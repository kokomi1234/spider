/**
 * 首页渲染脚本（js/page/home.js）单元测试
 * ─────────────────────────────────────────────────────────
 * 零第三方依赖，纯 node + 假 DOM。
 *
 * 被测对象只做两件事：渲染「常用查询」列表、提供重命名/删除/直达。
 * 卡片完全用 textContent 构建（不用 innerHTML），是首页唯一的用户可控输入面，
 * 所以 XSS 防护是这里重点验证的。
 *
 * 假 DOM 注意事项（踩过的坑，见任务说明）：
 *   1) document 必须作为 loadScript 的第二个参数传入（形参遮蔽全局）。
 *   2) querySelector/getElementById 要能递归到子树（卡片是动态 createElement 的）。
 *   3) window 需提供 addEventListener（storage 监听）；缺失依赖（toast /
 *      DialogUtils / TokenManager）要能安全跳过。
 *   4) 假元素支持 createElement/appendChild/removeChild/firstChild/children/
 *      className/dataset/textContent/hidden/href/type/addEventListener。
 */
'use strict';

const assert = require('assert');
const { loadScript, test } = require('./harness');

// ══════════════════════════════════════════════════════════
// 假 DOM
// ══════════════════════════════════════════════════════════

let innerHTMLWrites = 0; // 全局计数：任何元素被写 innerHTML 都 +1（验证首页不用 innerHTML）

function fakeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [],
    className: '',
    id: '',
    type: '',
    value: '',
    textContent: '',
    hidden: undefined,
    href: '',
    dataset: {},
    style: {},
    attrs: {},
    listeners: {},
    parent: null,
    _innerHTML: '',
    setAttribute(k, v) { this.attrs[k] = String(v); },
    appendChild(c) { this.children.push(c); c.parent = this; return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener() {},
    click() { (this.listeners.click || []).slice().forEach((fn) => fn({ target: this })); },
    querySelector(sel) { return findIn(this, (e) => e.id === String(sel).replace(/^[#.]/, '')); },
  };
  Object.defineProperty(el, 'firstChild', {
    get() { return this.children.length ? this.children[0] : null; },
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._innerHTML; },
    set(v) { innerHTMLWrites += 1; this._innerHTML = v; },
  });
  return el;
}

/** 深度优先找第一个满足条件的节点（卡片是动态挂到 savedList 子树里的） */
function findIn(root, pred) {
  if (pred(root)) return root;
  for (const c of root.children || []) {
    const hit = findIn(c, pred);
    if (hit) return hit;
  }
  return null;
}

function fakeDocument(els) {
  const body = fakeEl('body');
  function q(sel) {
    const id = String(sel).replace(/^[#.]/, '');
    if (els[id]) return els[id];
    return findIn(body, (e) => e.id === id) || null;
  }
  return {
    documentElement: fakeEl('html'),
    body,
    createElement: (tag) => fakeEl(tag),
    querySelector: q,
    getElementById: q,
    addEventListener() {},
    removeEventListener() {},
  };
}

// ══════════════════════════════════════════════════════════
// 可控的 SavedQuery 替身（不依赖真实 localStorage，便于断言「返回 false 时数据不变」）
// ══════════════════════════════════════════════════════════

function makeSavedQuery(seed) {
  let store = (seed || []).map((it) => ({ ...it }));
  return {
    STORAGE_KEY: 'spider.savedQueries.v1',
    PAGES: {
      publish: '服务发布数据查询',
      task: '任务单查询',
      subscription: '服务订阅关系查询',
    },
    list() { return store.slice(); },
    get(id) { return store.find((it) => it.id === id) || null; },
    save(item) { store = [item, ...store]; return { ok: true, item }; },
    rename(id, name) {
      const t = store.find((it) => it.id === id);
      if (!t) return { ok: false, error: '该查询已不存在' };
      t.name = name;
      return { ok: true, item: t };
    },
    remove(id) {
      const before = store.length;
      store = store.filter((it) => it.id !== id);
      if (store.length === before) return { ok: false, error: '该查询已不存在' };
      return { ok: true };
    },
    clear() { store = []; return { ok: true }; },
    hrefFor(page, id) {
      const base = page === 'task' ? '/task' : page === 'subscription' ? '/subscription' : '/publish';
      return `${base}?saved=${encodeURIComponent(id)}`;
    },
    _store: () => store,
  };
}

// ══════════════════════════════════════════════════════════
// 测试环境装配
// ══════════════════════════════════════════════════════════

const flush = () => new Promise((r) => setTimeout(r, 0));

/**
 * 装好假 DOM + 可控 SavedQuery + 可注入 DialogUtils/toast，再加载 home.js。
 * home.js 会在 IIFE 末尾自动 render() 一次（用当前 store 内容）。
 */
function buildEnv(opts = {}) {
  innerHTMLWrites = 0;
  const savedList = fakeEl('div'); savedList.id = 'savedList';
  const savedEmpty = fakeEl('div'); savedEmpty.id = 'savedEmpty';
  const savedCount = fakeEl('div'); savedCount.id = 'savedCount';
  const els = { savedList, savedEmpty, savedCount };
  const doc = fakeDocument(els);

  const sq = makeSavedQuery(opts.items || []);

  const toasts = [];
  const win = {
    addEventListener() {}, // 吞掉 storage 监听，不触发
    toast: (msg) => toasts.push(msg),
  };
  if (opts.loadSavedQuery !== false) win.SavedQuery = sq;

  // DialogUtils 可控：confirmBox / promptText 返回我们设定的值
  win.DialogUtils = {
    confirmBox: () => Promise.resolve(opts.confirmResult !== undefined ? opts.confirmResult : true),
    promptText: () => Promise.resolve(opts.promptResult !== undefined ? opts.promptResult : ''),
  };

  loadScript('js/page/home.js', { document: doc }, win);

  return { win, doc, els, sq, toasts };
}

/** 在 savedList 子树里按 data-id 找卡片 */
function cardFor(savedList, id) {
  return findIn(savedList, (e) => e.dataset && e.dataset.id === id);
}
function btnIn(card, text) {
  return findIn(card, (e) => e.tagName === 'BUTTON' && e.textContent === text);
}

// ══════════════════════════════════════════════════════════
// 用例
// ══════════════════════════════════════════════════════════

test('渲染：有 2 条数据 → 列表 2 个子节点、#savedEmpty 隐藏、#savedCount 含「共 2 条」', () => {
  const { els } = buildEnv({
    items: [
      { id: 'q1', page: 'publish', name: '批次查询', summary: 's1', at: 2 },
      { id: 'q2', page: 'task', name: '任务查询', summary: 's2', at: 1 },
    ],
  });
  assert.strictEqual(els.savedList.children.length, 2, '列表应有 2 个子节点');
  assert.strictEqual(els.savedEmpty.hidden, true, '#savedEmpty 应隐藏');
  assert.ok(/共 2 条/.test(els.savedCount.textContent), `#savedCount 应含「共 2 条」，实际：${els.savedCount.textContent}`);
});

test('空态：0 条 → 列表 0 个子节点、#savedEmpty 显示、计数为空串', () => {
  const { els } = buildEnv({ items: [] });
  assert.strictEqual(els.savedList.children.length, 0, '列表应为空');
  assert.strictEqual(els.savedEmpty.hidden, false, '#savedEmpty 应显示（hidden === false）');
  assert.strictEqual(els.savedCount.textContent, '', '计数应为空串');
});

test('卡片内容：名称/摘要写入 textContent，且全程零 innerHTML 写入（含 XSS 名称原样保存）', () => {
  const xss = '<img src=x onerror=alert(1)>';
  const { els } = buildEnv({
    items: [{ id: 'qx', page: 'publish', name: xss, summary: '摘要文本', at: 1 }],
  });
  const card = cardFor(els.savedList, 'qx');
  assert.ok(card, '应渲染出该卡片');

  // XSS 字符串必须原样存在于 textContent（textContent 不会执行），且未被转义
  const nameSpan = findIn(card, (e) => e.tagName === 'SPAN' && e.textContent === xss);
  assert.ok(nameSpan, `XSS 名称应原样在 textContent 中，实际未找到原样字符串`);
  assert.strictEqual(nameSpan.textContent, xss, '名称 textContent 必须原样等于输入');

  const sumDiv = findIn(card, (e) => e.className === 'saved-summary');
  assert.ok(sumDiv && sumDiv.textContent === '摘要文本', '摘要应写入 textContent');

  // 关键：动态卡片构建过程中没有任何节点被写 innerHTML（否则即 XSS 面）
  assert.strictEqual(innerHTMLWrites, 0, `动态卡片不应写 innerHTML，实际写了 ${innerHTMLWrites} 次`);
});

test('徽标文案：publish/task/subscription 分别显示对应中文', () => {
  const { els } = buildEnv({
    items: [
      { id: 'p', page: 'publish', name: 'a', at: 3 },
      { id: 't', page: 'task', name: 'b', at: 2 },
      { id: 's', page: 'subscription', name: 'c', at: 1 },
    ],
  });
  const expect = { p: '服务发布数据查询', t: '任务单查询', s: '服务订阅关系查询' };
  for (const id of ['p', 't', 's']) {
    const card = cardFor(els.savedList, id);
    const badge = findIn(card, (e) => e.className === 'saved-badge');
    assert.ok(badge, `${id} 应有徽标`);
    assert.strictEqual(badge.textContent, expect[id], `${id} 徽标文案应为「${expect[id]}」`);
  }
});

test('打开链接：卡片 <a> 的 href 等于 SavedQuery.hrefFor(page, id)', () => {
  const { els } = buildEnv({
    items: [
      { id: 'q1', page: 'publish', name: 'a', at: 2 },
      { id: 'q2', page: 'task', name: 'b', at: 1 },
    ],
  });
  const cases = [
    { id: 'q1', page: 'publish', href: '/publish?saved=q1' },
    { id: 'q2', page: 'task', href: '/task?saved=q2' },
  ];
  for (const c of cases) {
    const card = cardFor(els.savedList, c.id);
    const a = findIn(card, (e) => e.tagName === 'A');
    assert.ok(a, `${c.id} 应有打开链接 <a>`);
    assert.strictEqual(a.href, c.href, `${c.id} 的 href 应为 ${c.href}`);
  }
});

test('删除：确认 → 该条从存储消失、列表少一条', async () => {
  const { els, sq } = buildEnv({
    items: [
      { id: 'q1', page: 'publish', name: 'a', at: 2 },
      { id: 'q2', page: 'task', name: 'b', at: 1 },
    ],
    confirmResult: true,
  });
  assert.strictEqual(els.savedList.children.length, 2, '前置：应有 2 条');
  const card = cardFor(els.savedList, 'q1');
  btnIn(card, '删除').click();
  await flush();

  assert.strictEqual(sq._store().length, 1, '存储应只剩 1 条');
  assert.strictEqual(sq._store().find((it) => it.id === 'q1'), undefined, 'q1 应从存储移除');
  assert.strictEqual(els.savedList.children.length, 1, '列表重渲染后应少一条');
  assert.ok(!cardFor(els.savedList, 'q1'), 'q1 卡片应已不在 DOM');
});

test('删除：取消（confirm 返回 false）→ 数据不变', async () => {
  const { els, sq } = buildEnv({
    items: [
      { id: 'q1', page: 'publish', name: 'a', at: 2 },
      { id: 'q2', page: 'task', name: 'b', at: 1 },
    ],
    confirmResult: false,
  });
  const card = cardFor(els.savedList, 'q1');
  btnIn(card, '删除').click();
  await flush();

  assert.strictEqual(sq._store().length, 2, '取消删除时存储应仍是 2 条');
  assert.strictEqual(els.savedList.children.length, 2, '列表不应变化');
});

test('重命名：输入新名 → 存储 name 更新、列表显示新名', async () => {
  const { els, sq } = buildEnv({
    items: [{ id: 'q1', page: 'publish', name: '旧名', at: 1 }],
    promptResult: '  新名字  ', // 带空格，验证会被 trim
  });
  const card = cardFor(els.savedList, 'q1');
  btnIn(card, '重命名').click();
  await flush();

  assert.strictEqual(sq._store()[0].name, '新名字', '存储 name 应被 trim 后更新');
  const card2 = cardFor(els.savedList, 'q1');
  const nameSpan = findIn(card2, (e) => e.tagName === 'SPAN' && e.textContent === '新名字');
  assert.ok(nameSpan, '重渲染后列表应显示新名');
});

test('重命名：输入空串/取消 → 名字不变', async () => {
  const { els, sq } = buildEnv({
    items: [{ id: 'q1', page: 'publish', name: '旧名', at: 1 }],
    promptResult: '', // 取消或空输入
  });
  const card = cardFor(els.savedList, 'q1');
  btnIn(card, '重命名').click();
  await flush();

  assert.strictEqual(sq._store()[0].name, '旧名', '空输入时名字不应改变');
  const card2 = cardFor(els.savedList, 'q1');
  const nameSpan = findIn(card2, (e) => e.tagName === 'SPAN' && e.textContent === '旧名');
  assert.ok(nameSpan, '列表应仍显示旧名');
});

test('删除后 id 已不存在（存储被别的标签页清了）→ 不崩，给出提示', async () => {
  const { els, sq, toasts } = buildEnv({
    items: [{ id: 'q1', page: 'publish', name: 'a', at: 1 }],
    confirmResult: true,
  });
  // 模拟「确认后，remove 时存储里已经没这条了」
  sq.remove = () => ({ ok: false, error: '该查询已不存在' });
  const card = cardFor(els.savedList, 'q1');
  btnIn(card, '删除').click();
  await flush();

  assert.ok(toasts.some((t) => /已不存在/.test(t)), `应提示已不存在，实际提示：${JSON.stringify(toasts)}`);
  assert.strictEqual(els.savedList.children.length, 1, '不应崩，列表维持原状');
});

test('window.SavedQuery 未加载 → render() 不抛异常（入口卡是静态 HTML，不能白屏）', () => {
  const { win, els } = buildEnv({ loadSavedQuery: false });
  assert.ok(win.HomePage, 'window.HomePage 应正常暴露');
  // 再手动调一次 render，确认也不抛
  assert.doesNotThrow(() => win.HomePage.render(), 'SavedQuery 缺失时 render() 不应抛异常');
  assert.strictEqual(els.savedList.children.length, 0, '缺失存储层时列表应为空、不渲染卡片');
});

test('SavedQuery.list() 抛异常（localStorage 坏了）→ render() 吞异常、不崩', () => {
  const { win, els, toasts } = buildEnv({ items: [{ id: 'q1', page: 'publish', name: 'a', at: 1 }] });
  // 让 list 抛错，模拟 localStorage 损坏（render 内部已 try/catch）
  win.SavedQuery.list = () => { throw new Error('localStorage 不可用'); };
  // 重新触发一次 render（加载时那次是好的，这里测坏路径）
  assert.doesNotThrow(() => win.HomePage.render(), 'list 抛错时 render() 不应抛异常');
  assert.strictEqual(els.savedList.children.length, 0, '读失败时应渲染空列表');
  assert.strictEqual(els.savedEmpty.hidden, false, '读失败时应显示空态');
  assert.ok(toasts.some((t) => /读取常用查询失败/.test(t)), `应提示读取失败，实际：${JSON.stringify(toasts)}`);
});

test('window.HomePage.count() 与列表实际子节点数一致', () => {
  const { win, els } = buildEnv({
    items: [
      { id: 'q1', page: 'publish', name: 'a', at: 3 },
      { id: 'q2', page: 'task', name: 'b', at: 2 },
      { id: 'q3', page: 'subscription', name: 'c', at: 1 },
    ],
  });
  assert.strictEqual(win.HomePage.count(), 3, 'count 应为 3');
  assert.strictEqual(win.HomePage.count(), els.savedList.children.length, 'count 应与 children.length 一致');
});
