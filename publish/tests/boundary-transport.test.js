/**
 * 传输层 / 取数层边界场景单测。
 *
 * 不依赖任何第三方库，纯 node + tests/harness.js。
 * 重点盯「失败能不能收敛成 { ok:false, error } 而不是抛异常 / 造假数据 / 静默通过」、
 * 「endpoint 未配置是否直接失败且零请求」、「端点配置错配是否把失败吞掉」。
 *
 * 桩的手法照 api-client.test.js / service-api.test.js / tool-api.test.js：
 *   · 非冻结模块（API / TaskApi / ToolApi / UserApi / ServiceApi）：先 loadScript(api-client)，
 *     再把 win.API.call 换成测试桩。
 *   · 冻结模块（PublishResponse / PublishQuery）：直接 loadScript 真代码，依赖项在
 *     loadScript 之前塞进传入的 win，避免 Object.freeze 之后赋值静默失效。
 */
'use strict';

const { loadScript, test } = require('./harness');
const assert = require('assert');

// ─────────────────────────── 通用假响应 / 桩 ───────────────────────────

function okResp(records, total, code) {
  return {
    ok: true, status: 200,
    headers: { get: () => null },
    json: async () => ({
      code: code == null ? 0 : code,
      data: { records: records || [], total: total == null ? (records || []).length : total },
    }),
  };
}
function errResp(status) {
  return { ok: false, status, headers: { get: () => null }, json: async () => ({}) };
}
function nonJsonResp() {
  return {
    ok: true, status: 200, headers: { get: () => null },
    json: async () => { throw new SyntaxError('Unexpected token in JSON'); },
  };
}
function bizFailResp(msg) {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ code: 500, msg }) };
}

/** 记录每次调用并回传一个响应（或抛错） */
function recStub(factory) {
  const rec = { calls: 0, args: [] };
  const fn = async (path, opts) => {
    rec.calls += 1;
    rec.args.push({ path, opts });
    return factory(path, opts);
  };
  return { fn, rec };
}

/** 期望 fn() 抛错，并校验错误文案（pred 为字符串子串或断言函数） */
async function expectThrow(fn, pred) {
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  assert.ok(err, '应当抛错但没有');
  const text = String((err && err.message) || err);
  if (typeof pred === 'string') assert.ok(text.includes(pred), `错误文案应含「${pred}」，实际：${text}`);
  else if (typeof pred === 'function') assert.ok(pred(err), `错误断言未通过：${text}`);
  return err;
}

// ─────────────────────────── PublishResponse.parse ───────────────────────────

function loadPublishResponse() {
  const win = {};
  loadScript('js/core/publish-response.js', {}, win);
  return win.PublishResponse;
}

test('PublishResponse.parse：200 + 合法 JSON（code:0）→ 解出 records/total，loose=false', async () => {
  const R = loadPublishResponse();
  const resp = {
    ok: true, status: 200,
    headers: { get: () => null },
    json: async () => ({ code: 0, data: { records: [{ id: 1 }], total: 42 } }),
  };
  const r = await R.parse(resp);
  assert.deepStrictEqual(r.rows, [{ id: 1 }]);
  assert.strictEqual(r.total, 42);
  assert.strictEqual(r.loose, false);
});

test('PublishResponse.parse：HTTP 非 2xx → 抛 {message:"HTTP 500"}（交上层收敛为 ok:false）', async () => {
  const R = loadPublishResponse();
  const resp = { ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) };
  await expectThrow(() => R.parse(resp), 'HTTP 500');
});

test('PublishResponse.parse：200 但 body 不是 JSON（json() 抛 SyntaxError）→ 抛格式异常', async () => {
  const R = loadPublishResponse();
  const resp = nonJsonResp();
  const err = await expectThrow(() => R.parse(resp), '接口返回数据格式异常');
  assert.ok(err && typeof err === 'object', '应抛可携带 message 的对象（能被上层收进 error）');
});

test('PublishResponse.parse：业务码非 0 → 抛后端 msg', async () => {
  const R = loadPublishResponse();
  const resp = {
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ code: 500, msg: '物理应用组件编号不能为空' }),
  };
  await expectThrow(() => R.parse(resp), '物理应用组件编号不能为空');
});

test('PublishResponse.parse：data 为 null → 走空结果（rows=[]、total=0），不造假数据', async () => {
  const R = loadPublishResponse();
  const resp = {
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ code: 0, data: null }),
  };
  const r = await R.parse(resp);
  assert.deepStrictEqual(r.rows, []);
  assert.strictEqual(r.total, 0);
});

