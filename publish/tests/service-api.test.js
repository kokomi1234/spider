/**
 * 订阅写入路径单测（js/api/service-api.js）。
 *
 * 这是全项目唯一「往生产库写数据」的链路，此前零测试。
 * 这里不去导出内部函数，而是直接走 subscribeWithForm()，把 window.API.call 换成桩，
 * 检查**真正会被提交的请求体** —— 正好覆盖 2026-09-15 修的那批抓包样例常量。
 */
'use strict';

const { loadScript, test } = require('./harness');
const assert = require('assert');

function freshServiceApi(callImpl) {
  const win = { toast: () => {}, __APP_CONFIG__: undefined };
  loadScript('js/core/api-client.js', {}, win);
  win.API.call = callImpl;
  loadScript('js/api/service-api.js', {}, win);
  return win.ServiceApi;
}

/** 抓一次请求体 */
async function captureBody(fn) {
  let captured = null;
  const api = freshServiceApi(async (path, opts) => {
    captured = { path, opts };
    return { ok: true, status: 200, json: async () => ({ code: 200, msg: '操作成功' }) };
  });
  const res = await fn(api);
  return { captured, res };
}

const ROW = {
  serverCoding: 'ObsUkbContectQuery',
  sysServeNo: 'E00301TO1197',
  prodBatch: '2609批次',
  prodBatchList: '2610批次',
  assemblyNo: 'E00301',
  assemblyName: '互联网金融服务平台',
  deptId: 'K4229',
  deptName: '软件中心某部门',
  offerEffectiveTime: '2026-09-04',
  offerServerState: '开发基线',
  isBackup: '否',
};

test('subscribeWithForm：请求体不再带抓包样例的批次 / 日期 / 状态', async () => {
  const { captured } = await captureBody((api) => api.subscribeWithForm(ROW, { callerSystem: 'E00406' }));
  const pub = captured.opts.body.publishSubcription;

  // 来自 row 的字段照常带上
  assert.strictEqual(pub.prodBatch, '2609批次');
  assert.strictEqual(pub.prodBatchList, '2610批次');
  assert.strictEqual(pub.offerEffectiveTime, '2026-09-04');
  assert.strictEqual(pub.deptId, 'K4229');
  assert.strictEqual(pub.assemblyNo, 'E00301');

  // 曾经写死成 '2611批次' / '2026-09-04' / '功能测试基线' 等样例值的字段，
  // row 没带时必须是 null（让后端报错），绝不能是样例常量
  assert.notStrictEqual(pub.sheetProductBatch, '2611批次');
  assert.notStrictEqual(pub.prodBatch, '2611批次');
  assert.notStrictEqual(pub.prodBatchList, '2611批次');
  assert.strictEqual(pub.sheetProductBatch, null);
  assert.strictEqual(pub.version, null);              // row 没带 version → null（不再是 'BOCNET-G-IFS_V01.1M_B45'）
  assert.strictEqual(pub.provideSystemNumber, 'E00301');   // 来自 row.assemblyNo
  assert.strictEqual(pub.provideComponentName, '互联网金融服务平台'); // 来自 row.assemblyName
  assert.strictEqual(pub.deptName, '软件中心某部门');      // 来自 row
});

test('subscribeWithForm：row 缺字段时一律 null，不回收样例句柄', async () => {
  const { captured } = await captureBody((api) => api.subscribeWithForm({ serverCoding: 'C1' }, null));
  const pub = captured.opts.body.publishSubcription;
  ['provideComponentName', 'provideSystemNumber', 'assemblyNo', 'assemblyName', 'deptId', 'deptName']
    .forEach((k) => assert.strictEqual(pub[k], null, `${k} 应为 null，实际 ${JSON.stringify(pub[k])}`));
});

