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
  -- auto_name：**由筛选条件生成的默认名**（保存时弹窗里预填的那个）。
  -- name 是使用者可以随手改的，所以部门榜不能拿它当标题（2026-09-22 用户报
  -- 「改了名字，部门榜跟着变」/「两处命名规则不一样」）。这个字段专门留给榜单。
  auto_name     TEXT NOT NULL DEFAULT '',
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

-- ── 「谁**用过**这份查询」（与「谁保存过」分开）──────────────────────
-- 2026-09-21 加，为「部门高频查询」的时间衰减排序攒数据（见 publish/docs/部门高频查询排序方案.md）。
-- 为什么要单独一张表：
--   · 打开别人分享的查询也算「在用」，但那个人没有保存关系 —— 塞进 savers 表会把
--     「几个人保存过」这个现有口径搞乱（现在榜单就是按它排的，方案第 1 步不动排序）；
--   · 将来算分数时按 user_key 与 savers 取并集、时间取 MAX 即可，两边语义互不污染。
-- 只存「最后时间」不存每次访问的明细：衰减是时间的函数，明细既没必要又会无限膨胀。
CREATE TABLE IF NOT EXISTS saved_query_uses (
  query_id TEXT NOT NULL,
  user_key TEXT NOT NULL,
  dept_key TEXT NOT NULL DEFAULT '',
  at       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (query_id, user_key)
);
CREATE INDEX IF NOT EXISTS idx_uses_dept  ON saved_query_uses (dept_key);
CREATE INDEX IF NOT EXISTS idx_uses_query ON saved_query_uses (query_id);
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
 * 部门高频查询的分数**半衰期**：30 天。
 * 想让榜单更恋旧就调大（45~60 天），想更快换血就调小（14~21 天）—— 只改这一个常量。
 * 30 天与业务节奏一致：批次是月度的（2607~2612），30 天 ≈ 一个批次周期。
 */
