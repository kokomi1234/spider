/**
 * Token 管理弹窗（js/ui/token-manager.js）
 *
 * ── 钉的是哪个 bug ────────────────────────────────────
 * token-manager 调的是 DialogUtils.openUtilDialog，而 dialog-utils.js
 * 只导出了 lockScroll / unlockScroll / forceUnlockAll / makeDraggable /
 * promptText / confirmBox —— **没有 openUtilDialog**。点按钮当场 TypeError，
 * 页面上表现为「点了没反应」，且错误藏在 click 回调里，控制台之外毫无征兆。
 *
 * 所以这里不满足于「断言函数存在」，而是用假 DOM 把整条链路跑一遍：
 * 点击 → 弹窗真的挂到 body → 空值拦截 → 填值后发出 POST。
 * 只断言导出项的话，哪天有人把调用改成别的不存在的方法，测试还是绿的。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ROOT, test, loadScript } = require('./harness');

// ══════════════════════════════════════════════════════════
// 假 DOM：只实现 openUtilDialog / TokenManager 真正用到的部分
// ══════════════════════════════════════════════════════════

function fakeEl(tag) {
  return {
    tagName: String(tag || 'div').toUpperCase(),
    children: [],
    style: {},
    attrs: {},
    className: '',
    id: '',
    type: '',
    value: '',
    checked: true,
    textContent: '',
    innerHTML: '',
    listeners: {},
    parent: null,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    appendChild(c) { this.children.push(c); c.parent = this; return c; },
    append(...cs) { cs.forEach((c) => this.appendChild(c)); },
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener() {},
    focus() {},
    click() { (this.listeners.click || []).slice().forEach((fn) => fn({ target: this })); },
    classList: { add() {}, remove() {}, contains() { return false; } },
    querySelector(sel) { return findIn(this, (e) => e.id === String(sel).replace('#', '')); },
  };
}

/** 深度优先找第一个满足条件的节点 */
function findIn(root, pred) {
  if (pred(root)) return root;
  for (const c of root.children || []) {
    const hit = findIn(c, pred);
    if (hit) return hit;
  }
  return null;
}

function fakeDocument(ids) {
  const body = fakeEl('body');
  return {
    documentElement: fakeEl('html'),
    body,
    createElement: (tag) => fakeEl(tag),
    // 跟真浏览器一样：先查「页面里本来就有的」，再去 body 子树里找动态创建的
    // （弹窗是开出来之后才 append 上去的，只查固定 ids 会永远找不到输入框）
    getElementById: (id) => ids[id] || findIn(body, (e) => e.id === id) || null,
    addEventListener() {},
    removeEventListener() {},
  };
}

/**
 * 按 URL 返回不同假响应的 fetch，同时记录每次调用。
 * @param {Array} calls  收集 { url, init }
 * @param {Function} payloadFor  (url) => 响应对象
 */
function fakeFetch(calls, payloadFor) {
  return (url, init) => {
    calls.push({ url, init });
    const payload = payloadFor(url);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(payload),
    });
  };
}

/**
 * 装好假全局跑 fn，跑完还原。
 * 注意 document 必须经 loadScript 的形参注入（harness 是
 * `new Function('window','document',...)`），只设 global.document 不生效。
 */
async function withFakeDom(ids, fetchImpl, fn) {
  const prev = {
    document: global.document,
    fetch: global.fetch,
    raf: global.requestAnimationFrame,
  };
  const doc = fakeDocument(ids);
  global.document = doc;
  global.fetch = fetchImpl;
  global.requestAnimationFrame = (cb) => { cb(); return 1; };
  try {
    return await fn(doc);
  } finally {
    if (prev.document === undefined) delete global.document; else global.document = prev.document;
    if (prev.fetch === undefined) delete global.fetch; else global.fetch = prev.fetch;
    if (prev.raf === undefined) delete global.requestAnimationFrame; else global.requestAnimationFrame = prev.raf;
  }
}

