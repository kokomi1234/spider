/**
 * priority.js 单测：里程碑推算、批次 label 解析、逾期、批次时间覆盖、排序。
 * 纯计算，不需要 DOM。
 */
'use strict';

const { loadScript, test } = require('./harness');
const assert = require('assert');

const P = loadScript('js/ui/priority.js').Priority;

const NOW = new Date(2026, 5, 1); // 2026-06-01，固定基准，避免测试随当天日期漂移

test('parseBatchYearMonth：抓包里的 4 种真实写法', () => {
  assert.deepStrictEqual(P.parseBatchYearMonth('2606批次'), { year: 2026, month: 6 });
  assert.deepStrictEqual(P.parseBatchYearMonth('2507-仿真'), { year: 2025, month: 7 });
  assert.deepStrictEqual(P.parseBatchYearMonth('26年8月独立'), { year: 2026, month: 8 });
  // 只有年份、解析不出月份 → 不参与优先级
  assert.strictEqual(P.parseBatchYearMonth('技术支持类-2026年批次'), null);
});

test('parseBatchYearMonth：纯 4 位数字、非法月份、空值', () => {
  assert.deepStrictEqual(P.parseBatchYearMonth('2606'), { year: 2026, month: 6 });
  assert.strictEqual(P.parseBatchYearMonth('2699批次'), null, '月份 99 非法，应返回 null');
  assert.strictEqual(P.parseBatchYearMonth(''), null);
  assert.strictEqual(P.parseBatchYearMonth(null), null);
});

test('parseYmd：合法 / 非法', () => {
  assert.strictEqual(P.parseYmd('2026-09-15').getTime(), new Date(2026, 8, 15).getTime());
  assert.strictEqual(P.parseYmd('2026/09/15'), null, '斜杠分隔不接受');
  assert.strictEqual(P.parseYmd(''), null);
  assert.strictEqual(P.parseYmd(null), null);
});

test('evaluate：开发基线 → 批次月 -1 个月的 15 日', () => {
  const r = P.evaluate({ prodBatch: '2609批次', status: '开发基线' }, NOW);
  assert.strictEqual(r.next, '功能测试基线');
  assert.strictEqual(r.deadline, '2026-08-15', '2609 → 9-1=8 月 15 日');
  assert.strictEqual(r.days, 75);
  assert.strictEqual(r.level, 'normal');
  assert.strictEqual(r.from, 'rule');
});

test('evaluate：开发基线的截止日跨年（2601批次 → 上一年 12 月）', () => {
  const r = P.evaluate({ prodBatch: '2601批次', status: '开发基线' }, NOW);
  assert.strictEqual(r.deadline, '2025-12-15', '1-1=0 → 上一年的 12 月');
  assert.strictEqual(r.from, 'rule');
});

test('evaluate：功能测试基线 → 批次月的 15 日', () => {
  const r = P.evaluate({ prodBatch: '2609批次', status: '功能测试基线' }, NOW);
  assert.strictEqual(r.deadline, '2026-09-15');
  assert.strictEqual(r.next, '正式版基线');
  assert.strictEqual(r.days, 106);
  assert.strictEqual(r.level, 'normal');
});

test('evaluate：终点状态（正式版基线 / 下线）不提醒', () => {
  assert.strictEqual(P.evaluate({ prodBatch: '2609批次', status: '正式版基线' }, NOW).level, 'done');
  assert.strictEqual(P.evaluate({ prodBatch: '2609批次', status: '下线' }, NOW).level, 'done');
});

test('evaluate：逾期标红且天数取绝对值', () => {
  const now = new Date(2026, 8, 1); // 2026-09-01，晚于 2026-08-15
  const r = P.evaluate({ prodBatch: '2609批次', status: '开发基线' }, now);
  assert.strictEqual(r.days, -17);
  assert.strictEqual(r.overdue, true);
  assert.strictEqual(r.level, 'overdue');
  assert.strictEqual(r.text, '逾期 17 天');
});

test('evaluate：LEVELS 临界值（-1 / 0 / 7 / 8 / 30 / 31）', () => {
  // 截止日固定 2026-08-15，用 now 反推剩余天数 d
  const at = (d) => P.evaluate({ prodBatch: '2609批次', status: '开发基线' }, new Date(2026, 7, 15 - d)).level;
  assert.strictEqual(at(-1), 'overdue');
  assert.strictEqual(at(0), 'critical');
  assert.strictEqual(at(7), 'critical');
  assert.strictEqual(at(8), 'soon');
  assert.strictEqual(at(30), 'soon');
  assert.strictEqual(at(31), 'normal');
});

test('evaluate：批次解析不出年月 / 基线不在里程碑里', () => {
  const r1 = P.evaluate({ prodBatch: '技术支持类-2026年批次', status: '开发基线' }, NOW);
  assert.strictEqual(r1.level, 'unknown');
  assert.strictEqual(r1.reason, '批次解析不出年月');

  const r2 = P.evaluate({ prodBatch: '2609批次', status: '什么基线' }, NOW);
  assert.strictEqual(r2.level, 'unknown');
  assert.strictEqual(r2.reason, '基线状态不在里程碑里');
});

test('setBatchTimes：批次时间覆盖默认截止日（from=config）', () => {
  P.setBatchTimes({ '2609批次': { testDate: '2026-01-20' } });
  const r = P.evaluate({ prodBatch: '2609批次', status: '开发基线' }, new Date(2026, 0, 1));
  assert.strictEqual(r.deadline, '2026-01-20', '应以配置的 testDate 为准');
  assert.strictEqual(r.from, 'config');
  assert.strictEqual(r.days, 19);
  P.setBatchTimes(null); // 还原，避免污染后续用例
});

test('decorate：写回下划线字段', () => {
  const row = { prodBatch: '2609批次', status: '功能测试基线' };
  P.decorate(row, NOW);
  assert.strictEqual(row._prioDeadline, '2026-09-15');
  assert.strictEqual(row._prioNext, '正式版基线（2026-09-15 前）');
  assert.ok(row._prioText.includes('剩'));
});

test('compare：紧急在前，done 恒在最后', () => {
  const rows = [
    { prodBatch: '2609批次', status: '正式版基线' },  // done
    { prodBatch: '2609批次', status: '功能测试基线' }, // 剩 106 天
    { prodBatch: '2609批次', status: '开发基线' },     // 剩 14 天
  ].map((r) => P.decorate(r, NOW));

  const sorted = rows.slice().sort(P.compare);
  assert.strictEqual(sorted[0].status, '开发基线', '最紧急的排最前');
  assert.strictEqual(sorted[sorted.length - 1].status, '正式版基线', 'done 排最后');
});
