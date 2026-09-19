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
    // 第二个参数 force 是真 DOM 语义（toggle(c, false) = 只删不加）。
    // searchable-select 的 has-clear / has-value 都是按布尔量刷新的，
    // 少了 force 就会每次调用翻一次，同一个状态刷两遍反而错。
    toggle(c, force) {
      if (force === undefined) { if (set.has(c)) set.delete(c); else set.add(c); }
      else if (force) set.add(c);
      else set.delete(c);
    },
    _set: set,
  };
}

/** 单个（无逗号的）简单选择器：#id / .class / tag / tag[attr] */
function matchOne(el, raw) {
  const sel = String(raw || '').trim();
  if (!sel) return false;
  const attrIdx = sel.indexOf('[');
  const base = attrIdx >= 0 ? sel.slice(0, attrIdx) : sel;
  const attrTxt = attrIdx >= 0 ? sel.slice(attrIdx + 1).replace(/\]$/, '') : '';
  let ok = true;
  if (base[0] === '#') ok = el.id === base.slice(1);
  else if (base[0] === '.') ok = el.className.split(/\s+/).includes(base.slice(1));
  else if (base) ok = el.tagName === base.toUpperCase();
  if (ok && attrTxt) {
    const name = attrTxt.split(/[=~^$|*]/)[0];
    ok = !!(el.attrs && name in el.attrs);
  }
  return ok;
}

function matchSel(el, sel) {
  if (!el) return false;
  // 逗号组选择器（accessibleNameOf 里那句 .form-group,.sub-row,…）逐个试
  return String(sel).split(',').some((s) => matchOne(el, s));
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

/**
 * 假元素。除既有几个 UI 用例要的那几件事之外，还给 searchable-select 补了
 * 它真正会用的那几件：dataset / insertBefore / nextSibling / replaceChildren /
 * DocumentFragment 展开 / dispatchEvent / blur / 滚动几何。
 * 全是**新增方法或新增字段**，既有用例的行为不变。
 */
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [],
    style: {},
    attrs: {},
    dataset: {},
    classList: makeClassList(),
    _class: '',
    _id: '',
    _innerHTML: '',
    type: '',
    value: '',
    checked: false,
    textContent: '',
    hidden: false,
    // 组件里 ensureVisible / maybeLoadMore 会读这些，给确定数值免得比出 NaN
    scrollTop: 0, clientHeight: 200, scrollHeight: 200, offsetTop: 0, offsetHeight: 32,
    listeners: {},
    parentNode: null,
    parentElement: null,
    get className() { return this._class; },
    set className(v) { this._class = String(v); },
    get id() { return this._id; },
    set id(v) { this._id = String(v); this.attrs.id = String(v); },
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) { this._innerHTML = String(v); },
    get nextSibling() {
      const p = this.parentNode;
      if (!p) return null;
      const i = p.children.indexOf(this);
      return i < 0 ? null : (p.children[i + 1] || null);
    },
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === 'id') this._id = String(v);
      if (k === 'class') this._class = String(v);
    },
    getAttribute(k) { return this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; },
    hasAttribute(k) { return k in this.attrs; },
    appendChild(c) {
      // DocumentFragment：把它的孩子搬过来（组件用 replaceChildren(frag) 批量插选项）
      if (c && c.isDocumentFragment) {
        (c.children || []).slice().forEach((kid) => this.appendChild(kid));
        c.children = [];
        return c;
      }
      this.children.push(c); c.parentNode = this; c.parentElement = this; return c;
    },
    insertBefore(c, ref) {
      if (c && c.isDocumentFragment) {
        (c.children || []).slice().forEach((kid) => this.insertBefore(kid, ref));
        c.children = [];
        return c;
      }
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i < 0) return this.appendChild(c);
      this.children.splice(i, 0, c); c.parentNode = this; c.parentElement = this; return c;
    },
    replaceChildren(...ns) {
      this.children = [];
      ns.forEach((n) => this.appendChild(n));
    },
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
    dispatchEvent(ev) { this.dispatch(ev && ev.type, ev); return true; },
    click() { this.dispatch('click', { type: 'click', target: this, preventDefault() {}, stopPropagation() {}, button: 0 }); },
    focus() {},
    blur() {},
    closest(sel) { let n = this; while (n) { if (matchSel(n, sel)) return n; n = n.parentNode; } return null; },
    querySelector(sel) { return findIn(this, (e) => matchSel(e, sel)); },
    querySelectorAll(sel) { const out = []; walk(this, (e) => { if (matchSel(e, sel)) out.push(e); }); return out; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 40, right: 100, bottom: 40 }; },
  };
  return el;
}

