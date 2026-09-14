/**
 * 订阅页表格结构一致性（纯文本断言，不需要浏览器）
 *
 * 起因：2026-09-14 发现 colgroup 有 25 个 <col>、thead 只有 24 个 <th>（多一个），
 * min-width 也与实际列宽之和对不上。这种错位在页面上完全看不出来，却会让
 * js/ui/table-resize.js 直接放弃绑定（它要求 col 与 th 个数相等）—— 列宽拖拽静默失效。
 * 列宽与 sticky left 偏移同样是「改了 colgroup 忘了改 CSS」的高危处，一并守住。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ROOT, test } = require('./harness');

const html = fs.readFileSync(path.join(ROOT, 'subscription.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'js/page/subscription.js'), 'utf8');

const pick = (re) => {
  const m = re.exec(html);
  assert.ok(m, '没匹配到：' + re);
  return m[1];
};

const style = pick(/<style>([\s\S]*?)<\/style>/);
const colgroup = pick(/<colgroup>([\s\S]*?)<\/colgroup>/);
const thead = pick(/<thead>([\s\S]*?)<\/thead>/);

const cols = [...colgroup.matchAll(/<col\b([^>]*)>/g)].map((m) => m[1]);
const ths = [...thead.matchAll(/<th\b[^>]*>/g)];
const widths = cols.map((attr) => {
  const m = /width:\s*(\d+)px/.exec(attr);
  assert.ok(m, '每个 <col> 都要写死宽度（table-resize 靠它取默认值）：' + attr);
  return Number(m[1]);
});
const fixedClasses = ['col-prio', 'col-st', 'col-review', 'col-name', 'col-coding'];

test('colgroup 的 <col> 个数与 thead 的 <th> 个数必须相等', () => {
  assert.strictEqual(cols.length, ths.length,
    `col=${cols.length} vs th=${ths.length}；不等会让 table-resize.js 静默不绑定`);
});

test('.subq-table 的 min-width 等于所有列宽之和', () => {
  const rule = pick(/\.subq-table\s*\{([\s\S]*?)\}/);
  const minWidth = Number(/min-width:\s*(\d+)px/.exec(rule)[1]);
  const sum = widths.reduce((a, b) => a + b, 0);
  assert.strictEqual(minWidth, sum, `min-width=${minWidth}，列宽之和=${sum}`);
});

test('空态的 colspan 覆盖全部列', () => {
  const colspan = Number(/<td colspan="(\d+)" class="empty-hint">/.exec(html)[1]);
  assert.strictEqual(colspan, cols.length, `colspan=${colspan}，实际列数=${cols.length}`);
});

test('每个左固定列的 sticky left 等于它前面所有列宽之和', () => {
  let acc = 0;
  fixedClasses.forEach((cls, i) => {
    const idx = cols.findIndex((attr) => attr.includes(cls));
    assert.ok(idx >= 0, `<colgroup> 里缺少固定列 ${cls}`);
    if (i > 0) assert.ok(idx > cols.findIndex((a) => a.includes(fixedClasses[i - 1])),
      `${cls} 必须排在 ${fixedClasses[i - 1]} 之后（left 偏移是累加的）`);
    acc = widths.slice(0, idx).reduce((a, b) => a + b, 0);
    // left 允许写成 0（省略 px）
    const rule = new RegExp(`\\.subq-table td\\.${cls}\\s*\\{\\s*left:\\s*(\\d+)(?:px)?`);
    const m = rule.exec(style);
    assert.ok(m, `CSS 里没找到 td.${cls} 的 left 偏移`);
    assert.strictEqual(Number(m[1]), acc, `td.${cls} 的 left 应为 ${acc}px（前面列宽之和）`);
  });
});

test('左固定列在 <th> 上也带同一套类名，且 JS 侧登记齐全', () => {
  const headClasses = ths.map((m) => m[0]);
  fixedClasses.forEach((cls) => {
    assert.ok(headClasses.some((h) => h.includes(cls)), `<th> 上缺少 ${cls}`);
    assert.ok(js.includes(`'${cls}'`), `subscription.js 的固定列映射里缺少 ${cls}`);
  });
});