test('PublishResponse.parse：total 为字符串 "123" → 原样保留字符串，不强制转 number 也不补假数据', async () => {
  const R = loadPublishResponse();
  const resp = {
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ code: 0, data: { records: [], total: '123' } }),
  };
  const r = await R.parse(resp);
  assert.deepStrictEqual(r.rows, []);
  assert.strictEqual(r.total, '123');           // 真实行为：保留字符串，不偷偷转 123
  assert.strictEqual(typeof r.total, 'string');
});

test('PublishResponse.parse："0" / 数字 0 作为 total 都不能被当 falsy 吞掉', async () => {
  const R = loadPublishResponse();
  const zeroStr = await R.parse({ ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ code: 0, data: { records: [{ id: 1 }], total: '0' } }) });
  assert.strictEqual(zeroStr.total, '0', '字符串 "0" 应原样保留');

  const zeroNum = await R.parse({ ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ code: 0, data: { records: [{ id: 1 }], total: 0 } }) });
  assert.strictEqual(zeroNum.total, 0, '数字 0 不能被当成「无数据」吞掉');
});

test('PublishResponse.parse：X-Cache-Match: loose 响应头 → loose=true（宽松回放要如实告知）', async () => {
  const R = loadPublishResponse();
  const resp = {
    ok: true, status: 200,
    headers: { get: (k) => (String(k).toLowerCase() === 'x-cache-match' ? 'loose' : null) },
    json: async () => ({ code: 0, data: { records: [{ id: 1 }], total: 1 } }),
  };
  const r = await R.parse(resp);
  assert.strictEqual(r.loose, true);
  assert.deepStrictEqual(r.rows, [{ id: 1 }]);
});

test('PublishResponse.parse：无 x-cache-match 头 → loose=false', async () => {
  const R = loadPublishResponse();
  const r = await R.parse(okResp([{ id: 1 }], 1));
  assert.strictEqual(r.loose, false);
});

test('PublishResponse.parse：data 为 undefined（空对象响应）→ rows 回退为 []，不抛不造假', async () => {
  const R = loadPublishResponse();
  const resp = {
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ code: 0, data: {} }),
  };
  const r = await R.parse(resp);
  assert.deepStrictEqual(r.rows, []);
  assert.strictEqual(r.total, 0);
});

// ─────────────────────────── API.createRequester ───────────────────────────

function loadApiClient() {
  const win = { __APP_CONFIG__: {} };
  loadScript('js/core/api-client.js', { setTimeout: (fn) => setTimeout(fn, 0) }, win);
  return win;
}

test('createRequester：endpoint 未配置 → request 直接抛「接口未配置」，且一次 fetch 都不发', async () => {
  const win = loadApiClient();
  const stub = recStub(() => okResp([], 0));
  win.API.call = stub.fn;
  const req = win.API.createRequester({ endpoints: {}, methods: { foo: 'POST' } });
  await expectThrow(() => req.request('foo', { a: 1 }), '接口未配置');
  assert.strictEqual(stub.rec.calls, 0, '未配置不得发请求');
});

test('createRequester：HTTP 非 2xx → 抛 Error 并带状态码', async () => {
  const win = loadApiClient();
  const stub = recStub(() => errResp(500));
  win.API.call = stub.fn;
  const req = win.API.createRequester({ endpoints: { foo: '/x' }, methods: { foo: 'POST' } });
  await expectThrow(() => req.request('foo', {}), 'HTTP 500');
});

test('createRequester：200 但 body 非 JSON → 抛「接口返回的不是 JSON」', async () => {
  const win = loadApiClient();
  const stub = recStub(() => nonJsonResp());
  win.API.call = stub.fn;
  const req = win.API.createRequester({ endpoints: { foo: '/x' }, methods: { foo: 'POST' } });
  await expectThrow(() => req.request('foo', {}), '接口返回的不是 JSON');
});

test('createRequester：业务码非 0/200 → 抛 Error 并带后端 msg（不写兜底假数据）', async () => {
  const win = loadApiClient();
  const stub = recStub(() => bizFailResp('后端说：编号缺失'));
  win.API.call = stub.fn;
  const req = win.API.createRequester({ endpoints: { foo: '/x' }, methods: { foo: 'POST' } });
  await expectThrow(() => req.request('foo', {}), '后端说：编号缺失');
});

test('createRequester：业务码 "200"（字符串）视为成功放行', async () => {
  const win = loadApiClient();
  const stub = recStub(() => ({ ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ code: '200', msg: '操作成功', data: { rows: [1] } }) }));
  win.API.call = stub.fn;
  const req = win.API.createRequester({ endpoints: { foo: '/x' }, methods: { foo: 'POST' } });
  const json = await req.request('foo', {});
  assert.strictEqual(String(json.code), '200');
});