/** 加载 dialog-utils + token-manager 到同一个 window（模拟页面里的加载顺序） */
function loadTokenManager(win, doc) {
  loadScript('js/ui/dialog-utils.js', { document: doc }, win);
  loadScript('js/ui/token-manager.js', { document: doc }, win);
  return win;
}

const STATUS_OK = {
  code: 200,
  hasToken: true,
  tokenPreview: 'abcd1234...wxyz',
  envPath: '/mock/publish/.env',
};

const overlayOf = (doc) => findIn(doc.body, (e) => /dlg-util-overlay/.test(e.className));
const confirmBtnOf = (overlay) => findIn(overlay, (e) => e.tagName === 'BUTTON' && /filled/.test(e.className));

/** 让 applyToken 里的 fetch 链跑完（都是微任务，一个宏任务就够） */
const flush = () => new Promise((r) => setTimeout(r, 0));

// ══════════════════════════════════════════════════════════
// 用例
// ══════════════════════════════════════════════════════════

/**
 * 接线回归：上面几个用例是手工 init + click，拦不住「按钮 id 改坏」
 * 或「index.js 忘了调 init」——那同样表现为点了没反应，而且测试还是绿的。
 * 这里直接对着真实入口文件断言接线。
 */
test('接线：index.html 有按钮、index.js 会 init，且脚本顺序正确', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(/id="btnTokenManager"/.test(html), 'index.html 必须有 #btnTokenManager 按钮');
  assert.ok(/js\/ui\/token-manager\.js/.test(html), 'index.html 必须引入 token-manager.js');
  assert.ok(
    html.indexOf('js/ui/token-manager.js') < html.indexOf('js/page/index.js'),
    'token-manager.js 必须排在 index.js 之前（否则 init 时模块还没挂上）',
  );

  const js = fs.readFileSync(path.join(ROOT, 'js/page/index.js'), 'utf8');
  assert.ok(/TokenManager\.init\(\)/.test(js), 'index.js 必须调用 TokenManager.init()');
});

test('dialog-utils：openUtilDialog 必须导出（Token 管理弹窗直接依赖它）', () => {
  const win = loadScript('js/ui/dialog-utils.js', {}, {});
  assert.strictEqual(
    typeof win.DialogUtils.openUtilDialog,
    'function',
    'dialog-utils.js 未导出 openUtilDialog：Token 管理点开会当场 TypeError，页面上就是「点了没反应」',
  );
});

test('token-manager：点「🔑 Token」真的打开弹窗（回归：未导出时静默不弹）', async () => {
  const btn = fakeEl('button');
  const calls = [];

  await withFakeDom({ btnTokenManager: btn }, fakeFetch(calls, () => STATUS_OK), async (doc) => {
    const win = {};
    const toasts = [];
    loadTokenManager(win, doc);
    win.toast = (msg) => toasts.push(msg);

    win.TokenManager.init();
    btn.click();

    const overlay = overlayOf(doc);
    assert.ok(overlay, '点击后 body 上应挂出 .dlg-util-overlay');

    // 弹窗里该有的控件都得在，否则「打开了但没法用」也算失败
    assert.ok(findIn(overlay, (e) => e.id === 'tm-token-input'), '应有 token 输入框');
    assert.ok(findIn(overlay, (e) => e.id === 'tm-save-env'), '应有「覆盖 .env」勾选框');

    const status = findIn(overlay, (e) => e.id === 'tm-status');
    assert.ok(status, '应有状态区');
    assert.strictEqual(status.textContent, '加载中...', '状态区首帧应为加载中');

    await flush();

    // 状态回来后要显示真实预览 + 已配置（不能停在「加载中」）。
    // 假 DOM 不会把子节点文本拼到父节点上，所以直接在子树里找那两个节点。
    const code = findIn(status, (e) => e.tagName === 'CODE');
    assert.ok(code, '状态区应渲染出 <code> 预览');
    assert.strictEqual(code.textContent, 'abcd1234...wxyz');

    const stateEl = findIn(status, (e) => /配置/.test(e.textContent));
    assert.ok(stateEl && /已配置/.test(stateEl.textContent), 'hasToken=true 时应显示「已配置」');

    // 状态请求的 URL 要对得上 proxy 的端点
    assert.strictEqual(calls[0].url, '/admin/token/status', `首次请求应为状态接口，实际：${calls[0].url}`);
  });
});

