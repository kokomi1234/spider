'use strict';
/**
 * 常用查询的 SQLite 存储层（代理侧）
 * ------------------------------------------------------------------
 * 为什么不再用一个 JSON 文件：
 *   · JSON 文件存的是「一条条记录」，记录里只有**一个** owner —— 于同一份查询条件
 *     被 10 个人保存过，只能拆成 10 条，谁也说不清它到底被多少人用过。
 *   · 现在拆成「查询本体」+「谁保存过」两张表，两种视图一次拿到：
 *       一个人的常用查询  → savers 表里这个人关联的所有查询；
 *       部门的高频查询    → 同一份条件在本部门里 **COUNT(DISTINCT 人)**。
 *
 * 依赖：只用 Node 内置的 `node:sqlite`（Node ≥ 22.5，本机 22.22 实测可用），
 * **不装任何 npm 包** —— 内网 / 离线环境照样能跑（与 vendoring playwright 同一个思路）。
 * 万一 Node 版本不够，`open()` 会抛 ERR_NO_SQLITE，由调用方降级回 JSON 文件，
 * 功能不残废。
 */

/** @type {null|Object} require 失败的缓存，避免每次请求都试一遍 */
let sqliteMod;

function loadSqlite() {
  if (sqliteMod !== undefined) return sqliteMod;
  try {
    // eslint-disable-next-line global-require
    sqliteMod = require('node:sqlite');
  } catch (_) {
    sqliteMod = null;
  }
  return sqliteMod;
}

