/**
 * 常用查询（首页快捷入口）存储层
 * ------------------------------------------------------------
 * 三个查询页都能把「当前填好的筛选条件」存一份到首页，之后从首页一键直达、
 * 自动回填条件并查询。数据落在 localStorage，**不进任何请求**。
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

  function readRaw() {
    const s = storage();
    if (!s) return [];
    try {
      const txt = s.getItem(STORAGE_KEY);
      if (!txt) return [];
      const parsed = JSON.parse(txt);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return []; // JSON 坏掉 / 不是数组：当成空列表，不拖崩首页
    }
  }

  function writeRaw(list) {
    const s = storage();
    if (!s) return fail('浏览器存储不可用（隐私模式？），无法保存');
    try {
      s.setItem(STORAGE_KEY, JSON.stringify(list));
      return { ok: true };
    } catch (e) {
      // 最常见的是 QuotaExceededError
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
    if (!key) return [];
    const mine = list()
      // 用 saverKeysOf 而不是 owner：owner 只是「最早保存的那个人」，
      // 经服务端往返后可能不是我（见 saverKeysOf 的注释）。
      .filter((it) => saverKeysOf(it).includes(key))
      .sort((a, b) => ((b.lastAt || b.at) - (a.lastAt || a.at)) || (b.at - a.at));
    const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
    return n ? mine.slice(0, n) : mine;
  }

  /** 从首页点开一次 → 计一次打开（「高频」的依据；纯本地计数，不上报） */
  function hit(id) {
    if (!id) return fail('缺少 id');
    const items = list();
    const target = items.find((it) => it.id === id);
    if (!target) return fail('该查询已不存在');
    const next = items.map((it) => (it.id === id
      ? { ...it, hits: it.hits + 1, lastAt: Date.now() }
      : it));
    const w = writeRaw(next);
    return w.ok ? { ok: true, item: next.find((it) => it.id === id) } : w;
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
   * 保存一份常用查询。
   * 同名同页视为「更新」（保留原 id 与排序位置），否则新增；超过上限报错。
   */
  function save({ page, name, fields, summary, labels, owner }) {
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
    // 注意它要**先于**同名判重算出来 —— 归属人是「同名算更新还是新增」的一半判据。
    const ownerInfo = cleanOwner(owner || (window.CurrentUser && window.CurrentUser.get()));
    const myKey = userKeyOf(ownerInfo);

    const items = list();
    // 「同名同页」只对**同一个人**算更新。
    // 团队库里 A 和 B 各自保存一份同名查询是**两条不同的记录**（默认名由筛选条件生成，
    // 两个人从同一份条件保存必然同名）：以前只看 page+name，B 保存会复用 A 的 id，
    // 服务端 `ON CONFLICT(id)` 把 B 的条件写进 A 那条，A 反过来也看不到 B 的。
    // 2026-09-20 实测：B 保存后服务端回传的 owner 仍是 A（savers[0]），本机被服务端全集覆盖
    // → listForUser(B) 恒为空，表现成「第二个用户怎么存都存不进去」。
    const exists = items.find((it) => it.page === page && it.name === title
      && userKeyOf(it.owner) === myKey);
    const item = {
      id: exists ? exists.id : newId(),
      page,
      name: title,
      summary: typeof summary === 'string' ? summary : '',
      labels: cleanLabels(labels),
      owner: ownerInfo,
      // 同名同页覆盖时累加保存次数，而不是重置——「高频」既看打开也看保存
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
    return w.ok ? { ok: true, item, updated: !!exists, ownerMissing: !ownerInfo } : w;
  }

  function rename(id, name) {
    const title = (name || '').trim();
    if (!title) return fail('请填写查询名称');
    const items = list();
    const target = items.find((it) => it.id === id);
    if (!target) return fail('该查询已不存在');
    const next = items.map((it) => (it.id === id ? { ...it, name: title, at: it.at } : it));
    const w = writeRaw(next);
    if (w.ok) autoPush();
    return w.ok ? { ok: true, item: { ...target, name: title } } : w;
  }

  function remove(id) {
    const items = list();
    if (!items.some((it) => it.id === id)) return fail('该查询已不存在');
    const w = writeRaw(items.filter((it) => it.id !== id));
    if (w.ok) { markDeleted(id); autoPush(); }
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
    return JSON.stringify({
      app: 'spider-saved-queries',
      v: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      items: list(),
    }, null, 2);
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
      const same = items.find((it) => it.id === inc.id
        || (it.page === inc.page && it.name === inc.name
          && userKeyOf(it.owner) === userKeyOf(inc.owner)));
      if (same) {
        same.hits = Math.max(same.hits || 0, inc.hits || 0);
        same.saves = Math.max(same.saves || 1, inc.saves || 1);
        same.lastAt = Math.max(same.lastAt || 0, inc.lastAt || 0);
        if (!same.owner && inc.owner) same.owner = inc.owner;   // 本地没归属就补上
        if (!same.labels && inc.labels && Object.keys(inc.labels).length) same.labels = inc.labels;
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

  function importJson(text) {
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

    const { items, added, merged } = mergeItems(list(), valid);
    if (items.length > MAX_ITEMS) {
      return fail(`合并后共 ${items.length} 条，超过上限 ${MAX_ITEMS} 条，请先清理一些再导入`);
    }
    const w = writeRaw(items);
    // 与 save / rename / remove 一致：导入也是本机的一次**写操作**，要推给共享库。
    // 之前只有它没有 autoPush —— 后果是"从空库导入后，首页 ?user= 拉回空数据把刚导入的
    // 条目盖掉"，而且导进来的东西永远只留在这一台机器上（2026-09-20 子代理真点 UI 发现）。
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
      syncState.state = r.file ? 'shared' : (syncState.state === 'shared' ? 'shared' : 'local');
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

  /** 拉取共享数据并合并进本地。返回 {ok, added, merged, total, file?} 或 {ok:false,error} */
  async function syncFromServer() {
    if (!canSync()) return recordSync(noEndpoint('当前环境没有同步端点（静态部署或离线）'));
    try {
      const r = await window.fetch(SERVER_URL, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!r.ok) return recordSync(fail('同步失败：HTTP ' + r.status));
      const json = await r.json();
      const data = (json && json.data) || {};
      const incoming = Array.isArray(data.items) ? data.items : [];
      const meta = { file: data.file, storage: data.storage, people: data.people };
      if (!incoming.length) {
        return recordSync({ ok: true, added: 0, merged: 0, total: list().length, ...meta });
      }
      const { items, added, merged } = mergeItems(list(), incoming.map(sanitize).filter(Boolean));
      const w = writeRaw(items);
      return recordSync(w.ok ? { ok: true, added, merged, total: items.length, ...meta } : w);
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
      const items = Array.isArray(data.items) ? data.items : null;
      if (!items) return recordSync({ ok: true, total: list().length, ...meta });
      const valid = items.map(sanitize).filter(Boolean);
      const w = writeRaw(valid);
      // 服务端已收到这批删除意图（返回的 items 里也没有它们），本地清空待办
      if (w.ok) writePendingDeletes([]);
      return recordSync(w.ok ? { ok: true, total: valid.length, ...meta } : w);
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
    exportJson,
    importJson,
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