test('createRequester：业务码 0 视为成功放行', async () => {
  const win = loadApiClient();
  const stub = recStub(() => okResp([{ id: 1 }], 1, 0));
  win.API.call = stub.fn;
  const req = win.API.createRequester({ endpoints: { foo: '/x' }, methods: { foo: 'POST' } });
  const json = await req.request('foo', {});
  assert.strictEqual(json.code, 0);
});

test('createRequester：无 code 的响应（只有 total/rows）→ 放行，业务码不误判', async () => {
  const win = loadApiClient();
  const stub = recStub(() => ({ ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ total: 0, rows: [] }) }));
  win.API.call = stub.fn;
  const req = win.API.createRequester({ endpoints: { foo: '/x' }, methods: { foo: 'POST' } });
  const json = await req.request('foo', {});
  assert.deepStrictEqual(json.rows, []);
});

// ─────────────────────────── TaskApi（挑 fetchTaskList 等）───────────────────────────

function loadTaskApi(cfg, callImpl) {
  const win = { __APP_CONFIG__: cfg || {}, JSON, fetch: () => {}, localStorage: { setItem() {}, removeItem() {} } };
  loadScript('js/core/api-client.js', { setTimeout: (fn) => setTimeout(fn, 0) }, win);
  win.API.call = callImpl;
  loadScript('js/api/task-api.js', {}, win);
  return win.TaskApi;
}

test('TaskApi.fetchTaskList：endpoint 未配置 → {ok:true, local:true, total:0, rows:[]}，零请求', async () => {
  const stub = recStub(() => okResp([], 0));
  const api = loadTaskApi({ taskEndpoints: { taskList: '' } }, stub.fn);
  const res = await api.fetchTaskList({}, 1, 10);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.local, true);
  assert.deepStrictEqual(res.rows, []);
  assert.strictEqual(res.total, 0);
  assert.strictEqual(stub.rec.calls, 0, '未配置不得发请求');
});

test('TaskApi.fetchTaskList：网络中断（fetch reject TypeError）→ 收敛 {ok:false, error}，不抛', async () => {
  const api = loadTaskApi({}, async () => { throw new TypeError('Failed to fetch'); });
  const res = await api.fetchTaskList({}, 1, 10);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, 'Failed to fetch');   // 用户可读，不是 [object Object]
  assert.deepStrictEqual(res.rows, []);
});

test('TaskApi.fetchTaskList：HTTP 500 → {ok:false}，error 带状态码，不抛', async () => {
  const api = loadTaskApi({}, async () => errResp(500));
  const res = await api.fetchTaskList({}, 1, 10);
  assert.strictEqual(res.ok, false);
  assert.ok(res.error.includes('500'), 'error 应含状态码：' + res.error);
});

test('TaskApi.fetchTaskList：200 但 body 非 JSON → {ok:false}，不抛', async () => {
  const api = loadTaskApi({}, async () => nonJsonResp());
  const res = await api.fetchTaskList({}, 1, 10);
  assert.strictEqual(res.ok, false);
  assert.ok(res.error.includes('接口返回的不是 JSON'), 'error：' + res.error);
});

test('TaskApi.fetchTaskList：业务码非 0 → {ok:false, error: 后端 msg}，不抛', async () => {
  const api = loadTaskApi({}, async () => bizFailResp('任务单编号不能为空'));
  const res = await api.fetchTaskList({}, 1, 10);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, '任务单编号不能为空');
});

test('TaskApi.fetchTaskList：正常 JSON（{total, rows}）→ 解出 total/rows，local=false', async () => {
  // 注意 fetchTaskList 读 json.rows（不是 records）
  const api = loadTaskApi({}, async () => ({
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ code: 0, rows: [{ id: 1 }, { id: 2 }], total: 2 }),
  }));
  const res = await api.fetchTaskList({}, 1, 10);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.local, false);
  assert.strictEqual(res.total, 2);
  assert.strictEqual(res.rows.length, 2);
});

test('TaskApi.fetchTaskList：total 为字符串 "123" → 转成数字 123；rows 缺失 → 回退 []', async () => {
  const api = loadTaskApi({}, async () => ({
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ code: 0, total: '123' }),   // 无 rows
  }));
  const res = await api.fetchTaskList({}, 1, 10);
  assert.strictEqual(res.total, 123);
  assert.strictEqual(typeof res.total, 'number');
  assert.deepStrictEqual(res.rows, []);
});

test('TaskApi.fetchTaskList：total 为 0 → {total:0}（数字 0 不被当 falsy 吞掉）', async () => {
  const api = loadTaskApi({}, async () => ({
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ code: 0, total: 0, rows: [{ id: 1 }] }),
  }));
  const res = await api.fetchTaskList({}, 1, 10);
  assert.strictEqual(res.total, 0);          // 不是被 ||0 吞成"无数据"
  assert.strictEqual(res.rows.length, 1);
});