/** 能不能用 SQLite：版本不够 / 内置模块被裁掉时 false */
function available() {
  return !!loadSqlite();
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS saved_queries (
  id            TEXT PRIMARY KEY,
  page          TEXT NOT NULL,
  name          TEXT NOT NULL,
  summary       TEXT NOT NULL DEFAULT '',
  fields        TEXT NOT NULL DEFAULT '{}',
  labels        TEXT NOT NULL DEFAULT '{}',
  fingerprint   TEXT NOT NULL DEFAULT '',
  hits          INTEGER NOT NULL DEFAULT 0,
  saves         INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL DEFAULT 0,
  last_opened_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS saved_query_savers (
  query_id   TEXT NOT NULL,
  user_key   TEXT NOT NULL,
  user_id    TEXT NOT NULL DEFAULT '',
  user_name  TEXT NOT NULL DEFAULT '',
  team_id    TEXT NOT NULL DEFAULT '',
  team_name  TEXT NOT NULL DEFAULT '',
  org_id     TEXT NOT NULL DEFAULT '',
  org_name   TEXT NOT NULL DEFAULT '',
  dept_key   TEXT NOT NULL DEFAULT '',
  saved_at   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (query_id, user_key)
);
CREATE TABLE IF NOT EXISTS saved_query_tombstones (
  query_id TEXT PRIMARY KEY,
  at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_savers_user  ON saved_query_savers (user_key);
CREATE INDEX IF NOT EXISTS idx_savers_dept  ON saved_query_savers (dept_key);
CREATE INDEX IF NOT EXISTS idx_savers_query ON saved_query_savers (query_id);
`;

/** 部门的归并键，口径与前端 SavedQuery.deptKeyOf 一致：team 优先，org 兜底 */
function deptKeyOf(u) {
  if (!u || typeof u !== 'object') return '';
  return String(u.teamId || u.teamName || u.orgId || u.orgName || '').trim();
}

/** 同一份条件的指纹，口径与前端 SavedQuery.fingerprintOf 一致 */
function fingerprintOf(item) {
  let f = {};
  try {
    const raw = typeof item.fields === 'string' ? JSON.parse(item.fields) : (item.fields || {});
    if (raw && typeof raw === 'object') f = raw;
  } catch (_) { f = {}; }
  const keys = Object.keys(f).filter((k) => {
    const v = f[k];
    if (v == null || v === '') return false;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  });
  if (!keys.length) return '';
  return `${item.page}?${keys.sort().map((k) => {
    const v = f[k];
    return `${k}=${Array.isArray(v) ? v.map(String).sort().join(',') : String(v)}`;
  }).join('&')}`;
}

/** 一个人在这台机器上的唯一标识：有工号用工号，否则用姓名（两端口径一致） */
function userKeyOf(owner) {
  const o = owner && typeof owner === 'object' ? owner : {};
  return String(o.userId || o.userName || '').trim();
}

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : (d || 0));

/**
 * 打开（或新建）数据库。
 * @param {string} file SQLite 文件路径
 * @returns {object} store
 */
function open(file) {
  const mod = loadSqlite();
  if (!mod) {
    const e = new Error('当前 Node 不支持内置的 node:sqlite（需要 Node ≥ 22.5）');
    e.code = 'ERR_NO_SQLITE';
    throw e;
  }
  const db = new mod.DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');   // 多人同时读写时，写不阻塞读
  db.exec(SCHEMA);

  // ── 语句 ────────────────────────────────────────────────
  const insQuery = db.prepare(`
    INSERT INTO saved_queries
      (id, page, name, summary, fields, labels, fingerprint, hits, saves, created_at, updated_at, last_opened_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      page=excluded.page, name=excluded.name, summary=excluded.summary,
      fields=excluded.fields, labels=excluded.labels, fingerprint=excluded.fingerprint,
      hits=MAX(saved_queries.hits, excluded.hits),
      saves=MAX(saved_queries.saves, excluded.saves),
      updated_at=MAX(saved_queries.updated_at, excluded.updated_at),
      last_opened_at=MAX(saved_queries.last_opened_at, excluded.last_opened_at)
  `);
  const insSaver = db.prepare(`
    INSERT INTO saved_query_savers
      (query_id, user_key, user_id, user_name, team_id, team_name, org_id, org_name, dept_key, saved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(query_id, user_key) DO UPDATE SET
      user_name=excluded.user_name, team_name=excluded.team_name, org_name=excluded.org_name,
      dept_key=excluded.dept_key, saved_at=MAX(saved_query_savers.saved_at, excluded.saved_at)
  `);
  const insTomb = db.prepare('INSERT OR REPLACE INTO saved_query_tombstones (query_id, at) VALUES (?, ?)');
  const selTomb = db.prepare('SELECT query_id, at FROM saved_query_tombstones');
  const delTomb = db.prepare('DELETE FROM saved_query_tombstones WHERE at < ?');
  const delSavers = db.prepare('DELETE FROM saved_query_savers WHERE query_id = ?');
  const delQuery = db.prepare('DELETE FROM saved_queries WHERE id = ?');
  const selAll = db.prepare('SELECT * FROM saved_queries WHERE id NOT IN (SELECT query_id FROM saved_query_tombstones)');
  const selSaversOf = db.prepare('SELECT * FROM saved_query_savers WHERE query_id = ? ORDER BY saved_at ASC');
  const deptTotal = db.prepare('SELECT COUNT(DISTINCT user_key) AS c FROM saved_query_savers');

  const TOMB_KEEP_MS = 30 * 24 * 3600 * 1000;   // 与前端/旧 JSON 实现一致：墓碑留 30 天

  /** 一条 query + 它的保存者 → 前端要的记录形状（带 owner，兼容旧契约） */
  function toRecord(row) {
    const savers = selSaversOf.all(row.id);
    const first = savers[0] || null;
    let fields = {};
    try { fields = JSON.parse(row.fields || '{}'); } catch (_) { fields = {}; }
    let labels = {};
    try { labels = JSON.parse(row.labels || '{}'); } catch (_) { labels = {}; }
    return {
      id: row.id,
      page: row.page,
      name: row.name,
      summary: row.summary || '',
      fields,
      labels,
      hits: Number(row.hits) || 0,
      saves: Number(row.saves) || 1,
      at: Number(row.created_at) || 0,
      lastAt: Number(row.last_opened_at) || 0,
      owner: first ? {
        userId: first.user_id, userName: first.user_name,
        teamId: first.team_id, teamName: first.team_name,
        orgId: first.org_id, orgName: first.org_name,
      } : null,
      // 服务端算好的「几个人保存过」：前端不必再猜
      savers: new Set(savers.map((s) => s.user_key)).size,
      saverNames: [...new Set(savers.map((s) => s.user_name || s.user_key))],
      recentUser: savers.length
        ? (savers.slice().sort((a, b) => b.saved_at - a.saved_at)[0].user_name || '')
        : '',
      v: 2,
    };
  }

  return {
    kind: 'sqlite',
    file,
    db,

    /** 全部记录（未删的），形状与旧 JSON 一致 */
    all() { return selAll.all().map(toRecord); },

    /** 墓碑列表 [{key, at}]，形状与旧 JSON 一致 */
    tombstones() { return selTomb.all().map((t) => ({ key: t.query_id, at: t.at })); },

    /**
     * 提交一批记录（幂等）。
     * @param {Array} items 记录（每个带 owner）
     * @param {string[]} deletedIds 要删掉的 id（立墓碑）
     */
    upsert(items, deletedIds) {
      const now = Date.now();
      (Array.isArray(items) ? items : []).forEach((it) => {
        if (!it || typeof it !== 'object' || !it.id || !it.page) return;
        const owner = it.owner && typeof it.owner === 'object' ? it.owner : {};
        const at = num(it.at, now) || now;
        insQuery.run(
          String(it.id), String(it.page), String(it.name || '未命名查询'),
          String(it.summary || ''),
          JSON.stringify(it.fields && typeof it.fields === 'object' ? it.fields : {}),
          JSON.stringify(it.labels && typeof it.labels === 'object' ? it.labels : {}),
          fingerprintOf(it),
          num(it.hits, 0), Math.max(1, num(it.saves, 1)),
          at, num(it.at, at), num(it.lastAt, 0),
        );
        const uk = userKeyOf(owner);
        if (uk) {
          insSaver.run(
            String(it.id), uk,
            String(owner.userId || ''), String(owner.userName || uk),
            String(owner.teamId || ''), String(owner.teamName || ''),
            String(owner.orgId || ''), String(owner.orgName || ''),
            deptKeyOf(owner), at,
          );
        }
      });
      (Array.isArray(deletedIds) ? deletedIds : []).forEach((id) => {
        const key = String(id || '');
        if (!key) return;
        insTomb.run(key, now);
        delSavers.run(key);
        delQuery.run(key);
      });
      delTomb.run(now - TOMB_KEEP_MS);
      return { items: this.all(), deleted: this.tombstones() };
    },

    /**
     * 某人保存过的查询（个人视图）。
     * @param {string} userKey 工号 / 姓名
     * @param {number} [limit]
     */
    byUser(userKey, limit) {
      const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
      const rows = db.prepare(`
        SELECT * FROM saved_queries q
        JOIN saved_query_savers s ON s.query_id = q.id
        WHERE s.user_key = ?
          AND q.id NOT IN (SELECT query_id FROM saved_query_tombstones)
        ORDER BY MAX(s.saved_at, q.last_opened_at) DESC
        LIMIT ?
      `).all(String(userKey || ''), n);
      return rows.map((r) => toRecord(r));
    },

    /**
     * 部门高频查询：**同一份查询条件被本部门几个人保存过**，人多者排前。
     * @param {string} deptKey teamId ‖ teamName ‖ orgId ‖ orgName
     * @param {number} [limit]
     */
    deptTop(deptKey, limit) {
      const key = String(deptKey || '');
      if (!key) return [];
      const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;
      // 聚合口径：同一份条件（fingerprint 相同）算同一个查询；没填条件的各自成组。
      // 代表行取「最近有人保存的那条」，名字/摘要用它 —— 也就是当前大家在用的那份。
      const rows = db.prepare(`
        WITH scoped AS (
          SELECT q.*, s.user_key, s.user_name, s.saved_at,
                 CASE WHEN q.fingerprint <> '' THEN q.fingerprint ELSE 'solo:' || q.id END AS gid
          FROM saved_queries q
          JOIN saved_query_savers s ON s.query_id = q.id
          WHERE s.dept_key = ?
            AND q.id NOT IN (SELECT query_id FROM saved_query_tombstones)
        ),
        agg AS (
          SELECT gid,
                 COUNT(DISTINCT user_key) AS savers,
                 MAX(saved_at) AS last_saved,
                 GROUP_CONCAT(DISTINCT user_name) AS people
          FROM scoped
          GROUP BY gid
        )
        SELECT scoped.id, scoped.page, scoped.name, scoped.summary, scoped.fields,
               scoped.labels, scoped.hits, scoped.saves, scoped.created_at,
               scoped.updated_at, scoped.last_opened_at, scoped.user_key,
               scoped.user_name, scoped.saved_at,
               agg.savers AS savers, agg.last_saved AS last_saved, agg.people AS people
        FROM scoped
        JOIN agg ON agg.gid = scoped.gid AND agg.last_saved = scoped.saved_at
        ORDER BY agg.savers DESC, agg.last_saved DESC
        LIMIT ?
      `).all(key, n);
      // people 已经是**整个组**（同一份条件）的本部门人员名单：
      // 只取代表行那一条的话，会把同组其它人的名字埋掉。
      return rows.map((r) => {
        const rec = toRecord(r);
        const names = String(r.people || '').split(',').map((s) => s.trim()).filter(Boolean);
        return {
          ...rec,
          savers: Number(r.savers) || rec.savers,
          saverNames: names.length ? names : rec.saverNames,
          recentUser: r.user_name || rec.recentUser,
        };
      });
    },

    /** 库里不同保存者的数量（给诊断用：有没有真的在共享） */
    peopleCount() {
      const row = deptTotal.get();
      return row ? Number(row.c) || 0 : 0;
    },

    close() { try { db.close(); } catch (_) { /* 已关 */ } },
  };
}

module.exports = { open, available, deptKeyOf, fingerprintOf, userKeyOf };