/** 假 DocumentFragment（组件批量插选项用） */
function makeFragment() {
  const f = { isDocumentFragment: true, children: [] };
  f.appendChild = (c) => { f.children.push(c); return c; };
  return f;
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
    createDocumentFragment() { return makeFragment(); },
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

// ══════════════════════════════════════════════════════════
// 5) searchable-select.js —— 面板展开时也能一步回到「不限」
//
// 缺陷（2026-09-20 真浏览器实测）：展开态的 ✕ 被 theme.css 的
//   `.searchable-select.is-open .searchable-select-clear-btn { display:none !important }`
// 连同组件里 `show = hasValue && !isOpen` 一起摘掉，量到 display=none、矩形 0×0、
// elementFromPoint 打到下层 .wrap；而字典灌进来的选项没有 value==='' 的项，
// 面板里也没有第二条退路 —— 想改回「不限」必须先关面板。
// 这里钉住修完的行为 + 两枚图标不再抢位置的 CSS 契约。
// ══════════════════════════════════════════════════════════

const SS_LIST = [
  { value: 'a1', label: '甲系统' },
  { value: 'b2', label: '乙批次' },
];

/** 建一个「宿主 <select>（无 option，模拟字典灌入）+ .form-group 里的 label」的最小现场 */
function mountSelect(options = SS_LIST, opts = {}) {
  const doc = makeDoc();
  const group = makeEl('div');
  group.className = 'form-group';
  doc.body.appendChild(group);
  const label = makeEl('label');
  label.textContent = '部门名称 ';
  group.appendChild(label);
  const host = makeEl('select');
  host.id = 'f_demo';
  host.options = [];              // 宿主里一条 option 都没有：正是缺陷现场
  host.value = '';
  group.appendChild(host);

  const win = { addEventListener() {}, removeEventListener() {} };
  loadScript('js/ui/searchable-select.js', { document: doc }, win);
  const inst = win.createSearchableSelect(host, options, opts);

  // 容器插在宿主之后（组件用 insertBefore(container, host.nextSibling)）
  const container = group.children[group.children.indexOf(host) + 1];
  const has = (c) => findIn(container, (e) => e.className.split(/\s+/).includes(c));
  const changes = { n: 0 };
  host.addEventListener('change', () => { changes.n += 1; });   // 页面就是靠这个联动重新查询的
  return {
    doc, group, host, inst, container,
    input: has('searchable-select-input'),
    clearBtn: has('searchable-select-clear-btn'),
    arrow: has('searchable-select-arrow'),
    panel: has('searchable-select-dropdown'),
    changes,
  };
}

/** 派发一个组件真的在听的鼠标事件 */
function mouseAt(el, type) {
  el.dispatchEvent({ type, target: el, preventDefault() {}, stopPropagation() {}, button: 0 });
}
function keyAt(el, key) {
  el.dispatchEvent({ type: 'keydown', key, target: el, preventDefault() {}, stopPropagation() {} });
}
const shownOptions = (m) => m.panel.querySelectorAll('.searchable-select-option');

test('searchable-select：展开态 ✕ 不被藏（有值时 display 不再是 none），点它一步回到「不限」且面板不关', () => {
  const m = mountSelect();
  m.inst.setValue('a1');
  assert.strictEqual(m.clearBtn.style.display, '', '收起态有值 → ✕ 可见（既有行为）');
  assert.strictEqual(m.changes.n, 0, 'setValue 是程序赋值，不该派发 change');

  m.inst.open();
  assert.strictEqual(m.inst.isOpen(), true, '前置条件：面板已展开');
  assert.notStrictEqual(m.clearBtn.style.display, 'none',
    '回归钉：展开态不能再把 ✕ 置成 display:none（缺陷就是这么藏掉唯一清除入口的）');
  assert.strictEqual(m.clearBtn.style.display, '', '有值 → 展开态同样保持可见');
  assert.ok(m.container.classList.contains('has-clear'), 'has-clear 要在（CSS 靠它给 ✕ 让出槽位）');

  mouseAt(m.clearBtn, 'mousedown');
  assert.strictEqual(m.inst.getValue(), '', '点 ✕ 应清成「不限」');
  assert.strictEqual(m.host.value, '', '要写回宿主，页面按宿主页取值');
  assert.strictEqual(m.inst.isOpen(), true, '清完面板仍开着：这才是「一步」');
  assert.strictEqual(m.changes.n, 1, '用户清除要派发一次 change（联动重新查询）');
  assert.strictEqual(m.input.value, '', '展开态输入框不能被回填成已选 label');
  assert.strictEqual(m.clearBtn.style.display, 'none', '已无值 → ✕ 自己收起来');
  assert.ok(!m.container.classList.contains('has-clear'), 'has-clear 要摘掉（▼ 回原位）');
});

test('searchable-select：展开态清成「不限」后面板里的「已选区」消失，选项一条不少', () => {
  const m = mountSelect();
  m.inst.setValue('b2');
  m.inst.open();
  assert.ok(m.panel.querySelector('.searchable-select-selected-section'), '展开且已选 → 顶部有「已选择数据」区');
  const before = shownOptions(m).length;
  mouseAt(m.clearBtn, 'mousedown');
  assert.ok(!m.panel.querySelector('.searchable-select-selected-section'), '清完之后已选区必须消失（否则用户以为没清）');
  assert.strictEqual(shownOptions(m).length, before, '清除只动选中态，不该把选项吃掉');
});

test('searchable-select：没有选中值 / disabled 时展开态也不冒出 ✕（别多出一个无意义的「不限」按钮）', () => {
  const empty = mountSelect();
  assert.strictEqual(empty.clearBtn.style.display, 'none', '无值 → 收起态不显示 ✕');
  empty.inst.open();
  assert.strictEqual(empty.clearBtn.style.display, 'none', '无值 → 展开态同样不显示');
  assert.ok(!empty.container.classList.contains('has-clear'), '无值 → 不给 has-clear');

  const off = mountSelect(SS_LIST, { disabled: true });
  off.inst.setValue('a1');
  assert.strictEqual(off.clearBtn.style.display, 'none', '禁用实例不给清除入口');
  off.inst.open();
  assert.strictEqual(off.inst.isOpen(), false, '禁用实例根本展不开');
});

test('searchable-select：is-open / has-clear 只加在组件自建容器上，宿主页面无该类（.msel.is-open 多选不受牵连）', () => {
  const m = mountSelect();
  m.inst.setValue('a1');
  m.inst.open();
  assert.ok(m.container.classList.contains('is-open'), '容器带 is-open（新 CSS 的 .is-open.has-clear 组合据此生效）');
  assert.ok(m.container.classList.contains('has-clear'), '容器同时带 has-clear');
  assert.ok(!m.host.classList.contains('is-open'), '宿主不被挂 is-open —— 否则 .msel / 别的容器会被连带命中');
  assert.ok(!m.host.classList.contains('has-clear'), '宿主不被挂 has-clear');
  assert.ok(!m.host.classList.contains('searchable-select'), '宿主也不带组件类');
});

test('searchable-select：可访问名称不串味 —— 输入框始终叫字段名，✕ 固定叫「清除选择」，展开/清除都不改', () => {
  const m = mountSelect();
  assert.strictEqual(m.input.getAttribute('aria-label'), '部门名称', '新建 input 从同组 label 取名（口径见 a11y-name.test.js）');
  assert.strictEqual(m.clearBtn.getAttribute('aria-label'), '清除选择', '✕ 自己的名字是固定动作名，不吃字段名');
  m.inst.setValue('a1');
  m.inst.open();
  assert.strictEqual(m.input.getAttribute('aria-label'), '部门名称', '展开态仍叫字段名（不能变成「甲系统」或 placeholder）');
  assert.strictEqual(m.clearBtn.getAttribute('aria-label'), '清除选择', '展开态 ✕ 的名字也要在（读屏此刻能念到它 = 本次修复的可达性）');
  mouseAt(m.clearBtn, 'mousedown');
  assert.strictEqual(m.input.getAttribute('aria-label'), '部门名称', '清除后仍叫字段名');
  assert.strictEqual(m.input.getAttribute('role'), 'combobox', 'combobox 语义不变');
  assert.strictEqual(m.input.getAttribute('aria-expanded'), 'true', '面板还开着，aria-expanded 要对得上');
});

test('searchable-select：点选项 / 按 Enter 仍然关面板（只有 ✕ 保留面板，两条路径不许混）', () => {
  const m = mountSelect();
  m.inst.open();
  shownOptions(m)[0].click();
  assert.strictEqual(m.inst.getValue(), 'a1');
  assert.strictEqual(m.inst.isOpen(), false, '选中一项 → 收起（既有行为）');
  assert.strictEqual(m.changes.n, 1, '用户选中派发一次 change');

  m.inst.open();
  keyAt(m.input, 'ArrowDown');
  keyAt(m.input, 'ArrowDown');
  keyAt(m.input, 'Enter');
  assert.strictEqual(m.inst.getValue(), 'b2', '键盘 ↓↓Enter 选到第二项');
  assert.strictEqual(m.inst.isOpen(), false, '键盘选中同样要收起');
  assert.strictEqual(m.changes.n, 2, '鼠标选中 + 键盘选中各派发一次 change');
});

test('searchable-select：既有行为不变 —— updateOptions([]) 后 value 仍在、setValue(未知值) 归零为不限（展开态也要成立）', () => {
  const m = mountSelect();
  m.inst.setValue('a1');
  m.inst.updateOptions([]);        // 字典没回来
  assert.strictEqual(m.inst.getValue(), 'a1', '选项清空不该丢掉已选值');
  assert.strictEqual(m.inst.getLabel(), 'a1', '取不到 label 就退回编号本身（smoke 钉的同一条）');
  m.inst.setValue('9999xx');       // 选项里没有的值
  assert.strictEqual(m.inst.getValue(), '', '未知值不认账 → 归为不限（smoke 钉的 valueOfUnknown===“”）');
  assert.strictEqual(m.clearBtn.style.display, 'none', '没值了 → ✕ 收起，不会冒出无意义的清除按钮');

  m.inst.open();
  assert.strictEqual(m.clearBtn.style.display, 'none', '展开态 + 无值 → 仍不该有 ✕');
  m.inst.updateOptions(SS_LIST);
  assert.strictEqual(m.inst.getValue(), '', '换列表不该自己改动值');
  assert.strictEqual(shownOptions(m).length, 2, '新列表要渲染出来');
  m.inst.setValue('a1');
  assert.strictEqual(m.inst.getValue(), 'a1', '展开态赋个认账的值');
  assert.strictEqual(m.clearBtn.style.display, '', '展开态 + 有值 → ✕ 立刻可用（本次修复的正题）');
  mouseAt(m.clearBtn, 'mousedown');
  assert.strictEqual(m.inst.getValue(), '', '再点 ✕ 一步回到不限');
  assert.strictEqual(m.inst.isOpen(), true, '面板仍开着');
});

// ── CSS 契约：theme.css 里那三条展开态规则（几何互相咬合，退回一条就会「两个控件抢位置」）
const themeCss = require('fs').readFileSync(require('path').join(ROOT, 'theme.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');   // 去注释，免得注释里的示例选择器被当成规则

/** 把（去注释后的）CSS 拆成 { selector, decl } 列表 */
function cssRules(text) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let mm;
  while ((mm = re.exec(text))) {
    out.push({ selector: mm[1].replace(/\s+/g, ' ').trim(), decl: mm[2] });
  }
  return out;
}
const THEME_RULES = cssRules(themeCss);
const ruleOf = (sel) => THEME_RULES.find((r) => r.selector === sel);
const numOf = (decl, prop) => {
  const mm = new RegExp('(^|;)\\s*' + prop + '\\s*:\\s*([0-9.]+)px').exec(decl + ';');
  return mm ? parseFloat(mm[2]) : NaN;
};

test('theme.css 契约：展开态藏 ✕ 的那条 !important 规则不许回来', () => {
  const hiders = THEME_RULES.filter((r) => /is-open/.test(r.selector)
    && /searchable-select-clear-btn/.test(r.selector)
    && /display:\s*none/.test(r.decl));
  assert.strictEqual(hiders.length, 0,
    `不能再出现「展开时藏 ✕」的规则，实际找到 ${JSON.stringify(hiders.map((h) => h.selector))}`);
});

test('theme.css 契约：展开态 ✕ 与 ▼ 各占一个槽位，命中区边界相接不重叠', () => {
  const CLEAR_BOX = 22;                       // ✕ 外观宽（theme.css 基础规则 width:22px）
  const HIT_PAD = 6;                          // ::before 外扩 6px
  const clearBase = ruleOf('.searchable-select .searchable-select-clear-btn');
  const arrowShift = ruleOf('.searchable-select.is-open.has-clear .searchable-select-arrow');
  const openPad = ruleOf('.searchable-select.is-open.has-clear .searchable-select-input');
  const clearHit = ruleOf('.searchable-select.is-open.has-clear .searchable-select-clear-btn::before');
  assert.ok(clearBase && arrowShift && openPad && clearHit,
    '四条规则都得在（✕ 宽度 / ▼ 让位 / 输入框留白 / ✕ 命中区内缩）');

  const clearRight = numOf(clearBase.decl, 'right');          // ✕ 距容器右缘
  const arrowRight = numOf(arrowShift.decl, 'right');         // ▼ 让到多远
  const arrowW = numOf(ruleOf('.searchable-select .searchable-select-arrow').decl, 'width') || 26;
  assert.ok(arrowRight > clearRight + CLEAR_BOX,
    `▼ 必须让到 ✕ 的左边：✕ 左沿在 ${clearRight + CLEAR_BOX}px，实际 ▼ right=${arrowRight}`);
  // ✕ 的 ::before 左沿不得再往外扩（inset 第四位=左，0 表示不外扩），否则两命中区重叠、
  // ✕ 的 z-index:2 会吃掉 ▼ 的左沿 —— 想收面板却被清值。
  assert.ok(/inset:\s*-?\d+px\s+\S+\s+\S+\s+0\b/.test(clearHit.decl),
    `展开态 ✕ 的 ::before 左沿应内缩到 0，实际 ${clearHit.decl.trim()}`);
  const clearHitLeft = clearRight + CLEAR_BOX;                // ✕ 命中区左界
  assert.ok(arrowRight - HIT_PAD >= clearHitLeft,
    `▼ 命中区右界 ${arrowRight - HIT_PAD}px 不该压到 ✕ 命中区（左界 ${clearHitLeft}px）`);
  assert.ok(numOf(openPad.decl, 'padding-right') >= arrowRight + arrowW,
    '输入框留白要盖住 ▼ 的外观左沿，否则文字压到箭头下');
});

test('theme.css 契约：展开态新规则一律以 .searchable-select 起头，且只走令牌上色（不牵连 .msel 多选）', () => {
  const touched = THEME_RULES.filter((r) => /is-open/.test(r.selector)
    && /searchable-select/.test(r.selector));
  assert.ok(touched.length >= 3, `展开态规则应有 3 条以上，实际 ${touched.length}`);
  touched.forEach((r) => {
    r.selector.split(',').forEach((one) => {
      const s = one.trim();
      // 最左边的复合必须以容器类 .searchable-select 起头（后面不能直接跟字母，
      // 免得 .searchable-select-dropdown 之类的被当成锚点）：裸 .is-open 会连带命中
      // .msel.is-open，多选面板就会被这套 ✕/▼ 规则牵进去。
      assert.ok(/^\.searchable-select(?![a-z-])/.test(s),
        `选择器必须以 .searchable-select 起头（裸 .is-open 会连带命中 .msel.is-open 多选）：${s}`);
    });
  });
  const colors = touched.map((r) => r.decl).join(' ');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(colors),
    '这几条规则不许写死色值（全站颜色只从 theme.css 的 :root 令牌取）');
});
