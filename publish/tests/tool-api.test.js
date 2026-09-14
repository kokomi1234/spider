/**
 * tool-api.js 单测：响应形态解析（重点是 getInformationProdBatch 的 D 型三层嵌套）
 * 与「失败不抛异常、一律返回 { ok:false, error }」的约定。
 */
'use strict';

const assert = require('assert');
const { loadScript, test } = require('./harness');

/** 用给定的 API.call 实现加载 tool-api.js，返回 window.ToolApi */
function fresh(callImpl, config) {
  const win = { __APP_CONFIG__: config, API: { call: callImpl } };
  loadScript('js/api/tool-api.js', {}, win);
  return win.ToolApi;
}

const okJson = (payload) => async () => ({ ok: true, status: 200, json: async () => payload });

/** getInformationProdBatch 的真实响应形状（三层嵌套，见 ITAMP接口总览.md「D 型」） */
const D_TYPE = {
  code: 200,
  msg: '操作成功',
  data: {
    code: 200,
    msg: '操作成功',
    data: {
      sysServeNoList: [
        { label: 'E00301TP42E9', value: 'E00301TP42E9', shortEn: null },
        { label: 'E00301TO1182', value: 'E00301TO1182', shortEn: null },
      ],
    },
  },
};

test('fetchInformationProdBatch：解 D 型三层嵌套，拿到 sysServeNoList', async () => {
  const api = fresh(okJson(D_TYPE));
  const res = await api.fetchInformationProdBatch('E00301');

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.local, false);
  assert.strictEqual(res.list.length, 2, '三层嵌套解错就会返回空数组');
  assert.strictEqual(res.list[0].value, 'E00301TP42E9');
});

test('fetchInformationProdBatch：浅一层 / 直接给数组也吃得下', async () => {
  const oneLevel = { code: 200, data: { sysServeNoList: [{ label: 'A', value: 'A' }] } };
  const asArray = { code: 200, data: [{ label: 'B', value: 'B' }] };

  assert.strictEqual((await fresh(okJson(oneLevel)).fetchInformationProdBatch('X')).list[0].value, 'A');
  assert.strictEqual((await fresh(okJson(asArray)).fetchInformationProdBatch('X')).list[0].value, 'B');
});

test('fetchInformationProdBatch：没有该字段时返回空数组，而不是骗人的假数据', async () => {
  const res = await fresh(okJson({ code: 200, data: {} })).fetchInformationProdBatch('X');
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.list, []);
});

test('接口失败：HTTP 非 2xx → { ok:false, error }，不抛异常', async () => {
  const api = fresh(async () => ({ ok: false, status: 500, text: async () => 'boom' }));
  const res = await api.fetchInformationProdBatch('E00301');

  assert.strictEqual(res.ok, false);
  assert.ok(res.error && res.error.includes('500'), '错误里应带状态码：' + res.error);
});

test('接口失败：业务码非 0/200 → 同样收敛成 { ok:false }', async () => {
  const api = fresh(okJson({ code: 500, msg: '物理应用组件编号不能为空' }));
  const res = await api.fetchInformationProdBatch('');

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, '物理应用组件编号不能为空');
});

test('endpoint 被配置成空串 → 走本地兜底，一个请求都不发', async () => {
  let called = 0;
  const api = fresh(async () => { called += 1; return { ok: true, status: 200, json: async () => ({}) }; },
    { toolEndpoints: { infoProdBatch: '' } });
  const res = await api.fetchInformationProdBatch('E00301');

  assert.strictEqual(res.local, true);
  assert.strictEqual(called, 0, '未配置 endpoint 时不得发网络请求');
  assert.deepStrictEqual(res.list, []);
});

test('导出订阅关系相关接口已彻底移除', () => {
  const api = fresh(okJson({}));
  assert.strictEqual(api.exportSubscriptionPublishHistory, undefined);
  assert.strictEqual('subscriptionExport' in api.endpoints, false, 'endpoints 里不该再有 subscriptionExport');
});
