'use strict';
/**
 * 用户 token 存储（代理侧，SQLite）。
 *
 * 为什么要有它：token 以前是**全局一个**（.env 的 PROXY_TOKEN），所有人共用一个身份。
 * 现在改成「谁登录了就用他自己的 token」：
 *   · 用户在页面上录入自己的 token → 存进这张表，绑到他的工号；
 *   · 没录入 / 录了但过期 / 根本没登录 → 代理回落到**管理员 token**（.env 里那个，
 *     由运维工具每天自动刷新），只是那种状态下工具里会限制一部分功能。
 *
 * 过期规则（用户拍板）：内网 token **每天早上 5 点**失效，所以判定很直接 ——
 *   「录入时间早于最近一次 5:00」就算过期。
 * 这条规则天然支持「5 点后重新录入立刻生效」：新录入的 issued_at 晚于今天的 5:00。
 *
 * 与 lib/queries-db.js 同一套模式（node:sqlite + 懒加载 + available() 兜底）。
 */

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

/** 能不能用 SQLite：版本不够 / 内置模块被裁掉时 false（调用方回落到「只用管理员 token」） */
function available() {
  return !!loadSqlite();
}

/** token 每天几点失效（内网口径），判定与展示都用它 */
const EXPIRY_HOUR = 5;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS user_tokens (
  user_key   TEXT PRIMARY KEY,
  user_name  TEXT NOT NULL DEFAULT '',
  token      TEXT NOT NULL,
  issued_at  INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
`;

/** 「最近一次 5:00」的时间戳：早于它的 token 都算过期（5 点后录入的天然不算） */
function lastResetAt(now) {
  const t = Number.isFinite(now) ? now : Date.now();
  const d = new Date(t);
  d.setHours(EXPIRY_HOUR, 0, 0, 0);
  if (d.getTime() > t) d.setDate(d.getDate() - 1);   // 今天 5:00 还没到 → 用昨天那一次
  return d.getTime();
}

/** 这个 token 是不是已经过期（issuedAt 早于最近一次 5:00） */
function isExpired(issuedAt, now) {
  const at = Number(issuedAt) || 0;
  if (!at) return true;                    // 没有录入时间 = 不可信
  return at < lastResetAt(now);
}

/** 对外展示用的脱敏预览：只留头尾，中间的字符不落日志/不上面 */
function previewOf(token) {
  const s = String(token || '');
  if (s.length <= 8) return s ? s.slice(0, 2) + '...' : '';
  return s.slice(0, 4) + '...' + s.slice(-4);
}

/**
 * 打开（或新建）token 库。
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
  try { db.exec('PRAGMA busy_timeout = 2000'); } catch (_) { /* 老版本不认就不设 */ }
  try { db.exec('PRAGMA journal_mode = WAL'); } catch (_) { /* 保持库当前的日志模式 */ }
  db.exec(SCHEMA);

  const selOne = db.prepare('SELECT * FROM user_tokens WHERE user_key = ?');
  const selAll = db.prepare('SELECT * FROM user_tokens ORDER BY updated_at DESC');
  const insOne = db.prepare(`
    INSERT INTO user_tokens (user_key, user_name, token, issued_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_key) DO UPDATE SET
      user_name=excluded.user_name, token=excluded.token,
      issued_at=excluded.issued_at, updated_at=excluded.updated_at
  `);
  const delOne = db.prepare('DELETE FROM user_tokens WHERE user_key = ?');

  const toRecord = (row) => (row ? {
    userKey: row.user_key,
    userName: row.user_name || '',
    token: row.token,
    issuedAt: Number(row.issued_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  } : null);

  return {
    kind: 'sqlite',
    file,
    db,

    /** 某个人的 token 记录（没有就 null）。**含明文 token**，别直接回给浏览器 */
    get(userKey) {
      const k = String(userKey || '').trim();
      if (!k) return null;
      return toRecord(selOne.get(k));
    },

    /**
     * 录入 / 覆盖某个人的 token。
     * @returns {{ok:boolean, error?:string}}
     */
    set({ userKey, userName, token, issuedAt }) {
      const k = String(userKey || '').trim();
      const t = String(token || '').trim();
      if (!k) return { ok: false, error: '缺少 userKey' };
      if (!t) return { ok: false, error: '缺少 token' };
      const now = Date.now();
      try {
        insOne.run(k, String(userName || ''), t, Number(issuedAt) || now, now);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    },

    /** 移除某个人的 token（回到「用管理员 token」的兜底） */
    remove(userKey) {
      const k = String(userKey || '').trim();
      if (!k) return { ok: false, error: '缺少 userKey' };
      delOne.run(k);
      return { ok: true };
    },

    /** 全量列表（**脱敏**：只给工号/姓名/预览/时间，绝不回明文）。诊断页与状态接口用。 */
    list(now) {
      return selAll.all().map((row) => {
        const r = toRecord(row);
        return {
          userKey: r.userKey,
          userName: r.userName,
          preview: previewOf(r.token),
          issuedAt: r.issuedAt,
          expired: isExpired(r.issuedAt, now),
        };
      });
    },

    /** 库里有多少人有自己的 token（诊断用） */
    count() {
      const row = db.prepare('SELECT COUNT(*) AS c FROM user_tokens').get();
      return row ? Number(row.c) || 0 : 0;
    },

    close() { try { db.close(); } catch (_) { /* 已关 */ } },
  };
}

module.exports = { open, available, isExpired, lastResetAt, previewOf, EXPIRY_HOUR };
