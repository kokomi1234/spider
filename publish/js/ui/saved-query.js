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
  const MAX_ITEMS = 50;
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
      v: typeof item.v === 'number' ? item.v : 1,   // 缺省 1 = 升级前的旧格式
      at: typeof item.at === 'number' ? item.at : 0,
      fields,
    };
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
  function save({ page, name, fields, summary, labels }) {
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
    return w.ok ? { ok: true, item: { ...target, name: title } } : w;
  }

  function remove(id) {
    const items = list();
    if (!items.some((it) => it.id === id)) return fail('该查询已不存在');
    const w = writeRaw(items.filter((it) => it.id !== id));
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

  function clear() {
    return writeRaw([]);
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
    remove,
    clear,
    hrefFor,
  };
})();
