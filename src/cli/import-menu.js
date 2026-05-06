#!/usr/bin/env node

/**
 * CLI: импорт одного меню (GD_DOCUMENT.ID = USR$MN_MENU.DOCUMENTKEY) из Firebird в MongoDB.
 * Учётные данные берут из .env; опционально можно переопределить из аргументов (для лаунчера Gedemin).
 */

const fs = require('fs').promises;
const path = require('path');
const { runImport } = require('../lib/runImport');

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

/**
 * Если `npm run` на Windows отрезал argv, часто остаётся env от npm (--key=value после `--`).
 * @returns {string|undefined}
 */
function menuKeyFromNpmConfigEnv() {
  const e = process.env;
  return (
    e.npm_config_menu_document_key ||
    e.npm_config_menuDocumentKey ||
    e.npm_config_menu_key ||
    undefined
  );
}

function overridesFromCli(cli) {
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

  put('COL_UNIT', cli.colUnit);
  put('COL_GOOD', cli.colGood);
  put('COL_GOOD_GROUP', cli.colGoodGroup);
  put('COL_GOOD_GROUP_MEMBERSHIP', cli.colGoodGroupMembership);
  put('COL_GROUP_HIERARCHY', cli.colHierarchy);
  put('COL_PRICE_LIST_TYPE', cli.colPriceListType);
  put('COL_PRICE_LIST', cli.colPriceList);
  put('COL_PRICE_LIST_LINE', cli.colPriceListLine);

  return o;
}

async function main() {
  const cli = parseArgs(process.argv);

  const startedAt = new Date().toISOString();
  /** @type {string} */
  let resultPath = cli.resultFile
    ? path.resolve(cli.resultFile)
    : path.join(process.cwd(), 'import-menu.result.json');

  const posId = cli.positional.find((a) => /^\d+$/.test(a));
  const menuDocumentKey =
    cli.menuDocumentKey ||
    cli.menuKey ||
    process.env.MENU_DOCUMENT_KEY ||
    menuKeyFromNpmConfigEnv() ||
    posId;
  const overrides = overridesFromCli(cli);

  /** @type {object} */
  let payload;

  try {
    if (!menuDocumentKey) {
      throw new Error(
        'Missing menuDocumentKey. Пример: node .\\src\\cli\\import-menu.js --menuDocumentKey=123 ' +
          'или .\\import-menu.cmd 123 (Windows). npm run на Windows часто не передаёт аргументы после --.'
      );
    }

    const summary = await runImport({
      menuDocumentKey,
      overrides,
    });

    const finishedAt = new Date().toISOString();

    payload = {
      ok: true,
      startedAt,
      finishedAt,
      summary,
    };

    console.log(JSON.stringify(summary, null, 2));

    await fs.writeFile(resultPath, JSON.stringify(payload, null, 2), 'utf8');
    process.exitCode = 0;
  } catch (e) {
    const finishedAt = new Date().toISOString();
    const msg = e && e.message ? e.message : String(e);
    payload = {
      ok: false,
      startedAt,
      finishedAt,
      error: msg,
    };
    console.error(msg);
    if (process.env.DEBUG_IMPORT === '1' && e && e.stack) console.error(e.stack);

    await fs.writeFile(resultPath, JSON.stringify(payload, null, 2), 'utf8');
    process.exitCode = 1;
  }
}

main();
