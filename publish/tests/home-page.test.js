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
    // 支持 #id / .class /「A B」复合（组件那侧用 `.searchable-select .searchable-select-input`）。
    // 假 DOM 不分层，一律拿最后一段当条件 —— 够用，也免得为了一个选择器把整棵树的语义做出来。
    querySelector(sel) {
      const last = String(sel).trim().split(/\s+/).pop() || '';
      if (last.startsWith('#')) return findIn(this, (e) => e.id === last.slice(1));
      if (last.startsWith('.')) {
        const cls = last.slice(1);
        return findIn(this, (e) => String(e.className || '').split(/\s+/).includes(cls));
      }
      return findIn(this, (e) => e.id === last);
    },
  };
  Object.defineProperty(el, 'firstChild', {
    get() { return this.children.length ? this.children[0] : null; },
  });
  // 真实 DOM 的 parentElement：组件与 home.js 都用它找「宿主容器」
  Object.defineProperty(el, 'parentElement', {
    get() { return this.parent || null; },
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

function makeSavedQuery(seed, syncState) {
  let store = (seed || []).map((it) => ({ ...it }));
  const subs = [];
  return {
    STORAGE_KEY: 'spider.savedQueries.v1',
    // 同步状态：真实实现里由代理响应驱动（js/ui/saved-query.js 的 recordSync）。
    // 首页角标只如实翻译这份状态，所以这里做成可注入 + 可广播，用来验「订阅回调到了就把角标换掉」。
    _sync: { state: 'pending', total: 0, file: '', storage: '', people: 0, error: '', at: 0, ...(syncState || {}) },
    lastSyncState() { return { ...this._sync }; },
    onSyncStateChange(fn) {
      subs.push(fn);
      return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
    },
    /** 模拟「一次同步回来了」：改状态 + 通知订阅方 */
    _emitSync(patch) {
      Object.assign(this._sync, patch);
      // 快照自己拼，不走 lastSyncState() —— 有条用例要把那个方法删掉来验组件的容错
      const snap = { ...this._sync };
      subs.slice().forEach((fn) => fn(snap));
      return this._sync;
    },
    PAGES: {
      publish: '服务发布数据查询',
      task: '任务单查询',
      subscription: '服务订阅关系查询',
    },
    list() { return store.slice(); },
    // 与真实实现同口径：有工号用工号、否则姓名；取不到键就是「没有我的」，绝不退回全部
    userKeyOf: (u) => String((u && (u.userId || u.userName)) || ''),
    // 与真实实现同口径（2026-09-22 改）：有身份按人过滤；
    // 没身份则只给「无人认领」的本机记录（就是没登录时存的那批），别人的一律不露。
    listForUser(user) {
      const key = String((user && (user.userId || user.userName)) || '');
      return store
        .filter((it) => {
          const mine = String((it.owner && (it.owner.userId || it.owner.userName)) || '');
          return key ? mine === key : !mine;
        })
        .sort((a, b) => ((b.lastAt || b.at) - (a.lastAt || a.at)) || ((b.at || 0) - (a.at || 0)));
    },
    // 与真实实现同口径：把本机无人认领的记录认领给当前用户（首页渲染前会调一次）
    claimAnonymous(user) {
      const key = String((user && (user.userId || user.userName)) || '');
      if (!key) return { ok: false, error: '未设置当前用户' };
      let n = 0;
      store.forEach((it) => {
        const mine = String((it.owner && (it.owner.userId || it.owner.userName)) || '');
        if (!mine) {
          it.owner = { userId: user.userId, userName: user.userName, teamId: user.teamId, teamName: user.teamName };
          n += 1;
        }
      });
      return { ok: true, claimed: n };
    },
    // 默认不提供服务端数据：让首页停在「本机渲染」这条分支上（也顺带钉住
    // 「服务端这条路失败就别覆盖本机结果」）。要用服务端数据的用例自己覆盖它。
    mineFromServer: async () => ({ ok: false, error: '测试替身默认不供服务端数据' }),
    get(id) { return store.find((it) => it.id === id) || null; },
    // 2026-09-20 架构改版配套：首页改名走 getAsync（镜像没有时去服务端捞）。
    // 桩里镜像即全量，getAsync = get 的 async 版即可。
    async getAsync(id) { return store.find((it) => it.id === id) || null; },
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
  const savedSync = mk('savedSync', 'span'); savedSync.hidden = true;
  // 当前用户 + 部门排行所需的节点
  const userSet = mk('userSet'); userSet.hidden = true;
  const userAvatar = mk('userAvatar');
  const userLabel = mk('userLabel');
  const userDept = mk('userDept');
  const userForm = mk('userForm'); userForm.hidden = false;
  const userHint = mk('userHint');
  const btnUserSearch = mk('btnUserSearch', 'button');
  const btnUserChange = mk('btnUserChange', 'button');
  // 「当前用户」现在是 searchable-select 的宿主 <select>：**必须挂在父节点下** ——
  // 组件和 home.js 都靠 parentElement 找「宿主容器」，再往里插真正的输入框。
  const userField = mk('userField'); userField.className = 'home-field';
  const userKeyword = mk('userKeyword', 'select');
  userField.appendChild(userKeyword);
  const deptTitle = mk('deptTitle');
  const deptList = mk('deptList');
  const deptEmpty = mk('deptEmpty');
  const deptTopN = mk('deptTopN', 'select'); deptTopN.value = '10';

  const els = {
    savedList, savedEmpty, savedCount, savedSync,
    userSet, userAvatar, userLabel, userDept, userForm, userKeyword, userHint, btnUserSearch, btnUserChange,
    // 注意：fakeDocument 是按 id 取元素的，key 必须和元素 id 完全一致 ——
    // 拼错（如写成 userField 却在 HTML 里叫别的）不会报错，只会静默拿到 undefined
    userField,
    deptTitle, deptList, deptEmpty, deptTopN,
  };
  const doc = fakeDocument(els);

  // 默认已设置当前用户：主列表自 2026-09-19 起按人过滤，不设置的人看到的是空列表。
  // 要测「未设置」那种情况，用例自己传 currentUser: null。
  const cu = opts.currentUser === undefined ? ME : opts.currentUser;
  // 没写 owner 的种子按「就是当前用户存的」补；显式写了 owner: null 的保持无归属
  // （那是专门用来验证「没归属的记录不该出现在任何人的列表里」的场景）
  const seed = (opts.items || []).map((it) => (it && 'owner' in it ? it : { ...(it || {}), owner: cu }));
  const sq = makeSavedQuery(seed, opts.syncState);

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

  // 假的 searchable-select 组件（真组件在假 DOM 上跑不起来）：按真实行为造最小结构 ——
  // 在宿主父节点里插一个 .searchable-select 容器 + .searchable-select-input 输入框
  // （home.js 正是靠这个选择器找"真输入框"），并记录 updateOptions / setBusy 的调用。
  const selects = [];
  win.createSearchableSelect = (host, options, o) => {
    const parent = host && host.parentElement;
    let box = null;
    if (parent) {
      const wrap = fakeEl('div');
      wrap.className = 'searchable-select';
      box = fakeEl('input');
      box.className = 'searchable-select-input';
      wrap.appendChild(box);
      parent.appendChild(wrap);
    }
    const inst = {
      host,
      opts: o || {},
      box,
      options: Array.isArray(options) ? options.slice() : [],
      busy: '',
      _open: false,
      value: '',
      label: '',
      free: '',
      updateOptions(list) { inst.options = Array.isArray(list) ? list.slice() : []; },
      setBusy(t) { inst.busy = String(t || ''); },
      isOpen() { return inst._open; },
      open() { inst._open = true; },
      close() { inst._open = false; },
      getValue() { return inst.value; },
      getLabel() { return inst.label; },
      getFreeText() { return inst.free; },
      setValue(v) { inst.value = String(v || ''); inst.label = ''; },
      destroy() {},
    };
    selects.push(inst);
    return inst;
  };

  // 可控的当前用户：null = 未设置
  const cuState = { user: cu };
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

  // 定时器要显式注入：沙箱里没有它们，而「输入即搜」的防抖真会调用（setTimeout/clearTimeout）
  loadScript('js/page/home.js', { document: doc, setTimeout, clearTimeout }, win);

  return { win, doc, els, sq, toasts, ls, cuState, selects };
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
  win.SavedQuery.listForUser = () => { throw new Error('localStorage 不可用'); };
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

test('当前用户：未设置时清空身份条、显示表单，并建好可搜索下拉', () => {
  const { win, els, selects } = buildEnv({ currentUser: null, items: [] });
  win.HomePage.render();
  assert.strictEqual(els.userSet.hidden, true, '未设置时身份条必须隐藏（hidden 不能被 display 盖掉）');
  assert.strictEqual(els.userForm.hidden, false);
  assert.strictEqual(els.userLabel.textContent, '');
  assert.strictEqual(els.userDept.textContent, '');
  assert.strictEqual(els.userAvatar.textContent, '');
  // 「清空输入」的 ✕ 现在归组件管（不再有自己的按钮）：这里只确认组件建了起来
  assert.ok(selects[0], '可搜索下拉组件要建在这个 <select> 上');
});

test('部门排行：只列本部门的记录，且是只读视图（无重命名/删除）', () => {
  // ⚠️ 这里刻意不放 owner: null 的记录：首页渲染时会先把无归属的本机记录认领给当前用户
  //    （SavedQuery.claimAnonymous，2026-09-22 加），随后它就归进本部门了，会搅浑本用例
  //    「只看部门口径」的意图。无归属记录的展示/认领由「没设当前用户也要显示」那条用例守。
  const items = [
    { id: 'd1', page: 'publish', name: '本部门A', at: 3, owner: ME, hits: 1 },
    { id: 'd2', page: 'task', name: '别的部门', at: 2, owner: OTHER, hits: 9 },
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

// ══════════════════════════════════════════════════════════
// 输入即出的候选下拉（2026-09-20：不必再点「查 询」）
// ══════════════════════════════════════════════════════════
//
// 假 DOM 量不到布局与真实键盘事件 —— 「贴不贴在输入框正下方」「真浏览器里按键什么样」
// 由冒烟那一侧钉住（tests/smoke-browser.js 的「当前用户候选下拉」）；
// 这里守的是**纯逻辑**：什么输入才发请求、下拉该不该开、键盘选中谁。

/**
 * 组件内部那个真输入框（home.js 靠 `.searchable-select .searchable-select-input` 找它）。
 * 宿主 <select> 是隐藏的，用户真正打字的是这个框。
 */
function userBox(els) {
  const wrap = els.userField.children
    .find((c) => String(c.className || '').split(/\s+/).includes('searchable-select'));
  return wrap ? wrap.children[0] : null;
}

/** 造一次「用户输入」：写进真输入框，再叫一遍 input 监听器（假 DOM 没有 dispatchEvent） */
function typeInto(els, value) {
  const box = userBox(els);
  box.value = value;
  // home.js 把 input 监听**直接挂在组件内部那个输入框上**（不再挂宿主容器上用 capture 兜）
  (box.listeners.input || []).forEach((fn) => fn({ target: box }));
}

const TWO_ZHANG = [
  { userId: '1001', userName: '张三', orgId: 'O1', orgName: '软件中心', teamId: 'K1', teamName: '开发一部' },
  { userId: '1002', userName: '张三四', orgId: 'O1', orgName: '软件中心', teamId: 'K1', teamName: '开发一部' },
];

test('首页：「我的」为空时要说清是哪一种空（无归属 / 别人的 / 真没有）', () => {
  // 2026-09-20 加：用户报「给郑梓辉存了却还是空」，光看旧文案分不清是哪种情况，
  // 而三种情况用户要做的下一步完全不同。
  const ME2 = { userId: '4711510', userName: '郑梓辉', teamId: 'K4229', teamName: '开发三部' };

  // ① 本机一条都没有 → 就是"还没存过"
  const a = buildEnv({ currentUser: ME2, items: [] });
  a.win.HomePage.render();
  assert.ok(/你还没有保存过常用查询/.test(a.els.savedEmpty.textContent), a.els.savedEmpty.textContent);

  // ② 有记录但**没归属人**（owner: null）→ 2026-09-22 改：**自动认领给当前用户**并直接显示。
  //    旧行为是"空列表 + 提示设好用户再去查询页重新保存一次"，等于承认用户白存了一次
  //    （用户报过"没登录时保存的明明存下来了，首页却看不到"）。
  const b = buildEnv({
    currentUser: ME2,
    items: [{ id: 'o1', page: 'publish', name: '没归属的', at: 1, owner: null }],
  });
  b.win.HomePage.render();
  assert.strictEqual(b.els.savedList.children.length, 1, '认领后它应该出现在列表里');
  assert.strictEqual(b.els.savedEmpty.hidden, true, '有内容了空态要收起');
  const claimed = (b.win.SavedQuery.list()[0] || {}).owner || {};
  assert.strictEqual(claimed.userId, '4711510', '认领要落到本机镜像：owner 改成当前用户');

  // ③ 有归属人、但不是"我"的 → 说清"没有一条属于郑梓辉"
  const c = buildEnv({
    currentUser: ME2,
    items: [{ id: 'x1', page: 'publish', name: '别人的', at: 1, owner: OTHER }],
  });
  c.win.HomePage.render();
  assert.ok(/郑梓辉/.test(c.els.savedEmpty.textContent), c.els.savedEmpty.textContent);
  assert.ok(!/没有归属人/.test(c.els.savedEmpty.textContent), '这条有归属人，不该说成没归属');
});

test('首页：没设「当前用户」也要显示本机存的查询，但绝不露别人的', () => {
  // 2026-09-22 用户报：没登录时保存的查询存下来了，首页却是空的（只留一句"先设当前用户"）。
  // 现在没身份就把**无人认领的本机记录**列出来；别人的（有归属人的）依然一条都不显示 ——
  // 「宁可不显示，也不把同事的查询说成我的」这条防线不能因为这次改动而破。
  const env = buildEnv({
    currentUser: null,
    items: [
      { id: 'a1', page: 'publish', name: '没登录时存的', at: 5, owner: null },
      { id: 'x1', page: 'task', name: '别人的', at: 9, owner: OTHER },
    ],
  });
  env.win.HomePage.render();
  assert.strictEqual(env.els.savedList.children.length, 1, '只列本机那条匿名的，别人的不算');
  assert.strictEqual(env.els.savedEmpty.hidden, true, '有内容就不该显示空态');
  assert.strictEqual(env.els.savedCount.textContent, '共 1 条', '计数也要按实际列出来的算');

  // 一条匿名记录都没有时，才回到"空"的提示（这时该告诉用户怎么开始）
  const empty = buildEnv({ currentUser: null, items: [] });
  empty.win.HomePage.render();
  assert.strictEqual(empty.els.savedList.children.length, 0);
  assert.ok(/保存到首页/.test(empty.els.savedEmpty.textContent), empty.els.savedEmpty.textContent);
});

test('首页：光输入就出候选（走 searchable-select 组件，不点「查 询」）', async () => {
  const { win, els, selects } = buildEnv({
    currentUser: null,
    lookupResult: { ok: true, mode: 'name', list: TWO_ZHANG },
  });
  win.HomePage.render();
  const inst = selects[0];
  assert.ok(inst, '组件应该被建出来（宿主就是那个 <select>）');
  assert.deepStrictEqual(inst.options, [], '一开始没有候选');

  typeInto(els, '张三');
  await new Promise((r) => setTimeout(r, 320));   // 防抖 250ms

  assert.strictEqual(inst.options.length, 2, '候选要灌进组件');
  assert.strictEqual(inst.options[0].value, '1001', 'value 用工号（选中后靠它反查这个人）');
  assert.ok(/张三/.test(inst.options[0].label), 'label 是给人看的：' + inst.options[0].label);
  assert.ok(/开发一部/.test(inst.options[0].label), 'label 里要带部门，选人时才有区分度');
  assert.strictEqual(inst.isOpen(), true, '出候选的时候要把面板展开');
});

test('首页：在组件里选中一项 → 身份落到那个人身上', async () => {
  const { win, els, selects, cuState } = buildEnv({
    currentUser: null,
    lookupResult: { ok: true, mode: 'name', list: TWO_ZHANG },
  });
  win.HomePage.render();
  typeInto(els, '张三');
  await new Promise((r) => setTimeout(r, 320));
  assert.strictEqual(cuState.user, null, '光出候选不自动套用身份');

  // 模拟组件完成一次选择：宿主 <select> 的 value 变成 userId，再派发 change
  els.userKeyword.value = '1001';
  (els.userKeyword.listeners.change || []).forEach((fn) => fn({ target: els.userKeyword }));

  assert.strictEqual(cuState.user && cuState.user.userId, '1001', '选中的是谁就设成谁');
  assert.strictEqual(els.userForm.hidden, true, '设好之后输入表单收起');
  assert.ok(selects[0].options.length === 0, '选完要把候选清掉，下次重新搜');
});

test('首页：手动点「查 询」且唯一命中 → 直接设上（自动搜索不走这条）', async () => {
  const { win, els, cuState } = buildEnv({
    currentUser: null,
    lookupResult: { ok: true, mode: 'name', list: [TWO_ZHANG[0]] },
  });
  win.HomePage.render();
  typeInto(els, '张三');
  await new Promise((r) => setTimeout(r, 320));
  assert.strictEqual(cuState.user, null, '输入即搜只出下拉，不替用户拍板');

  els.btnUserSearch.click();   // 手动查询沿用旧语义
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(cuState.user && cuState.user.userId, '1001', '手动点查 询且只命中一个 → 直接设上');
});

test('首页：输入太短不发请求；清空后候选跟着清掉', async () => {
  let calls = 0;
  const { win, els, selects } = buildEnv({ currentUser: null });
  win.CurrentUser.lookup = async () => { calls += 1; return { ok: true, list: [] }; };
  win.HomePage.render();

  typeInto(els, '47');            // 纯数字不足 3 位：不是工号（与 looksLikeId 同口径）
  await new Promise((r) => setTimeout(r, 320));
  assert.strictEqual(calls, 0, '两位数不是工号，不该发请求');

  typeInto(els, '471');           // 3 位起才当工号
  await new Promise((r) => setTimeout(r, 320));
  assert.strictEqual(calls, 1, '够位数就该发');

  typeInto(els, '');              // 清空 → 候选清掉，且不再发
  await new Promise((r) => setTimeout(r, 320));
  assert.strictEqual(calls, 1, '清空不该再发一次');
  assert.deepStrictEqual(selects[0].options, [], '输入清空后候选也要清掉');
});

// ══════════════════════════════════════════════════════════
// 同步状态角标（「已同步 / 仅本机 / 同步失败」）
// ══════════════════════════════════════════════════════════
//
// 这条待办的原话是「同步是静默的，用户无从判断当前看的是本机数据还是团队数据」。
// 判定口径在 js/ui/saved-query.js（那里有用例），这里守的是**翻译层**：
// 三种状态各有各的文案与配色类，而且「为什么」必须写在 title 里 —— 角标只有一行字，
// 讲不清原因就等于没解决问题。

test('角标：还没同步过时不显示（首屏不该闪一个假的「仅本机」）', () => {
  const { els } = buildEnv({ items: [] });
  assert.strictEqual(els.savedSync.hidden, true, 'pending 时应隐藏');
  assert.strictEqual(els.savedSync.textContent, '');
});

test('角标：已同步 → 只显示「已同步」+ is-shared，不显示计数、不弹长提示（2026-09-21 用户拍板）', () => {
  const { els } = buildEnv({
    items: [],
    syncState: { state: 'shared', total: 12, file: '/srv/shared/saved-queries.db', storage: 'sqlite', people: 4, at: Date.now() },
  });
  assert.strictEqual(els.savedSync.hidden, false);
  assert.strictEqual(els.savedSync.textContent, '已同步');
  assert.strictEqual(els.savedSync.className, 'sync-state is-shared');
  assert.strictEqual(els.savedSync.title, '', '提示文字全删：悬停不该再弹一大坨');
});

test('角标：仅本机 → 「仅本机」+ is-local，无 title 提示', () => {
  const { els } = buildEnv({ items: [], syncState: { state: 'local', total: 3, at: Date.now() } });
  assert.strictEqual(els.savedSync.textContent, '仅本机');
  assert.strictEqual(els.savedSync.className, 'sync-state is-local');
  assert.strictEqual(els.savedSync.title, '');
});

test('角标：同步失败 → 「同步失败」+ is-fail，无 title 提示', () => {
  const { els } = buildEnv({
    items: [],
    syncState: { state: 'fail', total: 0, error: '同步失败：HTTP 500', at: Date.now() },
  });
  assert.strictEqual(els.savedSync.textContent, '同步失败');
  assert.strictEqual(els.savedSync.className, 'sync-state is-fail');
  assert.strictEqual(els.savedSync.title, '');
});

test('角标：同步状态一变就自己刷新，不需要重画整页', () => {
  const { els, sq } = buildEnv({ items: [] });
  assert.strictEqual(els.savedSync.hidden, true);
  sq._emitSync({ state: 'shared', total: 5, file: '/srv/x.db', at: Date.now() });
  assert.strictEqual(els.savedSync.hidden, false, '回调到了就该显示');
  assert.strictEqual(els.savedSync.textContent, '已同步');
});

test('角标：回到 pending 要清掉上一次的残留（文案/类名/title 都不能留）', () => {
  const { els, sq } = buildEnv({ items: [] });
  // 先留一份可见的旧状态，再退回 pending —— 只断 hidden 是假通过：
  // 新建的假元素 textContent 本来就是空串，必须先把脏数据写进去才能验「清没清」。
  sq._emitSync({ state: 'shared', total: 9, file: 'x.db', storage: 'sqlite', at: Date.now() });
  assert.strictEqual(els.savedSync.hidden, false);
  assert.ok(els.savedSync.textContent, '前置：先有残留');
  sq._emitSync({ state: 'pending', total: 0, file: '', storage: '', at: 0 });
  assert.strictEqual(els.savedSync.hidden, true);
  assert.strictEqual(els.savedSync.textContent, '', '文案要清掉');
  assert.ok(!els.savedSync.title, 'title 也要清掉，否则悬停还会读到旧的');
});

test('角标：存储层没给 lastSyncState（旧版替身）时安静跳过，不抛', () => {
  const { els, sq } = buildEnv({ items: [] });
  delete sq.lastSyncState;
  els.savedSync.textContent = '残留';
  sq._sync = { state: 'shared', total: 9, at: Date.now() };
  // _emitSync 仍会广播（订阅方是 renderSync），此时 renderSync 取不到 lastSyncState 就该收起角标
  sq._emitSync({});
  assert.strictEqual(els.savedSync.hidden, true, '拿不到状态就把角标收起来，别显示旧的');
});

