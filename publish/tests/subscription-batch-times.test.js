/**
 * subscription-batch-times.js 单测：接口完整性、load 的三级降级、
 * 配置注入优先级、保存失败时的兜底。
 */
'use strict';

const { loadScript, test } = require('./harness');
const assert = require('assert');

// 模块内部用裸 fetch / localStorage，这里临时替换
function withFetch(impl, fn) {
  const orig = global.fetch;
  const origLs = global.localStorage;
  global.fetch = impl;
  return Promise.resolve()
    .then(fn)
    .finally(() => { global.fetch = orig; global.localStorage = origLs; });
}

const okJson = (data) => async () => ({ ok: true, status: 200, json: async () => data });

function fresh() {
  const win = loadScript('js/ui/priority.js');
  loadScript('js/page/subscription-batch-times.js', {}, win);
  return win;
}

test('SubscriptionBatchTimes：暴露预期接口', () => {
  const BT = fresh().SubscriptionBatchTimes;
  ['init', 'load', 'open', 'close', 'save', 'getBatchTimes', 'applyToPriority']
    .forEach((k) => assert.strictEqual(typeof BT[k], 'function', '缺少 ' + k));
});

// ── 选择栏的月份规则（功测 = 批次月上月，上线 = 批次月当月）──────

const R = fresh().SubscriptionBatchTimes._rules;

test('monthKey：跨年由 Date 自己进位（2601批次 → 上一年 12 月）', () => {
  assert.strictEqual(R.monthKey(2026, 1, -1), '2025-12');   // 1 月往前一个月
  assert.strictEqual(R.monthKey(2026, 1, -3), '2025-10');
  assert.strictEqual(R.monthKey(2026, 12, 1), '2027-01');   // 12 月往后一个月
  assert.strictEqual(R.monthKey(2026, 12, 3), '2027-03');
  assert.strictEqual(R.monthKey(2026, 8, 0), '2026-08');
  assert.strictEqual(R.monthKey(2026, 8, -1), '2026-07');
});

test('默认取值：功测 = 批次月的上一个月，上线 = 批次月当月', () => {
  const ym = { year: 2026, month: 8 };                       // 2608批次
  assert.strictEqual(R.monthKey(ym.year, ym.month, R.TEST_OFFSETS.def), '2026-07');
  assert.strictEqual(R.monthKey(ym.year, ym.month, R.RELEASE_OFFSETS.def), '2026-08');
  assert.strictEqual(R.TEST_OFFSETS.def, -1);
  assert.strictEqual(R.RELEASE_OFFSETS.def, 0);
});

test('可选范围：功测 前 3 个月~当月，上线 当月~后 3 个月，且功测恒不晚于上线', () => {
  for (const [y, m] of [[2026, 1], [2026, 2], [2026, 3], [2026, 8], [2026, 12]]) {
    const test = [];
    for (let off = R.TEST_OFFSETS.min; off <= R.TEST_OFFSETS.max; off += 1) test.push(R.monthKey(y, m, off));
    const release = [];
    for (let off = R.RELEASE_OFFSETS.min; off <= R.RELEASE_OFFSETS.max; off += 1) release.push(R.monthKey(y, m, off));

    assert.strictEqual(test.length, 4, `${y}-${m} 功测应有 4 个可选月份`);
    assert.strictEqual(release.length, 4, `${y}-${m} 上线应有 4 个可选月份`);
    assert.strictEqual(test[test.length - 1], R.monthKey(y, m, 0), '功测最晚只能选到批次月');
    assert.strictEqual(release[0], R.monthKey(y, m, 0), '上线最早只能选批次月');
    // 两个范围只可能在「批次月」相交 → 天然不会出现功测晚于上线
    assert.ok(test[test.length - 1] <= release[0]);
    // 默认值必须落在各自范围内
    assert.ok(test.includes(R.monthKey(y, m, R.TEST_OFFSETS.def)));
    assert.ok(release.includes(R.monthKey(y, m, R.RELEASE_OFFSETS.def)));
  }
});

test('展示与落盘：「26年7月」⇄「2026-07-15」，兼容旧的 YYYY-MM-DD 配置', () => {
  assert.strictEqual(R.ymLabel('2026-07'), '26年7月');
  assert.strictEqual(R.ymLabel('2025-12'), '25年12月');
  assert.strictEqual(R.ymLabel(''), '—');
  assert.strictEqual(R.toStoredDate('2026-07'), '2026-07-15');
  assert.strictEqual(R.toStoredDate(''), '');
  assert.strictEqual(R.toMonthKey('2026-07-15'), '2026-07');
  assert.strictEqual(R.toMonthKey('2026-7-1'), '2026-07');    // 旧数据可能不补零
  assert.strictEqual(R.toMonthKey(''), '');
  assert.strictEqual(R.parseYm('2026-13'), null);
  assert.strictEqual(R.parseYm('26-07'), null);
});

test('load：代理端点可用时走它，并触发 refreshPriority', async () => {
  const win = fresh();
  const BT = win.SubscriptionBatchTimes;
  let refreshed = 0;
  BT.init({ refreshPriority: () => { refreshed += 1; } });

  await withFetch(okJson({ data: { batchTimes: { '2609批次': { testDate: '2026-01-20' } } } }),
    () => BT.load());

  assert.deepStrictEqual(BT.getBatchTimes(), { '2609批次': { testDate: '2026-01-20' } });
  assert.strictEqual(refreshed, 1, 'load 后应通知页面重算优先级');
});

test('load：代理端点不可用时降级到静态文件', async () => {
  const win = fresh();
  const BT = win.SubscriptionBatchTimes;
  BT.init({ refreshPriority: () => {} });

  let asked = 0;
  await withFetch(async (url) => {
    asked += 1;
    if (String(url).includes('local/batch-times')) return { ok: false, status: 404 };
    return okJson({ batchTimes: { '2608批次': { releaseDate: '2026-08-15' } } })();
  }, () => BT.load());

  assert.strictEqual(asked, 2, '先试代理端点，再试静态文件');
  assert.deepStrictEqual(BT.getBatchTimes(), { '2608批次': { releaseDate: '2026-08-15' } });
});

test('applyToPriority：把配置喂给 Priority（from=config）', async () => {
  const win = fresh();
  const BT = win.SubscriptionBatchTimes;
  const P = win.Priority;
  BT.init({ refreshPriority: () => {} });
  await withFetch(okJson({ data: { batchTimes: { '2609批次': { testDate: '2026-01-20' } } } }),
    () => BT.load());

  BT.applyToPriority();
  const r = P.evaluate({ prodBatch: '2609批次', status: '开发基线' }, new Date(2026, 0, 1));
  assert.strictEqual(r.deadline, '2026-01-20');
  assert.strictEqual(r.from, 'config', '截止日应来自批次时间配置');
});

test('load：代理端点与静态文件都不可用时降级到 localStorage', async () => {
  const store = { 'itamp.batchTimes': JSON.stringify({ '2607批次': { testDate: '2026-03-01' } }) };
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };

  const win = fresh();
  const BT = win.SubscriptionBatchTimes;
  BT.init({ refreshPriority: () => {} });

  await withFetch(async () => { throw new Error('全挂'); }, () => BT.load());
  assert.deepStrictEqual(BT.getBatchTimes(), { '2607批次': { testDate: '2026-03-01' } });
});
