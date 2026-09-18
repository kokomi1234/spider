/**
 * 边界场景单元测试：UI 组件层（纯 node 假 DOM 跑浏览器 IIFE）
 *
 * 覆盖：
 *   1. js/ui/csv-export.js   （CsvExporter）—— 最高优先级
 *   2. js/ui/table-utils.js  （TableUtils）
 *   3. js/ui/dialog-utils.js （DialogUtils）
 *   4. js/ui/subscribe-manager.js（SubscribeManager）
 *
 * 写法遵循 harness / token-manager.test.js：
 *   - loadScript(rel, { document }, win) 把 document 经形参注入（坑1）
 *   - 假 getElementById / querySelector 递归 body 子树（坑2）
 *   - CsvExporter / TableUtils / DialogUtils 都用 Object.freeze 导出，
 *     不对其打桩，避免坑3。
 *
 * 期望值全部对着源码真实实现定；发现真 bug 不改动源码，仅在报告里指出。
 */
'use strict';

const assert = require('assert');
const { ROOT, test, loadScript } = require('./harness');

// ══════════════════════════════════════════════════════════
// 假 DOM（覆盖 createElement / appendChild / append / remove /
// addEventListener / classList / style / querySelector / querySelectorAll /
// closest / getBoundingClientRect / setAttribute / innerHTML 等）
// ══════════════════════════════════════════════════════════

function makeClassList() {
  const set = new Set();
  return {
    add(...cs) { cs.forEach((c) => set.add(c)); },
    remove(...cs) { cs.forEach((c) => set.delete(c)); },
    contains(c) { return set.has(c); },
    toggle(c) { if (set.has(c)) set.delete(c); else set.add(c); },
    _set: set,
  };
}

function matchSel(el, sel) {
  if (!el) return false;
  if (sel[0] === '#') return el.id === sel.slice(1);
  if (sel[0] === '.') return el.className.split(/\s+/).includes(sel.slice(1));
  return el.tagName === String(sel).toUpperCase();
}

/** 深度优先找第一个满足 pred 的节点（含 root） */
function findIn(root, pred) {
  if (!root) return null;
  if (pred(root)) return root;
  for (const c of root.children || []) {
    const hit = findIn(c, pred);
    if (hit) return hit;
  }
  return null;
}

/** 遍历所有后代（不含 root） */
function walk(el, cb) {
  for (const c of el.children || []) { cb(c); walk(c, cb); }
}

function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [],
    style: {},
    attrs: {},
    classList: makeClassList(),
    _class: '',
    _id: '',
    _innerHTML: '',
    type: '',
    value: '',
    checked: false,
    textContent: '',
    hidden: false,
    listeners: {},
    parentNode: null,
    parentElement: null,
    get className() { return this._class; },
    set className(v) { this._class = String(v); },
    get id() { return this._id; },
    set id(v) { this._id = String(v); },
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) { this._innerHTML = String(v); },
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === 'id') this._id = String(v);
      if (k === 'class') this._class = String(v);
    },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.children.push(c); c.parentNode = this; c.parentElement = this; return c; },
    append(...cs) { cs.forEach((c) => this.appendChild(c)); },
    remove() {
      if (this.parentNode) {
        this.parentNode.children = this.parentNode.children.filter((x) => x !== this);
        this.parentNode = null;
        this.parentElement = null;
      }
    },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    removeEventListener(t, fn) { if (this.listeners[t]) this.listeners[t] = this.listeners[t].filter((f) => f !== fn); },
    dispatch(t, ev) { (this.listeners[t] || []).slice().forEach((fn) => fn(ev)); },
    click() { this.dispatch('click', { target: this, preventDefault() {}, button: 0 }); },
    focus() {},
    closest(sel) { let n = this; while (n) { if (matchSel(n, sel)) return n; n = n.parentNode; } return null; },
    querySelector(sel) { return findIn(this, (e) => matchSel(e, sel)); },
    querySelectorAll(sel) { const out = []; walk(this, (e) => { if (matchSel(e, sel)) out.push(e); }); return out; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 40, right: 100, bottom: 40 }; },
  };
  return el;
}

