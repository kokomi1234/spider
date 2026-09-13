/**
 * table-utils.js 单测：分页页数计算、空状态的 colspan / 转义 / 分页条显隐。
 */
'use strict';

const { loadScript, test } = require('./harness');
const assert = require('assert');

// renderEmpty 依赖 #resultBody / #pagination
const bodyEl = { innerHTML: '' };
const barEl = { style: {} };
const docStub = {
  querySelector: (sel) => {
    if (sel === '#resultBody') return bodyEl;
    if (sel === '#pagination') return barEl;
    return null;
  },
};

// 复用同一个 window：先加载真正的 format.js，让 table-utils 用到真的 Fmt.esc，
// 而不是在测试里手写一个「看起来对」的转义桩
const win = loadScript('js/core/format.js', { document: docStub });
loadScript('js/ui/table-utils.js', { document: docStub }, win);
const T = win.TableUtils;

test('totalPages：向上取整，且至少 1 页', () => {
  assert.strictEqual(T.totalPages(100, 50), 2);
  assert.strictEqual(T.totalPages(101, 50), 3, '余数也要算一页');
  assert.strictEqual(T.totalPages(0, 50), 1, '0 条时也不能是 0 页');
  assert.strictEqual(T.totalPages(0, 0), 1, 'pageSize 为 0 时不能崩');
});

test('renderEmpty：占满 colspan、带 empty-hint、隐藏分页条', () => {
  bodyEl.innerHTML = '';
  barEl.style.display = '';
  T.renderEmpty('没有数据', 24);
  assert.ok(bodyEl.innerHTML.includes('colspan="24"'));
  assert.ok(bodyEl.innerHTML.includes('没有数据'));
  assert.ok(bodyEl.innerHTML.includes('empty-hint'));
  assert.strictEqual(barEl.style.display, 'none');
});

test('renderEmpty：文本经 esc 转义，防注入', () => {
  T.renderEmpty('<b>x</b>', 13);
  assert.ok(bodyEl.innerHTML.includes('&lt;b&gt;'), '尖括号要转义');
  assert.ok(!bodyEl.innerHTML.includes('<b>'), '原文标签不能原样输出');
});
