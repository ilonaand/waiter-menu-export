#!/usr/bin/env node

/**
 * CLI: полный экспорт залов и столов из Firebird в MongoDB.
 * Параметры подключения — из .env или аргументов (--fb*, --mongo*).
 */

const fs = require('fs').promises;
const path = require('path');
const { runExportHallsTables } = require('../lib/runExportHallsTables');
const { parseArgs, connectionOverridesFromCli } = require('../lib/cliCommon');

function hallsOverridesFromCli(cli) {
  const o = { ...connectionOverridesFromCli(cli) };
  const put = (envKey, val) => {
    if (val != null && val !== '') o[envKey] = String(val);
  };

  put('COL_RESTAURANT_HALL', cli.colRestaurantHall);
  put('COL_RESTAURANT_TABLE', cli.colRestaurantTable);

  return o;
}

async function main() {
  const cli = parseArgs(process.argv);
  const startedAt = new Date().toISOString();
  const resultPath = cli.resultFile
    ? path.resolve(cli.resultFile)
    : path.join(process.cwd(), 'export-halls.result.json');

  const overrides = hallsOverridesFromCli(cli);

  /** @type {object} */
  let payload;

  try {
    const summary = await runExportHallsTables({ overrides });
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
