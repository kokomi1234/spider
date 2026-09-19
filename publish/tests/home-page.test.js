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
    removeAttribute(k) { delete this.attrs[k]; },   // 真实 DOM 有；缺了会让身份条清空那步抛错
    appendChild(c) { this.children.push(c); c.parent = this; return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener() {},
    click() { (this.listeners.click || []).slice().forEach((fn) => fn({ target: this })); },
    focus() {},   // 真实 DOM 有；缺了会让「切换用户」这类回调抛 TypeError
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
    hit(id) {
      const t = store.find((it) => it.id === id);
      if (!t) return { ok: false, error: '该查询已不存在' };
      t.hits = (t.hits || 0) + 1;
      t.lastAt = Date.now();
      return { ok: true, item: t };
    },
    // 与真实实现同口径（2026-09-19 改）：先按部门过滤，再按**保存人数**降序取前 n 条。
    // 排序第一判据是 savers 而不是 hits —— 别写回旧口径，否则单测测不到真东西。
    deptKeyOf: (u) => String((u && (u.teamId || u.teamName || u.orgId || u.orgName)) || ''),
    listByDept(user, limit) {
      const key = String((user && (user.teamId || user.teamName || user.orgId || user.orgName)) || '');
      if (!key) return [];
      const n = Number.isFinite(limit) && limit > 0 ? limit : 10;
      return store
        .filter((it) => String((it.owner && (it.owner.teamId || it.owner.teamName || it.owner.orgId || it.owner.orgName)) || '') === key)
        .sort((a, b) => ((b.savers || 0) - (a.savers || 0)) || ((b.lastAt || b.at) - (a.lastAt || a.at)))
        .slice(0, n);
    },
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
  const mk = (id, tag) => { const e = fakeEl(tag || 'div'); e.id = id; return e; };
  const savedList = mk('savedList');
  const savedEmpty = mk('savedEmpty');
  const savedCount = mk('savedCount');
  // 当前用户 + 部门排行所需的节点
  const userSet = mk('userSet'); userSet.hidden = true;
  const userAvatar = mk('userAvatar');
  const userLabel = mk('userLabel');
  const userDept = mk('userDept');
  const userForm = mk('userForm'); userForm.hidden = false;
  const userClear = mk('btnUserClear', 'button');
  const userKeyword = mk('userKeyword', 'input');
  const userCands = mk('userCands');
  const userHint = mk('userHint');
  const btnUserSearch = mk('btnUserSearch', 'button');
  const btnUserChange = mk('btnUserChange', 'button');
  const deptTitle = mk('deptTitle');
  const deptList = mk('deptList');
  const deptEmpty = mk('deptEmpty');
  const deptTopN = mk('deptTopN', 'select'); deptTopN.value = '10';

  const els = {
    savedList, savedEmpty, savedCount,
    userSet, userAvatar, userLabel, userDept, userForm, userKeyword, userCands, userHint, btnUserSearch, btnUserChange,
    // 注意：fakeDocument 是按 id 取元素的，key 必须和元素 id 完全一致，
    // 写成 userClear 就取不到 #btnUserClear（表现是回调静默不执行、断言拿到 undefined）
    btnUserClear: userClear,
    deptTitle, deptList, deptEmpty, deptTopN,
  };
  const doc = fakeDocument(els);

  const sq = makeSavedQuery(opts.items || []);

  const toasts = [];
  const ls = new Map(Object.entries(opts.localStorage || {}));
  const win = {
    addEventListener() {}, // 吞掉 storage 监听，不触发
    toast: (msg) => toasts.push(msg),
    localStorage: {
      getItem: (k) => (ls.has(k) ? ls.get(k) : null),
      setItem: (k, v) => ls.set(k, String(v)),
      removeItem: (k) => ls.delete(k),
    },
  };
  if (opts.loadSavedQuery !== false) win.SavedQuery = sq;

  // 可控的当前用户：null = 未设置
  const cuState = { user: opts.currentUser || null };
  win.CurrentUser = {
    STORAGE_KEY: 'spider.currentUser.v1',
    get: () => cuState.user,
    set: (u) => { cuState.user = u; return { ok: true, user: u }; },
    clear: () => { cuState.user = null; return { ok: true }; },
    label: (u) => (u ? `${u.userName}（${u.userId}） · ${u.teamName || u.orgName}` : ''),
    deptLabel: (u) => (u ? (u.teamName || u.orgName || '') : ''),
    lookup: async (kw) => (opts.lookupResult
      ? opts.lookupResult
      : { ok: true, list: [], mode: /^\d+$/.test(String(kw).trim()) ? 'id' : 'name', empty: true }),
  };

  // DialogUtils 可控：confirmBox / promptText 返回我们设定的值
  win.DialogUtils = {
    confirmBox: () => Promise.resolve(opts.confirmResult !== undefined ? opts.confirmResult : true),
    promptText: () => Promise.resolve(opts.promptResult !== undefined ? opts.promptResult : ''),
  };

  loadScript('js/page/home.js', { document: doc }, win);

  return { win, doc, els, sq, toasts, ls, cuState };
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

test('整栏可点：卡片主体本身就是 <a>，href 等于 SavedQuery.hrefFor(page, id)', () => {
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
    assert.strictEqual(a.className, 'saved-main', '可点的应该是整块主体（saved-main），不是某个小按钮');
    assert.strictEqual(a.href, c.href, `${c.id} 的 href 应为 ${c.href}`);
    // 名称与摘要要在这块 <a> 里，否则「点整栏」根本点不到
    assert.ok(findIn(a, (e) => e.textContent === 'a' || e.textContent === 'b'), '名称应在可点区域内');
  }
});