test('token-manager：状态接口挂了要给出提示，而不是卡在「加载中」', async () => {
  const btn = fakeEl('button');

  await withFakeDom({ btnTokenManager: btn }, () => Promise.reject(new Error('ECONNREFUSED')), async (doc) => {
    const win = {};
    loadTokenManager(win, doc);
    win.TokenManager.init();
    btn.click();

    const status = findIn(overlayOf(doc), (e) => e.id === 'tm-status');
    await flush();

    assert.ok(/失败|未启动/.test(status.textContent), `应提示获取失败，实际：${status.textContent}`);
  });
});

test('token-manager：token 为空时点确认不关闭弹窗，并给出提示', async () => {
  const btn = fakeEl('button');
  const calls = [];

  await withFakeDom({ btnTokenManager: btn }, fakeFetch(calls, () => STATUS_OK), async (doc) => {
    const win = {};
    const toasts = [];
    loadTokenManager(win, doc);
    win.toast = (msg) => toasts.push(msg);

    win.TokenManager.init();
    btn.click();
    await flush();

    const overlay = overlayOf(doc);
    confirmBtnOf(overlay).click();

    // 关键：校验失败不能把弹窗关掉（旧实现是先关窗再校验，提示根本看不见）
    assert.ok(overlayOf(doc), '校验失败时弹窗应留在页面上');
    assert.ok(toasts.some((t) => /请输入/.test(t)), `应提示输入 token，实际提示：${JSON.stringify(toasts)}`);
    assert.strictEqual(
      calls.filter((c) => String(c.url).indexOf('/admin/token') === 0 && c.init && c.init.method === 'POST').length,
      0,
      '空值不应发出 POST',
    );
  });
});

test('token-manager：填上 token 点确认 → POST /admin/token 并关闭弹窗', async () => {
  const btn = fakeEl('button');
  const calls = [];

  await withFakeDom(
    { btnTokenManager: btn },
    fakeFetch(calls, (url) => (String(url).indexOf('/admin/token?') === 0 || /\/admin\/token$/.test(url)
      ? { code: 200, msg: 'token updated', saved: true }
      : STATUS_OK)),
    async (doc) => {
      const win = {};
      const toasts = [];
      loadTokenManager(win, doc);
      win.toast = (msg) => toasts.push(msg);

      win.TokenManager.init();
      btn.click();
      await flush();

      const overlay = overlayOf(doc);
      findIn(overlay, (e) => e.id === 'tm-token-input').value = '  NEW-TOKEN-VALUE  ';
      confirmBtnOf(overlay).click();
      await flush();

      const post = calls.find((c) => c.init && c.init.method === 'POST');
      assert.ok(post, `应发出 POST，实际调用：${JSON.stringify(calls.map((c) => c.url))}`);
      assert.strictEqual(post.url, '/admin/token');
      assert.deepStrictEqual(
        JSON.parse(post.init.body),
        { token: 'NEW-TOKEN-VALUE', saveToEnv: true },
        'token 要 trim 后提交，saveToEnv 取勾选框（默认勾上）',
      );

      assert.ok(!overlayOf(doc), '确认成功后应关闭弹窗');
      assert.ok(toasts.some((t) => /已更新/.test(t)), `应提示更新成功，实际：${JSON.stringify(toasts)}`);
    },
  );
});

test('token-manager：页面带 ?token= 时透传给管理端点（代理设了 PROXY_ADMIN_TOKEN 才需要）', async () => {
  const btn = fakeEl('button');
  const calls = [];

  await withFakeDom({ btnTokenManager: btn }, fakeFetch(calls, () => STATUS_OK), async (doc) => {
    const win = { location: { search: '?token=admin-secret' } };
    loadTokenManager(win, doc);
    win.TokenManager.init();
    btn.click();
    await flush();

    assert.strictEqual(calls[0].url, '/admin/token/status?token=admin-secret', `实际：${calls[0].url}`);
  });
});
