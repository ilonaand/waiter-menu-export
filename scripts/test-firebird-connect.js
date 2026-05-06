#!/usr/bin/env node
/**
 * Проверка: Firebird.attach + SELECT FIRST 1 … из RDB$DATABASE (те же опции, что у импорта).
 */

const path = require('path');

try {
  require('dotenv').config({
    path: path.join(__dirname, '..', '.env'),
    override: true,
  });
} catch (_) {}

const Firebird = require('node-firebird');
const { firebirdAttachOptionsFromEnv } = require('../src/lib/firebirdAttachOptions');

function attach(opts) {
  return new Promise((resolve, reject) => {
    Firebird.attach(opts, (err, db) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
}

function probe(db) {
  return new Promise((resolve, reject) => {
    db.query('SELECT FIRST 1 1 AS OK FROM RDB$DATABASE', [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function main() {
  const attachOpts = firebirdAttachOptionsFromEnv(process.env);

  console.log(
    `FIREBIRD: ${attachOpts.host}:${attachOpts.port} db=${attachOpts.database || '(empty)'} user=${attachOpts.user}`
  );
  const plug =
    attachOpts.pluginName == null ? 'auto (driver default)' : attachOpts.pluginName;
  const wire =
    attachOpts.wireCrypt === Firebird.WIRE_CRYPT_ENABLE ? 'enable' : 'disable';
  console.log(`auth plugin used: ${plug}, wireCrypt: ${wire}`);

  if (!attachOpts.database || !String(attachOpts.database).trim()) {
    console.log('Нет FIREBIRD_DB в .env.');
    process.exitCode = 1;
    return;
  }

  let db;
  try {
    db = await attach(attachOpts);
    const rows = await probe(db);
    console.log('OK:', rows);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    console.log('FAIL:', msg);
    process.exitCode = 1;
  } finally {
    if (db && typeof db.detach === 'function') {
      try {
        db.detach();
      } catch (_) {}
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