const DEPT_SCORE_HALFLIFE_MS = 30 * 24 * 3600 * 1000;

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
  // busy_timeout：实测两个进程同时开同一个库时，约 2.5% 的 POST 会直接
  // 400「database is locked」（默认等 0 毫秒就放弃）。等 2 秒能把绝大多数撞上变成排队。
  try { db.exec('PRAGMA busy_timeout = 2000'); } catch (_) { /* 老版本不认就不设 */ }
  // WAL 让「写不阻塞读」，但库已被别的进程以独占方式打开时这句会抛 ——
  // 那不是「这台 Node 不支持 SQLite」，不该冒泡成静默回落 JSON（两套后端会把数据分家）。
  try { db.exec('PRAGMA journal_mode = WAL'); } catch (_) { /* 保持库当前的日志模式 */ }
  db.exec(SCHEMA);
  // 老库迁移（2026-09-22）：auto_name 是后加的列，已存在的库要补上。
  // 补不了也不致命：读的时候回退到 summary / labels 拼（见前端 condNameOf）。
  try {
    const cols = db.prepare("PRAGMA table_info(saved_queries)").all().map((c) => c.name);
    if (cols.indexOf('auto_name') < 0) {
      db.exec("ALTER TABLE saved_queries ADD COLUMN auto_name TEXT NOT NULL DEFAULT ''");
      console.log('[saved-queries] 已为旧库补上 auto_name 列');
    }
    // 老记录回填：auto_name 是刚加的列，历史行都是空的 —— 用它的 name 兜上。
    // 为什么用 name 而不是 summary：旧记录的 name 多半就是"保存时那个默认名"
    //（谁会没事改它），这样部门榜与「我的常用查询」立刻对得上；改过名的极少数
    // 会显示成改后的名字，下次保存同一条时会被新的 autoName 覆盖回来。
    const need = db.prepare("SELECT COUNT(*) AS c FROM saved_queries WHERE auto_name = '' AND name <> ''").get();
    const n = need ? Number(need.c) || 0 : 0;
    if (n > 0) {
      db.exec("UPDATE saved_queries SET auto_name = name WHERE auto_name = ''");
      console.log(`[saved-queries] 已为 ${n} 条老记录回填默认名（用原名字，仅供部门榜显示）`);
    }
  } catch (_) { /* 迁移失败不拦启动 */ }

  // ── 语句 ────────────────────────────────────────────────
  const insQuery = db.prepare(`
    INSERT INTO saved_queries
      (id, page, name, auto_name, summary, fields, labels, fingerprint, hits, saves, created_at, updated_at, last_opened_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      page=excluded.page, name=excluded.name, auto_name=excluded.auto_name, summary=excluded.summary,
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
  // 「用过」的记录：同一人重复上报只更新最后时间（幂等，反复提交同一个文件/重试不会刷时间）
  const insUse = db.prepare(`
    INSERT INTO saved_query_uses (query_id, user_key, dept_key, at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(query_id, user_key) DO UPDATE SET
      dept_key=excluded.dept_key, at=MAX(saved_query_uses.at, excluded.at)
  `);
  const delUses = db.prepare('DELETE FROM saved_query_uses WHERE query_id = ?');
  const selUsesOf = db.prepare('SELECT * FROM saved_query_uses WHERE query_id = ?');
  const selAll = db.prepare('SELECT * FROM saved_queries WHERE id NOT IN (SELECT query_id FROM saved_query_tombstones)');
  const selSaversOf = db.prepare('SELECT * FROM saved_query_savers WHERE query_id = ? ORDER BY saved_at ASC');
  const deptTotal = db.prepare('SELECT COUNT(DISTINCT user_key) AS c FROM saved_query_savers');
  // ── 同一份条件 + 同一个人 = 同一条（2026-09-22）────────────────────
  // 以前判重比的是**名字**：改个名就多出一条，匿名保存被认领后也多出一条。
  // 这两条语句用于 upsert 里归并（一条找"该并到哪"，一条列"这个条件下的所有行"）。
  const selSameByFp = db.prepare(`
    SELECT q.id AS id
    FROM saved_queries q
    JOIN saved_query_savers s ON s.query_id = q.id
    WHERE q.fingerprint = ? AND q.fingerprint <> '' AND s.user_key = ?
    ORDER BY q.updated_at DESC LIMIT 1
  `);
  const selRowsByFp = db.prepare(`
    SELECT q.id AS id, q.hits AS hits, q.saves AS saves, q.updated_at AS updated_at, q.created_at AS created_at
    FROM saved_queries q
    WHERE q.fingerprint = ?
    ORDER BY q.updated_at DESC
  `);
  const updQueryCounts = db.prepare('UPDATE saved_queries SET hits = MAX(hits, ?), saves = MAX(saves, ?) WHERE id = ?');

  // ── 姓名 → 工号 的库内映射（2026-09-23）──────────────────────────
  // 归属键是「工号优先」，但另一台机器可能只填得出姓名（人员接口没回工号 / 旧版设的身份），
  // 于是它存出去的行键成了姓名 —— 别人按工号查不到它，它按工号也查不到别人的。
  // 库里其实**知道**这个姓名对应哪个工号（同一人别的行带过工号），就在这里补上。
  const selIdsByName = db.prepare(`
    SELECT DISTINCT user_id FROM saved_query_savers WHERE user_name = ? AND user_id <> ''
  `);
  const selPersonByUserId = db.prepare(`
    SELECT user_key, user_id, user_name, team_id, team_name, org_id, org_name, dept_key
    FROM saved_query_savers WHERE user_id = ? ORDER BY saved_at DESC LIMIT 1
  `);

  /**
   * 只有在这个姓名**唯一**对应一个工号时才返回那个人；查不到、或同名对应到两个以上工号，
   * 一律返回 null —— 宁可留着姓名键（顶多换台机器看不到），也不能把别人的查询算到你头上。
   */
  function personByName(name) {
    const key = String(name || '').trim();
    if (!key) return null;
    const ids = selIdsByName.all(key);
    if (ids.length !== 1) return null;
    return selPersonByUserId.get(ids[0].user_id) || null;
  }

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
      // 由条件生成的默认名（保存时预填的那个）：部门榜的标题用它 ——
      // name 是使用者随手改的，榜单不能跟着晃（2026-09-22）。
      // ⚠️ toRecord 是**逐字段挑**的，新增列必须在这里显式带出来，否则前端永远收不到
      //   （踩过一次：列加好了、也写进去了，但读出来是 undefined）。
      autoName: row.auto_name || '',
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
      // 「谁保存过」的全集（去重后的 user_key）。前端 saved-query.js 的 listForUser 靠它
      // 判断「这条是不是我的」—— 只看 owner 不行：owner 是 savers[0]（最早保存的那位），
      // 第二个人保存过的记录会被判成别人的（2026-09-20 实测：第二个用户看不到自己存的）。
      saverKeys: [...new Set(savers.map((s) => s.user_key))],
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
      // 一整批（新增/更新 + 立墓碑 + 删本体）要么全成、要么全不成。
      // 为什么要事务：这不是"几条 INSERT"那么简单 —— 一条删除要同时动三张表
      // （墓碑、savers、queries），中途失败会留下"墓碑立了但本体还在"这类半截状态。
      // 单进程同步 API 撞上的概率不高，但服务端现在是**一份代理给全团队用**，
      // 一个请求出错不该让它留下不一致的库。
      // BEGIN IMMEDIATE（而不是裸 BEGIN）：立刻拿写锁，避免"读事务升级成写"时的死锁。
      db.exec('BEGIN IMMEDIATE');
      // 被跳过的条数要如实带回去（2026-09-22 复测 D-5）：以前两条 `return` 都是静默丢，
      // 代理回一个「已合并保存」，前端角标照说「已同步」—— 实测提交 3 条可以 0 条入库。
      let skipped = 0;
      try {
        (Array.isArray(items) ? items : []).forEach((it) => {
          if (!it || typeof it !== 'object' || !it.id || !it.page) { skipped += 1; return; }
          const owner0 = it.owner && typeof it.owner === 'object' ? it.owner : {};
          const at = num(it.at, now) || now;
          let uk = userKeyOf(owner0);
          // ⚠️ 没有归属人的记录**不入服务端**（2026-09-22 用户报「未登录存的会变成重复」）：
          // 服务端的用户视图是按 savers 表 join 出来的（byUser / deptTop 都靠它），
          // 没有 saver 的行走进去只会变成**孤儿行** —— 谁的用户视图都看不见它，
          // 但它确实占着一个 id、还会在镜像刷新后冒出来，表现就是"同一条查询出现两遍"。
          // 未登录时保存的东西本来就只属于那台机器（本机镜像是它的家，见 user-token 那套思路）。
          if (!uk) { skipped += 1; return; }
          // 提交里只有姓名（没工号）时，按库内唯一映射换成工号键 —— 否则这台机器存的东西
          // 换个工号身份的机器查不到（2026-09-23 深度矩阵里唯一没通的一格）。认不准就不换。
          let who = owner0;
          if (!String(owner0.userId || '').trim() && String(owner0.userName || '').trim() === uk) {
            const known = personByName(uk);
            if (known && known.user_id) {
              who = {
                userId: known.user_id,
                userName: owner0.userName || known.user_name || uk,
                teamId: owner0.teamId || known.team_id || '',
                teamName: owner0.teamName || known.team_name || '',
                orgId: owner0.orgId || known.org_id || '',
                orgName: owner0.orgName || known.org_name || '',
              };
              uk = String(known.user_id);
            }
          }
          const fp = fingerprintOf(it);
          // 同条件 + 同人已有记录 → **并到它上面**（用它的 id），而不是新增一条。
          // 前端已经按同一口径判过了，这里再兜一层：前端镜像可能陈旧、或那次提交
          // 根本没带上老记录（2026-09-22 用户报的两个重复来源正是这两类）。
          let id = String(it.id);
          if (fp && uk) {
            const hit = selSameByFp.get(fp, uk);
            if (hit && hit.id) id = String(hit.id);
          }
          insQuery.run(
            id, String(it.page), String(it.name || '未命名查询'),
            String(it.autoName || ''),
            String(it.summary || ''),
            JSON.stringify(it.fields && typeof it.fields === 'object' ? it.fields : {}),
            JSON.stringify(it.labels && typeof it.labels === 'object' ? it.labels : {}),
            fp,
            num(it.hits, 0), Math.max(1, num(it.saves, 1)),
            at, num(it.at, at), num(it.lastAt, 0),
          );
          if (uk) {
            insSaver.run(
              id, uk,
              String(who.userId || ''), String(who.userName || uk),
              String(who.teamId || ''), String(who.teamName || ''),
              String(who.orgId || ''), String(who.orgName || ''),
              deptKeyOf(who), at,
            );
          }
        });
        // 归并历史重复：同一份条件 + 同一个人只留一条。
        // 旧判重按名字，改名/认领时攒下的重复就在库里；这里对「本批涉及的 fingerprint」
        // 顺手收干净（不额外扫全库）。计数取 MAX 而不是累加 —— 累加会把"存了 3 次"
        // 算成 6 次，虚高。只删「仅属于这一个人」的重复行，别人也存过的行不动。
        const touchedFp = new Set();
        (Array.isArray(items) ? items : []).forEach((it) => {
          const fp = fingerprintOf(it);
          if (fp) touchedFp.add(fp);
        });
        touchedFp.forEach((fp) => {
          const rows = selRowsByFp.all(fp);
          const byUser = new Map();   // user_key → 该人在这个条件下的行（已按 updated_at 降序）
          rows.forEach((r) => {
            selSaversOf.all(r.id).forEach((s) => {
              if (!byUser.has(s.user_key)) byUser.set(s.user_key, []);
              byUser.get(s.user_key).push(r);
            });
          });
          byUser.forEach((list) => {
            if (list.length < 2) return;
            // 保留哪一条：重复行的条件完全一样，差别只在名字与计数 ——
            // 按「更常用」定：hits 多的 → saves 多的 → 创建更早的。
            // ⚠️ **别按 updated_at**：改名产生的那条副本才是"最新更新"的，
            //    按它会留下副本、删掉正主（2026-09-22 实测：用户改名留下的"2"就是这样）。
            const sorted = list.slice().sort((a, b) => (num(b.hits, 0) - num(a.hits, 0))
              || (num(b.saves, 0) - num(a.saves, 0))
              || (num(a.created_at, 0) - num(b.created_at, 0)));
            const keep = sorted[0];
            updQueryCounts.run(num(keep.hits, 0), num(keep.saves, 1), keep.id);
            sorted.slice(1).forEach((dup) => {
              if (dup.id === keep.id) return;
              if (selSaversOf.all(dup.id).length > 1) return;      // 别人也存过 → 不动它
              updQueryCounts.run(num(dup.hits, 0), num(dup.saves, 1), keep.id);
              delSavers.run(dup.id);
              delUses.run(dup.id);
              delQuery.run(dup.id);
            });
          });
          // 孤儿行（没有任何 saver）：同条件下还有别的行时删掉它。
          // 未登录保存的记录曾被推成这种（见上面 !uk 那段注释），老库里已经攒下了 ——
          // 不清掉的话，用户镜像刷新后它还会以"重复的一条"冒出来。
          if (rows.length < 2) return;
          rows.forEach((r) => {
            if (selSaversOf.all(r.id).length > 0) return;
            delSavers.run(r.id);
            delUses.run(r.id);
            delQuery.run(r.id);
          });
        });
        (Array.isArray(deletedIds) ? deletedIds : []).forEach((id) => {
          const key = String(id || '');
          if (!key) return;
          insTomb.run(key, now);
          delSavers.run(key);
          delUses.run(key);      // 「用过」的记录一起清，否则墓碑之外的残留会一直留在表里
          delQuery.run(key);
        });
        delTomb.run(now - TOMB_KEEP_MS);
        db.exec('COMMIT');
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch (_) { /* 已经回滚掉了 */ }
        throw e;   // 如实抛给调用方 → 代理回 400/500，前端角标显示失败，而不是"成功但数据不全"
      }
      return { items: this.all(), deleted: this.tombstones(), skipped };
    },

    /**
     * 全库归并「同一份条件 + 同一个人」的历史重复（2026-09-22）。
     *
     * 由代理启动时调一次。为什么要专门扫一遍：旧的判重比的是**名字**，
     * 改名 / 匿名保存被认领都会攒下重复；upsert 里的归并只在"这份条件又被保存时"
     * 才收敛 —— 用户不动它，重复就一直摆在首页上（用户截图里那条改名留下的"2"就是）。
     *
     * 安全性：只删「**仅属于这一个人**」的重复行；别人也存过的行一字不动
     *（那种是两个人各存了一份，部门榜靠聚合，不该合并）。
     *
     * @returns {{removed:number}} 归并掉的行数
     */
    dedupeAll() {
      const rows = db.prepare(
        "SELECT id, fingerprint, hits, saves, updated_at, created_at FROM saved_queries WHERE fingerprint <> ''",
      ).all();
      const byFp = new Map();
      rows.forEach((r) => {
        if (!byFp.has(r.fingerprint)) byFp.set(r.fingerprint, []);
        byFp.get(r.fingerprint).push(r);
      });
      let removed = 0;
      db.exec('BEGIN IMMEDIATE');
      try {
        byFp.forEach((list) => {
          if (list.length < 2) return;
          const byUser = new Map();   // user_key → 该人在这个条件下的行
          list.forEach((r) => {
            selSaversOf.all(r.id).forEach((sv) => {
              if (!byUser.has(sv.user_key)) byUser.set(sv.user_key, []);
              byUser.get(sv.user_key).push(r);
            });
          });
          byUser.forEach((dups) => {
            if (dups.length < 2) return;
            // 保留策略同 upsert：按「更常用」而不是「更新更晚」
            //（改名副本的 updated_at 最新，按它会留副本删正主）。
            dups.sort((a, b) => (num(b.hits, 0) - num(a.hits, 0))
              || (num(b.saves, 0) - num(a.saves, 0))
              || (num(a.created_at, 0) - num(b.created_at, 0))
              || String(a.id).localeCompare(String(b.id)));
            const keep = dups[0];
            dups.slice(1).forEach((d) => {
              if (d.id === keep.id) return;
              if (selSaversOf.all(d.id).length > 1) return;   // 别人也存过 → 不动
              updQueryCounts.run(num(d.hits, 0), num(d.saves, 1), keep.id);
              delSavers.run(d.id);
              delUses.run(d.id);
              delQuery.run(d.id);
              removed += 1;
            });
          });
          // 没有任何 saver 记录的「孤儿行」：同条件下还有别的行时它就是历史残留
          //（改名的中间产物曾被留成这种），删掉。只剩它一条时保留 ——
          // 那可能是"刚 INSERT、saver 还没写"的中间态，不值得赌。
          if (list.length < 2) return;
          list.forEach((r) => {
            if (selSaversOf.all(r.id).length > 0) return;
            delSavers.run(r.id);
            delUses.run(r.id);
            delQuery.run(r.id);
            removed += 1;
          });
        });
        db.exec('COMMIT');
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch (_) { /* 已经回滚掉了 */ }
        throw e;
      }
      return { removed };
    },

    /**
     * 记一次「这个人用了这份查询」（部门高频的时间衰减排序要用）。
     *
     * 为什么单独一个入口而不是塞进 upsert：upsert 写的是**保存关系**（savers 表），
     * 而「用过但没保存」的人没有保存关系 —— 混进去会把「几个人保存过」这个现有口径搞乱。
     *
     * 幂等：同一人重复上报只把时间往后推（MAX），反复重试/重复提交不会刷时间。
     *
     * @param {Array<{queryId:string, userKey:string, deptKey?:string, at?:number}>} uses
     * @returns {number} 实际写入/更新的条数
     */
    markUsed(uses) {
      const arr = Array.isArray(uses) ? uses : [];
      let n = 0;
      try {
        db.exec('BEGIN');
        arr.forEach((u) => {
          if (!u || typeof u !== 'object') return;
          const qid = String(u.queryId || u.id || '').trim();
          const uk = String(u.userKey || '').trim();
          if (!qid || !uk) return;
          insUse.run(qid, uk, String(u.deptKey || '').trim(), num(u.at, Date.now()));
          n += 1;
        });
        db.exec('COMMIT');
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch (_) { /* 已回滚 */ }
        throw e;
      }
      return n;
    },

    /**
     * 某人保存过的查询（个人视图）。
     * @param {string} userKeyOrName 工号 **或** 姓名
     * @param {number} [limit]
     */
    byUser(userKeyOrName, limit) {
      // 上限要钳住：?limit=1e21 是有限数，直接进 SQLite 的 LIMIT 会 500（datatype mismatch）
      const n = Number.isFinite(limit) && limit > 0 ? Math.min(1000, Math.floor(limit)) : 50;
      // 三个键都要能命中（2026-09-23）：库里存的 user_key 是「工号优先」（userKeyOf），
      // 但「当前用户」在另一台机器上可能只有姓名（接口没回工号 / 旧版本设的身份），
      // 那时前端拿姓名来查 —— 只比 user_key 就会回 0 条，而 HTTP 200 + mode=user，
      // 角标照报「已同步」，用户看到的是「我存过 4 条，换台机器一条都没有」（实测复现）。
      // ⚠️ 同名同姓会互相看到对方的记录：这台后端在姓名多命中时本来就报错
      //（current-user.js 的 lookup 里那条抓包结论），实际风险很低；真要区分还得靠工号。
      // ⚠️ 空键直接返回空：user_id 允许是空串（只有姓名的人），否则 `user_id = ''` 会把这些行捞出来
      const key = String(userKeyOrName || '');
      if (!key) return [];
      const rows = db.prepare(`
        SELECT * FROM saved_queries q
        JOIN saved_query_savers s ON s.query_id = q.id
        WHERE (s.user_key = ? OR s.user_id = ? OR s.user_name = ?)
          AND q.id NOT IN (SELECT query_id FROM saved_query_tombstones)
        ORDER BY MAX(s.saved_at, q.last_opened_at) DESC
        LIMIT ?
      `).all(key, key, key, n);
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
      const n = Number.isFinite(limit) && limit > 0 ? Math.min(1000, Math.floor(limit)) : 10;
      // 聚合口径：同一份条件（fingerprint 相同）算同一个查询；没填条件的各自成组。
      // 代表行取「最近有人保存的那条」，名字/摘要用它 —— 也就是当前大家在用的那份。
      // ── 排序：指数时间衰减的「按人贡献求和」（2026-09-21 改，方案见 docs/部门高频查询排序方案.md）──
      //   分数 = Σ（本部门每个人） 2 ^ ( −(现在 − 这个人最后活跃时间) / 半衰期 )
      //   其中「最后活跃时间」= MAX(这个人保存它的时间, 这个人最近一次使用它的时间)。
      //   老查询没人用 → 每个人的贡献都趋近 0 → 自然下沉，不需要额外的过期/淘汰规则。
      const nowMs = Date.now();
      const rows = db.prepare(`
        -- rn = 组内第几行（按保存时间倒序）。用来挑「代表行」——
        -- ⚠️ 原来靠 agg.last_saved = scoped.saved_at 挑，组内若有两人 saved_at 相同
        --    （批量导入 / 同一毫秒保存）会同时匹配上，榜单里同一条查询出现两行。
        --    （注意：SQL 注释里别用反引号 —— 这一段是 JS 模板字符串，反引号会提前截断它。）
        WITH scoped AS (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY gid ORDER BY saved_at DESC, id ASC) AS rn
          FROM (
            SELECT q.*, s.user_key, s.user_name, s.saved_at,
                   CASE WHEN q.fingerprint <> '' THEN q.fingerprint ELSE 'solo:' || q.id END AS gid
            FROM saved_queries q
            JOIN saved_query_savers s ON s.query_id = q.id
            WHERE s.dept_key = ?
              AND q.id NOT IN (SELECT query_id FROM saved_query_tombstones)
          )
        ),
        -- 每个人的最后活跃时间：保存过的人（scoped）与用过的人（uses）取并集，时间取 MAX。
        -- 分成两段再 UNION ALL 是因为「用过但没保存」的人根本不在 savers 表里。
        activity AS (
          SELECT gid, user_key, MAX(t) AS t
          FROM (
            SELECT gid, user_key, saved_at AS t FROM scoped
            UNION ALL
            SELECT CASE WHEN q.fingerprint <> '' THEN q.fingerprint ELSE 'solo:' || q.id END AS gid,
                   u.user_key AS user_key, u.at AS t
            FROM saved_query_uses u
            JOIN saved_queries q ON q.id = u.query_id
            WHERE u.dept_key = ?
              AND q.id NOT IN (SELECT query_id FROM saved_query_tombstones)
          )
          GROUP BY gid, user_key
        ),
        agg AS (
          SELECT gid,
                 COUNT(DISTINCT user_key) AS savers,
                 MAX(saved_at) AS last_saved,
                 GROUP_CONCAT(user_name, '"|;"') AS people
          FROM scoped
          GROUP BY gid
        ),
        score AS (
          SELECT gid,
                 -- ⚠️ 必须 * 1.0 转 REAL：SQLite 的 / 是整数除法，否则指数被截断成 0、
                 -- 不足一个半衰期的时间差全算成「就在今天」，衰减会静默失效（实测确认）。
                 SUM(POW(2.0, -(? - t) * 1.0 / ?)) AS score
          FROM activity
          GROUP BY gid
        )
        SELECT scoped.id, scoped.page, scoped.name, scoped.auto_name, scoped.summary, scoped.fields,
               scoped.labels, scoped.hits, scoped.saves, scoped.created_at,
               scoped.updated_at, scoped.last_opened_at, scoped.user_key,
               scoped.user_name, scoped.saved_at,
               agg.savers AS savers, agg.last_saved AS last_saved, agg.people AS people,
               COALESCE(score.score, 0) AS score
        FROM scoped
        JOIN agg ON agg.gid = scoped.gid
        LEFT JOIN score ON score.gid = scoped.gid
        WHERE scoped.rn = 1          -- 每组只出一行（组内 saved_at 相同也不会重复）
        -- 主排序改成分数；分数相同时再按「保存人数 → 最近保存时间」，
        -- 保证任何情况下顺序都是确定的（不会因为并列而每次查询抖一下）。
        ORDER BY score DESC, agg.savers DESC, agg.last_saved DESC
        LIMIT ?
      `).all(key, key, nowMs, DEPT_SCORE_HALFLIFE_MS, n);
      // people 已经是**整个组**（同一份条件）的本部门人员名单：
      // 只取代表行那一条的话，会把同组其它人的名字埋掉。
      // 不用 GROUP_CONCAT 的默认逗号：姓名里带逗号会被拆成两个人（实测「王,五」→ 两人）。
      // 换成几乎不可能出现在人名里的标记，DISTINCT 交给 JS 做
      // （SQLite 的 DISTINCT 聚合不允许带第二个参数，写了会直接报错）。
      return rows.map((r) => {
        const rec = toRecord(r);
        const names = [...new Set(String(r.people || '').split('"|;"').map((x) => x.trim()).filter(Boolean))];
        return {
          ...rec,
          savers: Number(r.savers) || rec.savers,
          saverNames: names.length ? names : rec.saverNames,
          recentUser: r.user_name || rec.recentUser,
          // 衰减后的分数（诊断用：业务问「它凭什么排第一」时能当场给出数字）。
          // 前端不拿它排序 —— 排序在 SQL 里已经做完了。
          score: Number(r.score) || 0,
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
