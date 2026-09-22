'use strict';
/**
 * 结果表「折行 + 点击复制 + 键盘漫游」共用模块（js/ui/copy-cells.js）。
 *
 * 这套原来是订阅页私有的（清单 B9），2026-09-23 抽成三页共用，并据此删掉了
 * 发布页/任务单页/订阅页上「悬停看全文」的 title（`memory.md` §1）。
 * 之所以在 node 里测而不是只靠冒烟：漫游的下标算术（左右不跨行、上下不越表）
 * 与「重复 bind 不叠监听」这类是纯逻辑，真浏览器反而难精确断言。
 */
const assert = require('assert');
const { loadScript, test } = require('./harness');

function fakeEl(opts) {
  const o = opts || {};
  const classes = new Set((o.cls || '').split(' ').filter(Boolean));
  const el = {
    dataset: o.dataset || {},
    tabIndex: -1,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); },
    },
    _classes: classes,
    focus() { el._focused = true; },
    closest(sel) {
      if (sel === '.copy-cell') return classes.has('copy-cell') ? el : null;
      return null;
    },
    parentElement: o.row || null,
  };
  return el;
}

/** 一张 2 行 × 3 列的可复制格 + 一个能记监听的 tbody 替身 */
function fakeTable() {
  const rows = [0, 1].map(() => ({
    querySelectorAll: (sel) => (sel === '.copy-cell' ? [] : []),
  }));
  const cells = [];
  rows.forEach((row, r) => {
    const rowCells = [];
    for (let c = 0; c < 3; c += 1) {
      const td = fakeEl({ cls: 'copy-cell cell-wrap', dataset: { copy: `R${r}C${c}` } });
      td.parentElement = row;
      rowCells.push(td);
      cells.push(td);
    }
    row.querySelectorAll = (sel) => (sel === '.copy-cell' ? rowCells : []);
  });
  const listeners = {};
  const body = {
    dataset: {},
    cells,
    rows,
    querySelectorAll: (sel) => (sel === '.copy-cell' ? cells : []),
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    fire(type, ev) { (listeners[type] || []).forEach((f) => f(ev)); },
    count(type) { return (listeners[type] || []).length; },
  };
  return body;
}

function clickOn(td) {
  return { target: td, stopPropagation() { this.stopped = true; } };
}

function keyOn(td, key) {
  let prevented = false;
  return {
    key, target: td,
    preventDefault() { prevented = true; },
    stopPropagation() {},
    _prevented: () => prevented,
  };
}

const loaded = (() => {
  const win = {};
  loadScript('js/ui/copy-cells.js', {}, win);
  return win.CopyCells;
})();

test('copy-cells：点击可复制格 → 回传该格 data-copy 并阻止冒泡；点非格子不回传', () => {
  const body = fakeTable();
  const got = [];
  loaded.bind(body, { onCopy: (t) => got.push(t) });

  const ev = clickOn(body.cells[1]);
  body.fire('click', ev);
  assert.deepStrictEqual(got, ['R0C1'], '复制的应该是被点那一格的值');
  assert.strictEqual(ev.stopped, true, '必须阻止冒泡，否则会顺带触发行点击/详情弹窗');

  body.fire('click', clickOn(fakeEl({ cls: '' })));
  assert.strictEqual(got.length, 1, '点到普通格不该再触发复制');

  const empty = clickOn(fakeEl({ cls: 'copy-cell', dataset: {} }));
  body.fire('click', empty);
  assert.strictEqual(got.length, 1, 'data-copy 为空的格子不该调复制');
});