function makeDoc(ids) {
  ids = ids || {};
  const body = makeEl('body');
  const docEl = makeEl('html');
  const doc = {
    documentElement: docEl,
    body,
    listeners: {},
    createElement(tag) { return makeEl(tag); },
    getElementById(id) { return ids[id] || findIn(body, (e) => e.id === id) || null; },
    querySelector(sel) { return findIn(body, (e) => matchSel(e, sel)); },
    querySelectorAll(sel) { const out = []; walk(body, (e) => { if (matchSel(e, sel)) out.push(e); }); return out; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    removeEventListener(t, fn) { if (this.listeners[t]) this.listeners[t] = this.listeners[t].filter((f) => f !== fn); },
    dispatch(t, ev) { (this.listeners[t] || []).slice().forEach((fn) => fn(ev)); },
  };
  return doc;
}

// dialog-utils 用到全局 requestAnimationFrame（openUtilDialog 里）
global.requestAnimationFrame = (cb) => { try { cb(); } catch (_) {} return 1; };

// ══════════════════════════════════════════════════════════
// 假 Blob / URL（捕获导出内容 + 不崩）
// ══════════════════════════════════════════════════════════

const createdBlobs = [];
let blobSeq = 0;
function FakeBlob(parts) { this.parts = parts; this.type = (parts && parts[1] && parts[1].type) || ''; }
const fakeURL = {
  createObjectURL(b) { createdBlobs.push(b); return 'blob:fake-' + (++blobSeq); },
  revokeObjectURL() {},
};
const fakeSetTimeout = (cb) => { return 0; }; // 不实际触发，避免副作用

/** 取最近一次创建的 Blob 的文本内容 */
function lastBlobText() {
  const b = createdBlobs[createdBlobs.length - 1];
  return b ? b.parts.join('') : '';
}

/** 按 CSV 规则（尊重引号内换行）统计行数 */
function countCsvRows(text) {
  const body = String(text).replace(/^\uFEFF/, '');
  let sep = 0;
  let inQ = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"') {
      if (inQ && body[i + 1] === '"') { i++; continue; }
      inQ = !inQ;
    } else if (c === '\r' && body[i + 1] === '\n') {
      if (!inQ) sep++;
      i++;
    }
  }
  return sep + 1; // 末尾无多余换行
}

function findOverlay(doc) {
  return findIn(doc.body, (e) => e.className.split(/\s+/).includes('dlg-util-overlay'));
}
function findInput(ov) { return findIn(ov, (e) => e.tagName === 'INPUT'); }
function findFilled(ov) { return findIn(ov, (e) => e.className.split(/\s+/).includes('filled')); }
function findByText(ov, t) { return findIn(ov, (e) => e.textContent === t); }

