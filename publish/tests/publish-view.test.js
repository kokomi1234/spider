/**
 * publish-view.js 单测：覆盖从 index.js 抽出的 HTML 字符串生成。
 * 纯输入→输出，不涉及任何 DOM 写入。
 *
 * 复用同一个 window 先加载 publish-model.js，让 view 能用到 PublishModel.normalizeRow
 * 等纯函数（与浏览器里脚本加载顺序一致：model 先于 view）。
 */
'use strict';

const { loadScript, test } = require('./harness');
const assert = require('assert');

const win = loadScript('js/page/publish-model.js');
loadScript('js/page/publish-view.js', {}, win);
const V = win.PublishView;
const PM = win.PublishModel;

const SAMPLE = {
  serverCoding: 'S1', sysServeNo: 'N1', serviceName: '名字',
  interfaceCode: 'I1', isChecked: '1', deptName: '财务',
  offerServerState: '运行中',
};

test('PublishView：暴露预期接口', () => {
  ['stateBadge', 'emptyRow', 'renderRows'].forEach((k) =>
    assert.strictEqual(typeof V[k], 'function', '缺少 ' + k));
  assert.strictEqual(Object.isFrozen(V), true);
});

test('stateBadge：状态→徽章 HTML，空值兜底', () => {
  assert.strictEqual(V.stateBadge('正式版基线'), '<span class="badge b-run">正式版基线</span>');
  assert.strictEqual(V.stateBadge('运行中'), '<span class="badge b-run">运行中</span>');
  assert.strictEqual(V.stateBadge(''), '<span class="badge b-off">未设置</span>');
  // 含特殊字符时转义（无 Fmt 时退化为 String，但仍验证结构）
  assert.strictEqual(V.stateBadge('a&b').includes('a&b'), true);
});

test('emptyRow：生成 colspan 空态行', () => {
  assert.strictEqual(V.emptyRow(10, 'x'), '<tr><td colspan="10" class="empty-hint">x</td></tr>');
});

test('renderRows：未订阅 → 未订阅标记 + 订阅按钮 + 绝对下标', () => {
  const html = V.renderRows([SAMPLE], {
    pageNum: 1, pageSize: 20, checkSubscribe: () => 'unsubscribed',
  });
  assert.strictEqual(html.includes('data-code="S1"'), true);
  assert.strictEqual(html.includes('<td class="cell-index">1</td>'), true);
  assert.strictEqual(html.includes('<span class="cell-primary-code">S1</span>'), true);
  assert.strictEqual(html.includes('接口：I1'), true);     // 副编码
  assert.strictEqual(html.includes('<span class="badge b-run">运行中</span>'), true);
  assert.strictEqual(html.includes('<span class="badge b-run">是</span>'), true);   // isChecked=1
  assert.strictEqual(html.includes('✗ 未订阅'), true);
  assert.strictEqual(html.includes('data-detail="0"'), true);    // absIdx = (1-1)*20+0 = 0
  assert.strictEqual(html.includes('data-sub="0"'), true);
});

test('renderRows：已订阅 → 已订阅标记 + 无订阅按钮 + 第2页绝对下标偏移', () => {
  const html = V.renderRows([SAMPLE], {
    pageNum: 2, pageSize: 20, checkSubscribe: () => 'subscribed',
  });
  assert.strictEqual(html.includes('✓ 已订阅'), true);
  assert.strictEqual(html.includes('data-sub='), false);          // 已订阅不渲染订阅按钮
  assert.strictEqual(html.includes('data-detail="20"'), true);    // absIdx = (2-1)*20+0 = 20
});

test('renderRows：字段兜底 —— 缺省值渲染占位符', () => {
  const html = V.renderRows([{}], {
    pageNum: 1, pageSize: 20, checkSubscribe: () => 'unknown',
  });
  // 编码缺省 → serverCoding 为「—」，且无订阅标记（因为 serverCoding === '—'）
  assert.strictEqual(html.includes('data-code="—"'), true);
  assert.strictEqual(html.includes('cell-sub"><span'), false);    // 无 subscribeMark
});