test('TaskApi.fetchTaskList：连续两次调用各自独立、不串数据', async () => {
  let n = 0;
  const api = loadTaskApi({}, async () => {
    n += 1;
    return { ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ code: 0, rows: [{ seq: n }], total: 1 }) };
  });
  const a = await api.fetchTaskList({}, 1, 10);
  const b = await api.fetchTaskList({}, 1, 10);
  assert.strictEqual(a.rows[0].seq, 1);
  assert.strictEqual(b.rows[0].seq, 2);
});

// ─────────────────────────── ToolApi（fetchJudgeInfo + fetchPublishDataList）───────────────────────────

function loadToolApi(cfg, callImpl) {
  const win = { __APP_CONFIG__: cfg || {}, JSON, fetch: () => {}, localStorage: { setItem() {}, removeItem() {} } };
  loadScript('js/core/api-client.js', { setTimeout: (fn) => setTimeout(fn, 0) }, win);
  win.API.call = callImpl;
  loadScript('js/api/tool-api.js', {}, win);
  return win.ToolApi;
}

test('ToolApi.fetchJudgeInfo：endpoint 未配置 → {ok:true, local:true, list:[]}，零请求', async () => {
  const stub = recStub(() => okResp([], 0));
  const api = loadToolApi({ toolEndpoints: { judgeInfo: '' } }, stub.fn);
  const res = await api.fetchJudgeInfo({ compNum: 'E001' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.local, true);
  assert.deepStrictEqual(res.list, []);
  assert.strictEqual(stub.rec.calls, 0);
});

test('ToolApi.fetchJudgeInfo：网络中断 → {ok:false, error}，不抛', async () => {
  const api = loadToolApi({}, async () => { throw new TypeError('Failed to fetch'); });
  const res = await api.fetchJudgeInfo({ compNum: 'E001' });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, 'Failed to fetch');
});

test('ToolApi.fetchJudgeInfo：HTTP 500 → {ok:false, error 含 500}，不抛', async () => {
  const api = loadToolApi({}, async () => errResp(500));
  const res = await api.fetchJudgeInfo({ compNum: 'E001' });
  assert.strictEqual(res.ok, false);
  assert.ok(res.error.includes('500'));
});

test('ToolApi.fetchJudgeInfo：业务码非 0 → {ok:false, error: msg}，不抛', async () => {
  const api = loadToolApi({}, async () => bizFailResp('评委信息查询失败'));
  const res = await api.fetchJudgeInfo({ compNum: 'E001' });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, '评委信息查询失败');
});

test('ToolApi.fetchJudgeInfo：正常 JSON（data 为数组）→ list 正确解析', async () => {
  const api = loadToolApi({}, async () => ({
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ code: 0, data: [{ userId: '1' }, { userId: '2' }] }),
  }));
  const res = await api.fetchJudgeInfo({ compNum: 'E001' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.list.length, 2);
});

test('ToolApi.fetchPublishDataList：endpoint 未配置 → 直接抛错（缺抓包不发请求），不静默返回假 ok', async () => {
  const stub = recStub(() => okResp([], 0));
  const api = loadToolApi({ toolEndpoints: { publishDataList: '' } }, stub.fn);
  await expectThrow(() => api.fetchPublishDataList({ pageNum: 1 }), '接口未配置：publishDataList');
  assert.strictEqual(stub.rec.calls, 0, '未配置不得发请求');
});

// ─────────────────────────── ServiceApi（订阅写入事故面）───────────────────────────

function loadServiceApi(cfg, callImpl) {
  const win = { __APP_CONFIG__: cfg || {}, JSON, fetch: () => {}, localStorage: { setItem() {}, removeItem() {} } };
  loadScript('js/core/api-client.js', { setTimeout: (fn) => setTimeout(fn, 0) }, win);
  win.API.call = callImpl;
  loadScript('js/api/service-api.js', {}, win);
  return win.ServiceApi;
}

const ROW = { serverCoding: 'ObsUkbContectQuery', sysServeNo: 'E00301TO1197', deptId: 'K4229' };

test('ServiceApi.subscribeWithForm：endpoint 未配置 → {ok:true, local:true}，零请求', async () => {
  const stub = recStub(() => okResp([], 0, 0));
  const api = loadServiceApi({ endpoints: { subscribeAdd: '' } }, stub.fn);
  const res = await api.subscribeWithForm(ROW, { callerSystem: 'E00406' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.local, true);
  assert.strictEqual(stub.rec.calls, 0);
});

test('ServiceApi.subscribeWithForm：网络中断 → {ok:false, error}，不抛', async () => {
  const api = loadServiceApi({}, async () => { throw new TypeError('Failed to fetch'); });
  const res = await api.subscribeWithForm(ROW, { callerSystem: 'E00406' });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, 'Failed to fetch');
});

