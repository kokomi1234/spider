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

test('renderEmpty：format.js 缺失时，兜底也必须真转义（不能静默零转义）', () => {
  // 单独一个 window：这次**不**先加载 format.js，逼出 table-utils 内置的那条兜底。
  // 原来兜底写成 String(s ?? '')，等于零转义 —— format.js 一旦没加载，
  // 全站 innerHTML 的 XSS 防护就静默失效，且不报错。
  const body2 = { innerHTML: '' };
  const doc2 = { querySelector: (sel) => (sel === '#resultBody' ? body2 : null) };
  const win2 = loadScript('js/ui/table-utils.js', { document: doc2 });
  win2.TableUtils.renderEmpty('<img src=x onerror=alert(1)>', 5);
  assert.ok(body2.innerHTML.includes('&lt;img'), '兜底也要转义尖括号');
  assert.ok(!body2.innerHTML.includes('<img'), '不能把标签原样写进 innerHTML');
  win2.TableUtils.renderEmpty('a"b\'c', 5);
  assert.ok(body2.innerHTML.includes('&quot;'), '双引号要转义（防属性注入）');
  assert.ok(body2.innerHTML.includes('&#39;'), '单引号也要转义');
});

test('syncEmptyOverlay / hideEmptyOverlay：页面没有浮层时静默跳过，不抛异常', () => {
  assert.strictEqual(T.syncEmptyOverlay(), false, '没有 .table-empty-overlay 时返回 false');
  T.hideEmptyOverlay();   // 不应抛错
});

// 以下 buildPageNumbers 用例从 tests/subscription-model.test.js 搬来 ——
// 该函数已移到 js/ui/table-utils.js（首页与订阅页共用）。
test('buildPageNumbers：首页 + 当前页 ±2 + 末页，中间省略号', () => {
  const btnCount = (h) => h.split('<button').length - 1;
  const dots = (h) => h.split('page-ellipsis').length - 1;

  // 只有一页：单个按钮，无省略号
  const one = T.buildPageNumbers(1, 1);
  assert.strictEqual(btnCount(one), 1);
  assert.strictEqual(dots(one), 0);
  assert.ok(one.indexOf('data-page="1" class="is-current" aria-current="page">1') > -1);

  // 页数少：全列
  assert.strictEqual(btnCount(T.buildPageNumbers(3, 2)), 3);
  assert.strictEqual(dots(T.buildPageNumbers(3, 2)), 0);

  // 首页：1~3 + 末页 10，中间一个省略号
  const first = T.buildPageNumbers(10, 1);
  assert.strictEqual(btnCount(first), 4);
  assert.strictEqual(dots(first), 1);
  assert.ok(first.indexOf('data-page="10"') > -1);

  // 中间页 5：1 / …… / 3~7 / …… / 10
  const mid = T.buildPageNumbers(10, 5);
  assert.strictEqual(btnCount(mid), 7);
  assert.strictEqual(dots(mid), 2);
  assert.ok(mid.indexOf('data-page="5" class="is-current" aria-current="page">5') > -1);
  // 当前页以外的按钮不带 is-current，也不带 aria-current（清单 A9：只该标当前页）
  assert.strictEqual(mid.split('is-current').length - 1, 1);
  assert.strictEqual(mid.split('aria-current="page"').length - 1, 1);

  // 末页：倒数三页 + 首页
  assert.strictEqual(btnCount(T.buildPageNumbers(10, 10)), 4);

  // 乱序/越界入参不炸且不产生越界按钮
  const weird = T.buildPageNumbers(10, 99);
  assert.strictEqual(weird.indexOf('data-page="99"'), -1);
  assert.strictEqual(weird.indexOf('data-page="0"'), -1);
  assert.strictEqual(T.buildPageNumbers(1, 1).indexOf('data-page="0"'), -1);
});