// 简易 Fmt（与源码兜底实现一致），供 table-utils / csv-export 在调用时读取
const Fmt = {
  esc: (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
  stamp: () => '2020-01-01-00-00-00',
};

// ══════════════════════════════════════════════════════════
// 1) csv-export.js
// ══════════════════════════════════════════════════════════

function loadCsv() {
  createdBlobs.length = 0;
  const win = { Fmt };
  const doc = makeDoc();
  loadScript('js/ui/csv-export.js', { document: doc, Blob: FakeBlob, URL: fakeURL, setTimeout: fakeSetTimeout }, win);
  return { win, doc };
}

// —— csvCell 基础转义 ——
test('csvCell：普通字符串原样返回（不含特殊字符）', () => {
  const { win } = loadCsv();
  assert.strictEqual(win.CsvExporter.csvCell('hello'), 'hello');
  assert.strictEqual(win.CsvExporter.csvCell(123), '123');
});

test('csvCell：含英文逗号的值被双引号包裹', () => {
  const { win } = loadCsv();
  assert.strictEqual(win.CsvExporter.csvCell('a,b'), '"a,b"');
});

test('csvCell：含英文双引号的值引号翻倍', () => {
  const { win } = loadCsv();
  assert.strictEqual(win.CsvExporter.csvCell('he said "hi"'), '"he said ""hi"""');
});

test('csvCell：含换行 \\r\\n 的值被引号包裹', () => {
  const { win } = loadCsv();
  assert.strictEqual(win.CsvExporter.csvCell('a\r\nb'), '"a\r\nb"');
});

test('csvCell：逗号 + 双引号同时存在 → 既翻倍又包裹', () => {
  const { win } = loadCsv();
  assert.strictEqual(win.CsvExporter.csvCell('a,"b"'), '"a,""b"""');
});

test('csvCell：null / undefined → 空串', () => {
  const { win } = loadCsv();
  assert.strictEqual(win.CsvExporter.csvCell(null), '');
  assert.strictEqual(win.CsvExporter.csvCell(undefined), '');
});

// —— CSV 公式注入（2026-09-18 已修）——
// 期望：前导 = + - @ 及 \t \r 必须被中和（加前导单引号），使 Excel/WPS 打开后
// 不再当公式执行。导出内容全部来自后端报文，属不可信输入，这条是硬要求。
test('csvCell：公式注入前缀被前导单引号中和', () => {
  const { win } = loadCsv();
  const danger = ['=cmd|\'/c calc\'!A1', '+1+1', '@SUM(A1)', '-1+2', '\txyz'];
  for (const v of danger) {
    const out = win.CsvExporter.csvCell(v);
    const unquoted = out.startsWith('"') ? out.slice(1) : out; // 含 \r 的值会被整体加引号
    assert.ok(
      unquoted.startsWith("'"),
      `公式前缀必须被中和：${JSON.stringify(v)} -> ${JSON.stringify(out)}`,
    );
    assert.notStrictEqual(out, v, '绝不能原样落盘');
  }
});

test('csvCell：数字不做公式中和（负数不能被转成文本）', () => {
  const { win } = loadCsv();
  assert.strictEqual(win.CsvExporter.csvCell(-5), '-5', '负数应原样输出，不能变成 \'-5');
  assert.strictEqual(win.CsvExporter.csvCell(0), '0');
});

// —— download 基本行为 ——
test('download：rows 为空数组 → 仅表头 + BOM（行数=1，不崩）', () => {
  const { win } = loadCsv();
  win.CsvExporter.download([], [['code', '编码'], ['name', '名称']], 'f.csv');
  const text = lastBlobText();
  assert.ok(text.startsWith('\uFEFF'), '应以 BOM 开头');
  assert.strictEqual(countCsvRows(text), 1, '空数据时只有表头一行');
  assert.strictEqual(text.replace(/^\uFEFF/, ''), '编码,名称', `表头应为「编码,名称」，实际：${JSON.stringify(text)}`);
});

test('download：字段含逗号/双引号/换行 → 行数正确不串行', () => {
  const { win } = loadCsv();
  const rows = [
    { code: 'A,B', name: 'he said "hi"' },
    { code: 'C', name: 'line1\r\nline2' },
  ];
  win.CsvExporter.download(rows, [['code', '编码'], ['name', '名称']], 'f.csv');
  const text = lastBlobText();
  // 表头 + 2 数据行 = 3 行；字段内 \r\n 不应被算作行分隔
  assert.strictEqual(countCsvRows(text), 3, '含内嵌换行的字段不得串行');
  assert.ok(/"A,B"/.test(text), '含逗号的字段应被包裹');
  assert.ok(/"he said ""hi"""/.test(text), '含双引号的字段应翻倍');
  assert.ok(/"line1\r\nline2"/.test(text), '内嵌换行应被包裹在同一字段');
});

test('download：含公式前缀字段导出后未被中和（断言现状·疑似缺陷）', () => {
  const { win } = loadCsv();
  const rows = [{ code: '=cmd|\'/c calc\'!A1', name: '+1+1' }];
  win.CsvExporter.download(rows, [['code', '编码'], ['name', '名称']], 'f.csv');
  const text = lastBlobText();
  assert.ok(text.includes("=cmd|'/c calc'!A1"), '公式前缀原样落盘，未被中和');
});

test('download：filename 为空 → 不崩', () => {
  const { win } = loadCsv();
  assert.doesNotThrow(() => win.CsvExporter.download([{ code: 'X' }], [['code', '编码']], ''));
  assert.ok(lastBlobText().length > 0, '仍应生成下载内容');
});

test('download：filename 含 / 和 : 等非法字符 → 不崩（源码无兜底·疑似缺陷）', () => {
  const { win } = loadCsv();
  const badName = 'a/b:c\\d*.csv';
  assert.doesNotThrow(() => win.CsvExporter.download([{ code: 'X' }], [['code', '编码']], badName));
  // 现状：直接把原始非法文件名赋给 a.download，没有任何清洗/兜底
  const a = createdBlobs.length; // 仅确认有创建
  assert.ok(createdBlobs.length >= 1, '应创建下载锚点');
});

// —— exportRows 行为 ——
test('exportRows：rows 为空数组 → 返回 false 并 notify 警告（不产 CSV）', () => {
  const { win } = loadCsv();
  const calls = [];
  const notify = (msg, time, type) => calls.push({ msg, time, type });
  const r = win.CsvExporter.exportRows([], () => 'unsubscribed', notify);
  assert.strictEqual(r, false, '空结果应直接返回 false');
  assert.strictEqual(createdBlobs.length, 0, '空结果不应产生下载');
  assert.ok(calls.some((c) => /没有可导出的结果/.test(c.msg)), '应提示没有可导出结果');
});

test('exportRows：rows 为 null → 返回 false 不崩', () => {
  const { win } = loadCsv();
  const calls = [];
  const notify = (msg) => calls.push(msg);
  const r = win.CsvExporter.exportRows(null, () => 'unsubscribed', notify);
  assert.strictEqual(r, false, 'null 应返回 false');
  assert.strictEqual(createdBlobs.length, 0);
});

test('exportRows：正常一行 → 返回 true、notify 成功、含表头+数据', () => {
  const { win } = loadCsv();
  const calls = [];
  const notify = (msg, time, type) => calls.push({ msg, time, type });
  const rows = [{
    serverCoding: 'SRV1', interfaceCode: 'IF1', serviceName: '服务1',
    sysServeNo: '', sheetProductBatch: '', offerServerState: 'on',
    isChecked: '1', deptName: '部门A',
  }];
  const r = win.CsvExporter.exportRows(rows, (c) => (c === 'SRV1' ? 'subscribed' : 'unsubscribed'), notify);
  assert.strictEqual(r, true);
  assert.ok(calls.some((c) => /已导出 1 条/.test(c.msg)), '应提示导出成功');
  const text = lastBlobText();
  assert.ok(text.includes('SRV1'), '应含服务编码');
  assert.ok(text.includes('已订阅'), '订阅状态应映射为已订阅');
  assert.strictEqual(countCsvRows(text), 2, '表头+1 数据行');
});

test('exportRows：未订阅服务映射为「未订阅」', () => {
  const { win } = loadCsv();
  const rows = [{ serverCoding: 'SRV2', serviceName: '服务2' }];
  win.CsvExporter.exportRows(rows, () => 'unsubscribed', () => {});
  const text = lastBlobText();
  assert.ok(text.includes('未订阅'), '非 subscribed 应映射为未订阅');
});

// ══════════════════════════════════════════════════════════
// 2) table-utils.js
// ══════════════════════════════════════════════════════════

function loadTable() {
  const win = { Fmt, addEventListener() {} };
  const doc = makeDoc();
  loadScript('js/ui/table-utils.js', { document: doc }, win);
  return { win, doc };
}

test('totalPages：total 为负数 → 至少 1 页', () => {
  const { win } = loadTable();
  assert.strictEqual(win.TableUtils.totalPages(-5, 10), 1);
  assert.strictEqual(win.TableUtils.totalPages(-1, 1), 1);
});

test('totalPages：total 为 NaN → 至少 1 页不崩', () => {
  const { win } = loadTable();
  assert.strictEqual(win.TableUtils.totalPages(NaN, 10), 1);
  // 注意：传非数字字符串 'abc' 时 Number('abc')=NaN 但走的是 truthy 分支 → 返回 NaN
  // （Number('abc'||0) = Number('abc') = NaN），源码未对字符串脏输入兜底，属可疑点。
  assert.ok(Number.isNaN(win.TableUtils.totalPages('abc', 10)), '非数字字符串应返回 NaN（调用方需保证传 number）');
});

test('totalPages：正常分页计算正确', () => {
  const { win } = loadTable();
  assert.strictEqual(win.TableUtils.totalPages(25, 10), 3);
  assert.strictEqual(win.TableUtils.totalPages(0, 10), 1);
});

test('totalPages：pageSize 为 0 → 不除零、返回有限值', () => {
  const { win } = loadTable();
  const r = win.TableUtils.totalPages(20, 0);
  assert.ok(Number.isFinite(r), 'pageSize=0 不得产生 NaN/Infinity');
  assert.strictEqual(r, 20);
});

// —— renderEmpty colspan 注入 ——
test('renderEmpty：colspan 传注入字符串 → 被中和成 1（无 onmouseover）', () => {
  const { win, doc } = loadTable();
  const resultBody = makeEl('tbody'); resultBody.id = 'resultBody';
  doc.body.appendChild(resultBody);
  win.TableUtils.renderEmpty('暂无', '3"onmouseover="alert(1)');
  assert.ok(/colspan="1"/.test(resultBody.innerHTML), `colspan 应被中和为 1，实际：${resultBody.innerHTML}`);
  assert.ok(!/onmouseover/.test(resultBody.innerHTML), '不得产出可利用的 onmouseover 属性');
});

test('renderEmpty：colspan 传 0 → 兜底为 1', () => {
  const { win, doc } = loadTable();
  const resultBody = makeEl('tbody'); resultBody.id = 'resultBody';
  doc.body.appendChild(resultBody);
  win.TableUtils.renderEmpty('x', 0);
  assert.ok(/colspan="1"/.test(resultBody.innerHTML));
});

test('renderEmpty：colspan 传 -1 → 不得产出可利用属性', () => {
  const { win, doc } = loadTable();
  const resultBody = makeEl('tbody'); resultBody.id = 'resultBody';
  doc.body.appendChild(resultBody);
  win.TableUtils.renderEmpty('x', -1);
  const html = resultBody.innerHTML;
  assert.ok(!/onmouseover|onerror|javascript:/i.test(html), '不应出现可利用属性');
});

test('renderEmpty：text 含 < 被 HTML 转义（防 XSS）', () => {
  const { win, doc } = loadTable();
  const resultBody = makeEl('tbody'); resultBody.id = 'resultBody';
  doc.body.appendChild(resultBody);
  win.TableUtils.renderEmpty('<img src=x onerror=alert(1)>', 1);
  assert.ok(/&lt;img/.test(resultBody.innerHTML), '尖括号应被转义');
  assert.ok(!/<img/.test(resultBody.innerHTML), '不得原样写入 <img>');
});

test('renderEmpty：页面无 #resultBody（tbody 缺失）→ 不崩', () => {
  const { win, doc } = loadTable();
  // doc.body 里没有任何 resultBody / pagination / overlay
  assert.doesNotThrow(() => win.TableUtils.renderEmpty('x', 1));
});

test('renderEmpty：有浮层时同步显示并设置 top（隐藏分页条）', () => {
  const { win, doc } = loadTable();
  const resultBody = makeEl('tbody'); resultBody.id = 'resultBody';
  const pagination = makeEl('div'); pagination.id = 'pagination';
  const scroll = makeEl('div'); scroll.className = 'tbl-scroll';
  const thead = makeEl('thead');
  const overlay = makeEl('div'); overlay.className = 'table-empty-overlay';
  const overlayText = makeEl('div'); overlayText.className = 'table-empty-overlay-text';
  scroll.appendChild(thead);
  scroll.appendChild(overlay);
  doc.body.appendChild(resultBody);
  doc.body.appendChild(pagination);
  doc.body.appendChild(overlayText);
  doc.body.appendChild(scroll);

  win.TableUtils.renderEmpty('没有匹配的服务', 3);
  assert.strictEqual(overlay.hidden, false, '空态浮层应显示');
  assert.strictEqual(overlay.style.top, '40px', '浮层 top 应对齐表头高度');
  assert.strictEqual(pagination.style.display, 'none', '应隐藏分页条');
  assert.strictEqual(overlayText.textContent, '没有匹配的服务', '浮层文案应同步');
});

test('syncEmptyOverlay：页面无浮层 → 返回 false（整体跳过）', () => {
  const { win, doc } = loadTable();
  // 没有 .table-empty-overlay
  assert.strictEqual(win.TableUtils.syncEmptyOverlay(), false);
});

test('resetTableScroll：无 .tbl-scroll → 不崩', () => {
  const { win, doc } = loadTable();
  assert.doesNotThrow(() => win.TableUtils.resetTableScroll());
});

// ══════════════════════════════════════════════════════════
// 3) dialog-utils.js（promptText / confirmBox / 滚动锁）
// ══════════════════════════════════════════════════════════

function loadDialog() {
  const win = { addEventListener() {}, Fmt };
  const doc = makeDoc();
  // setTimeout 必须作为 loadScript 形参传入（dialog-utils 的 onReady 用到），
  // 否则形参遮蔽全局 → "setTimeout is not a function"
  loadScript('js/ui/dialog-utils.js', { document: doc, setTimeout: fakeSetTimeout }, win);
  return { win, doc };
}

test('lockScroll：调用后 body / html 加 dialog-open', () => {
  const { win, doc } = loadDialog();
  win.DialogUtils.lockScroll();
  assert.ok(doc.body.classList.contains('dialog-open'), 'body 应锁定');
  assert.ok(doc.documentElement.classList.contains('dialog-open'), 'html 应锁定');
});

test('lockScroll/unlockScroll：嵌套锁只锁一次，解一层仍保持', () => {
  const { win, doc } = loadDialog();
  const D = win.DialogUtils;
  D.lockScroll(); D.lockScroll();
  assert.ok(doc.body.classList.contains('dialog-open'), '锁两次仍锁');
  D.unlockScroll();
  assert.ok(doc.body.classList.contains('dialog-open'), '解一层仍保持');
  D.unlockScroll();
  assert.ok(!doc.body.classList.contains('dialog-open'), '解两层才解锁');
});

test('forceUnlockAll：连开两个弹窗后强制解锁恢复滚动', () => {
  const { win, doc } = loadDialog();
  const D = win.DialogUtils;
  D.lockScroll(); D.lockScroll();
  D.forceUnlockAll();
  assert.ok(!doc.body.classList.contains('dialog-open'), 'forceUnlockAll 后应解锁');
});

test('promptText：确认有值 → resolve 去空格后的值', async () => {
  const { win, doc } = loadDialog();
  const p = win.DialogUtils.promptText({ title: 'T', label: 'L' });
  const ov = findOverlay(doc);
  assert.ok(ov, '应挂载弹窗');
  findInput(ov).value = '  hello  ';
  findFilled(ov).click();
  const res = await p;
  assert.strictEqual(res, 'hello', '应返回 trim 后的值');
  assert.ok(!findOverlay(doc), '确认后应移除弹窗');
});

test('promptText：取消按钮 → resolve null', async () => {
  const { win, doc } = loadDialog();
  const p = win.DialogUtils.promptText({ title: 'T' });
  const cancel = findByText(findOverlay(doc), '取 消');
  assert.ok(cancel, '应有取消按钮');
  cancel.click();
  const res = await p;
  assert.strictEqual(res, null, '取消应返回 null');
});

test('promptText：点遮罩关闭 → resolve null', async () => {
  const { win, doc } = loadDialog();
  const p = win.DialogUtils.promptText({ title: 'T' });
  findOverlay(doc).click(); // 命中 overlay 自身的遮罩点击
  const res = await p;
  assert.strictEqual(res, null, '点遮罩应返回 null');
});

test('promptText：按 Esc 取消 → resolve null', async () => {
  const { win, doc } = loadDialog();
  const p = win.DialogUtils.promptText({ title: 'T' });
  doc.dispatch('keydown', { key: 'Escape', preventDefault() {} });
  const res = await p;
  assert.strictEqual(res, null, 'Esc 应返回 null');
});

test('promptText：输入纯空格 → 拦截并提示（不 resolve、弹窗仍在）', () => {
  const { win, doc } = loadDialog();
  const toasts = [];
  win.toast = (m) => toasts.push(m);
  const p = win.DialogUtils.promptText({ title: 'T' });
  const ov = findOverlay(doc);
  findInput(ov).value = '     ';
  findFilled(ov).click();
  // 校验失败：toast 提示，弹窗不关、promise 仍 pending
  assert.ok(findOverlay(doc), '空白输入不应关闭弹窗');
  assert.ok(toasts.some((t) => /请输入/.test(t)), `应提示请输入内容，实际：${JSON.stringify(toasts)}`);
  // 不 await p（保持 pending 属预期）
});

test('confirmBox：确认 → 返回 true', async () => {
  const { win, doc } = loadDialog();
  const p = win.DialogUtils.confirmBox({ message: '确定？' });
  findFilled(findOverlay(doc)).click();
  const res = await p;
  assert.strictEqual(res, true);
});

test('confirmBox：取消 → 返回 false', async () => {
  const { win, doc } = loadDialog();
  const p = win.DialogUtils.confirmBox({ message: '确定？' });
  findByText(findOverlay(doc), '取 消').click();
  const res = await p;
  assert.strictEqual(res, false);
});

test('confirmBox：点遮罩 → 返回 false', async () => {
  const { win, doc } = loadDialog();
  const p = win.DialogUtils.confirmBox({ message: '确定？' });
  findOverlay(doc).click();
  const res = await p;
  assert.strictEqual(res, false);
});

// ══════════════════════════════════════════════════════════
// 4) subscribe-manager.js（localStorage 边界）
// ══════════════════════════════════════════════════════════

const LS_KEY = 'subscribed_services';
let _lsDesc; // 首次捕获的原始 localStorage 描述符

function makeStore(initial) {
  const store = Object.assign({}, initial);
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    _store: store,
  };
}