test('subscribeWithForm：查询条件缺失时字段为 null，而不是沿用样例实体', async () => {
  // 只给服务编码（等价「手动订阅」那条路径：拿不到完整 row）
  const { captured } = await captureBody((api) => api.subscribeWithForm('ObsUkbContectQuery', null));
  const pub = captured.opts.body.publishSubcription;

  ['sheetProductBatch', 'prodBatch', 'prodBatchList', 'offerEffectiveTime',
    'offerServerState', 'assemblyNo', 'assemblyName', 'deptId', 'deptName', 'version']
    .forEach((k) => {
      assert.ok(pub[k] === null || pub[k] === undefined,
        `${k} 应为 null（缺失就让后端报错），实际 ${JSON.stringify(pub[k])}`);
    });

  assert.strictEqual(pub.serverCoding, 'ObsUkbContectQuery');
  assert.strictEqual(pub.interfaceCode, 'ObsUkbContectQuery');
});

test('subscribeWithForm：没选关联文档时提交空数组，不塞别人的文档', async () => {
  const { captured } = await captureBody((api) => api.subscribeWithForm(ROW, { callerSystem: 'E00406' }));
  assert.deepStrictEqual(captured.opts.body.documents, []);

  const withDoc = await captureBody((api) => api.subscribeWithForm(ROW, {
    callerSystem: 'E00406',
    relDocIds: 'doc-1,doc-2',
    relDocNames: '甲文档、乙文档',
  }));
  const docs = withDoc.captured.opts.body.documents;
  assert.strictEqual(docs.length, 2);
  assert.strictEqual(docs[0].docInstId, 'doc-1');
  assert.strictEqual(docs[1].docName, '乙文档');
});

test('subscribeWithForm：prodSysServeNoList 由调用方编号 + 提供者编号尾部 TO 号拼出', async () => {
  const { captured } = await captureBody((api) => api.subscribeWithForm(ROW, { callerSystem: 'E00406' }));
  const pub = captured.opts.body.publishSubcription;
  assert.deepStrictEqual(pub.prodSysServeNoList, ['E00406TO1197']);

  // 表单里已确认过调用方服务号时，以表单为准
  const withForm = await captureBody((api) => api.subscribeWithForm(ROW, {
    callerSystem: 'E00406',
    callerServiceNo: 'E00406TO9999',
  }));
  assert.deepStrictEqual(withForm.captured.opts.body.publishSubcription.prodSysServeNoList, ['E00406TO9999']);
});

test('subscribe：只给编码时不发远程写（缺明细会把兜底值写进生产库）', async () => {
  let called = 0;
  const api = freshServiceApi(async () => { called += 1; return { ok: true, status: 200, json: async () => ({ code: 200 }) }; });

  const byCode = await api.subscribe('X1');
  assert.strictEqual(byCode.ok, true);
  assert.strictEqual(byCode.remoteSkipped, true, '缺明细时应明确告知只记本地');
  assert.strictEqual(called, 0, '不得发远程写');

  // 传完整 row 才真的发一次
  const byRow = await api.subscribe(ROW);
  assert.strictEqual(byRow.ok, true);
  assert.strictEqual(byRow.local, false);
  assert.strictEqual(called, 1);
});

test('unsubscribe：端点为空的接口不发请求（取消订阅只做本地移除）', async () => {
  let called = 0;
  const api = freshServiceApi(async () => { called += 1; return { ok: true, status: 200, json: async () => ({ code: 200 }) }; });
  assert.strictEqual(api.isEnabled('subscribeRemove'), false, '默认未配置 = 该能力关闭');

  const rm = await api.unsubscribe('X1');
  assert.strictEqual(rm.ok, true);
  assert.strictEqual(called, 0, '未配置的接口不得发请求');
});

test('接口失败收敛成 { ok:false, error }，不抛异常', async () => {
  const api = freshServiceApi(async () => ({ ok: false, status: 500, text: async () => 'boom' }));
  const res = await api.subscribeWithForm(ROW, { callerSystem: 'E00406' });
  assert.strictEqual(res.ok, false);
  assert.ok(res.error && res.error.includes('500'), '错误里应带状态码：' + res.error);
});
