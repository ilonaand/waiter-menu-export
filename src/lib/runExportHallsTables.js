/**
 * Full export: Firebird (Gedemin) halls + tables → MongoDB (pos-restaurantHall / pos-restaurantTable).
 */

const { MongoClient } = require('mongodb');
const { firebirdAttachOptionsFromEnv } = require('./firebirdAttachOptions');
const {
  tryLoadDotenv,
  num,
  query,
  attachFirebird,
  mongoClientOptionsFromEnv,
} = require('./firebirdUtil');

function positiveNum(val) {
  const n = num(val, NaN);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function strTrim(val) {
  if (val == null) return '';
  return String(val).trim();
}

function optionalStr(val) {
  const s = strTrim(val);
  return s.length ? s : undefined;
}

const HALLS_SQL = `
  SELECT
    hall.ID AS HALL_ID,
    hall.USR$NAME AS HALL_NAME,
    m.USR$WIDTHTABLE AS CANVAS_WIDTH,
    m.USR$HEIGHTTABLE AS CANVAS_HEIGHT
  FROM USR$FRONT_HALL hall
  INNER JOIN USR$FRONT_MAP m ON m.USR$HALLKEY = hall.ID
  ORDER BY hall.ID
`;

const TABLES_SQL = `
  SELECT
    Z.ID AS TABLE_ID,
    Z.USR$NUMTABLE,
    Z.USR$COLORTABLE,
    Z.USR$TOPTABLE,
    Z.USR$LEFTTABLE,
    Z.USR$HEIGHTTABLE,
    Z.USR$WIDTHTABLE,
    Z.USR$COUNTPERSON,
    Z.USR$MAPKEY,
    m.USR$HALLKEY AS HALL_ID
  FROM USR$FRONT_MAPTABLE Z
  INNER JOIN USR$FRONT_MAP m ON m.ID = Z.USR$MAPKEY
  ORDER BY m.USR$HALLKEY, Z.USR$NUMTABLE
`;

/**
 * @param {object} [options]
 * @param {object} [options.overrides] env overrides from CLI
 * @returns {Promise<object>}
 */
async function runExportHallsTables({ overrides = {} } = {}) {
  tryLoadDotenv();

  const env = { ...process.env, ...overrides };
  const firebirdOptions = firebirdAttachOptionsFromEnv(env);

  if (!firebirdOptions.database) {
    throw new Error('FIREBIRD_DB is required');
  }

  const MONGODB_URI = env.MONGODB_URI;
  const MONGODB_DB = env.MONGODB_DB;
  if (!MONGODB_URI) throw new Error('MONGODB_URI is required');
  if (!MONGODB_DB) throw new Error('MONGODB_DB is required');

  const COL_HALL = env.COL_RESTAURANT_HALL || 'pos-restaurantHall';
  const COL_TABLE = env.COL_RESTAURANT_TABLE || 'pos-restaurantTable';

  const mongoOptions = mongoClientOptionsFromEnv(env);

  const now = new Date();
  const stats = {
    hallsUpserted: 0,
    tablesUpserted: 0,
    hallsDeleted: 0,
    tablesDeleted: 0,
    warnings: [],
  };

  let fbDb = null;
  const mongo = new MongoClient(MONGODB_URI, mongoOptions);
  await mongo.connect();

  try {
    fbDb = await attachFirebird(firebirdOptions);
    const db = mongo.db(MONGODB_DB);
    const colHall = db.collection(COL_HALL);
    const colTable = db.collection(COL_TABLE);

    const hallRows = await query(fbDb, HALLS_SQL);
    const hallMongoIdByFbId = new Map();
    const fbHallIds = [];

    for (const row of hallRows) {
      const hallFbId = num(row.HALL_ID, NaN);
      if (!Number.isFinite(hallFbId) || hallFbId <= 0) {
        stats.warnings.push('Hall row skipped: invalid HALL_ID');
        continue;
      }

      const name = strTrim(row.HALL_NAME);
      if (!name) {
        stats.warnings.push(`Hall ${hallFbId} skipped: empty name`);
        continue;
      }

      const canvasWidth = positiveNum(row.CANVAS_WIDTH);
      const canvasHeight = positiveNum(row.CANVAS_HEIGHT);
      if (canvasWidth == null || canvasHeight == null) {
        stats.warnings.push(`Hall ${hallFbId} skipped: canvasWidth/canvasHeight must be > 0`);
        continue;
      }

      await colHall.findOneAndUpdate(
        { __fbId: hallFbId },
        {
          $set: {
            name,
            canvasWidth,
            canvasHeight,
            __fbId: hallFbId,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true }
      );

      const fresh = await colHall.findOne({ __fbId: hallFbId });
      if (!fresh || !fresh._id) {
        stats.warnings.push(`Hall ${hallFbId}: upsert failed`);
        continue;
      }

      hallMongoIdByFbId.set(hallFbId, fresh._id);
      fbHallIds.push(hallFbId);
      stats.hallsUpserted += 1;
    }

    const tableRows = await query(fbDb, TABLES_SQL);
    const fbTableIds = [];
    const seenNumberByHall = new Map();

    for (const row of tableRows) {
      const tableFbId = num(row.TABLE_ID, NaN);
      if (!Number.isFinite(tableFbId) || tableFbId <= 0) {
        stats.warnings.push('Table row skipped: invalid TABLE_ID');
        continue;
      }

      const hallFbId = num(row.HALL_ID, NaN);
      if (!Number.isFinite(hallFbId) || hallFbId <= 0) {
        stats.warnings.push(`Table ${tableFbId} skipped: invalid or missing HALL_ID (MAPKEY)`);
        continue;
      }

      const restaurantHallId = hallMongoIdByFbId.get(hallFbId);
      if (!restaurantHallId) {
        stats.warnings.push(`Table ${tableFbId} skipped: hall ${hallFbId} not exported`);
        continue;
      }

      const number = optionalStr(row.USR$NUMTABLE);
      if (!number) {
        stats.warnings.push(`Table ${tableFbId} skipped: empty USR$NUMTABLE`);
        continue;
      }

      const dupKey = `${hallFbId}:${number}`;
      if (seenNumberByHall.has(dupKey)) {
        stats.warnings.push(
          `Table ${tableFbId} skipped: duplicate number "${number}" in hall ${hallFbId}`
        );
        continue;
      }
      seenNumberByHall.set(dupKey, tableFbId);

      const top = num(row.USR$TOPTABLE, NaN);
      const left = num(row.USR$LEFTTABLE, NaN);
      const width = positiveNum(row.USR$WIDTHTABLE);
      const height = positiveNum(row.USR$HEIGHTTABLE);
      const maxPersonCount = positiveNum(row.USR$COUNTPERSON);

      if (
        !Number.isFinite(top) ||
        !Number.isFinite(left) ||
        width == null ||
        height == null ||
        maxPersonCount == null
      ) {
        stats.warnings.push(`Table ${tableFbId} skipped: invalid geometry or maxPersonCount`);
        continue;
      }

      const colorCode = optionalStr(row.USR$COLORTABLE);

      /** @type {Record<string, unknown>} */
      const setDoc = {
        restaurantHallId,
        number,
        shapeCode: 'rect',
        top,
        left,
        width,
        height,
        maxPersonCount,
        __fbId: tableFbId,
        updatedAt: now,
      };
      if (colorCode) setDoc.colorCode = colorCode;

      await colTable.findOneAndUpdate(
        { __fbId: tableFbId },
        {
          $set: setDoc,
          $setOnInsert: { createdAt: now },
        },
        { upsert: true }
      );

      fbTableIds.push(tableFbId);
      stats.tablesUpserted += 1;
    }

    if (fbTableIds.length) {
      const delTables = await colTable.deleteMany({ __fbId: { $nin: fbTableIds } });
      stats.tablesDeleted = delTables.deletedCount || 0;
    } else {
      const delTables = await colTable.deleteMany({});
      stats.tablesDeleted = delTables.deletedCount || 0;
    }

    if (fbHallIds.length) {
      const delHalls = await colHall.deleteMany({ __fbId: { $nin: fbHallIds } });
      stats.hallsDeleted = delHalls.deletedCount || 0;
    } else {
      const delHalls = await colHall.deleteMany({});
      stats.hallsDeleted = delHalls.deletedCount || 0;
    }

    return {
      ok: true,
      stats,
      hallsInFirebird: fbHallIds.length,
      tablesInFirebird: fbTableIds.length,
    };
  } finally {
    try {
      if (fbDb) fbDb.detach();
    } catch (_) {}
    await mongo.close();
  }
}

module.exports = { runExportHallsTables };