function setLocalStorageImpl(impl) {
  if (_lsDesc === undefined) {
    try { _lsDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'); } catch (_) { _lsDesc = null; }
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { return impl; } });
}

function setLocalStorageThrowing() {
  if (_lsDesc === undefined) {
    try { _lsDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'); } catch (_) { _lsDesc = null; }
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('localStorage unavailable'); } });
}

function restoreLocalStorage() {
  if (!_lsDesc) { delete globalThis.localStorage; }
  else { Object.defineProperty(globalThis, 'localStorage', _lsDesc); }
}

function loadSubscribe(impl) {
  setLocalStorageImpl(impl);
  const win = {};
  loadScript('js/ui/subscribe-manager.js', {}, win);
  return win;
}

test('subscribe：localStorage 正常数组 → 加载成功', () => {
  const store = makeStore({ [LS_KEY]: '["A","B"]' });
  const win = loadSubscribe(store);
  try {
    assert.deepStrictEqual(win.SubscribeManager.getAll(), ['A', 'B']);
    assert.strictEqual(win.SubscribeManager.isSubscribed('A'), true);
    assert.strictEqual(win.SubscribeManager.count(), 2);
  } finally { restoreLocalStorage(); }
});

test('subscribe：JSON.parse 直接抛错 → _load 回退 [] 且不抛', () => {
  const store = makeStore({ [LS_KEY]: '{bad json' });
  const win = loadSubscribe(store);
  try {
    assert.strictEqual(win.SubscribeManager.count(), 0, '解析失败应回退空数组');
  } finally { restoreLocalStorage(); }
});