test('整栏可点：不再有独立的「打 开」按钮（操作区只剩重命名 / 删除）', () => {
  const { els } = buildEnv({ items: [{ id: 'q1', page: 'publish', name: 'a', at: 1 }] });
  const card = cardFor(els.savedList, 'q1');
  const ops = findIn(card, (e) => e.className === 'saved-ops');
  assert.ok(ops, '应有操作区');
  const btns = ops.children.filter((c) => c.tagName === 'BUTTON').map((c) => c.textContent);
  assert.deepStrictEqual(btns, ['重命名', '删除'], '操作区只保留重命名与删除');
  assert.strictEqual(findIn(card, (e) => e.className === 'saved-open'), null, '不应再有 .saved-open 按钮');
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

// ══════════════════════════════════════════════════════════
// 当前用户 + 部门常用查询（本机口径）
// ══════════════════════════════════════════════════════════

const ME = {
  userId: '4711510', userName: '张三',
  orgId: '1645A', orgName: '中国银行软件中心（深圳）',
  teamId: 'K4229', teamName: '中国银行软件中心（深圳）开发三部',
};
const OTHER = {
  userId: '1001', userName: '李四',
  orgId: '1645A', orgName: '中国银行软件中心（深圳）',
  teamId: 'M2534', teamName: '中国银行软件中心（深圳）开发一部',
};

test('当前用户：未设置时部门区给引导，标题回到默认', () => {
  const { win, els } = buildEnv({ currentUser: null, items: [] });
  win.HomePage.render();
  assert.strictEqual(els.deptTitle.textContent, '部门常用查询');
  assert.strictEqual(els.deptEmpty.hidden, false, '空态要显示');
  assert.ok(/当前用户/.test(els.deptEmpty.textContent), '要指明去哪里设置，而不是只说「没有数据」');
  assert.strictEqual(els.userForm.hidden, false);
  assert.strictEqual(els.userSet.hidden, true);
  assert.strictEqual(win.HomePage.deptCount(), 0);
});

test('当前用户：已设置时显示身份条（头像/姓名工号/部门），并收起输入表单', () => {
  const { win, els } = buildEnv({ currentUser: ME, items: [] });
  win.HomePage.render();
  assert.strictEqual(els.userSet.hidden, false);
  // 这条断言是防「CSS display:flex 盖掉 hidden」那个 bug 的：设了用户就必须收起输入框
  assert.strictEqual(els.userForm.hidden, true, '已设置后输入表单要收起，否则页面上两套 UI 并存');
  assert.ok(/张三/.test(els.userLabel.textContent) && /4711510/.test(els.userLabel.textContent),
    '姓名与工号要能一眼看到：' + els.userLabel.textContent);
  assert.ok(/开发三部/.test(els.userDept.textContent),
    '部门单独一行显示（teamName 优先于 orgName）：' + els.userDept.textContent);
  assert.strictEqual(els.userAvatar.textContent, '张', '头像圈用姓名首字，便于一眼确认「是我」');
  assert.ok(/开发三部/.test(els.deptTitle.textContent), '标题要写明是哪个部门（teamName 优先于 orgName）');
});

test('当前用户：未设置时清空身份条、显示表单，且不显示清空按钮', () => {
  const { win, els } = buildEnv({ currentUser: null, items: [] });
  win.HomePage.render();
  assert.strictEqual(els.userSet.hidden, true, '未设置时身份条必须隐藏（hidden 不能被 display 盖掉）');
  assert.strictEqual(els.userForm.hidden, false);
  assert.strictEqual(els.userLabel.textContent, '');
  assert.strictEqual(els.userDept.textContent, '');
  assert.strictEqual(els.userAvatar.textContent, '');
  assert.strictEqual(els.btnUserClear.hidden, true, '输入框空着时不该出现清空按钮');
});

test('部门排行：只列本部门的记录，且是只读视图（无重命名/删除）', () => {
  const items = [
    { id: 'd1', page: 'publish', name: '本部门A', at: 3, owner: ME, hits: 1 },
    { id: 'd2', page: 'task', name: '别的部门', at: 2, owner: OTHER, hits: 9 },
    { id: 'd3', page: 'publish', name: '无归属', at: 1, owner: null, hits: 5 },
  ];
  const { win, els } = buildEnv({ currentUser: ME, items });
  win.HomePage.render();
  assert.strictEqual(win.HomePage.deptCount(), 1, '只应出现本部门那一条');
  const card = els.deptList.children[0];
  const name = findIn(card, (e) => e.textContent === '本部门A');
  assert.ok(name, '本部门记录要渲染出来');
  assert.strictEqual(findIn(card, (e) => e.className === 'saved-ops'), null, '部门排行不应有操作按钮');
  assert.ok(findIn(card, (e) => e.className === 'saved-meta'), '要显示查询人与次数');
});

test('部门排行：按打开次数降序，条数受 TopN 限制', () => {
  const items = [];
  for (let i = 0; i < 8; i += 1) {
    items.push({ id: 'q' + i, page: 'publish', name: 'q' + i, at: i, owner: ME, hits: i });
  }
  const { win, els } = buildEnv({ currentUser: ME, items, localStorage: { 'spider.deptTopN.v1': '5' } });
  win.HomePage.render();
  assert.strictEqual(win.HomePage.deptCount(), 5, 'TopN=5 时只渲染 5 条');
  assert.strictEqual(els.deptTopN.value, '5', '下拉要回显记住的值');
  const ids = els.deptList.children.map((c) => c.dataset.id);
  assert.deepStrictEqual(ids, ['q7', 'q6', 'q5', 'q4', 'q3'], '打开次数多的排前面');
});

test('部门排行：TopN 非法/缺省时退回 10', () => {
  const items = [];
  for (let i = 0; i < 12; i += 1) items.push({ id: 'q' + i, page: 'publish', name: 'q' + i, at: i, owner: ME, hits: i });
  const a = buildEnv({ currentUser: ME, items });
  a.win.HomePage.render();
  assert.strictEqual(a.win.HomePage.deptCount(), 10, '默认 10 条');

  const b = buildEnv({ currentUser: ME, items, localStorage: { 'spider.deptTopN.v1': '99' } });
  b.win.HomePage.render();
  assert.strictEqual(b.win.HomePage.deptCount(), 10, '非法值（99）也要退回默认 10');
});

test('部门排行：切换条数会记住选择', () => {
  const { win, els, ls } = buildEnv({ currentUser: ME, items: [] });
  els.deptTopN.value = '20';
  els.deptTopN.listeners.change[0]();      // 假 DOM 没有 dispatchEvent，直接调监听器
  assert.strictEqual(ls.get('spider.deptTopN.v1'), '20', '选择要落 localStorage');
  assert.strictEqual(els.deptTopN.value, '20', '重渲染后仍回显 20');
});

test('打开计数：点卡片主体会记一次打开（「高频」的判据）', () => {
  const items = [{ id: 'h1', page: 'publish', name: '甲', at: 1, owner: ME, hits: 0 }];
  const { win, els, sq } = buildEnv({ currentUser: ME, items });
  win.HomePage.render();
  const link = findIn(els.savedList, (e) => e.className === 'saved-main');
  assert.ok(link, '卡片主体应是 <a>');
  link.click();
  assert.strictEqual(sq.get('h1').hits, 1, '点一次应 +1');
  link.click();
  assert.strictEqual(sq.get('h1').hits, 2);
});

test('切换用户：清空当前用户后回到输入表单', () => {
  const { win, els } = buildEnv({ currentUser: ME, items: [] });
  win.HomePage.render();
  els.btnUserChange.click();
  assert.strictEqual(win.CurrentUser.get(), null);
  assert.strictEqual(els.userForm.hidden, false);
  assert.strictEqual(els.userSet.hidden, true);
});
