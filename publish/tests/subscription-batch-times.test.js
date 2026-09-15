/**
 * subscription-batch-times.js 单测：接口完整性、load 的三级降级、配置注入优先级。
 *
 * 弹窗本体（表格渲染 / 日期选择器 / 保存）依赖 DOM 与 createDatePicker，
 * 走 tests/smoke-browser.js 的浏览器断言，这里只钉纯 JS 部分。
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