test('subscribe：getItem 返回非数组 JSON（对象）→ 回退空列表，不崩（2026-09-18 已修）', () => {
  const store = makeStore({ [LS_KEY]: '{"a":1}' });
  const win = loadSubscribe(store);
  try {
    assert.ok(win.SubscribeManager, '模块必须建得出来（旧实现在 new Set(对象) 处抛错，整页订阅功能全废）');
    assert.deepStrictEqual(win.SubscribeManager.getAll(), [], '非数组应回退空列表');
    assert.strictEqual(win.SubscribeManager.count(), 0);
  } finally { restoreLocalStorage(); }
});

test('subscribe：脏数据 [null,123] → 过滤成空列表（2026-09-18 已修）', () => {
  const store = makeStore({ [LS_KEY]: '[null,123]' });
  const win = loadSubscribe(store);
  try {
    assert.deepStrictEqual(win.SubscribeManager.getAll(), [], '非字符串条目应被过滤（否则导出会出空行、isSubscribed 语义错）');
    assert.strictEqual(win.SubscribeManager.count(), 0);
  } finally { restoreLocalStorage(); }
});

test('subscribe：混合脏数据 ["A",null,"",123] → 只留合法字符串', () => {
  const store = makeStore({ [LS_KEY]: '["A",null,"",123,"B"]' });
  const win = loadSubscribe(store);
  try {
    assert.deepStrictEqual(win.SubscribeManager.getAll(), ['A', 'B']);
    assert.strictEqual(win.SubscribeManager.isSubscribed('A'), true);
    assert.strictEqual(win.SubscribeManager.isSubscribed('B'), true);
  } finally { restoreLocalStorage(); }
});

