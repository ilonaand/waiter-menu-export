/**
 * Shared Firebird/Mongo helpers for export scripts.
 */

const path = require('path');
const Firebird = require('node-firebird');

function tryLoadDotenv() {
  try {
    require('dotenv').config({
      path: path.join(__dirname, '..', '..', '.env'),
      override: true,
    });
  } catch (_) {}
}

function num(val, def = 0) {
  if (val == null || val === '') return def;
  const n = Number(val);
  return Number.isFinite(n) ? n : def;
}

function query(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function attachFirebird(opts) {
  return new Promise((resolve, reject) => {
    Firebird.attach(opts, (err, db) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
}

function mongoClientOptionsFromEnv(env) {
  return {
    socketTimeoutMS: parseInt(env.MONGO_SOCKET_TIMEOUT_MS || '300000', 10),
    serverSelectionTimeoutMS: parseInt(env.MONGO_SERVER_SELECTION_TIMEOUT_MS || '30000', 10),
  };
}

module.exports = {
  tryLoadDotenv,
  num,
  query,
  attachFirebird,
  mongoClientOptionsFromEnv,
};
