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

    const items = list();
    const exists = items.find((it) => it.page === page && it.name === title);
    const item = {
      id: exists ? exists.id : newId(),
      page,
      name: title,
      summary: typeof summary === 'string' ? summary : '',
      labels: cleanLabels(labels),
      // 谁保存的（用于部门排行）。没显式传就取「当前用户」——
      // 三个查询页因此不必各自接一次线，少三处漏传的可能。
      owner: cleanOwner(owner || (window.CurrentUser && window.CurrentUser.get())),
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
    return w.ok ? { ok: true, item, updated: !!exists } : w;
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
   * 合并两份列表（幂等）：按 id 或「同页面 + 同名」判重，计数取 max ——
   * 反复提交同一个文件不该把「高频」刷上去。
   * 导出/导入与代理同步共用这一份规则（代理侧 proxy.js 有等价实现）。
   */
  function mergeItems(localItems, incoming) {
    const items = (localItems || []).slice();
    let added = 0;
    let merged = 0;
    (incoming || []).forEach((inc) => {
      const same = items.find((it) => it.id === inc.id
        || (it.page === inc.page && it.name === inc.name));
      if (same) {
        same.hits = Math.max(same.hits || 0, inc.hits || 0);
        same.saves = Math.max(same.saves || 1, inc.saves || 1);
        same.lastAt = Math.max(same.lastAt || 0, inc.lastAt || 0);
        if (!same.owner && inc.owner) same.owner = inc.owner;   // 本地没归属就补上
        if (!same.labels && inc.labels && Object.keys(inc.labels).length) same.labels = inc.labels;
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
      // 关键防线：mode 必须是 dept。JSON 存储/静态服务器会忽略我们的查询参数，
      // 直接回全量 —— 那一刻要是照渲染，部门卡就名不副实了。
      if (data.mode && data.mode !== 'dept') return fail('存储后端不支持部门排行（回落到本机计算）');
      const items = Array.isArray(data.items) ? data.items.map(sanitize).filter(Boolean) : null;
      if (!items) return fail('部门排行返回异常（没有 items）');
      return { ok: true, items, people: Number(data.people) || 0, storage: String(data.storage || '') };
    } catch (e) {
      return fail('部门排行请求失败：' + ((e && e.message) || String(e)));
    }
  }

  /** 拉取共享数据并合并进本地。返回 {ok, added, merged, total} 或 {ok:false,error} */
  async function syncFromServer() {
    if (!canSync()) return fail('当前环境没有同步端点（静态部署或离线）');
    try {
      const r = await window.fetch(SERVER_URL, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!r.ok) return fail('同步失败：HTTP ' + r.status);
      const json = await r.json();
      const incoming = (json && json.data && Array.isArray(json.data.items)) ? json.data.items : [];
      const valid = incoming.map(sanitize).filter(Boolean);
      if (!valid.length) return { ok: true, added: 0, merged: 0, total: list().length };
      const { items, added, merged } = mergeItems(list(), valid);
      const w = writeRaw(items);
      return w.ok ? { ok: true, added, merged, total: items.length } : w;
    } catch (e) {
      return fail('同步失败：' + ((e && e.message) || String(e)));
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
      try {
        // sendBeacon 不带自定义头，但代理只解析 body，够用
        const nav = window.navigator;
        if (nav && typeof nav.sendBeacon === 'function') {
          const okSent = nav.sendBeacon(SERVER_URL, new Blob([payload], { type: 'application/json' }));
          if (okSent) { writePendingDeletes([]); return { ok: true, beacon: true }; }
          return fail('浏览器拒绝发送');
        }
      } catch (_) { /* 落到普通 fetch */ }
      return fail('当前环境不支持 sendBeacon');
    }

    if (!canSync()) return fail('当前环境没有同步端点（静态部署或离线）');
    try {
      const r = await window.fetch(SERVER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
      if (!r.ok) return fail('同步失败：HTTP ' + r.status);
      const json = await r.json();
      const items = (json && json.data && Array.isArray(json.data.items)) ? json.data.items : null;
      if (!items) return { ok: true, total: list().length };
      const valid = items.map(sanitize).filter(Boolean);
      const w = writeRaw(valid);
      // 服务端已收到这批删除意图（返回的 items 里也没有它们），本地清空待办
      if (w.ok) writePendingDeletes([]);
      return w.ok ? { ok: true, total: valid.length } : w;
    } catch (e) {
      return fail('同步失败：' + ((e && e.message) || String(e)));
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
    fingerprintOf,
    exportJson,
    importJson,
    syncFromServer,
    pushToServer,
    remove,
    clear,
    hrefFor,
  };
})();
