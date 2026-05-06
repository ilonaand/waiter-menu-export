/**
 * One-menu import: Firebird (Gedemin) → MongoDB per PROMPT_firebird_menu_to_mongo.md
 */

const path = require('path');
const Firebird = require('node-firebird');
const { MongoClient, ObjectId } = require('mongodb');
const { firebirdAttachOptionsFromEnv } = require('./firebirdAttachOptions');

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

function bool01(val) {
  return num(val, 0) === 1;
}

function toDate(val) {
  if (val == null) return null;
  if (val instanceof Date) return val;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toDateOnly(val) {
  const d = toDate(val);
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

function roundCostToCents(costRub) {
  if (costRub == null || costRub === '') return 0;
  let x;
  if (typeof costRub === 'number') x = costRub;
  else if (typeof costRub === 'string') {
    const s = costRub.trim().replace(',', '.');
    x = Number(s);
  } else x = Number(costRub);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100);
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

function fbGroupCode(alias, id) {
  const a = alias == null ? '' : String(alias).trim();
  if (a.length > 0) return a;
  return `gg:${id}`;
}

function isPosInt(n) {
  return Number.isInteger(n) && n > 0;
}

function assertMenuKey(menuDocumentKey) {
  const k = Number(menuDocumentKey);
  if (!isPosInt(k)) {
    throw new Error(`Invalid menuDocumentKey: ${menuDocumentKey}`);
  }
  return k;
}

function sqlIntList(ids) {
  const uniq = [...new Set(ids)].filter(isPosInt);
  if (!uniq.length) return null;
  return uniq.join(',');
}

/**
 * @param {object} options
 * @param {string|number} options.menuDocumentKey
 * @param {object} [options.overrides] env overrides from CLI
 * @returns {Promise<object>} result summary
 */
async function runImport({ menuDocumentKey, overrides = {} }) {
  tryLoadDotenv();

  const env = { ...process.env, ...overrides };
  const menuKey = assertMenuKey(menuDocumentKey);

  const firebirdOptions = firebirdAttachOptionsFromEnv(env);

  if (!firebirdOptions.database) {
    throw new Error('FIREBIRD_DB is required');
  }

  const MONGODB_URI = env.MONGODB_URI;
  const MONGODB_DB = env.MONGODB_DB;
  if (!MONGODB_URI) throw new Error('MONGODB_URI is required');
  if (!MONGODB_DB) throw new Error('MONGODB_DB is required');

  const COL_UNIT = env.COL_UNIT || 'Unit';
  const COL_GOOD = env.COL_GOOD || 'Good';
  const COL_GOOD_GROUP = env.COL_GOOD_GROUP || 'GoodGroup';
  const COL_GOOD_GROUP_MEMBERSHIP = env.COL_GOOD_GROUP_MEMBERSHIP || 'GoodGroupMembership';
  const COL_GROUP_HIERARCHY = env.COL_GROUP_HIERARCHY || 'GroupHierarchy';
  const COL_PRICE_LIST_TYPE = env.COL_PRICE_LIST_TYPE || 'pos-priceListType';
  const COL_PRICE_LIST = env.COL_PRICE_LIST || 'pos-priceList';
  const COL_PRICE_LIST_LINE = env.COL_PRICE_LIST_LINE || 'pos-priceListLine';

  const mongoOptions = {
    socketTimeoutMS: parseInt(env.MONGO_SOCKET_TIMEOUT_MS || '300000', 10),
    serverSelectionTimeoutMS: parseInt(env.MONGO_SERVER_SELECTION_TIMEOUT_MS || '30000', 10),
  };

  const now = new Date();
  const stats = {
    goodUpserts: 0,
    groupUpserts: 0,
    membershipUpserts: 0,
    linesDeleted: 0,
    linesInserted: 0,
    warnings: [],
  };

  let fbDb = null;
  const mongo = new MongoClient(MONGODB_URI, mongoOptions);
  await mongo.connect();
  try {
    fbDb = await attachFirebird(firebirdOptions);
    const db = mongo.db(MONGODB_DB);
    const colUnit = db.collection(COL_UNIT);
    const colHierarchy = db.collection(COL_GROUP_HIERARCHY);
    const colPlType = db.collection(COL_PRICE_LIST_TYPE);
    const colGood = db.collection(COL_GOOD);
    const colGroup = db.collection(COL_GOOD_GROUP);
    const colMembership = db.collection(COL_GOOD_GROUP_MEMBERSHIP);
    const colPl = db.collection(COL_PRICE_LIST);
    const colLine = db.collection(COL_PRICE_LIST_LINE);

    // --- refs: Unit, Hierarchy, priceListType
    await colUnit.findOneAndUpdate(
      { name: 'шт' },
      {
        $set: { name: 'шт', updatedAt: now },
        $setOnInsert: {
          createdAt: now,
          createdBy: new ObjectId('000000000000000000000000'),
          updatedBy: new ObjectId('000000000000000000000000'),
        },
      },
      { upsert: true }
    );
    const unitFresh = await colUnit.findOne({ name: 'шт' });
    if (!unitFresh) throw new Error('Failed to upsert Unit (шт)');
    const unitId = unitFresh._id;

    await colHierarchy.findOneAndUpdate(
      { code: 'menu' },
      {
        $set: {
          code: 'menu',
          name: env.MENU_HIERARCHY_NAME || 'Иерархия меню',
          description: env.MENU_HIERARCHY_DESC || '',
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );
    const hierarchyFresh = await colHierarchy.findOne({ code: 'menu' });
    if (!hierarchyFresh) throw new Error('Failed to upsert GroupHierarchy (menu)');
    const hierarchyId = hierarchyFresh._id;

    await colPlType.findOneAndUpdate(
      { name: 'menu' },
      {
        $set: { name: 'menu', disabled: false, updatedAt: now },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );
    const plTypeFresh = await colPlType.findOne({ name: 'menu' });
    if (!plTypeFresh) throw new Error('Failed to upsert priceListType (menu)');
    const priceListTypeId = plTypeFresh._id;

    // --- 6.1 Header
    const headerSql = `
      SELECT
        Z.ID AS DOC_ID,
        Z.DOCUMENTDATE AS DOC_DATE,
        Z.DISABLED AS DOC_DISABLED,
        U.USR$TODATE, U.USR$NOTACTIVE, U.USR$NOGROUPS, U.USR$ALTERGROUPS,
        U.USR$MENUNAMEKEY, U.USR$DEPOTKEY
      FROM GD_DOCUMENT Z
      JOIN USR$MN_MENU U ON U.DOCUMENTKEY = Z.ID
      WHERE Z.ID = ?
    `;
    const headerRows = await query(fbDb, headerSql, [menuKey]);
    if (!headerRows.length) {
      throw new Error(`Menu document not found: USR$MN_MENU.DOCUMENTKEY=${menuKey}`);
    }
    const H = headerRows[0];

    let menuname = null;
    const mnKey = H['USR$MENUNAMEKEY'];
    if (mnKey != null) {
      const mnRows = await query(fbDb, 'SELECT FIRST 1 USR$NAME FROM USR$MN_MENUNAME WHERE ID = ?', [
        mnKey,
      ]);
      if (mnRows.length) menuname = mnRows[0]['USR$NAME'];
    }

    let depotName = null;
    const depotKey = H['USR$DEPOTKEY'];
    if (depotKey != null) {
      const cRows = await query(fbDb, 'SELECT FIRST 1 NAME, ADDRESS FROM GD_CONTACT WHERE ID = ?', [
        depotKey,
      ]);
      if (cRows.length) depotName = cRows[0].NAME;
    }

    const docId = H.DOC_ID;
    const docNumber = null;
    const fromDateStr = toDateOnly(H.DOC_DATE);
    let toDateStr = toDateOnly(H['USR$TODATE']);
    if (!toDateStr) toDateStr = fromDateStr;

    // Детерминированное имя для upsert по `name`: DOCUMENT.ID (USR$MN_MENUNAME — только метаданные)
    const priceListName = `Меню ${docId}`;

    const disabled = bool01(H.DOC_DISABLED) || bool01(H['USR$NOTACTIVE']);
    const noGroups = bool01(H['USR$NOGROUPS']);
    const alternativeGroups = bool01(H['USR$ALTERGROUPS']);

    // --- Lines
    const lineSql = `
      SELECT USR$GOODKEY, USR$COST, USR$QUANTITY, USR$SORTNUMBER
      FROM USR$MN_MENULINE
      WHERE MASTERKEY = ?
      ORDER BY COALESCE(USR$SORTNUMBER, 0)
    `;
    const lines = await query(fbDb, lineSql, [menuKey]);

    const goodIdsNeeded = [];
    for (const L of lines) {
      const gk = L['USR$GOODKEY'];
      if (gk == null) {
        stats.warnings.push('Menu line without USR$GOODKEY (skipped)');
        continue;
      }
      goodIdsNeeded.push(Number(gk));
    }
    const goodIdListSql = sqlIntList(goodIdsNeeded);
    const goodsById = new Map();
    if (goodIdListSql) {
      const goodSql = `
        SELECT ID, NAME, ALIAS, BARCODE, GROUPKEY, ISASSEMBLY,
               USR$BEDIVIDE, USR$GTIN, DISABLED
        FROM GD_GOOD
        WHERE ID IN (${goodIdListSql})
      `;
      const gRows = await query(fbDb, goodSql);
      for (const g of gRows) goodsById.set(Number(g.ID), g);
    }

    // --- Group closure from goods
    let initialGroupIds = [...goodsById.values()]
      .map((g) => g.GROUPKEY)
      .filter((x) => x != null)
      .map((x) => Number(x));
    const groupsById = new Map();
    let frontier = [...new Set(initialGroupIds)];
    while (frontier.length) {
      const list = sqlIntList(frontier);
      frontier = [];
      if (!list) break;
      const ggrRows = await query(
        fbDb,
        `SELECT ID, PARENT, NAME, ALIAS, DISABLED FROM GD_GOODGROUP WHERE ID IN (${list})`
      );
      for (const r of ggrRows) {
        const id = Number(r.ID);
        if (groupsById.has(id)) continue;
        groupsById.set(id, r);
        const p = r.PARENT;
        if (p != null) {
          const pid = Number(p);
          if (!groupsById.has(pid)) frontier.push(pid);
        }
      }
    }

    const groupObjectIdByFbId = new Map();

    function isFbRootRow(r, map) {
      const p = r.PARENT;
      if (p == null) return true;
      return !map.has(Number(p));
    }

    async function upsertGoodGroupFbRow(fbRow, needSynthetic, syntheticRootId) {
      const fbId = Number(fbRow.ID);
      const code = fbGroupCode(fbRow.ALIAS, fbId);
      const title = (fbRow.NAME && String(fbRow.NAME).trim()) || `Группа ${fbId}`;
      const disabled = bool01(fbRow.DISABLED);
      const fbRoot = isFbRootRow(fbRow, groupsById);
      const parentFbId = fbRow.PARENT != null ? Number(fbRow.PARENT) : null;

      let parentMongoId = null;
      let ancestors = [];
      let depthVal = 0;

      if (needSynthetic && syntheticRootId) {
        if (fbRoot) {
          parentMongoId = syntheticRootId;
          ancestors = [syntheticRootId];
          depthVal = 1;
        } else if (parentFbId != null) {
          parentMongoId = groupObjectIdByFbId.get(parentFbId) || null;
          const pRow = groupsById.get(parentFbId);
          const pcode = pRow ? fbGroupCode(pRow.ALIAS, parentFbId) : `gg:${parentFbId}`;
          const parentDoc = await colGroup.findOne({ hierarchyId, code: pcode });
          ancestors = [...(parentDoc?.ancestors || []), parentMongoId];
          depthVal = Number(parentDoc?.depth ?? 0) + 1;
        }
      } else if (!fbRoot && parentFbId != null) {
        parentMongoId = groupObjectIdByFbId.get(parentFbId) || null;
        const pRow = groupsById.get(parentFbId);
        const pcode = pRow ? fbGroupCode(pRow.ALIAS, parentFbId) : `gg:${parentFbId}`;
        const parentDoc = await colGroup.findOne({ hierarchyId, code: pcode });
        ancestors = [...(parentDoc?.ancestors || []), parentMongoId];
        depthVal = Number(parentDoc?.depth ?? 0) + 1;
      } else if (fbRoot) {
        parentMongoId = null;
        ancestors = [];
        depthVal = 0;
      }

      await colGroup.findOneAndUpdate(
        { hierarchyId, code },
        {
          $set: {
            hierarchyId,
            code,
            name: title,
            parentId: parentMongoId,
            ancestors,
            depth: depthVal,
            disabled,
            __fbId: fbId,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true }
      );

      const fresh = await colGroup.findOne({ hierarchyId, code });
      if (fresh) groupObjectIdByFbId.set(fbId, fresh._id);
      stats.groupUpserts += 1;
    }

    const SYN_CODE = 'menu-import-root';

    if (groupsById.size > 0) {
      const fbRoots = [...groupsById.values()].filter((r) => isFbRootRow(r, groupsById));
      const needSynthetic = fbRoots.length !== 1;

      let syntheticRootId = null;
      if (needSynthetic) {
        if (fbRoots.length > 1) {
          stats.warnings.push(
            `GoodGroup closure has ${fbRoots.length} Firebird roots — attaching them under synthetic root "${SYN_CODE}"`
          );
        }
        await colGroup.findOneAndUpdate(
          { hierarchyId, code: SYN_CODE },
          {
            $set: {
              hierarchyId,
              code: SYN_CODE,
              name: 'Корень',
              parentId: null,
              ancestors: [],
              depth: 0,
              updatedAt: now,
            },
            $setOnInsert: { createdAt: now },
          },
          { upsert: true }
        );
        const synFresh = await colGroup.findOne({ hierarchyId, code: SYN_CODE });
        syntheticRootId = synFresh ? synFresh._id : null;
        stats.groupUpserts += 1;
      }

      const orderedRoots = [...fbRoots].sort((a, b) => Number(a.ID) - Number(b.ID));
      const queue = orderedRoots.map((r) => Number(r.ID));
      const queued = new Set(queue);
      const visited = new Set();

      while (queue.length) {
        const id = queue.shift();
        if (visited.has(id)) continue;
        visited.add(id);
        const row = groupsById.get(id);
        if (!row) continue;
        await upsertGoodGroupFbRow(row, needSynthetic, syntheticRootId);

        const children = [...groupsById.values()]
          .filter((g) => g.PARENT != null && Number(g.PARENT) === id)
          .sort((a, b) => Number(a.ID) - Number(b.ID));
        for (const ch of children) {
          const cid = Number(ch.ID);
          if (!queued.has(cid)) {
            queued.add(cid);
            queue.push(cid);
          }
        }
      }

      for (const g of [...groupsById.values()].sort((a, b) => Number(a.ID) - Number(b.ID))) {
        const gid = Number(g.ID);
        if (visited.has(gid)) continue;
        stats.warnings.push(`GoodGroup ${gid}: not reached by BFS from roots (orphan/cycle) — upserting last`);
        await upsertGoodGroupFbRow(g, needSynthetic, syntheticRootId);
      }
    }

    // --- Goods
    const goodObjectIdByFbId = new Map();
    for (const [, g] of goodsById) {
      const gid = Number(g.ID);
      const internalCode = String(gid);
      const alias = g.ALIAS != null ? String(g.ALIAS).trim().slice(0, 16) : '';
      const barcode = g.BARCODE != null && String(g.BARCODE).trim() !== '' ? String(g.BARCODE).trim() : undefined;

      await colGood.findOneAndUpdate(
        { internalCode },
        {
          $set: {
            name: String(g.NAME || `Товар ${gid}`),
            ...(alias ? { alias } : {}),
            ...(barcode ? { barcode } : {}),
            unitId,
            isAssembly: bool01(g.ISASSEMBLY),
            // В этой схеме признак дробного/весового товара не используем (всегда 0)
            isFractional: false,
            ...(g['USR$GTIN'] ? { GTIN: String(g['USR$GTIN']) } : {}),
            __fbId: gid,
            disabled: bool01(g.DISABLED),
            updatedAt: now,
          },
          $setOnInsert: { internalCode, createdAt: now },
        },
        { upsert: true }
      );
      const gFresh = await colGood.findOne({ internalCode });
      if (!gFresh) throw new Error(`Failed to upsert Good internalCode=${internalCode}`);
      goodObjectIdByFbId.set(gid, gFresh._id);
      stats.goodUpserts += 1;
    }

    // --- Membership (primary group from GROUPKEY)
    for (const [, g] of goodsById) {
      const gid = Number(g.ID);
      const gk = g.GROUPKEY != null ? Number(g.GROUPKEY) : null;
      if (!gk || !groupObjectIdByFbId.has(gk)) {
        if (gk) stats.warnings.push(`Good ${gid}: GROUPKEY ${gk} not loaded for membership`);
        continue;
      }
      const fbGr = groupsById.get(gk);
      const gCode = fbGr ? fbGroupCode(fbGr.ALIAS, gk) : `gg:${gk}`;
      const groupDoc = await colGroup.findOne({ hierarchyId, code: gCode });
      if (!groupDoc) continue;

      const goodId = goodObjectIdByFbId.get(gid);
      const groupId = groupDoc._id;
      const ancestorGroupIds = [...(groupDoc.ancestors || [])];

      await colMembership.findOneAndUpdate(
        { goodId, groupId },
        {
          $set: {
            goodId,
            groupId,
            hierarchyId,
            ancestorGroupIds,
            isPrimary: true,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true }
      );
      stats.membershipUpserts += 1;
    }

    // --- priceList upsert по детерминированному имени (`Меню <DOCUMENT.ID>`)
    const plFilter = { name: priceListName };
    await colPl.findOneAndUpdate(
      plFilter,
      {
        $set: {
          name: priceListName,
          priceListTypeId,
          fromDate: fromDateStr,
          toDate: toDateStr,
          noGroups,
          alternativeGroups,
          disabled,
          navigationHierarchyId: hierarchyId,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );
    const plFresh = await colPl.findOne(plFilter);
    if (!plFresh || !plFresh._id) {
      throw new Error(`Failed to upsert price list (${priceListName})`);
    }
    const priceListId = plFresh._id;

    // --- Lines: delete then insert
    const delRes = await colLine.deleteMany({ priceListId });
    stats.linesDeleted = delRes.deletedCount || 0;

    const bulkLines = [];
    for (const L of lines) {
      const gk = L['USR$GOODKEY'];
      if (gk == null) continue;
      const gid = Number(gk);
      const goodOid = goodObjectIdByFbId.get(gid);
      if (!goodOid) {
        stats.warnings.push(`Line skipped: Good ID ${gk} missing in GD_GOOD`);
        continue;
      }
      bulkLines.push({
        priceListId,
        goodId: goodOid,
        price: roundCostToCents(L['USR$COST']),
        quantity: num(L['USR$QUANTITY'], 0),
        disabled: false,
        createdAt: now,
        updatedAt: now,
      });
    }
    if (bulkLines.length) {
      await colLine.insertMany(bulkLines, { ordered: false });
      stats.linesInserted = bulkLines.length;
    }

    return {
      ok: true,
      menuDocumentKey: menuKey,
      priceListId: String(priceListId),
      priceListName,
      stats,
      logged: { menuname, depotName, docNumber: docNumber != null ? String(docNumber) : null },
    };
  } finally {
    try {
      if (fbDb) fbDb.detach();
    } catch (_) {}
    await mongo.close();
  }
}

module.exports = { runImport };
