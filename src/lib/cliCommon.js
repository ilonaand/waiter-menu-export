/**
 * Shared CLI helpers for Gedemin launchers.
 */

function parseArgs(argv) {
  /** @type {Record<string, string> & { positional: string[] }} */
  const o = /** @type {any} */ ({ positional: [] });
  for (let i = 2; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) {
      o.positional.push(tok);
      continue;
    }
    const slice = tok.slice(2);
    const eq = slice.indexOf('=');
    let k;
    let v;
    if (eq >= 0) {
      k = slice.slice(0, eq);
      v = slice.slice(eq + 1);
    } else {
      k = slice;
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        v = argv[++i];
      } else {
        v = '1';
      }
    }
    o[k] = v;
  }
  return o;
}

function connectionOverridesFromCli(cli) {
  /** @type {Record<string, string>} */
  const o = {};
  const put = (envKey, val) => {
    if (val != null && val !== '') o[envKey] = String(val);
  };

  put('FIREBIRD_HOST', cli.fbHost);
  put('FIREBIRD_PORT', cli.fbPort);
  put('FIREBIRD_DB', cli.fbDb);
  put('FIREBIRD_USER', cli.fbUser);
  put('FIREBIRD_PASS', cli.fbPass);
  put('FIREBIRD_CHARSET', cli.fbCharset);
  put('FIREBIRD_AUTH_PLUGIN', cli.fbAuthPlugin);
  put('FIREBIRD_WIRE_CRYPT', cli.fbWireCrypt);

  put('MONGODB_URI', cli.mongoUri);
  put('MONGODB_DB', cli.mongoDb);

  return o;
}

module.exports = {
  parseArgs,
  connectionOverridesFromCli,
};
