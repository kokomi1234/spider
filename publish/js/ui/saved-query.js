/**
 * 常用查询（首页快捷入口）存储层
 * ------------------------------------------------------------
 * 三个查询页都能把「当前填好的筛选条件」存一份到首页，之后从首页一键直达、
 * 自动回填条件并查询。
 *
 * 存储架构（2026-09-20 改版，用户拍板）：**服务端数据库是唯一真相源**。
 *   · 增/删/改直接写服务端（/local/saved-queries），成功后拉「我的列表」刷新镜像；
 *   · localStorage 只是「我的」离线镜像，**严禁写入团队全集**（旧版全集回写是
 *     「改名弹回 / 导入被盖 / 第二个人存了看不到」那一串 bug 的共同根源）；
 *   · 服务端不可达时退回本机兜底（离线照用，返回值带 localOnly，角标会说明）。
 *
 * 设计约束（都是踩过的坑）：
 *   1) localStorage 在隐私模式/配额满时会**直接抛异常**，所以读取与写入一律
 *      try/catch，失败要返回 {ok:false,error} 让上层提示，不能把整页拖崩。
 *   2) 存量数据不可信（旧版本、手工改过、JSON 坏掉）：list() 逐条校验，
 *      脏数据直接丢弃，绝不把畸形对象喂给页面。
 *   3) 值只允许 string / string[] / number，其它类型（对象、null）一律丢掉——
 *      fields 最终会回填进表单，不能让任意结构穿透到 DOM。
 *
 * 用法：
 *   SavedQuery.save({ page:'publish', name:'2611批次-全球汇划', fields:{...}, summary:'…' })
 *   SavedQuery.list()                      // 首页渲染卡片
 *   跳转：/publish?saved=<id>               // 由各页自行读取并回填
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'spider.savedQueries.v1';
  // 「无人认领」记录的**独立存储键**（2026-09-22 分键，用户报「登录了再退出，未登录存的会被覆盖」）：
  // 登录时 syncFromServer 会用服务端拉回的「我的列表」**整段覆盖**登录镜像 —— 单键时代
  // 没登录时保存的匿名记录会跟着被冲掉。分键后同步只动登录段，匿名段独立存活，
  // 认领（claimAnonymous）时 writeRaw 按归属分流，记录自然从匿名段挪进登录段。
  const ANON_STORAGE_KEY = 'spider.savedQueries.anon.v1';
  // 上限与代理端点（/local/saved-queries）保持一致：合并了同团队别人的记录后
  // 本机条目数会超过「自己存的」，两边用同一个数字才不会互相打架。
  const MAX_ITEMS = 200;
  /** 共享落盘端点（代理提供，与 /local/batch-times 同一套路） */
  const SERVER_URL = '/local/saved-queries';
  /** 待同步的删除意图：删掉的 id 要告诉服务端，否则它会把记录原样合并回来 */
  const DELETED_KEY = 'spider.savedQueries.deleted.v1';
  /** 记录结构版本：1 = 旧格式（只有编号 + 当时拼好的摘要）；2 = 带 labels（人类可读文本） */
  const SCHEMA_VERSION = 2;
  const PAGES = { publish: '服务发布数据查询', task: '任务单查询', subscription: '服务订阅关系查询' };

  /** 空实现：localStorage 不可用时用它顶上，让调用方拿到一致的结构 */
  const fail = (error) => ({ ok: false, error });

  function storage() {
    try {
      const s = window.localStorage || globalThis.localStorage;
      return s || null;
    } catch (_) {
      return null; // 某些浏览器访问 localStorage 本身就抛（隐私模式）
    }
  }

  /** 读单个存储段（不 sanitize；JSON 坏掉当空列表，不拖崩首页） */
  function readSeg(key) {
    const s = storage();
    if (!s) return [];
    try {
      const txt = s.getItem(key);
      if (!txt) return [];
      const parsed = JSON.parse(txt);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return []; // JSON 坏掉 / 不是数组：当成空列表，不拖崩首页
    }
  }

  /** 写单个存储段 */
  function writeSeg(key, items) {
    const s = storage();
    if (!s) return false;
    try {
      s.setItem(key, JSON.stringify(items));
      return true;
    } catch (_) {
      return false; // 最常见的是 QuotaExceededError
    }
  }

  // 旧版只有 STORAGE_KEY 一个键、登录与匿名的记录混在一起。分键后要把里面
  // 的匿名记录挪到匿名段，否则**迁移前的一次登录同步**就会把它们冲掉。
  let migrated = false;
  function migrateIfNeeded() {
    if (migrated) return;
    migrated = true;
    const raw = readSeg(STORAGE_KEY);
    const anonInUserSeg = raw.filter((it) => saverKeysOf(it).length === 0);
    if (!anonInUserSeg.length) return;
    const exist = readSeg(ANON_STORAGE_KEY);
    const merged = exist.concat(anonInUserSeg.filter((x) => x && !exist.some((a) => a && a.id === x.id)));
    try {
      writeSeg(ANON_STORAGE_KEY, merged);
      writeSeg(STORAGE_KEY, raw.filter((it) => saverKeysOf(it).length !== 0));
    } catch (_) { /* 迁移失败不致命：下次写操作时 writeRaw 会按归属再分流一次 */ }
  }

  /**
   * 合并视图 = 登录镜像段 + 匿名段。
   * 2026-09-22 分键：登录时 syncFromServer 的 writeRaw(我的记录) 是**整段覆盖**，
   * 单键时代会把「没登录时保存的」匿名记录一起冲掉（用户报）。
   * 同 id 冲突时登录段优先 —— 认领会把记录从匿名段挪进登录段，理论上不会共存，防御一下。
   */
  function readRaw() {
    migrateIfNeeded();
    const mine = readSeg(STORAGE_KEY);
    const anon = readSeg(ANON_STORAGE_KEY);
    if (!anon.length) return mine;
    // 段里是**未清洗**的原始 JSON，可能有 null / 非对象这类脏条目 ——
    // 合并去重前先防御，脏的照原样带过去，交给 list() 的 sanitize 统一处理
    const ids = new Set(mine.filter((x) => x && typeof x === 'object' && x.id).map((x) => x.id));
    return mine.concat(anon.filter((x) => x && typeof x === 'object' && x.id && !ids.has(x.id)));
  }

  /**
   * 写镜像：**按归属分流** —— 有归属人的进登录段（会被服务端同步整段覆盖），
   * 匿名的进独立段（登录/退出都不碰它）。上层所有写操作（保存/改名/删除/导入/认领/同步）
   * 都走这里，所以分流只需写对这一处。
   */
  function writeRaw(list) {
    const s = storage();
    if (!s) return fail('浏览器存储不可用（隐私模式？），无法保存');
    try {
      const anon = list.filter((it) => saverKeysOf(it).length === 0);
      const mine = list.filter((it) => saverKeysOf(it).length !== 0);
      s.setItem(STORAGE_KEY, JSON.stringify(mine));
      s.setItem(ANON_STORAGE_KEY, JSON.stringify(anon));
      return { ok: true };
    } catch (e) {
      // 最常见的是 QuotaExceededError
      return fail('保存失败：浏览器存储空间不足或被禁用');
    }
  }

  /**
   * 只覆盖**登录镜像段**（服务端拉回的「我的列表」），匿名段原样不动。
   *
   * syncFromServer / pushToServer / getAsync 回填这类调用拿到的是「当前用户的」数据，
   * **不是全量镜像** —— 不能走 writeRaw（全量替换两段），否则匿名段会被一起冲掉
   *（2026-09-22 用户报「登录了再退出，未登录存的会被覆盖」的根因）。
   */
  function writeMineSeg(items) {
    const s = storage();
    if (!s) return fail('浏览器存储不可用（隐私模式？），无法保存');
    try {
      const mine = (Array.isArray(items) ? items : []).filter((it) => saverKeysOf(it).length !== 0);
      s.setItem(STORAGE_KEY, JSON.stringify(mine));
      return { ok: true };
    } catch (e) {
      return fail('保存失败：浏览器存储空间不足或被禁用');
    }
  }

  /** 值只保留 string / number / string[]，其余一律丢弃（回填表单不接受任意对象） */
  function cleanValue(v) {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' && isFinite(v)) return v;
    if (Array.isArray(v)) {
      return v.filter((x) => typeof x === 'string' || (typeof x === 'number' && isFinite(x)));
    }
    return null;
  }

  /** 查询人信息只收字符串字段：它会被渲染到首页卡片上，不能有任意结构 */
  function cleanOwner(owner) {
    if (!owner || typeof owner !== 'object') return null;
    // 后端有时把工号给成数字，这里统一成字符串再存（否则会被当成脏值丢掉）
    const pick = (k) => {
      const v = owner[k];
      if (typeof v === 'string') return v.trim();
      if (typeof v === 'number' && isFinite(v)) return String(v);
      return '';
    };
    const o = {
      userId: pick('userId'), userName: pick('userName'),
      orgId: pick('orgId'), orgName: pick('orgName'),
      teamId: pick('teamId'), teamName: pick('teamName'),
    };
    return (o.userId || o.userName || o.orgId || o.orgName || o.teamId || o.teamName) ? o : null;
  }

  /**
   * 部门主键：**team 优先，org 兜底**。
   * 依据真实报文（2026-09-18 实测 getUserInfo）：
   *   orgName  = "中国银行软件中心（深圳）"      ← 整个一级单位，几百人
   *   teamName = "…（深圳）开发三部"            ← 用户口语里的「我们部门」
   * 拿 orgName 当部门会让整个软件中心算一个部门，排行就没意义了。
   */
  function deptKeyOf(u) {
    if (!u || typeof u !== 'object') return '';
    return String(u.teamId || u.teamName || u.orgId || u.orgName || '').trim();
  }

  /**
   * 一个人的键：有工号用工号，否则用姓名。
   * **口径必须与服务端 lib/queries-db.js 的 userKeyOf 一致**，否则
   * 本机过滤与服务端 `?user=` 会切出两套不同的「我的」。
   */
  function userKeyOf(owner) {
    const o = owner && typeof owner === 'object' ? owner : {};
    return String(o.userId || o.userName || '').trim();
  }

  /**
   * 这条记录**谁保存过**（可能不止一个人）。
   *
   * 为什么不能只看 owner：记录经服务端往返之后，owner 是「最早保存的那个人」
   * （lib/queries-db.js 的 toRecord 取 savers[0]）——「我保存过」这件事在 owner 上看不出来。
   * 2026-09-20 实测：B 保存后服务端回传的 owner 仍是 A，本机列表被服务端全集覆盖，
   * 于是 listForUser(B) 恒为空，表现成「第二个用户怎么存都存不进去、条数还是第一个人的」。
   * 服务端在 saverKeys 里如实回传了全部保存者，这里把它和 owner 合起来用。
   *
   * @param {object} item 记录
   * @returns {string[]} 去重后的键（工号优先、姓名兜底）
   */
  function saverKeysOf(item) {
    const out = [];
    const own = userKeyOf(item && item.owner);
    if (own) out.push(own);
    if (item && Array.isArray(item.saverKeys)) {
      item.saverKeys.forEach((k) => {
        const s = String(k == null ? '' : k).trim();
        if (s) out.push(s);
      });
    }
    return Array.from(new Set(out));
  }

  /** labels 只收 string（展示用），空值丢弃 */
  function cleanLabels(labels) {
    const out = {};
    if (labels && typeof labels === 'object') {
      Object.keys(labels).forEach((k) => {
        const v = labels[k];
        if (typeof v === 'string' && v.trim()) out[k] = v.trim();
      });
    }
    return out;
  }

  /** 逐条校验存量数据：结构不合法就丢弃，避免脏数据把首页渲染打崩 */
  function sanitize(item) {
    if (!item || typeof item !== 'object') return null;
    const page = typeof item.page === 'string' && PAGES[item.page] ? item.page : null;
    if (!page) return null;
    const id = typeof item.id === 'string' && item.id ? item.id : null;
    if (!id) return null;

    const fields = {};
    if (item.fields && typeof item.fields === 'object') {
      Object.keys(item.fields).forEach((k) => {
        const v = cleanValue(item.fields[k]);
        if (v !== null && v !== '') fields[k] = v;
      });
    }
    // labels：字段 id → 人类可读文本（「2611批次」而不是「2611pc」）。
    // 2026-09-18 才加的：早先只存了 fields（编号）+ 当时拼好的 summary 字符串，
    // 于是老卡片显示的是编号。labels 保留下来，既便于以后改版式，也用来判断
    // 这条记录是不是已经升级过（见 SCHEMA_VERSION）。
    const labels = {};
    if (item.labels && typeof item.labels === 'object') {
      Object.keys(item.labels).forEach((k) => {
        const v = item.labels[k];
        if (typeof v === 'string' && v.trim()) labels[k] = v.trim();
      });
    }
    return {
      id,
      page,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : '未命名查询',
      // 「由筛选条件生成的默认名」——保存时弹窗里预填的那个（个人可改名，这个不会变）。
      // 部门榜标题用它，这样谁改名都不会带歪整个部门的榜单（2026-09-22）。
      // 服务端的列名是 auto_name，两种写法都认；旧记录没有这个字段就是空串。
      autoName: String(item.autoName || item.auto_name || '').trim().slice(0, 60),
      summary: typeof item.summary === 'string' ? item.summary : '',
      labels,
      owner: cleanOwner(item.owner),
      hits: Number.isFinite(item.hits) && item.hits > 0 ? Math.floor(item.hits) : 0,
      saves: Number.isFinite(item.saves) && item.saves > 0 ? Math.floor(item.saves) : 1,
      lastAt: typeof item.lastAt === 'number' ? item.lastAt : 0,
      v: typeof item.v === 'number' ? item.v : 1,   // 缺省 1 = 升级前的旧格式
      at: typeof item.at === 'number' ? item.at : 0,
      fields,
      // 服务端（SQLite 侧）算好的人口统计：savers = 这份条件被几个人保存过。
      // 允许它们穿过 sanitize —— 否则 SQL 里 COUNT(DISTINCT 人) 的结果会被这里抹掉，
      // 页面又退回「看不出热度」的状态。本机离线时 listByDept() 会自己再算一遍。
      savers: Number(item.savers) > 0 ? Math.floor(Number(item.savers)) : 0,
      saverNames: Array.isArray(item.saverNames)
        ? item.saverNames.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim())
        : [],
      recentUser: typeof item.recentUser === 'string' ? item.recentUser.trim() : '',
      // 服务端（SQLite 侧 saver 表）回传的「谁保存过」全集。本机离线写的记录没有这个字段，
      // 那时退化成只看 owner —— 两种来源都要能用，所以「有就用、没有就空数组」。
      saverKeys: Array.isArray(item.saverKeys)
        ? Array.from(new Set(item.saverKeys
          .map((k) => String(k == null ? '' : k).trim())
          .filter(Boolean)))
        : [],
    };
  }

  /**
   * 同一份「查询条件」的指纹：同页面 + 同 fields = 同一个查询。
   * 用它才能回答「这个条件有多少人保存过」—— 只看记录条数是不行的，
   * 同一个人保存三次和三个人各保存一次，是完全不同的热度。
   *
   * **空条件不参与聚合**：什么筛选都没填的两条记录归成一组没有意义，
   * 所以 fields 为空时返回空串（调用方按「各自独立」处理）。
   *
   * @param {object} item 记录
   * @returns {string} 指纹；空串表示「没有筛选条件，别归并」
   */
  function fingerprintOf(item) {
    const f = (item && item.fields && typeof item.fields === 'object') ? item.fields : {};
    const keys = Object.keys(f).filter((k) => {
      const v = f[k];
      if (v == null || v === '') return false;
      if (Array.isArray(v)) return v.length > 0;
      return true;
    });
    if (!keys.length) return '';
    const norm = keys.sort().map((k) => {
      const v = f[k];
      const sv = Array.isArray(v) ? v.map(String).sort().join(',') : String(v);
      return `${k}=${sv}`;
    }).join('&');
    return `${item.page}?${norm}`;
  }

  /**
   * 这两条是不是**同一份查询**（保存判重、同步合并都用它）。
   *
   * 2026-09-22 用户报：把常用查询改个名，同一个查询就**多出一条**；匿名保存的认领之后
   * 也会多出一条。根因就是判重比的是**名字** —— 名字是用户随手改的、不是身份。
   * 正确的判据是「同一份筛选条件 + 同一个人」：
   *   · id 相同 → 同一条（同步回来的老数据可能 id 对得上）
   *   · fingerprint 相同（同一页面 + 同一套条件）且归属人相同 → 同一条
   *   · 什么条件都没填时 fingerprint 是空串 → 退回「同页同名同人」的老口径
   *    （空条件没有"同一份查询"可言，本来就该各自独立）
   */
  function sameQuery(a, b) {
    if (!a || !b) return false;
    if (a.id && b.id && a.id === b.id) return true;
    if (a.page !== b.page) return false;
    if (userKeyOf(a.owner) !== userKeyOf(b.owner)) return false;
    const fa = fingerprintOf(a);
    const fb = fingerprintOf(b);
    if (fa && fb) return fa === fb;
    return a.name === b.name;
  }

  /**
   * 由**筛选条件**拼一个名字（部门榜的标题用它）。
   *
   * 为什么需要：部门高频榜是按「同一份条件」聚合出来的，但代表行的 `name` 是
   * **个人保存时起的**（还可能被本人改过）—— 谁改了名，整个部门的榜单标题都跟着变
   *（2026-09-22 用户报）。条件本身才是这份查询的身份，所以榜单标题只认 labels。
   * labels 为空（没填任何条件）时返回空串，调用方自己退回 name。
   */
  /**
   * 部门榜的**标题**：优先用「保存时由条件生成的默认名」（autoName），
   * 老记录没有这个字段就退回摘要前 30 字，再退回 labels 拼。
   *
   * 为什么不是 name：name 是使用者随手改的（2026-09-22 用户报「改了常用查询的名字，
   * 下面部门高频查询的名字也跟着改」）。为什么不是 labels 拼：各页面给的默认名规则不同
   *（订阅页是「调用方系统：xxx」、发布页是「批次 编号」），榜单自己拼会与"我的"对不上
   *（同日用户又报「命名规则怎么不一样」）。所以：**保存时算什么就用什么**。
   */
  function condNameOf(item) {
    const own = String((item && (item.autoName || item.auto_name)) || '').trim();
    if (own) return own;
    const sum = String((item && item.summary) || '').trim();
    if (sum) return sum.slice(0, 30);
    return nameFromLabels(item && item.labels);
  }

  function nameFromLabels(labels) {
    const o = cleanLabels(labels);
    return Object.keys(o)
      .map((k) => String(o[k] || '').trim())
      .filter(Boolean)
      .join(' ');
  }

  /**
   * 某个部门的常用查询排行（**本机口径**：只统计这台浏览器上能看到的记录）。
   *
   * 排序口径（2026-09-19 改）：**先看有多少人保存过这份条件，再看时间**。
   * 以前按「打开次数」排，排出来的只是个人的重复劳动；改成人数之后，
   * 排头位的才是「大家都觉得该查的东西」。
   *
   * 同一份条件（同页面 + 同 fields）会被聚成一行，避免同一个东西刷屏；
   * 保存者按 userId 去重（没有工号时用姓名兜底）。
   *
   * @param {{orgId?:string, orgName?:string, teamId?:string, teamName?:string}} user 当前用户
   * @param {number} [limit] 取前几条（首页的 5/10/20）
   * @returns {Array<object & {savers:number, saverNames:string[], recentUser:string}>}
   *          savers = 本部门里保存过这份条件的人数；recentUser = 最近一次是谁存的
   */
  function listByDept(user, limit) {
    const key = deptKeyOf(user);
    if (!key) return [];
    const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;
    const mine = list().filter((it) => deptKeyOf(it.owner) === key);

    // 按「同一份条件」分组：空条件的各自成组，不能都算成同一个查询
    const groups = new Map();
    mine.forEach((it) => {
      const fp = fingerprintOf(it);
      const gid = fp || ('solo:' + it.id);
      if (!groups.has(gid)) groups.set(gid, []);
      groups.get(gid).push(it);
    });

    const rows = [...groups.values()].map((items) => {
      // 同一个人可能反复保存同一份条件 → 按 userId 去重，只算「几个人」
      const people = new Map();
      items.forEach((it) => {
        const p = it.owner || {};
        const id = String(p.userId || p.userName || '未知');
        const prev = people.get(id);
        if (!prev || (it.at || 0) > (prev.at || 0)) {
          people.set(id, { name: p.userName || p.userId || '未知', userId: String(p.userId || ''), at: it.at || 0 });
        }
      });
      // 代表条目：最近保存的那条（它的名字与摘要最接近「现在该用的那份」）
      const head = items.slice()
        .sort((a, b) => (b.at - a.at) || (b.hits - a.hits))[0];
      const recent = [...people.values()].sort((a, b) => b.at - a.at)[0];
      return {
        ...head,
        savers: people.size,
        saverNames: [...people.values()].map((p) => p.name),
        recentUser: recent ? recent.name : '',
      };
    });

    return rows
      .sort((a, b) =>
        (b.savers - a.savers)
        || ((b.lastAt || b.at) - (a.lastAt || a.at))
        || (b.at - a.at))
      .slice(0, n);
  }

  /**
   * 「我保存的」——本机口径（服务端补充走 mineFromServer）。
   * 与 listByDept 的区别：这里**不聚合**（同一个人存两份相同条件是两条不同的命名查询，
   * 都该看见），也不按人数排，只按最近使用倒序。
   *
   * @param {{userId?:string, userName?:string}} user 当前用户；取不到键就返回空
   *        （**绝不退化成"显示全部"** —— 那会把同事的记录当成我的）
   */
  function listForUser(user, limit) {
    const key = userKeyOf(user);
    const mine = list()
      // 用 saverKeysOf 而不是 owner：owner 只是「最早保存的那个人」，
      // 经服务端往返后可能不是我（见 saverKeysOf 的注释）。
      .filter((it) => (key
        ? saverKeysOf(it).includes(key)          // 有身份：按人过滤
        // 2026-09-22 用户报「没登录时保存的也应该显示在常用查询里」：
        // 那时保存的记录 owner 为空，旧写法直接 return [] → 存下来了却看不到，
        // 空态还让用户"设好用户再去查询页重新保存一次"（等于白存）。
        // 现在没身份就把这些**无人认领的本机记录**列出来。
        // ⚠️ 这不等于"没设用户就显示全部"：有归属人的（同事的）一条都不会露出来，
        //    「宁可不显示，也不把同事的查询说成我的」这条旧口径依然成立。
        : saverKeysOf(it).length === 0))
      .sort((a, b) => ((b.lastAt || b.at) - (a.lastAt || a.at)) || (b.at - a.at));
    const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
    return n ? mine.slice(0, n) : mine;
  }

  /**
   * 把本机「无人认领」的记录认领给某个人（owner 为空 → owner = 当前用户）。
   *
   * 为什么需要：用户在**没设「当前用户」**时保存的查询，owner 是空的。
   * 等 ta 后来填了工号，那些记录既进不了「我的」（按人过滤不匹配），也不会自己消失 ——
   * 以前的做法是空态里让用户"去查询页重新保存一次"，等于白存。
   * 这里直接认领：改本机镜像 + 推给服务端，用户感知上就是「登录之后东西还在」。
   *
   * 幂等：没有匿名记录时什么都不做（返回 claimed: 0），反复调用安全。
   * 推送是 fire-and-forget：调用方（首页 renderSaved）要靠 markLocalWrite 的 5 秒保护
   * 挡住「GET 跑赢 POST、用认领前的旧数据覆盖镜像」的竞态。
   *
   * @param {object} user 当前用户 {userId,userName,teamId,...}
   * @returns {{ok:boolean, claimed:number, error?:string}}
   */
  function claimAnonymous(user) {
    const key = userKeyOf(user);
    if (!key) return fail('未设置当前用户');
    const items = list();
    const orphanIds = items.filter((it) => saverKeysOf(it).length === 0).map((it) => it.id);
    if (!orphanIds.length) return { ok: true, claimed: 0 };

    const owner = cleanOwner(user);
    const next = items.map((it) => (orphanIds.includes(it.id)
      ? { ...it, owner, saverKeys: [key], saverNames: [String(user.userName || key)] }
      : it));
    const w = writeRaw(next);
    if (!w.ok) return w;

    // 推服务端（fire-and-forget）：失败就只留本机，下一次同步/写操作会再带上它
    if (canSync()) {
      const claimed = orphanIds.map((id) => next.find((x) => x.id === id)).filter(Boolean);
      try {
        window.fetch(SERVER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: claimed, deletedIds: readPendingDeletes() }),
        }).then(() => {
          if (readPendingDeletes().length) writePendingDeletes([]);
        }).catch(() => { /* 离线：本机已经认领了，够渲染 */ });
      } catch (_) { /* 同上 */ }
    }
    return { ok: true, claimed: orphanIds.length };
  }

  /** 从首页点开一次 → 计一次打开（「高频」的依据）。async：镜像里没有就去服务端找 */
  async function hit(id) {
    if (!id) return fail('缺少 id');
    const items = list();
    const target = items.find((it) => it.id === id);
    if (target) {
      const next = items.map((it) => (it.id === id
        ? { ...it, hits: it.hits + 1, lastAt: Date.now() }
        : it));
      const w = writeRaw(next);
      const updated = next.find((it) => it.id === id);
      // 服务端可达就把计数送上去（失败不影响跳转——调用方也不等它）
      if (w.ok && canSync()) {
        try {
          await window.fetch(SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: [updated], deletedIds: readPendingDeletes() }),
          });
          if (readPendingDeletes().length) writePendingDeletes([]);
        } catch (_) { /* 计数失败不该挡住跳转 */ }
      }
      return w.ok ? { ok: true, item: updated } : w;
    }
    // 镜像里没有（深链进来 / 镜像陈旧）：去服务端找——记录可能是别人存的，先全集后我的
    if (canSync()) {
      try {
        const r = await window.fetch(SERVER_URL, { headers: { Accept: 'application/json' }, cache: 'no-store' });
        if (r.ok) {
          const data = (await r.json()).data;
          const found = data && Array.isArray(data.items)
            ? data.items.map(sanitize).filter(Boolean).find((it) => it.id === id)
            : null;
          if (found) {
            const updated = { ...found, hits: (found.hits || 0) + 1, lastAt: Date.now() };
            await window.fetch(SERVER_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ items: [updated] }),
            });
            // 是我自己的记录才进镜像（别人的只计数，不落本机）
            const cu = window.CurrentUser && window.CurrentUser.get();
            if (cu && saverKeysOf(updated).includes(userKeyOf(cu))) {
              writeRaw([updated].concat(list().filter((it) => it.id !== id)));
            }
            return { ok: true, item: updated };
          }
        }
      } catch (_) { /* 计数失败不该挡住跳转 */ }
    }
    return fail('该查询已不存在');
  }

  /**
   * 记一次「**我**用了这份查询」—— 部门高频查询的**时间衰减排序**要用
   * （方案见 publish/docs/部门高频查询排序方案.md；服务端落在 saved_query_uses 表）。
   *
   * ⚠️ **只在落地页调用，别在首页点卡片时调**：那一刻 `<a>` 已经开始跳转，
   * 浏览器会中断在途 fetch —— 实测点一次卡片，`hits` 和 `lastAt` 都没变，上报基本没成功过。
   * 落地页上报时跳转已经完成，而且语义更准：记的是「真打开并加载了」，不是「手滑点了一下」。
   *
   * 与 `hit()` 的分工：`hit()` 维护的是**整条记录**的打开次数（hits / lastAt）；
   * `markUsed()` 记的是**「这个人在这个部门」**用过它 —— 后者才是部门排行要的按人数据。
   *
   * @param {string} id 常用查询 id（URL 上 `?saved=` 的那个）
   * @returns {Promise<{ok:boolean, error?:string}>}
   */
  async function markUsed(id) {
    if (!id) return fail('缺少 id');
    const cu = window.CurrentUser && window.CurrentUser.get();
    const key = userKeyOf(cu);
    if (!key) return fail('未设置当前用户（不知道是谁用的，记了没意义）');
    if (!canSync()) return fail('当前环境没有同步端点');
    try {
      const r = await window.fetch(SERVER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [],
          uses: [{ queryId: String(id), userKey: key, deptKey: deptKeyOf(cu), at: Date.now() }],
        }),
      });
      if (!r.ok) return fail('使用上报失败：HTTP ' + r.status);
      return { ok: true };
    } catch (e) {
      return fail('使用上报失败：' + ((e && e.message) || String(e)));
    }
  }

  /**
   * get() 的 async 版：镜像里没有就去服务端找（先「我的」，再全集）。
   * 为什么要它：?saved=<id> 深链回填时，换电脑/清过缓存的本机镜像可能是空的——
   * 记录在共享库里，按 id 捞得到就照样回填（2026-09-20 架构改版配套）。
   */
  async function getAsync(id) {
    if (!id) return null;
    const local = list().find((it) => it.id === id);
    if (local) return local;
    if (!canSync()) return null;
    try {
      const cu = (window.CurrentUser && window.CurrentUser.get()) || {};
      const mine = await mineFromServer(cu);
      const inMine = mine.ok ? mine.items.find((it) => it.id === id) : null;
      if (inMine) return inMine;
      const r = await window.fetch(SERVER_URL, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!r.ok) return null;
      const data = (await r.json()).data;
      return (data && Array.isArray(data.items)
        ? data.items.map(sanitize).filter(Boolean).find((it) => it.id === id)
        : null) || null;
    } catch (_) {
      return null;
    }
  }

  function list() {
    return readRaw()
      .map(sanitize)
      .filter(Boolean)
      .sort((a, b) => b.at - a.at); // 最近保存的排前面
  }

  function get(id) {
    if (!id) return null;
    return list().find((it) => it.id === id) || null;
  }

  function newId() {
    return 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /**
   * 保存一份常用查询（**async，服务端优先**）。
   *
   * 2026-09-20 架构改版（用户拍板：**数据库为唯一真相源，不要存 localStorage**）：
   *   · 服务端可达 → 判重对着**服务端里我的列表**算（不再对着本机混合列表），
   *     然后只 POST 这一条；localStorage 里只留「我的列表」镜像。
   *   · 服务端不可达（静态部署 / 代理没起）→ 走本地兜底（写镜像 + autoPush），
   *     行为与旧版一致，返回值带 localOnly:true。
   * 判重口径不变：同名同页**只对同一个人**算更新——两个人各自保存同名查询
   * 是两条记录（默认名由筛选条件生成，同一份条件两人保存必然同名）。
   */
  async function save({ page, name, fields, summary, labels, owner, autoName }) {
    if (!page || !PAGES[page]) return fail('未知的页面类型');
    const title = (name || '').trim();
    if (!title) return fail('请填写查询名称');

    const cleanedFields = {};
    Object.keys(fields || {}).forEach((k) => {
      const v = cleanValue(fields[k]);
      if (v !== null && v !== '') cleanedFields[k] = v;
    });

    // 谁保存的（用于「我的常用查询」与部门排行）。没显式传就取「当前用户」。
    // ⚠️ 这个兜底**要求每个引用本模块的页面都加载了 current-user.js** ——
    // 少引一个脚本不会报错，只会让 owner 静默变成 null，那条记录就永远进不了
    // 任何按人/按部门的视图（2026-09-19 的三个查询页正是这么坏的）。
    // 所以这里把「取不到归属」显式回给调用方，由页面 toast 说给用户听。
    const ownerInfo = cleanOwner(owner || (window.CurrentUser && window.CurrentUser.get()));
    const myKey = userKeyOf(ownerInfo);

    // ── 服务端路径 ──
    if (canSync() && myKey) {
      const srv = await saveToServer({ page, title, cleanedFields, summary, labels, ownerInfo, myKey, autoName });
      if (srv.ok) return { ok: true, item: srv.item, updated: !!srv.updated, server: true };
      // 服务端失败不拦人：退回本地兜底，让用户先把东西存下来（错误留在角标里）
    }

    // ── 本地兜底路径（离线 / 服务端失败 / 没有归属人）──
    const serverTried = canSync() && !!myKey;   // true = 服务端试过但失败，提示语要说「仅本机」
    const items = list();
    // 判重按「同一份筛选条件 + 同一个人」（sameQuery），**不是**按名字 ——
    // 否则用户一改名就等于又存了一条（2026-09-22 报的）。
    const probe = { page, name: title, fields: cleanedFields, owner: ownerInfo };
    const exists = items.find((it) => sameQuery(it, probe));
    const item = {
      id: exists ? exists.id : newId(),
      page,
      name: title,
      autoName: String(autoName || '').trim().slice(0, 60),
      summary: typeof summary === 'string' ? summary : '',
      labels: cleanLabels(labels),
      owner: ownerInfo,
      // 同一份条件重复保存时累加保存次数，而不是重置——「高频」既看打开也看保存
      saves: exists ? (exists.saves || 1) + 1 : 1,
      hits: exists ? (exists.hits || 0) : 0,
      lastAt: exists ? (exists.lastAt || 0) : 0,
      v: SCHEMA_VERSION,
      at: Date.now(),
      fields: cleanedFields,
    };

    const next = exists
      ? items.map((it) => (it.id === exists.id ? item : it))
      : [item].concat(items);

    if (!exists && next.length > MAX_ITEMS) {
      return fail(`常用查询最多保存 ${MAX_ITEMS} 条，请先删除不用的`);
    }
    const w = writeRaw(next);
    if (w.ok) autoPush();
    if (w.ok && !ownerInfo) {
      // 有声失败：没归属的记录在按人/按部门两种视图里都是隐形的，不给提示就会变成"我明明存了"
      console.warn('[saved-query] 这条查询没有归属人（当前用户没设置，或本页没加载 current-user.js）');
    }
    return w.ok ? { ok: true, item, updated: !!exists, ownerMissing: !ownerInfo, localOnly: serverTried } : w;
  }

  /**
   * save() 的服务端一段：拉「服务端里我的列表」判重 → 只 POST 这一条。
   * 判重数据来自服务端而不是本机镜像 —— 本机镜像可能陈旧甚至混着别人的旧记录，
   * 而服务端才是唯一真相源。任何一步失败返回 {ok:false,...}，由 save() 落回本地。
   */
  async function saveToServer({ page, title, cleanedFields, summary, labels, ownerInfo, myKey, autoName }) {
    const mine = await mineFromServer(ownerInfo);
    if (!mine.ok) return { ok: false, error: mine.error };
    // 与本地兜底同一套判据：同条件 + 同人 = 同一条（改名不该产生新记录）
    const probe = { page, name: title, fields: cleanedFields, owner: ownerInfo };
    const exists = mine.items.find((it) => sameQuery(it, probe));
    const item = {
      id: exists ? exists.id : newId(),
      page,
      name: title,
      autoName: String(autoName || '').trim().slice(0, 60),
      summary: typeof summary === 'string' ? summary : '',
      labels: cleanLabels(labels),
      owner: ownerInfo,
      saves: exists ? (exists.saves || 1) + 1 : 1,
      hits: exists ? (exists.hits || 0) : 0,
      lastAt: exists ? (exists.lastAt || 0) : 0,
      v: SCHEMA_VERSION,
      at: Date.now(),
      fields: cleanedFields,
    };
    try {
      const r = await window.fetch(SERVER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [item], deletedIds: readPendingDeletes() }),
      });
      if (!r.ok) return { ok: false, error: '同步失败：HTTP ' + r.status };
      const json = await r.json();
      if (!json || !json.data) return { ok: false, error: '同步端点的响应不是预期 JSON' };
      // 服务端已确认。镜像刷新成「服务端里我的列表」——绝不写回 POST 响应里的团队全集。
      const meta = { file: json.data.file, storage: json.data.storage, people: json.data.people };
      const refreshed = await mineFromServer(ownerInfo);
      const total = refreshed.ok ? refreshed.items.length : undefined;
      if (refreshed.ok) writeRaw(refreshed.items);
      if (readPendingDeletes().length) writePendingDeletes([]);
      recordSync({ ok: true, total, ...meta });
      return { ok: true, item, updated: !!exists };
    } catch (e) {
      return { ok: false, error: '同步失败：' + ((e && e.message) || String(e)) };
    }
  }

  /**
   * 重命名（async，服务端优先）。镜像里找不到时去服务端「我的列表」里找——
   * 镜像可能还没刷新，但不能因为本机陈旧就说「不存在」。
   */
  async function rename(id, name) {
    const title = (name || '').trim();
    if (!title) return fail('请填写查询名称');
    const items = list();
    const target = items.find((it) => it.id === id);

    // ── 服务端路径 ──
    if (canSync()) {
      let base = target;
      if (!base) {
        const cu = window.CurrentUser && window.CurrentUser.get();
        const mine = await mineFromServer(cu || {});
        if (mine.ok) base = mine.items.find((it) => it.id === id);
      }
      if (base) {
        try {
          const r = await window.fetch(SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: [{ ...base, name: title }], deletedIds: readPendingDeletes() }),
          });
          if (r.ok) {
            const json = await r.json().catch(() => null);
            if (json && json.data) {
              // 本机镜像同步改掉（它只含我的记录，直接 map 替换是安全的）
              const w = writeRaw(list().map((it) => (it.id === id ? { ...it, name: title } : it)));
              if (readPendingDeletes().length) writePendingDeletes([]);
              recordSync({ ok: true, total: list().length, file: json.data.file, storage: json.data.storage, people: json.data.people });
              if (w.ok || !storage()) return { ok: true, item: { ...base, name: title }, server: true };
            }
          }
          // HTTP 失败 → 落本地
        } catch (_) { /* 落本地 */ }
      }
    }

    // ── 本地兜底 ──
    if (!target) return fail('该查询已不存在');
    const next = items.map((it) => (it.id === id ? { ...it, name: title, at: it.at } : it));
    const w = writeRaw(next);
    if (w.ok) autoPush();
    return w.ok ? { ok: true, item: { ...target, name: title } } : w;
  }

  /** 删除（async）：本地摘掉 + 立墓碑 + **await** 推送（推送里带刷新镜像，不再是 fire-and-forget） */
  async function remove(id) {
    const items = list();
    if (!items.some((it) => it.id === id)) return fail('该查询已不存在');
    const w = writeRaw(items.filter((it) => it.id !== id));
    if (w.ok) { markDeleted(id); await pushToServer(); }
    return w.ok ? { ok: true } : w;
  }

  /**
   * 就地改一条记录的**展示字段**（labels / summary / v），不动 id、name、fields、at。
   *
   * 为什么需要它：2026-09-18 之前的记录里摘要是「保存那一刻拼好的字符串」，
   * 里面写的是编号（2611pc / E00301）。改代码修不了已经落盘的文本，
   * 所以各页在从首页打开一条旧查询时，用已加载的字典把摘要重算一遍回写——
   * 用户**点一次卡片就自动修好**，不用手动重新保存。
   */
  function update(id, patch) {
    if (!id) return fail('缺少 id');
    const items = list();
    const target = items.find((it) => it.id === id);
    if (!target) return fail('该查询已不存在');
    const next = items.map((it) => {
      if (it.id !== id) return it;
      const merged = { ...it };
      if (patch && typeof patch.summary === 'string') merged.summary = patch.summary;
      if (patch && patch.labels) merged.labels = cleanLabels(patch.labels);
      if (patch && typeof patch.v === 'number') merged.v = patch.v;
      return merged;
    });
    const w = writeRaw(next);
    return w.ok ? { ok: true, item: next.find((it) => it.id === id) } : w;
  }

  /**
   * 清空本机清单。
   * ⚠️ **它删的是整个团队库，不只是「我这份」**：本机视图已经是共享文件的全集
   * （同事的记录也在里面），所以 clear() 会把每个人的 id 都记进删除意图并同步给服务端。
   * 2026-09-19 在跨机器自测里亲眼见过：B 端调一次 clear()，A 端刚推上去的记录当场消失。
   *
   * 因此：**别把它接成 UI 上的「清空」按钮**；真要有这种按钮，必须①明确告知会删除同事的记录，
   * ②二次确认。目前全项目只有测试脚本在调用（已 grep 确认，UI 侧无入口）。
   */
  function clear() {
    const ids = list().map((it) => it.id);
    const w = writeRaw([]);
    if (w.ok) { ids.forEach(markDeleted); autoPush(); }
    return w;
  }

  /**
   * 导出成可交换的 JSON 文本。
   * 为什么需要：数据在本机 localStorage 里，**换浏览器 / 换电脑就看不到别人的**
   * （不是权限问题，是物理上不共享）。同团队要对齐常用查询时，
   * 至少能一键导出、对方一键导入合并。
   */
  function exportJson() {
    // ⚠️ 口径必须与列表一致（listForUser），**不能**直接导 `list()`：
    // 镜像是「我的」离线镜像，**清除登录态并不会清掉它** —— 里面还残留着上一个登录的人
    // 的记录。直接导 list() 的话，没设用户的人导出文件里就会混进别人的查询
    //（2026-09-22 用户实测：清了登录态导出，文件里带着吴树海的两条）。
    // 有身份 = 导 ta 的；没身份 = 只导本机匿名的 —— 「导出的就是你看到的」。
    const items = listForUser(window.CurrentUser && window.CurrentUser.get());
    return JSON.stringify({
      app: 'spider-saved-queries',
      v: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      items,
    }, null, 2);
  }

  /**
   * 导出（async，服务端优先）：连得上代理就导**整个团队库**，导不出才退本机镜像。
   * 为什么要变：镜像现在只含「我的」，直接导本机会让文件看起来"少了一大半"；
   * 而团队库本来就该是导出的主体（换电脑对齐用的）。
   */
  async function exportJsonAsync() {
    // 2026-09-21 用户拍板：导出**只导当前用户自己的**。
    // 以前这里直接拉 SERVER_URL（团队库全集）—— 实测导出文件里 12 条跨了 6 个人
    // （郑梓辉/李胜华/吴树海/贾星玥…），用户报「怎么导出了这么多人的」。
    // 跨机器搬运的实际场景是「我（或同事）导出 → 再导入」，本来就用不到别人的记录；
    // 要看别人的有首页的「部门常用查询」。所以这里改用按人查询的口径。
    const cu = window.CurrentUser && window.CurrentUser.get();
    if (cu) {
      const mine = await mineFromServer(cu);
      if (mine.ok) {
        return JSON.stringify({
          app: 'spider-saved-queries',
          v: SCHEMA_VERSION,
          exportedAt: new Date().toISOString(),
          items: mine.items,
        }, null, 2);
      }
      // 按人拉失败（存储后端不支持 ?user= 等）→ 退本机镜像。镜像本来就只含「我的」，
      // 退它不会把别人的记录混进来，正是这里想要的。
    }
    // 没设「当前用户」：没有归属人就没有服务端记录，导出本机镜像里那几份
    // （用户拍板：没设用户时的常用查询就存在 localStorage，不进库）
    return exportJson();
  }

  /**
   * 导入他人导出的 JSON（按 id 或「同页面同名」合并，幂等）。
   * 计数取 max 而不是相加 —— 反复导入同一个文件不该把「高频」刷上去。
   * @returns {{ok:boolean, added?:number, merged?:number, total?:number, error?:string}}
   */
  /**
   * 合并两份列表（幂等）：按 id，或「同页面 + 同名 + 同一个人」判重，计数取 max ——
   * 反复提交同一个文件不该把「高频」刷上去。
   * 判重**必须带上人**：不同的人各自保存同名查询是两条记录，只看 page+name 会把别人的吞掉
   * （2026-09-20 实测：第二个用户那条就是这样消失的）。
   * 导出/导入与代理同步共用这一份规则。
   */
  function mergeItems(localItems, incoming) {
    const items = (localItems || []).slice();
    let added = 0;
    let merged = 0;
    (incoming || []).forEach((inc) => {
      const same = items.find((it) => sameQuery(it, inc));
      if (same) {
        same.hits = Math.max(same.hits || 0, inc.hits || 0);
        same.saves = Math.max(same.saves || 1, inc.saves || 1);
        same.lastAt = Math.max(same.lastAt || 0, inc.lastAt || 0);
        if (!same.owner && inc.owner) same.owner = inc.owner;   // 本地没归属就补上
        if (!same.labels && inc.labels && Object.keys(inc.labels).length) same.labels = inc.labels;
        // 默认名同理：本机的旧记录没有它，从服务端同步回来时补上（部门榜要用）
        if (!same.autoName && inc.autoName) same.autoName = inc.autoName;
        // 「谁保存过」取并集：合并后两个人的名单都要留着，
        // 否则并过来的那一位又看不见这条了（与 owner 只看最早的那位是同一个坑）。
        same.saverKeys = Array.from(new Set([...(same.saverKeys || []), ...(inc.saverKeys || [])]));
        merged += 1;
      } else {
        items.push(inc);
        added += 1;
      }
    });
    return { items, added, merged };
  }

  /**
   * 导入（async，服务端优先）：
   *   · 连得上代理 → 先 GET 全集算出「新增/合并」计数（只为了让 toast 说得准），
   *     再把**合并后的全集** POST 回去（服务端按 id upsert，天然幂等），
   *     最后刷新镜像。上限检查交给服务端（proxy.js 的 2000 条截断），不再按本机 200 卡。
   *   · 连不上 → 走旧的本地合并路径。
   */
  async function importJson(text) {
    let parsed;
    try {
      parsed = JSON.parse(String(text || ''));
    } catch (_) {
      return fail('不是合法的 JSON 文件');
    }
    const incoming = Array.isArray(parsed)
      ? parsed
      : (parsed && Array.isArray(parsed.items) ? parsed.items : null);
    if (!incoming) return fail('文件里没有 items 数组（确认是本页「导出」出来的文件？）');

    const valid = incoming.map(sanitize).filter(Boolean);
    if (!valid.length) return fail('文件里没有可用的常用查询');

    // 2026-09-21 用户拍板：导入进来的记录**归当前用户**（有当前用户时）。
    // 以前保留文件里的原 owner —— 后果是把同事导出的文件导入后，那些记录归同事，
    // 自己在「我的常用查询」里根本看不见（用户实测报的）。
    // 判重口径（同页面 + 同名 + 同一个人）随之按「我」来算：与我已有的同名记录会合并。
    // 没设当前用户时不动 owner —— 那种记录只落本机镜像（与 save 的本地兜底路径同理）。
    const me = cleanOwner(window.CurrentUser && window.CurrentUser.get());
    if (me) valid.forEach((it) => { it.owner = me; });

    if (canSync()) {
      try {
        const r = await window.fetch(SERVER_URL, { headers: { Accept: 'application/json' }, cache: 'no-store' });
        if (r.ok) {
          const json = await r.json();
          const data = json && json.data;
          if (data && Array.isArray(data.items)) {
            const existing = data.items.map(sanitize).filter(Boolean);
            const { items, added, merged } = mergeItems(existing, valid);
            const p = await window.fetch(SERVER_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ items, deletedIds: readPendingDeletes() }),
            });
            if (p.ok) {
              const pj = await p.json().catch(() => null);
              const pd = pj && pj.data;
              if (!pd) return fail('同步端点的响应不是预期 JSON');
              if (readPendingDeletes().length) writePendingDeletes([]);
              // 镜像只刷「我的」：导入的多半是别人的记录，不该进本机镜像
              const cu = window.CurrentUser && window.CurrentUser.get();
              let total = items.length;
              if (cu) {
                const mine = await mineFromServer(cu);
                if (mine.ok) { writeMineSeg(mine.items); total = mine.items.length; }   // 只覆盖登录段
              }
              recordSync({ ok: true, total, file: pd.file, storage: pd.storage, people: pd.people });
              return { ok: true, added, merged, total, server: true };
            }
          }
        }
        // 服务端失败 → 落本地兜底
      } catch (_) { /* 落本地兜底 */ }
    }

    const { items, added, merged } = mergeItems(list(), valid);
    if (items.length > MAX_ITEMS) {
      return fail(`合并后共 ${items.length} 条，超过上限 ${MAX_ITEMS} 条，请先清理一些再导入`);
    }
    const w = writeRaw(items);
    // 与 save / rename / remove 一致：导入也是本机的一次**写操作**，要推给共享库。
    if (w.ok) autoPush();
    return w.ok ? { ok: true, added, merged, total: items.length } : w;
  }

  // ── 与代理端点的同步（团队共享，与批次时间同一套路）──────────
  //
  // 为什么需要它：记录在本机 localStorage，换电脑/换浏览器就看不到别人的。
  // 代理提供一个读写共享文件的端点（GET 拉、POST 合并落盘），
  // 于是「同一个代理 / 同一个共享目录」的人就能看到彼此的常用查询。
  // 任何一步失败都只是「退回本机」——同步不该打断用户正在做的事。

  /** 环境是否支持同步：测试环境（无 location）与静态部署（无 fetch）都要安静跳过 */
  function canSync() {
    // 都从 window 上取：一是符合「调用时才取 window.*」的项目约定，
    // 二是单测能把 window.fetch / window.location 换成桩（裸 fetch 会解析到宿主全局）。
    return typeof window.fetch === 'function' && typeof window.location !== 'undefined';
  }

  // ── 同步状态（首页那个「已同步 / 仅本机」角标的唯一数据源）──────
  //
  // 为什么要显式记一份：同步一直是静默的 —— 成功合并、失败退回本机，页面上
  // 看不出任何差别，用户无从判断自己看到的是「团队库」还是「只有本机这一份」。
  // 代理在 GET/POST 响应里已经带了 file（它实际在读写哪个库文件），
  // 所以这个状态不需要新接口，只要把每次同步的结果如实留下来。
  //
  // state：'shared' 连上了共享库 / 'local' 没有端点（静态部署、离线）
  //        / 'fail' 端点在但这次失败 / 'pending' 还没同步过
  //        / 'nouser' 没设「当前用户」—— 没有「我的列表」可同步，首页角标对它隐藏
  //          （2026-09-21 加：以前这种情况也报 'shared'，等于说了一句空话）
  const syncState = { state: 'pending', total: 0, file: '', storage: '', people: 0, error: '', at: 0 };
  const syncListeners = new Set();

  /** @returns {{state:string,total:number,file:string,storage:string,people:number,error:string,at:number}} 最近一次同步的结果（副本，改不坏内部状态） */
  function lastSyncState() {
    return { ...syncState };
  }

  /**
   * 订阅「同步状态变了」，首页角标靠它刷新。
   * @param {(st:object)=>void} fn
   * @returns {() => void} 取消订阅
   */
  function onSyncStateChange(fn) {
    if (typeof fn !== 'function') return () => {};
    syncListeners.add(fn);
    return () => syncListeners.delete(fn);
  }

  /** 端点根本不存在（静态部署 / 没起代理）：这不是故障，别报成「同步失败」 */
  function isMissingEndpoint(err) {
    // 「响应不是 JSON」这类（SPA 站点会把未知路径 fallback 成 200 + HTML）也算没有端点，
    // 报成故障会让人以为共享库坏了。
    return /HTTP 40[45]|HTTP 50[123]|Failed to fetch|NetworkError|Load failed|not found|没有同步端点|is not valid JSON|Unexpected .*in JSON/i
      .test(String(err || ''));
  }

  /** 「这个环境压根没有同步端点」：显式标注，免得被误判成故障 */
  function noEndpoint(msg) {
    return Object.assign(fail(msg), { noEndpoint: true });
  }

  /** 把一次同步的结果落到 syncState；beacon 那条路径拿不到响应，不能拿它覆盖状态 */
  function recordSync(r) {
    if (!r || r.beacon) return r;
    syncState.at = Date.now();
    if (r.ok) {
      // 'nouser'：没设当前用户时只是探活，没有「我的列表」可同步 —— 不许谎报「已同步」
      syncState.state = r.noUser
        ? 'nouser'
        : (r.file ? 'shared' : (syncState.state === 'shared' ? 'shared' : 'local'));
      syncState.total = Number(r.total) || 0;
      // 只留文件名，不把代理机器的绝对路径摆到页面上（代理默认监听所有网卡，
      // 角标是每个打开首页的人都会看的；真要看全路径，title 里的文件名足够定位）
      if (r.file) syncState.file = String(r.file).split(/[\\/]/).filter(Boolean).pop() || String(r.file);
      if (r.storage) syncState.storage = String(r.storage);
      if (Number(r.people) > 0) syncState.people = Number(r.people);
      syncState.error = '';
    } else {
      const msg = (r.error && String(r.error)) || '未知错误';
      syncState.state = (r.noEndpoint || isMissingEndpoint(msg)) ? 'local' : 'fail';
      syncState.error = msg;
    }
    // 「写完本地顺手推一次」的调用方（save/rename/删除/导入）拿不到这个 Promise，
    // 所以角标靠订阅刷新，不靠它们各自传回调 —— 少接线就少漏接。
    syncListeners.forEach((fn) => { try { fn(lastSyncState()); } catch (_) { /* 订阅方炸了不影响存储层 */ } });
    return r;
  }

  /**
   * 向服务端要「部门高频查询」排行。
   *
   * 为什么要走服务端：本机只能看到**这台机器上**的记录，「部门里几个人保存过」
   * 需要所有人的记录凑在一起才算得出来 —— 那部分数据在代理的 SQLite 库里。
   * 服务端按同一份条件聚合并 COUNT(DISTINCT 人)，我们直接拿结果渲染。
   *
   * 存储降级到 JSON 文件时，代理不认 `?dept=`，会返回 `mode:'all'` 的全量列表；
   * 那种情况必须**拒绝使用**（否则页面上会变成「不分部门的全部记录」），
   * 让调用方退回本机计算。
   *
   * @returns {Promise<{ok:boolean, items?:Array, people?:number, storage?:string, error?:string}>}
   */
  async function deptTopFromServer(user, limit) {
    if (!canSync()) return fail('当前环境没有同步端点（静态部署或离线）');
    const key = deptKeyOf(user);
    if (!key) return fail('未设置当前用户，拿不到部门');
    const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;
    try {
      const r = await window.fetch(
        `${SERVER_URL}?dept=${encodeURIComponent(key)}&limit=${n}`,
        { headers: { Accept: 'application/json' }, cache: 'no-store' },
      );
      if (!r.ok) return fail('部门排行请求失败：HTTP ' + r.status);
      const json = await r.json();
      const data = json && json.data;
      if (!data) return fail('部门排行返回异常（没有 data）');
      // 关键防线：**明确**要求 mode 是 dept。JSON 存储/静态服务器会忽略我们的查询参数、
      // 直接回全量 —— 那一刻要是照渲染，部门卡就名不副实了。
      // （旧写法 `data.mode && data.mode !== 'dept'` 在 mode **缺失**时放行，
      //   而 JSON 兜底分支恰恰不发 mode：实测那样会把全部门记录当成本部门排行。2026-09-19 改严）
      if (data.mode !== 'dept') return fail('存储后端不支持部门排行（回落到本机计算）');
      const items = Array.isArray(data.items) ? data.items.map(sanitize).filter(Boolean) : null;
      if (!items) return fail('部门排行返回异常（没有 items）');
      return { ok: true, items, people: Number(data.people) || 0, storage: String(data.storage || '') };
    } catch (e) {
      return fail('部门排行请求失败：' + ((e && e.message) || String(e)));
    }
  }

  /**
   * 「我的常用查询」的服务端版本（?user=&lt;工号&gt;）。
   * 为什么要走服务端：换浏览器 / 换电脑时本机 localStorage 是空的，
   * 但记录在共享库里，按工号还能捞回来 —— 这才是「这个人存过哪些」的完整答案。
   *
   * 与 deptTopFromServer 同一条命门：**mode 必须严格等于 'user'**。
   * JSON 存储或静态服务器会忽略查询参数、回全量列表，照渲染就等于把同事的记录显示成"我的"。
   *
   * @returns {Promise<{ok:boolean, items?:Array, storage?:string, error?:string}>}
   */
  async function mineFromServer(user, limit) {
    if (!canSync()) return fail('当前环境没有同步端点（静态部署或离线）');
    const key = userKeyOf(user);
    if (!key) return fail('未设置当前用户');
    const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 200;
    try {
      const r = await window.fetch(
        `${SERVER_URL}?user=${encodeURIComponent(key)}&limit=${n}`,
        { headers: { Accept: 'application/json' }, cache: 'no-store' },
      );
      if (!r.ok) return fail('我的查询请求失败：HTTP ' + r.status);
      const json = await r.json();
      const data = json && json.data;
      if (!data) return fail('我的查询返回异常（没有 data）');
      if (data.mode !== 'user') return fail('存储后端不支持按人查询（回落到本机计算）');
      const items = Array.isArray(data.items) ? data.items.map(sanitize).filter(Boolean) : null;
      if (!items) return fail('我的查询返回异常（没有 items）');
      return { ok: true, items, storage: String(data.storage || '') };
    } catch (e) {
      return fail('我的查询请求失败：' + ((e && e.message) || String(e)));
    }
  }

  /**
   * 刷新本机镜像 = 从服务端拉「当前用户的我的列表」。
   * 2026-09-20 架构改版：不再把团队全集合并进本机（localStorage 只做「我的」离线镜像）。
   * 没设当前用户时无事可做——但同步状态角标还是要如实上报（连没连得上）。
   */
  async function syncFromServer() {
    if (!canSync()) return recordSync(noEndpoint('当前环境没有同步端点（静态部署或离线）'));
    const cu = window.CurrentUser && window.CurrentUser.get();
    try {
      if (!cu) {
        // 没有归属人：没有「我的列表」可同步（也不会被写进镜像），只探一下端点活着没。
        // ⚠️ 但要标 noUser —— 那时**什么都没同步**，不能把角标说成「已同步」
        //（2026-09-21 用户报：「没设用户时那个已同步的角标是不是也在乱说」）。
        const r = await window.fetch(SERVER_URL, { headers: { Accept: 'application/json' }, cache: 'no-store' });
        if (!r.ok) return recordSync(fail('同步失败：HTTP ' + r.status));
        const json = await r.json();
        const data = (json && json.data) || {};
        return recordSync({ ok: true, noUser: true, total: list().length, file: data.file, storage: data.storage, people: data.people });
      }
      const mine = await mineFromServer(cu);
      if (!mine.ok) return recordSync(fail(mine.error));
      const meta = { file: mine.storage, storage: mine.storage };
      writeMineSeg(mine.items);   // 只覆盖登录段：匿名段独立存活，不能被同步冲掉
      return recordSync({ ok: true, added: 0, merged: 0, total: mine.items.length, ...meta });
    } catch (e) {
      return recordSync(fail('同步失败：' + ((e && e.message) || String(e))));
    }
  }

  /**
   * 把本机记录推给端点（服务端会与文件里的合并后返回全集），并用返回结果覆盖本地。
   * @param {{beacon:boolean}} [opts] beacon=true 时用 sendBeacon —— 页面正在关闭
   *        （比如点开一条查询要跳转）也能把这次计数送出去，普通 fetch 会被中断丢掉。
   */
  async function pushToServer(opts) {
    const o = opts || {};
    const pendingDeletes = readPendingDeletes();
    const payload = JSON.stringify({ items: list(), deletedIds: pendingDeletes });

    if (o.beacon) {
      // beacon 是「发完就走」：拿不到响应，所以这条路径**不记同步状态**（beacon: true 让
      // recordSync 跳过它）。否则关页面时的 sendBeacon 不可用会把一个好好的「已同步」
      // 角标翻成「同步失败」，而用户其实什么都没做错。
      try {
        // sendBeacon 不带自定义头，但代理只解析 body，够用
        const nav = window.navigator;
        if (nav && typeof nav.sendBeacon === 'function') {
          const okSent = nav.sendBeacon(SERVER_URL, new Blob([payload], { type: 'application/json' }));
          if (okSent) { writePendingDeletes([]); return { ok: true, beacon: true }; }
          return { ...fail('浏览器拒绝发送'), beacon: true };
        }
      } catch (_) { /* 落到普通 fetch */ }
      return { ...fail('当前环境不支持 sendBeacon'), beacon: true };
    }

    if (!canSync()) return recordSync(noEndpoint('当前环境没有同步端点（静态部署或离线）'));
    try {
      const r = await window.fetch(SERVER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
      if (!r.ok) return recordSync(fail('同步失败：HTTP ' + r.status));
      const json = await r.json();
      // data 整块缺失 = 这个 200 根本不是代理给的（静态站的 fallback 页也会 200）。
      // 不能当成「同步成功」，否则角标会说「已同步」。
      if (!json || !json.data) return recordSync(noEndpoint('同步端点的响应不是预期 JSON'));
      const data = json.data;
      const meta = { file: data.file, storage: data.storage, people: data.people };
      // ⚠️ 2026-09-20 架构改版：**不再把 POST 响应里的团队全集写进 localStorage**。
      // 旧写法 `writeRaw(全集)` 会让本机镜像混着所有人的记录（李四的机器上有张三的记录），
      // 是「改名弹回 / 导入被盖 / 第二个人存了看不到」这一串 bug 的共同根源。
      // 现在镜像只留「我的列表」：有当前用户就顺手拉一份刷进去，没有就保持现状。
      if (readPendingDeletes().length) writePendingDeletes([]);
      const cu = window.CurrentUser && window.CurrentUser.get();
      if (cu) {
        const mine = await mineFromServer(cu);
        if (mine.ok) writeMineSeg(mine.items);   // 只覆盖登录段，匿名段不动
        return recordSync({ ok: true, total: mine.ok ? mine.items.length : list().length, ...meta });
      }
      return recordSync({ ok: true, total: list().length, ...meta });
    } catch (e) {
      return recordSync(fail('同步失败：' + ((e && e.message) || String(e))));
    }
  }

  function readPendingDeletes() {
    const s = storage();
    if (!s) return [];
    try {
      const arr = JSON.parse(s.getItem(DELETED_KEY) || '[]');
      return Array.isArray(arr) ? arr.map(String) : [];
    } catch (_) { return []; }
  }

  function writePendingDeletes(ids) {
    const s = storage();
    if (!s) return;
    try {
      s.setItem(DELETED_KEY, JSON.stringify(Array.from(new Set((ids || []).map(String)))));
    } catch (_) { /* 存不下就退化成「只删本地」，不影响别的功能 */ }
  }

  /** 记一条删除意图（下次 push 时带给服务端立墓碑） */
  function markDeleted(id) {
    if (!id) return;
    writePendingDeletes(readPendingDeletes().concat(String(id)));
  }

  /** 写完本地后「尽力而为」推一次：失败静默 —— 本地已经存好了，别用同步失败打扰用户 */
  function autoPush() {
    if (!canSync()) return;
    Promise.resolve()
      .then(() => pushToServer())
      .catch(() => { /* 静默：端点不可用就只留本机 */ });
  }

  /**
   * 给各页「⭐ 保存到首页」那句提示用的短后缀。
   *
   * 为什么要：保存后的自动回推是 fire-and-forget 的，用户看不到「这次进没进共享库」，
   * 与首页角标当年那个「同步是静默的」是同一个毛病。首页角标不在查询页的视野里，
   * 所以让三个查询页的 toast 也带上同一份口径 —— 判定还是只在 recordSync 一处。
   * 措辞刻意是「连接状态」而不是「这条已上传」：推送此刻还没回来，不能替它下结论。
   * @returns {string} 以 ` · ` 开头的后缀；还没同步过时返回空串（不瞎猜）
   */
  function syncSuffix() {
    const st = lastSyncState();
    if (st.state === 'shared') return ' · 共享库已连上';
    if (st.state === 'local') return ' · 仅本机（没连上共享库）';
    if (st.state === 'fail') return ` · 共享同步失败（${st.error || '未知错误'}），先存本机`;
    return '';
  }

  /**
   * 保存结果里「没记到归属人」时追加的那半句 —— 措辞只这一处，三个查询页共用。
   * 不说清的话，用户会觉得「我明明存了，首页怎么没有」：没归属的记录在
   * 「我的常用查询」和部门排行里都是隐形的，而保存本身是成功的。
   */
  function ownerSuffix(r) {
    return (r && r.ownerMissing)
      ? ' · 但没记到归属人（先在首页设好当前用户），这条不会出现在「我的」和部门排行里'
      : '';
  }

  /** 各页跳转地址（与 proxy.js 的干净路由一致） */
  function hrefFor(page, id) {
    const base = page === 'task' ? '/task' : page === 'subscription' ? '/subscription' : '/publish';
    return `${base}?saved=${encodeURIComponent(id)}`;
  }

  window.SavedQuery = {
    STORAGE_KEY,
    MAX_ITEMS,
    SCHEMA_VERSION,
    PAGES,
    list,
    get,
    save,
    rename,
    update,
    hit,
    listByDept,
    deptTopFromServer,
    deptKeyOf,
    listForUser,
    mineFromServer,
    userKeyOf,
    saverKeysOf,
    fingerprintOf,
    sameQuery,
    nameFromLabels,
    condNameOf,
    exportJson,
    exportJsonAsync,
    importJson,
    getAsync,
    markUsed,
    claimAnonymous,
    syncFromServer,
    pushToServer,
    lastSyncState,
    onSyncStateChange,
    syncSuffix,
    ownerSuffix,
    remove,
    clear,
    hrefFor,
  };
})();
