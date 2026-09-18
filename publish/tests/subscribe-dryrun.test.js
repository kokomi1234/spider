/**
 * 订阅报文预演台单测（js/ui/subscribe-dryrun.js）。
 *
 * 这个模块的价值全在「可信」两个字上，所以测试分三层钉：
 *   ① 纯函数口径：空值判定 / 取值格式化 / 报文结构描述（字段顺序必须与报文键序一致）
 *   ② 预演语义：走真实组包函数、但**一个真实请求都不能发**（API 层拦、fetch 层兜，
 *      并且跑完必须把传输层原样还原）；校验不过就按线上行为拦下、不构造报文
 *   ③ 场景矩阵：内置场景必须全部符合预期（断言项本身就是「该拦的拦住」这张清单）
 */
'use strict';

const { loadScript, test } = require('./harness');
const assert = require('assert');

/** 按浏览器的脚本顺序加载（dryrun 排最后，与 index.html 一致） */
function fresh() {
  const win = {
    toast: () => {},
    __APP_CONFIG__: undefined,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
  };
  loadScript('js/core/api-client.js', {}, win);
  loadScript('js/api/tool-api.js', {}, win);
  loadScript('js/api/service-api.js', {}, win);
  loadScript('js/ui/subscribe-model.js', {}, win);
  loadScript('js/ui/subscribe-dryrun.js', {}, win);
  return win;
}

/** 桩：真实 fetch 一旦被调用就是严重问题（预演不该产生真实请求） */
async function withoutRealFetch(fn) {
  const origin = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls += 1; throw new Error('预演中出现了真实 fetch'); };
  try {
    const r = await fn();
    return { r, calls };
  } finally {
    global.fetch = origin;
  }
}

const ROW = {
  id: 'PUB-1', publishId: 'PUB-1', serverCoding: 'E00301TO1197', sysServeNo: 'E00301TO1197',
  provideComponentName: '组件名', provideSystemNumber: 'E00301', assemblyNo: 'E00301',
  prodBatch: '2611批次', serverNo: 'M-202607-11289', deptId: 'K4229',
  deptName: '中国银行软件中心（深圳）开发三部',
};
const FORM = {
  callerSystem: 'E00406', callerServiceNo: 'E00406TO1197',
  relDocIds: 'doc-1', relDocNames: '某文档',
  relDocDetails: [{
    batchNum: '2611', docName: '某文档', docNo: 'D-1', label: 'D-1-某文档', templateCode: '16', docInstId: 'doc-1',
  }],
  perfPeak: { tps: '5' }, taskNo: 'T-2026-001',
};
const JUDGES = () => ([
  { role: '调用方产品负责人', empNo: '6464402', name: '吴树海', dept: '中国银行软件中心（深圳）开发三部', deptId: 'K4229' },
  { role: '服务方产品负责人', empNo: '6554220', name: '钟剑标', dept: '中国银行软件中心（深圳）开发三部', deptId: 'K4229' },
]);

// ── ① 纯函数口径 ───────────────────────────────────────

test('SubscribeDryRun：暴露预期接口且冻结', () => {
  const { SubscribeDryRun } = fresh();
  ['run', 'scenarios', 'dump', 'describe', 'isEmptyValue', 'formatValue', 'describeObject']
    .forEach((k) => assert.strictEqual(typeof SubscribeDryRun[k], 'function', '缺少函数 ' + k));
  ['FIELD_SOURCES', 'SCENARIOS'].forEach((k) => assert.strictEqual(typeof SubscribeDryRun[k], 'object'));
  assert.strictEqual(Object.isFrozen(SubscribeDryRun), true);
  assert.ok(SubscribeDryRun.SCENARIOS.length >= 20, '场景矩阵应覆盖足够多的场景');
});