test('ServiceApi.subscribeWithForm：HTTP 500 → {ok:false, error 含 500}，不抛', async () => {
  const api = loadServiceApi({}, async () => errResp(500));
  const res = await api.subscribeWithForm(ROW, { callerSystem: 'E00406' });
  assert.strictEqual(res.ok, false);
  assert.ok(res.error.includes('500'));
});

test('ServiceApi.subscribeWithForm：成功但业务码非 0 → {ok:false, error: msg}（不落本地成功标记）', async () => {
  const api = loadServiceApi({}, async () => bizFailResp('订阅失败，请稍后重试'));
  const res = await api.subscribeWithForm(ROW, { callerSystem: 'E00406' });
  assert.strictEqual(res.ok, false, '业务失败绝不能记成订阅成功');
  assert.strictEqual(res.error, '订阅失败，请稍后重试');
});

test('ServiceApi.subscribe：只给编码（无明细）→ {ok:true, local:true, remoteSkipped:true}，不写远程', async () => {
  const stub = recStub(() => okResp([], 0, 0));
  const api = loadServiceApi({}, stub.fn);
  const res = await api.subscribe('ObsUkbContectQuery');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.local, true);
  assert.strictEqual(res.remoteSkipped, true);
  assert.strictEqual(stub.rec.calls, 0, '缺明细不得发远程写');
});

test('ServiceApi.fetchServiceDetail：endpoint 未配置 → {ok:true, local:true, data:null}，零请求', async () => {
  const stub = recStub(() => okResp([], 0, 0));
  const api = loadServiceApi({ endpoints: { serviceDetail: '' } }, stub.fn);
  const res = await api.fetchServiceDetail(ROW);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.local, true);
  assert.strictEqual(res.data, null);
  assert.strictEqual(stub.rec.calls, 0);
});

test('ServiceApi.fetchServiceDetail：正常 → 返回适配后的 data', async () => {
  // serviceDetail 默认未配置，必须显式配置端点才会真正请求
  const api = loadServiceApi({ endpoints: { serviceDetail: '/itamp-tool/publish/getServiceDetail' } }, async () => ({
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ code: 0, data: { serverCoding: 'X', detail: 'y' } }),
  }));
  const res = await api.fetchServiceDetail(ROW);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.local, false);
  assert.strictEqual(res.data.serverCoding, 'X');
});

test('ServiceApi.unsubscribe：现状——subscribeRemove 已配置仍只做本地移除、0 次请求（疑似缺陷）', async () => {
  // 现状：即便在配置里填上 subscribeRemove 端点，unsubscribe 也只返回
  // { ok:true, local:true, remoteSkipped:true }，根本不会向服务端发请求。
  // 后果：一旦接入真实端点，UI 显示「已取消」但后端仍订阅 —— 见报告。
  const stub = recStub(() => okResp([], 0, 0));
  const api = loadServiceApi({ endpoints: { subscribeRemove: '/itamp-tool/publish/unsubscribe' } }, stub.fn);
  const res = await api.unsubscribe('ObsUkbContectQuery');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.local, true);
  assert.strictEqual(res.remoteSkipped, true);
  assert.strictEqual(stub.rec.calls, 0, '现状：配置了端点也不真正请求服务端（疑似缺陷）');
});

test('ServiceApi.unsubscribe：subscribeRemove 未配置 → {ok:true, local:true}，零请求', async () => {
  const stub = recStub(() => okResp([], 0, 0));
  const api = loadServiceApi({}, stub.fn);
  const res = await api.unsubscribe('ObsUkbContectQuery');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.local, true);
  assert.strictEqual(stub.rec.calls, 0);
});

// ─────────────────────────── UserApi（挑 fetchUserList）───────────────────────────

function loadUserApi(cfg, callImpl) {
  const win = { __APP_CONFIG__: cfg || {}, JSON, fetch: () => {}, localStorage: { setItem() {}, removeItem() {} } };
  loadScript('js/core/api-client.js', { setTimeout: (fn) => setTimeout(fn, 0) }, win);
  win.API.call = callImpl;
  loadScript('js/api/user-api.js', {}, win);
  return win.UserApi;
}

test('UserApi.fetchUserList：endpoint 未配置 → {ok:true, local:true, list:[]}，零请求', async () => {
  const stub = recStub(() => okResp([], 0));
  const api = loadUserApi({ userEndpoints: { userList: '' } }, stub.fn);
  const res = await api.fetchUserList('李胜');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.local, true);
  assert.deepStrictEqual(res.list, []);
  assert.strictEqual(stub.rec.calls, 0);
});

test('UserApi.fetchUserList：网络中断 → {ok:false, error}，不抛', async () => {
  const api = loadUserApi({}, async () => { throw new TypeError('Failed to fetch'); });
  const res = await api.fetchUserList('李胜');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, 'Failed to fetch');
});

