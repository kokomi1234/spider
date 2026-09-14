/**
 * 公共请求层（core/api-client.js 的 createRequester）单测。
 *
 * 这层是四个 api 模块（tool/service/task/user）共用的协议层：端点取值、发请求、
 * 业务码校验、错误文案。它错了四个模块一起错，所以单独钉一遍。
 *
 * 注意：createRequester 里**延迟**取 window.API.call（不在工厂里捕获），
 * 所以这里可以在加载后替换传输层，等价「真客户端 + 假传输」。
 */
'use strict';

const { loadScript, test } = require('./harness');
const assert = require('assert');

function fresh() {
  const win = {};
  loadScript('js/core/api-client.js', {}, win);
  return win.API;
}

const okJson = (payload) => async () => ({ ok: true, status: 200, json: async () => payload });

test('createRequester：未配置的 endpoint 直接抛错，且一个请求都不发', async () => {
  const API = fresh();
  let called = 0;
  API.call = async () => { called += 1; return { ok: true, status: 200, json: async () => ({}) }; };

  const r = API.createRequester({ endpoints: { a: '', b: '/x' }, methods: {} });
  assert.strictEqual(r.isEnabled('a'), false);
  assert.strictEqual(r.isEnabled('b'), true);

  await assert.rejects(() => r.request('a'), /接口未配置/);
  assert.strictEqual(called, 0, '未配置时不得发请求');
});

test('createRequester：业务码只认 0 / 200，字符串 "200" 也算成功', async () => {
  const API = fresh();
  const r = API.createRequester({ endpoints: { x: '/x' }, methods: {} });

  for (const code of [200, '200', 0, '0']) {
    API.call = okJson({ code, data: 1 });
    const json = await r.request('x');
    assert.strictEqual(json.code, code);
  }

  // 非 0/200 抛错，并优先用后端的 msg
  API.call = okJson({ code: 500, msg: '物理应用组件编号不能为空' });
  await assert.rejects(() => r.request('x'), /物理应用组件编号不能为空/);

  // 没有 code 的响应（列表类接口）放行
  API.call = okJson({ total: 0, rows: [] });
  const noCode = await r.request('x');
  assert.strictEqual(noCode.total, 0);
});

test('createRequester：HTTP 错误与非 JSON 给出可读错误', async () => {
  const API = fresh();
  const r = API.createRequester({ endpoints: { x: '/x' }, methods: {} });

  API.call = async () => ({ ok: false, status: 404, text: async () => 'nf' });
  await assert.rejects(() => r.request('x'), /HTTP 404 nf/);

  API.call = async () => ({ ok: true, status: 200, json: async () => { throw new Error('Unexpected token <'); } });
  await assert.rejects(() => r.request('x'), /接口返回的不是 JSON/);
});

test('createRequester：body 为 undefined 时不带 body；query 原样透传', async () => {
  const API = fresh();
  const r = API.createRequester({ endpoints: { x: '/x' }, methods: { x: 'POST' } });

  const seen = [];
  API.call = async (path, opts) => { seen.push({ path, opts }); return { ok: true, status: 200, json: async () => ({ code: 200 }) }; };

  await r.request('x');
  assert.strictEqual('body' in seen[0].opts, false, 'undefined 的 body 不应出现在请求里');
  assert.strictEqual(seen[0].opts.method, 'POST');

  await r.request('x', { compNum: 'E00301' }, { n: '0.1' });
  assert.deepStrictEqual(seen[1].opts.body, { compNum: 'E00301' });
  assert.deepStrictEqual(seen[1].opts.query, { n: '0.1' });
  assert.strictEqual(seen[1].path, '/x');
});

test('createRequester：缺方法时默认 POST', async () => {
  const API = fresh();
  const r = API.createRequester({ endpoints: { x: '/x' }, methods: {} });
  let method = '';
  API.call = async (path, opts) => { method = opts.method; return { ok: true, status: 200, json: async () => ({}) }; };
  await r.request('x', {});
  assert.strictEqual(method, 'POST');
});