test('isEmptyValue：null / 空白串 / 空数组算空；0 与 false 是有效取值', () => {
  const D = fresh().SubscribeDryRun;
  [null, undefined, '', '   ', '\n\t', []].forEach((v) => {
    assert.strictEqual(D.isEmptyValue(v), true, `${JSON.stringify(v)} 应算空`);
  });
  [0, false, '0', ' ', 'a', [0], {}, { a: 1 }].forEach((v) => {
    // 注意：' '（一个空格）是空白串 → 空；这里排除它，单独断言
    if (v === ' ') return;
    assert.strictEqual(D.isEmptyValue(v), false, `${JSON.stringify(v)} 应算非空`);
  });
  assert.strictEqual(D.isEmptyValue(' '), true, '单个空格 trim 后为空');
});

test('formatValue：字符串带引号（能看出首尾空格）、对象转 JSON、超长截断', () => {
  const D = fresh().SubscribeDryRun;
  assert.strictEqual(D.formatValue('  5  '), '"  5  "');
  assert.strictEqual(D.formatValue('abc'), '"abc"');
  assert.strictEqual(D.formatValue(0), '0');
  assert.strictEqual(D.formatValue(false), 'false');
  assert.strictEqual(D.formatValue(null), 'null');
  assert.strictEqual(D.formatValue(['A', 'B']), '["A","B"]');
  const long = D.formatValue('x'.repeat(100), 10);
  assert.strictEqual(long.length, 10);
  assert.ok(long.endsWith('…'));
});

test('describe：字段顺序 = 报文键序；对象段拆非空/空，数组段逐元素', () => {
  const D = fresh().SubscribeDryRun;
  const body = {
    documents: [{ a: 1, b: '' }],
    publishSubcription: { k1: 'v', k2: null, k3: 0, k4: false, k5: [], k6: '  ' },
    prodSysServeNoList: ['E00406TO1197'],
  };
  const d = D.describe(body);
  assert.deepStrictEqual(d.topKeys, ['documents', 'publishSubcription', 'prodSysServeNoList'], '顶层键序必须与报文一致');

  const sub = d.sections.find((s) => s.key === 'publishSubcription');
  assert.strictEqual(sub.kind, 'object');
  assert.strictEqual(sub.count, 6);
  assert.deepStrictEqual(sub.nonEmpty, ['k1', 'k3', 'k4'], '0 与 false 是非空；顺序仍是键序');
  assert.deepStrictEqual(sub.emptyKeys, ['k2', 'k5', 'k6']);
  assert.strictEqual(sub.allEmpty, false);

  const docs = d.sections.find((s) => s.key === 'documents');
  assert.strictEqual(docs.kind, 'array');
  assert.strictEqual(docs.count, 1);
  assert.deepStrictEqual(docs.items[0].keys, ['a', 'b']);
  assert.deepStrictEqual(docs.items[0].nonEmpty, ['a']);
  assert.deepStrictEqual(docs.items[0].empty, ['b']);

  const lists = d.sections.find((s) => s.key === 'prodSysServeNoList');
  assert.strictEqual(lists.count, 1);
  assert.strictEqual(lists.items[0].scalar, 'E00406TO1197');

  // 空报文的边界
  const empty = D.describe({ documents: [] });
  assert.strictEqual(empty.sections[0].allEmpty, true);
  assert.deepStrictEqual(empty.sections[0].items, []);
});

// ── ② 预演语义 ─────────────────────────────────────────

test('run：走真实组包函数，两个报文按 抓包顺序 捕获，且不发任何真实请求', async () => {
  const win = fresh();
  const origCall = win.API.call;
  const { r, calls } = await withoutRealFetch(() => win.SubscribeDryRun.run({
    row: ROW, form: FORM, judges: JUDGES(), quiet: true,
  }));

  assert.strictEqual(calls, 0, '预演过程不得产生真实 fetch');
  assert.strictEqual(r.fetchCalls, 0, 'fetch 层不应被穿透');
  assert.strictEqual(r.requests.length, 2, '订阅 + 评委两个请求');
  assert.deepStrictEqual(r.requests.map((x) => x.name), ['setSubcription', 'subscriptionReview']);
  assert.strictEqual(r.requests[0].method, 'POST');
  assert.ok(/setSubcription$/.test(r.requests[0].path), '路径要与抓包一致');
  assert.strictEqual(r.validate.ok, true, '完整输入应通过校验');
  assert.strictEqual(r.restored, true, '跑完必须还原传输层');
  assert.strictEqual(win.API.call, origCall, 'window.API.call 必须还原成原函数（否则页面后续请求全被吞）');
  assert.strictEqual(win.fetch, undefined, '未设置过 window.fetch 时应保持没有该属性（harness 环境）');
});