test('UserApi.fetchUserList：业务码非 0 → {ok:false, error: msg}，不抛', async () => {
  const api = loadUserApi({}, async () => bizFailResp('查无此人'));
  const res = await api.fetchUserList('李胜');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, '查无此人');
});

// ─────────────────────────── PublishQuery.fetchPages（冻结模块）───────────────────────────

function loadQueryLayer(fetchImpl) {
  const win = {};
  loadScript('js/core/publish-response.js', {}, win);   // 真 parse
  win.ToolApi = { fetchPublishDataList: fetchImpl };
  loadScript('js/page/publish-query.js', {}, win);       // 冻结：依赖在加载前就位
  return win;
}

test('PublishQuery.fetchPages：底层 fetch 网络中断 → 该页进 failed、不抛异常、未中止', async () => {
  const win = loadQueryLayer(async () => { throw new TypeError('Failed to fetch'); });
  const { byPage, failed, aborted } = await win.PublishQuery.fetchPages({
    baseBody: {}, pages: [1], isCurrent: () => true,
  });
  assert.strictEqual(aborted, false);
  assert.deepStrictEqual(failed, [1]);
  assert.strictEqual(byPage.size, 0);
});

test('PublishQuery.fetchPages：HTTP 非 2xx（resp.ok=false）→ 该页进 failed，不抛', async () => {
  const win = loadQueryLayer(async () => errResp(500));
  const { failed, aborted } = await win.PublishQuery.fetchPages({
    baseBody: {}, pages: [1], isCurrent: () => true,
  });
  assert.strictEqual(aborted, false);
  assert.deepStrictEqual(failed, [1]);
});

test('PublishQuery.fetchPages：200 但 json() 非 JSON（SyntaxError）→ 该页进 failed，不抛', async () => {
  const win = loadQueryLayer(async () => nonJsonResp());
  const { failed, aborted } = await win.PublishQuery.fetchPages({
    baseBody: {}, pages: [1], isCurrent: () => true,
  });
  assert.deepStrictEqual(failed, [1]);
  assert.strictEqual(aborted, false);
});

test('PublishQuery.fetchPages：业务码非 0 → 该页进 failed，不抛', async () => {
  const win = loadQueryLayer(async () => ({ ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ code: 500, msg: 'x' }) }));
  const { failed, aborted } = await win.PublishQuery.fetchPages({
    baseBody: {}, pages: [1], isCurrent: () => true,
  });
  assert.deepStrictEqual(failed, [1]);
  assert.strictEqual(aborted, false);
});

test('PublishQuery.fetchPages：data 为 null → 该页 rows=[]（空结果，不造假），不进 failed', async () => {
  const win = loadQueryLayer(async () => ({
    ok: true, status: 200, headers: { get: () => null },
    json: async () => ({ code: 0, data: null }),
  }));
  const { byPage, failed, aborted } = await win.PublishQuery.fetchPages({
    baseBody: {}, pages: [1], isCurrent: () => true,
  });
  assert.deepStrictEqual(failed, []);
  assert.strictEqual(aborted, false);
  assert.deepStrictEqual(byPage.get(1), []);
});

test('PublishQuery.fetchPages：触发 AbortError（用户取消）→ aborted=true，不记成失败页', async () => {
  const win = loadQueryLayer(async () => {
    const e = new Error('aborted'); e.name = 'AbortError'; throw e;
  });
  const { failed, aborted } = await win.PublishQuery.fetchPages({
    baseBody: {}, pages: [1], isCurrent: () => true,
  });
  assert.strictEqual(aborted, true);
  assert.deepStrictEqual(failed, [], '取消不应记成错误页');
});

test('PublishQuery.fetchPages：调用方传入已 abort 的 signal → 不发请求、aborted=true', async () => {
  let calls = 0;
  const win = loadQueryLayer(async () => { calls += 1; return okResp([{ id: 1 }], 1); });
  const ac = new AbortController();
  ac.abort();
  const { aborted, failed } = await win.PublishQuery.fetchPages({
    baseBody: {}, pages: [1], signal: ac.signal, isCurrent: () => !ac.signal.aborted,
  });
  assert.strictEqual(aborted, true);
  assert.deepStrictEqual(failed, []);
  assert.strictEqual(calls, 0, '已取消不应再发请求');
});

test('PublishQuery.fetchPages：连续两次调用各自独立、不串数据', async () => {
  let c = 0;
  const win = loadQueryLayer(async () => { c += 1; return okResp([{ seq: c }], 1); });
  const a = await win.PublishQuery.fetchPages({ baseBody: {}, pages: [1], isCurrent: () => true });
  const b = await win.PublishQuery.fetchPages({ baseBody: {}, pages: [1], isCurrent: () => true });
  assert.strictEqual(a.byPage.get(1)[0].seq, 1);
  assert.strictEqual(b.byPage.get(1)[0].seq, 2);
});