test('copy-cells：Enter 复制、方向键漫游不跨行不越表（B9 的下标算术）', () => {
  const body = fakeTable();
  const got = [];
  loaded.bind(body, { onCopy: (t) => got.push(t) });

  const evEnter = keyOn(body.cells[0], 'Enter');
  body.fire('keydown', evEnter);
  assert.deepStrictEqual(got, ['R0C0'], 'Enter 要复制当前格');
  assert.strictEqual(evEnter._prevented(), true, 'Enter 必须 preventDefault，否则会被「回车即查询」抢走');

  body.fire('keydown', keyOn(body.cells[0], 'ArrowRight'));          // → R0C1
  body.fire('keydown', keyOn(body.cells[1], 'ArrowRight'));          // → R0C2
  body.fire('keydown', keyOn(body.cells[2], 'ArrowRight'));          // 行尾，不许跳到下一行
  assert.strictEqual(body.cells[2].tabIndex, 0, '左右漫游不能跨行（横向滚动位置会被打乱）');

  body.fire('keydown', keyOn(body.cells[2], 'ArrowDown'));           // → R1C2
  assert.strictEqual(body.cells[5].tabIndex, 0, '向下要落在同一列的下一行');
  assert.strictEqual(body.cells[5].dataset.copy, 'R1C2');
  body.fire('keydown', keyOn(body.cells[5], 'ArrowDown'));
  assert.strictEqual(body.cells[5].tabIndex, 0, '最后一行往下不越表');

  body.fire('keydown', keyOn(body.cells[0], 'Tab'));                 // Tab 交回浏览器
  assert.strictEqual(body.cells[0].tabIndex, -1, 'Tab 不该被漫游接管');

  const focusable = body.cells.filter((td) => td.tabIndex === 0);
  assert.strictEqual(focuses(focusable), 1, '整张表只能有一个 Tab 停靠点');
  function focuses(n) { return n.length; }
});

test('copy-cells：重复 bind 不叠加监听（每次重渲染都会调），且归零到第一格', () => {
  const body = fakeTable();
  loaded.bind(body, { onCopy: () => {} });
  loaded.bind(body, { onCopy: () => {} });
  loaded.bind(body, { onCopy: () => {} });
  assert.strictEqual(body.count('click'), 1, 'click 监听只该挂一次（格子每次都是新 DOM）');
  assert.strictEqual(body.count('keydown'), 1, 'keydown 同理');
  assert.strictEqual(body.cells[0].tabIndex, 0, '重渲染后漫游回到第一格');
  assert.ok(body.cells[0]._classes.has('is-copy-focus'), '当前格要带焦点样式');
});

test('copy-cells：HTTP 非安全上下文没有 navigator.clipboard → 走 execCommand 兜底', () => {
  // 内网是 http://itamp 这种非安全上下文，navigator.clipboard 是 undefined；
  // 原来订阅导出按钮就因此「点了没反应」（见 subscribe-ui.js 的同款教训）。
  let copied = 0;
  let removed = 0;
  const doc = {
    createElement() {
      return { value: '', style: {}, setAttribute() {}, select() {}, focus() {} };
    },
    body: { appendChild() {}, removeChild() { removed += 1; } },
    execCommand() { copied += 1; return true; },
  };
  const win = {};
  loadScript('js/ui/copy-cells.js', { document: doc }, win);
  win.CopyCells.copyText('长编码-E00301');
  assert.strictEqual(copied, 1, '没有 clipboard 时必须落到 execCommand');
  assert.strictEqual(removed, 1, '临时 textarea 要撤掉，不然每次复制留一个幽灵节点');

  // clipboard 可用时走 Promise 那条路，不该同步抛
  win.navigator = { clipboard: { writeText: () => ({ then: (f) => { f(); return { catch() {} }; } }) } };
  let clipboardUsed = 0;
  win.navigator.clipboard.writeText = (t) => { clipboardUsed += 1; return Promise.resolve(t); };
  win.CopyCells.copyText('x');
  assert.strictEqual(clipboardUsed, 1, '有 clipboard 时优先用它');
});

test('copy-cells：容器缺能力时安静跳过，不抛（冒烟 / 半挂 DOM）', () => {
  assert.doesNotThrow(() => loaded.bind(null));
  assert.doesNotThrow(() => loaded.bind({}));
  assert.deepStrictEqual(loaded.cellsOf(null), []);
});