test('run：报文内容就是线上会发的那份（含 7 键评委 + 派生服务编号）', async () => {
  const win = fresh();
  const { r } = await withoutRealFetch(() => win.SubscribeDryRun.run({
    row: ROW, form: FORM, judges: JUDGES(), quiet: true,
  }));
  const body = r.requests[0].body;
  assert.ok(body.publishSubcription && Array.isArray(body.documents), '订阅报文的顶层结构');
  assert.strictEqual(body.publishSubcription.serverNo, 'M-202607-11289', '行里有 serverNo → 以行为准');
  assert.deepStrictEqual(body.publishSubcription.prodSysServeNoList, ['E00406TO1197'], '用户确认过的调用方服务编号优先');
  assert.strictEqual(body.publishSubcription.prodTPSPeak, '5');
  assert.strictEqual(body.publishSubcription.isChecked, '1');
  assert.strictEqual(body.publishSubcription.reviewStatus, '03');
  assert.strictEqual(body.documents.length, 1);

  const jl = r.requests[1].body.judgeInfoList;
  assert.strictEqual(jl.length, 2);
  assert.deepStrictEqual(Object.keys(jl[0]).sort(), [
    'involvedProduct', 'judgeDeptId', 'judgeDeptName', 'judgeName', 'judgeRoleId', 'judgeRoleName', 'judgeUserId',
  ]);
  assert.deepStrictEqual(jl.map((j) => j.judgeRoleId), ['03', '05']);
  assert.strictEqual(jl[0].judgeDeptId, 'K4229');
});

test('run：行数据缺 serverNo/taskNo → 用表单任务编号兜底', async () => {
  const win = fresh();
  const row = { ...ROW };
  delete row.serverNo;
  const { r } = await withoutRealFetch(() => win.SubscribeDryRun.run({
    row, form: FORM, judges: JUDGES(), quiet: true,
  }));
  const pub = r.requests[0].body.publishSubcription;
  assert.strictEqual(pub.serverNo, 'T-2026-001');
  assert.strictEqual(pub.prodTaskNo, 'T-2026-001');
});

test('run：校验不过时按线上行为拦下，一个报文都不构造（force 才继续）', async () => {
  const win = fresh();
  const badForm = { ...FORM, perfPeak: { tps: 'abc' } };

  const blocked = await win.SubscribeDryRun.run({ row: ROW, form: badForm, judges: JUDGES(), quiet: true });
  assert.strictEqual(blocked.validate.code, 'bad-tps');
  assert.strictEqual(blocked.requests.length, 0, '校验不过不得构造报文');
  assert.ok(blocked.skipped, '要明确告诉调用方「被前端拦下」');

  const forced = await win.SubscribeDryRun.run({
    row: ROW, form: badForm, judges: JUDGES(), quiet: true, force: true,
  });
  assert.deepStrictEqual(
    forced.requests.map((x) => x.name), ['setSubcription', 'subscriptionReview'],
    'force=true 时把整条链路都构造出来（订阅 + 评委），仅用于观察报文',
  );
  assert.strictEqual(
    forced.requests[0].body.publishSubcription.prodTPSPeak, 'abc',
    '非法 TPS 会原样出现在报文里 —— 这正是要看的东西',
  );
});

test('run：没有评委行时只发订阅报文（与线上一致，不补发评委）', async () => {
  const win = fresh();
  const { r } = await withoutRealFetch(() => win.SubscribeDryRun.run({
    row: ROW, form: FORM, judges: [], defaultsFetched: true, quiet: true,
  }));
  assert.deepStrictEqual(r.requests.map((x) => x.name), ['setSubcription']);
  assert.strictEqual(r.validate.ok, true, '已拉取默认评委 → 评委必填豁免');
});