test('PublishQuery.fetchPages：正常多页 → 按页码收集、failed=[], aborted=false', async () => {
  const win = loadQueryLayer(async (body) => okResp([{ page: body.pageNum }], 2));
  const { byPage, failed, aborted } = await win.PublishQuery.fetchPages({
    baseBody: {}, pages: [1, 2], concurrency: 2, isCurrent: () => true,
  });
  assert.strictEqual(aborted, false);
  assert.deepStrictEqual(failed, []);
  assert.deepStrictEqual([...byPage.keys()].sort((x, y) => x - y), [1, 2]);
});

// ─────────────────────────── PublishQuery.doQuery / retryFailedPages / exportCsv ───────────────────────────

const FETCH = 200;
const TOTAL = 450;
function pageData(p, total) {
  const start = (p - 1) * FETCH + 1;
  const end = Math.min(total, p * FETCH);
  const records = [];
  for (let i = start; i <= end; i++) records.push({ id: i, serverCoding: 'S' + i, offerServerState: '运行中' });
  return records;
}

function setupDoQuery() {
  const win = loadScript('js/page/publish-model.js');
  win.fetch = () => {};
  win.JSON = JSON;
  win.localStorage = { setItem() {}, removeItem() {} };
  loadScript('js/core/publish-response.js', {}, win);
  loadScript('js/ui/table-utils.js', {}, win);
  loadScript('js/page/publish-query.js', {}, win);

  const rec = {
    toasts: [], stats: [], retryBars: [], replay: [], errors: [], empty: [],
    loading: [], focused: [], deptRows: [], requests: [],
    retryBtn: { disabled: false, textContent: '重试失败分页' },
  };
  win.PublishView = {
    updateStats: (d) => rec.stats.push(d),
    updateRetryBar: (pages) => rec.retryBars.push((pages || []).slice()),
    updateCacheReplayBar: (loose) => rec.replay.push(!!loose),
    applySubscribeFilter: (s) => { s.pageNum = 1; s.filteredRows = s.rawRows.slice(); },
    renderCurrentPage: () => {},
    updatePagination: () => {},
    renderEmptyResult: (h) => rec.empty.push(h),
    renderQueryError: (e) => rec.errors.push(e),
  };
  const state = { currentFilter: 'all', displayedRows: [], filteredRows: [], pageNum: 1, pageSize: 10, totalItems: 0, rawRows: [] };
  const ctx = {
    state,
    retryBtn: rec.retryBtn,
    checkSubscribeStatus: () => 'unknown',
    collectApiBody: () => ({ compNum: 'E001', batch: '2609批次' }),
    collectLocalFilters: () => [],
    resolveBatchLabel: () => ({ value: '2609pc', label: '2609批次', ok: true }),
    getDeptValue: () => '',
    getProviderValue: () => 'E001',
    getBatchValue: () => '2609pc',
    focusProvider: () => rec.focused.push('provider'),
    focusBatch: () => rec.focused.push('batch'),
    fillDeptListFromRows: (rows) => rec.deptRows.push(rows.length),
    showToast: (msg, ms, type) => rec.toasts.push({ msg, ms, type }),
    showLoading: () => rec.loading.push(true),
    hideLoading: () => rec.loading.push(false),
    debugLog: () => {},
  };
  win.ToolApi = { fetchPublishDataList: async () => okResp([], 0) };
  const Q = win.PublishQuery;
  Q.init(ctx);
  return { win, Q, ctx, state, rec };
}

const toastOf = (t, needle) => t.rec.toasts.find((x) => x.msg.includes(needle));