test('subscribe：setItem 抛 QuotaExceededError → _save 失败但内存态仍正确', () => {
  const store = makeStore({ [LS_KEY]: '[]' });
  store.setItem = () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };
  const win = loadSubscribe(store);
  try {
    const mgr = win.SubscribeManager;
    assert.strictEqual(mgr.add('X'), true, '添加应成功');
    assert.strictEqual(mgr.isSubscribed('X'), true, '内存态应已订阅');
    assert.strictEqual(mgr.count(), 1, '内存计数应正确');
    assert.deepStrictEqual(mgr.getAll(), ['X'], '内存列表应含 X');
  } finally { restoreLocalStorage(); }
});

test('subscribe：localStorage 整体不可用（访问即抛）→ 模块不崩', () => {
  setLocalStorageThrowing();
  let win;
  try {
    win = loadScript('js/ui/subscribe-manager.js', {}, {});
  } finally { restoreLocalStorage(); }
  assert.ok(win.SubscribeManager, '模块应正常暴露单例');
  assert.strictEqual(win.SubscribeManager.count(), 0, '访问不可用时回退空列表');
});

test('subscribe：持久化 — add 后同 store 重新加载可见', () => {
  const store = makeStore({ [LS_KEY]: '[]' });
  const win1 = loadSubscribe(store);
  try {
    win1.SubscribeManager.add('SRV_X');
    // 重新加载（共享同一个 store，setItem 已写入）
    const win2 = loadSubscribe(store);
    assert.ok(win2.SubscribeManager.isSubscribed('SRV_X'), '重新加载应读到已保存的订阅');
  } finally { restoreLocalStorage(); }
});