test('run：isSubscribed 命中时拦下且不发请求', async () => {
  const win = fresh();
  const r = await win.SubscribeDryRun.run({
    row: ROW, form: FORM, judges: JUDGES(), quiet: true, isSubscribed: () => true,
  });
  assert.strictEqual(r.validate.code, 'subscribed');
  assert.strictEqual(r.requests.length, 0);
});

test('run：显式 row:null 走「无行数据」这一关（不能被当成没传而回落到内置示例）', async () => {
  const win = fresh();
  const r = await win.SubscribeDryRun.run({ row: null, form: FORM, judges: JUDGES(), quiet: true });
  assert.strictEqual(r.validate.code, 'no-row');
  assert.strictEqual(r.validate.msg, '', '无行数据时静默，不给文案');
  assert.strictEqual(r.requests.length, 0);
});

test('run：dump 能单独打印一份报文并返回同样的结构描述', () => {
  const win = fresh();
  const body = { publishSubcription: { a: 1, b: '' } };
  const origin = console.log;
  let lines = 0;
  console.log = () => { lines += 1; };
  let d;
  try {
    d = win.SubscribeDryRun.dump(body, '测试端点');
  } finally {
    console.log = origin;
  }
  assert.ok(lines > 0, 'dump 应当有控制台输出');
  assert.deepStrictEqual(d.topKeys, ['publishSubcription']);
  assert.deepStrictEqual(d.sections[0].nonEmpty, ['a']);
});

test('顺序无关：dryrun 先加载、依赖后加载，run 仍能工作（调用时才取 window.*）', async () => {
  const win = { toast: () => {}, __APP_CONFIG__: undefined };
  loadScript('js/ui/subscribe-dryrun.js', {}, win);   // 故意先加载
  loadScript('js/ui/subscribe-model.js', {}, win);
  loadScript('js/core/api-client.js', {}, win);
  loadScript('js/api/service-api.js', {}, win);
  loadScript('js/api/tool-api.js', {}, win);

  const { r, calls } = await withoutRealFetch(() => win.SubscribeDryRun.run({
    row: ROW, form: FORM, judges: JUDGES(), quiet: true,
  }));
  assert.strictEqual(calls, 0);
  assert.strictEqual(r.requests.length, 2);
});

// ── ③ 场景矩阵 ─────────────────────────────────────────

test('scenarios：内置场景全部符合预期，且覆盖必填缺失/字段为空/格式错误/顺序/组包', async () => {
  const win = fresh();
  const { r, calls } = await withoutRealFetch(() => win.SubscribeDryRun.scenarios({ quiet: true }));
  assert.strictEqual(calls, 0, '场景矩阵同样不得产生真实请求');
  assert.strictEqual(r.failed, 0, '不符合预期的场景：' + JSON.stringify(r.items.filter((i) => !i.pass)));
  assert.ok(r.total >= 20, `场景数应 >= 20，实际 ${r.total}`);

  const names = r.items.map((i) => i.name).join('\n');
  ['必填齐全', '无行数据', '行缺服务编码', '已在订阅列表', '未选调用方系统', '未选关联文档',
    '服务编号空且推不出', '服务编号空但可派生', 'TPS 为空', 'TPS 格式错误', 'TPS 全角数字',
    '评委为空且未拉取默认评委', '评委为空但已成功拉取默认评委', '任务编号为空', '批次为空',
    '校验顺序', '两个报文都捕获到', '每条 7 键', '字段为空（行无 serverNo/taskNo）',
    '行有 serverNo', 'TPS 优先取行数据', '无评委行', '直接拦下', 'force=true',
  ].forEach((needle) => {
    assert.ok(names.includes(needle), `场景矩阵缺少「${needle}」类场景`);
  });
  // 每个场景都要给出「期望 / 实际」，便于人工对照
  r.items.forEach((i) => {
    assert.ok(i.expect && i.expect.length > 0, `场景「${i.name}」缺 expect`);
    assert.strictEqual(typeof i.actual, 'string', `场景「${i.name}」缺 actual`);
  });
});
