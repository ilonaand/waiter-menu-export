'use strict';

const Firebird = require('node-firebird');

/**
 * Собирает options для Firebird.attach из FIREBIRD_* в env.
 * Если не задано иначе — legacy + wire crypt off.
 *
 * FIREBIRD_AUTH_PLUGIN: legacy | srp | srp256 | auto
 * FIREBIRD_WIRE_CRYPT: disable | enable
 *
 * @param {NodeJS.ProcessEnv} env
 */
function firebirdAttachOptionsFromEnv(env) {
  const host = env.FIREBIRD_HOST || '127.0.0.1';
  const portStr = env.FIREBIRD_PORT || '3050';

  const opts = {
    host,
    port: parseInt(portStr, 10),
    database: env.FIREBIRD_DB,
    user: env.FIREBIRD_USER || 'SYSDBA',
    password: env.FIREBIRD_PASS || '',
    lowercase_keys: false,
    encoding: env.FIREBIRD_CHARSET || 'WIN1251',
  };

  const plugRaw = env.FIREBIRD_AUTH_PLUGIN;
  let plug =
    plugRaw == null || String(plugRaw).trim() === ''
      ? 'legacy'
      : String(plugRaw).toLowerCase().trim();
  if (plug === 'auto') {
    // не задаём pluginName
  } else if (plug === 'srp') opts.pluginName = Firebird.AUTH_PLUGIN_SRP;
  else if (plug === 'srp256') opts.pluginName = Firebird.AUTH_PLUGIN_SRP256;
  else opts.pluginName = Firebird.AUTH_PLUGIN_LEGACY;

  const wc = String(env.FIREBIRD_WIRE_CRYPT || 'disable')
    .toLowerCase()
    .trim();
  if (wc === 'enable' || wc === '1' || wc === 'true' || wc === 'on') {
    opts.wireCrypt = Firebird.WIRE_CRYPT_ENABLE;
  } else {
    opts.wireCrypt = Firebird.WIRE_CRYPT_DISABLE;
  }

  const wcomp = String(env.FIREBIRD_WIRE_COMPRESSION || '')
    .toLowerCase()
    .trim();
  if (wcomp === '1' || wcomp === 'true' || wcomp === 'yes') {
    opts.wireCompression = true;
  }

  return opts;
}

module.exports = { firebirdAttachOptionsFromEnv };
