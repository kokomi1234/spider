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

test('run：预演模式下未选关联文档也放行（离线拿不到文档列表时仍能试通）', async () => {
  const win = fresh();
  const form = { ...FORM };
  delete form.relDocIds;
  delete form.relDocDetails;

  // 非预演：按线上拦下
  const blocked = await win.SubscribeDryRun.run({ row: ROW, form, judges: JUDGES(), quiet: true, dryRun: false });
  assert.strictEqual(blocked.validate.code, 'no-doc');
  assert.strictEqual(blocked.requests.length, 0);

  // 预演模式：放行，且报文标注 documents 为空数组
  const { r, calls } = await withoutRealFetch(() => win.SubscribeDryRun.run({
    row: ROW, form, judges: JUDGES(), quiet: true, dryRun: true,
  }));
  assert.strictEqual(calls, 0);
  assert.strictEqual(r.validate.ok, true);
  assert.strictEqual(r.docSkipped, true, '要能看出「文档必填被跳过」这件事');
  assert.deepStrictEqual(r.requests[0].body.documents, [], '预演下 documents 是空数组（真实环境后端会拒）');
  assert.deepStrictEqual(r.requests.map((x) => x.name), ['setSubcription', 'subscriptionReview']);

  // 但其它必填照旧：TPS 非法仍拦（预演只放开文档这一条）
  const badTps = await win.SubscribeDryRun.run({
    row: ROW, form: { ...form, perfPeak: { tps: 'abc' } }, judges: JUDGES(), quiet: true, dryRun: true,
  });
  assert.strictEqual(badTps.validate.code, 'bad-tps');
  assert.strictEqual(badTps.requests.length, 0);
});

test('run：点击驱动开着时默认按预演模式校验（不必重复传 dryRun）', async () => {
  const win = fresh();
  withSpyCall(win);
  await silence(() => win.SubscribeDryRun.enable());
  const form = { ...FORM };
  delete form.relDocIds;
  const { r } = await silence(() => win.SubscribeDryRun.run({ row: ROW, form, judges: JUDGES(), quiet: true }));
  assert.strictEqual(r.dryRun, true, '预演模式开启时应默认放开文档必填');
  assert.strictEqual(r.validate.ok, true);
  await silence(() => win.SubscribeDryRun.disable());
  const after = await silence(() => win.SubscribeDryRun.run({ row: ROW, form, judges: JUDGES(), quiet: true }));
  assert.strictEqual(after.r.dryRun, false, '关闭后回到线上口径（文档必填重新生效）');
  assert.strictEqual(after.r.validate.code, 'no-doc');
});



// ── ④ 点击驱动的预演模式（enable / disable）────────────

/** 跑一段逻辑并吞掉它的控制台输出（预演台会打印整份报文） */
async function silence(fn) {
  const origin = console.log;
  const lines = [];
  console.log = (...a) => { lines.push(a.join(' ')); };
  try {
    const r = await fn();
    return { r, lines };
  } finally {
    console.log = origin;
  }
}

/** 记录「真实」API.call 被调用的次数（用来验证读接口放行、写接口不放行） */
function withSpyCall(win) {
  const calls = [];
  win.API.call = async (path) => {
    calls.push(String(path));
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ code: 200, data: {} }) };
  };
  return calls;
}

test('enable：写请求被拦住（真实 call 不被调用），返回假 200 让上层继续', async () => {
  const win = fresh();
  const calls = withSpyCall(win);
  const origCall = win.API.call;
  const { r: enabled } = await silence(() => win.SubscribeDryRun.enable());
  assert.strictEqual(enabled.ok, true);
  assert.ok(enabled.paths.includes('/itamp-tool/publish/setSubcription'));

  const { r, calls: fetchCalls } = await withoutRealFetch(async () => {
    const res = await silence(() => win.ServiceApi.subscribeWithForm(ROW, FORM));
    return res.r;
  });

  assert.strictEqual(fetchCalls, 0, '预演模式下不得发真实请求');
  assert.deepStrictEqual(calls, [], '写请求不该穿透到真实 call');
  assert.deepStrictEqual(r, { ok: true, local: false }, '要返回成功，弹窗才会继续走评委与本地标记');

  const off = await silence(() => win.SubscribeDryRun.disable());
  assert.strictEqual(off.r.count, 1, '应记录到 1 个被拦截的写请求');
  assert.strictEqual(win.API.call, origCall, 'disable 必须还原 API.call');
  assert.strictEqual(win.SubscribeDryRun.isEnabled(), false);
});