function installBackend(t, getPage) {
  t.win.ToolApi = {
    fetchPublishDataList: async (body) => {
      t.rec.requests.push({ ...body });
      const r = getPage(body.pageNum);
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

test('PublishQuery.retryFailedPages：无失败分页（queryState 未初始化）→ 直接返回、不发请求', async () => {
  const t = setupDoQuery();
  await t.Q.retryFailedPages();
  assert.strictEqual(t.rec.requests.length, 0, '无失败页不应发任何请求');
  assert.strictEqual(t.rec.retryBtn.disabled, false);
});

test('PublishQuery.retryFailedPages：重试后仍有失败页 → 失败清单保留（hasFailedPages 仍 true）', async () => {
  const t = setupDoQuery();
  let failPage2 = true;
  installBackend(t, (p) => (p === 2 && failPage2 ? errResp(500) : okResp(pageData(p, TOTAL), TOTAL)));

  await t.Q.doQuery({ focusMissing: false });
  assert.strictEqual(t.Q.hasFailedPages(), true, 'doQuery 后应存在失败分页');

  // 让第 2 页在重试时继续失败
  await t.Q.retryFailedPages();

  assert.strictEqual(t.Q.hasFailedPages(), true, '重试后仍失败，清单必须保留');
  assert.deepStrictEqual(t.rec.retryBars[t.rec.retryBars.length - 1], [2]);
  assert.ok(toastOf(t, '仍有第 2 页获取失败'), '应提示仍有失败页');
});

test('PublishQuery.retryFailedPages：重试补齐失败页 → 失败清单清空', async () => {
  const t = setupDoQuery();
  let failPage2 = true;
  installBackend(t, (p) => (p === 2 && failPage2 ? errResp(500) : okResp(pageData(p, TOTAL), TOTAL)));

  await t.Q.doQuery({ focusMissing: false });
  assert.strictEqual(t.Q.hasFailedPages(), true);

  failPage2 = false;                                  // 重试前修好第 2 页
  await t.Q.retryFailedPages();

  assert.strictEqual(t.Q.hasFailedPages(), false, '补齐后不应再有失败页');
  assert.deepStrictEqual(t.rec.retryBars[t.rec.retryBars.length - 1], []);
  assert.strictEqual(t.state.rawRows.length, TOTAL);
});

test('PublishQuery.doQuery：网络中断 → 可读的「网络连接失败」toast，不抛异常、loading 收回', async () => {
  const t = setupDoQuery();
  installBackend(t, () => { throw new TypeError('Failed to fetch'); });
  await t.Q.doQuery({ focusMissing: false });
  assert.ok(toastOf(t, '网络连接失败'), '应给出用户可读的网络错误，实际：' + JSON.stringify(t.rec.toasts));
  assert.strictEqual(t.rec.errors.length, 1);
  assert.strictEqual(t.rec.loading[t.rec.loading.length - 1], false);
});

test('PublishQuery.exportCsv：CsvExporter 模块缺失 → 明确提示「导出模块未加载」，不崩不静默', async () => {
  const t = setupDoQuery();
  delete t.win.CsvExporter;        // 模拟依赖缺失
  t.ctx.state.filteredRows = [{ id: 1 }];
  t.Q.exportCsv();
  assert.ok(toastOf(t, '导出模块未加载'), '依赖缺失应显式失败');
});

test('PublishQuery.exportCsv：filteredRows=[] → 调用导出器且不崩（只交空数组，表头由导出器负责）', async () => {
  const t = setupDoQuery();
  let got = 'NOT_CALLED';
  t.win.CsvExporter = { exportRows: (rows) => { got = rows; } };
  t.ctx.state.filteredRows = [];
  assert.doesNotThrow(() => t.Q.exportCsv());
  assert.deepStrictEqual(got, [], '空结果也应正常传给导出器，而不是静默跳过或崩');
});

// ─────────────────────────── API.call 传输层（超时 / 中断 / 网络）──────────────────────────

function freshApiClient() {
  const timers = [];
  const win = {};
  loadScript('js/core/api-client.js', {
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length - 1; },
  }, win);
  return { API: win.API, timers };
}
function hangingFetch() {
  return (url, opts) => new Promise((_, reject) => {
    const sig = opts && opts.signal;
    if (!sig) return;
    const abort = () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); };
    if (sig.aborted) return abort();
    sig.addEventListener('abort', abort);
  });
}
async function withFetch(stub, fn) {
  const origin = global.fetch;
  global.fetch = stub;
  try { return await fn(); } finally { global.fetch = origin; }
}

test('API.call：网络中断（fetch reject TypeError）→ 抛 TypeError，由上层收敛为 {ok:false}（不静默过）', async () => {
  const { API } = freshApiClient();
  await withFetch(async () => { throw new TypeError('Failed to fetch'); }, async () => {
    let err = null;
    try { await API.call('/x', { timeout: 0 }); } catch (e) { err = e; }
    assert.ok(err, '网络中断必须显式失败，不能返回假 ok');
    assert.strictEqual(err.name, 'TypeError');
    assert.strictEqual(err.message, 'Failed to fetch');
  });
});

test('API.call：请求超时 → 抛带「请求超时」的可读文案，而不是裸对象', async () => {
  const { API, timers } = freshApiClient();
  await withFetch(hangingFetch(), async () => {
    const p = API.call('/x', { timeout: 20000 });
    assert.strictEqual(timers.length, 1, '应挂默认超时定时器');
    assert.strictEqual(timers[0].ms, 20000);
    timers[0].fn();                       // 模拟 20s 无响应
    let err = null;
    try { await p; } catch (e) { err = e; }
    assert.ok(err, '超时必须失败');
    assert.match(String(err.message), /请求超时/);
  });
});