test('enable：读接口照常放行（含名字里带 subscribe 的读接口 —— 关键回归）', async () => {
  const win = fresh();
  const calls = withSpyCall(win);
  await silence(() => win.SubscribeDryRun.enable());

  await silence(() => win.API.call('/itamp-tool/publish/getPublishDataList', { method: 'POST', body: {} }));
  await silence(() => win.API.call('/itamp-tool/intfcMgmt/conditions/subscribe', { method: 'POST', body: {} }));

  assert.deepStrictEqual(calls, [
    '/itamp-tool/publish/getPublishDataList',
    '/itamp-tool/intfcMgmt/conditions/subscribe',
  ], '读接口必须原样透传（conditions/subscribe 是批次/系统下拉的数据源，拦了页面就空了）');
  assert.strictEqual(win.SubscribeDryRun.isWritePath('/itamp-tool/intfcMgmt/conditions/subscribe'), false);
  assert.strictEqual(win.SubscribeDryRun.isWritePath('/itamp-tool/publish/setSubcription'), true);
  assert.strictEqual(win.SubscribeDryRun.isWritePath('/itamp-tool/publish/subscriptionReview?n=1'), true);
  await silence(() => win.SubscribeDryRun.disable());
});

test('enable：幂等；disable：还原提示包装并撤销预演期间新增的本地订阅标记', async () => {
  const win = fresh();
  // 假订阅管理器：记录 getAll / remove
  const services = ['EXISTING-1'];
  const removed = [];
  win.SubscribeManager = {
    getAll: () => services.slice(),
    remove: (c) => { removed.push(c); return true; },
  };
  const origToast = () => 'orig';
  win.AppServices = { toast: origToast };

  await silence(() => win.SubscribeDryRun.enable());
  const again = await silence(() => win.SubscribeDryRun.enable());
  assert.strictEqual(again.r.already, true, '重复 enable 应当幂等');
  assert.notStrictEqual(win.AppServices.toast, origToast, '开启后应镜像页面提示到控制台');

  services.push('NEW-FAKE-1');           // 模拟「预演订阅成功」写进本地清单
  const off = await silence(() => win.SubscribeDryRun.disable());
  assert.deepStrictEqual(off.r.reverted, ['NEW-FAKE-1'], '预演新增的本地标记要撤销');
  assert.deepStrictEqual(removed, ['NEW-FAKE-1']);
  assert.strictEqual(win.AppServices.toast, origToast, '提示包装要还原');
  const off2 = await silence(() => win.SubscribeDryRun.disable());
  assert.strictEqual(off2.r.already, true, '重复 disable 应当幂等');
});

test('enable({fail})：分别模拟「订阅失败」与「评委失败」，返回形状要能让失败链路走通', async () => {
  const win = fresh();
  withSpyCall(win);
  await silence(() => win.SubscribeDryRun.enable({ fail: 'review' }));

  const { r } = await silence(() => win.ServiceApi.subscribeWithForm(ROW, FORM));
  assert.strictEqual(r.ok, true, '订阅本身应成功');

  const review = await silence(() => win.ToolApi.submitSubscriptionReview({
    publishId: 'PUB-1', prodSysServeNoList: ['E00406TO1197'], judgeInfoList: [],
  }));
  assert.strictEqual(review.r.ok, false, '评委写入按设置失败 → 上层走「部分失败：只补交评委」');
  await silence(() => win.SubscribeDryRun.disable());

  const win2 = fresh();
  withSpyCall(win2);
  await silence(() => win2.SubscribeDryRun.enable({ fail: 'subscribe' }));
  const sub = await silence(() => win2.ServiceApi.subscribeWithForm(ROW, FORM));
  assert.strictEqual(sub.r.ok, false, '订阅写入按设置失败 → 上层提示「订阅失败」');
  await silence(() => win2.SubscribeDryRun.disable());
});

test('enable：一次点击的两个报文会归成一组（间隔小于阈值）', async () => {
  const win = fresh();
  withSpyCall(win);
  await silence(() => win.SubscribeDryRun.enable());
  const { lines } = await silence(async () => {
    await win.ServiceApi.subscribeWithForm(ROW, FORM);
    await win.ToolApi.submitSubscriptionReview({
      publishId: 'PUB-1',
      prodSysServeNoList: ['E00406TO1197'],
      judgeInfoList: win.SubscribeModel.toJudgeInfoList(JUDGES()),
    });
  });
  const joined = lines.join('\n');
  assert.ok(/第 1 个写请求已拦截/.test(joined), '第一个请求要有拦截横幅');
  assert.ok(/第 2 个写请求已拦截/.test(joined));
  assert.ok(/与上一个请求属同一次「确认」/.test(joined), '第二次应被识别为同一次点击');
  await silence(() => win.SubscribeDryRun.disable());
});

test('enable：API 未就绪 / 无可拦写接口时给出明确失败，不半途留下钩子', async () => {
  const win = { toast: () => {}, __APP_CONFIG__: undefined };
  loadScript('js/ui/subscribe-dryrun.js', {}, win);   // 只加载 dryrun：没有 API / ServiceApi
  const { r } = await silence(() => win.SubscribeDryRun.enable());
  assert.strictEqual(r.ok, false);
  assert.strictEqual(win.SubscribeDryRun.isEnabled(), false, '失败时不应进入已开启状态');
  assert.strictEqual(win.API, undefined);
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
