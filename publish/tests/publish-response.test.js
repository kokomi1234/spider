/**
 * publish-response.js 单测：响应解析（含 loose 回放标记）、错误文案、参数校验。
 */
'use strict';

const { loadScript, test } = require('./harness');
const assert = require('assert');

const win = loadScript('js/core/publish-response.js');
const PR = win.PublishResponse;

/** 造一个最小 Response 替身 */
function resp({ ok = true, status = 200, json = {}, headers = {} } = {}) {
  return {
    ok,
    status,
    json: async () => json,
    headers: { get: (k) => (String(k).toLowerCase() in headers ? headers[String(k).toLowerCase()] : null) },
  };
}

test('parse：取 rows / total，loose 默认 false', async () => {
  const r = await PR.parse(resp({ json: { code: 200, data: { rows: [{ a: 1 }], total: 7 } } }));
  assert.strictEqual(r.rows.length, 1);
  assert.strictEqual(r.total, 7);
  assert.strictEqual(r.loose, false);
});

test('parse：X-Cache-Match: loose 必须上报（否则回放数据会被当成真实结果）', async () => {
  const r = await PR.parse(resp({
    json: { code: 200, data: { rows: [], total: 0 } },
    headers: { 'x-cache-match': 'loose' },
  }));
  assert.strictEqual(r.loose, true);
});

test('parse：data 缺失时回退到 list/records 或整体', async () => {
  const r = await PR.parse(resp({ json: { code: 200, list: [{ b: 2 }] } }));
  assert.strictEqual(r.rows.length, 1, '无 data 时应回退到 list');
  assert.strictEqual(r.total, 1, '无 total 时用 rows.length');
});

test('parse：业务错误码抛错并带上 msg', async () => {
  let err = null;
  try { await PR.parse(resp({ json: { code: 500, msg: '炸了' } })); } catch (e) { err = e; }
  assert.ok(err && /炸了/.test(err.message), '应抛出带后端 msg 的错误');
});

test('parse：非 2xx 抛 HTTP 错误', async () => {
  let err = null;
  try { await PR.parse(resp({ ok: false, status: 502 })); } catch (e) { err = e; }
  assert.ok(err && /HTTP 502/.test(err.message));
});

test('parseApiError：401/403/500/网络失败各有对应文案', () => {
  assert.ok(/认证失败/.test(PR.parseApiError({ status: 401 }, {})));
  assert.ok(/权限不足/.test(PR.parseApiError({ status: 403 }, {})));
  assert.ok(/服务器内部错误/.test(PR.parseApiError({ status: 500 }, {})));
  assert.ok(/网络连接失败/.test(PR.parseApiError({ status: 0 }, { message: 'Failed to fetch' })));
});

test('parseApiError：404 给「没查到 + 下一步」，且不暴露部署细节', () => {
  const msg = PR.parseApiError({ status: 404 }, {});
  assert.ok(/没有查到/.test(msg), '要明说「没查到」，否则用户会以为查到的是空结果');
  assert.ok(/重试|调整筛选/.test(msg), '要给出下一步动作');
  assert.ok(!/接口地址不存在/.test(msg), '旧文案会把人往错误方向带');
  // 清单 C2：404 这句是直接上屏给业务用户的，不能出现缓存 / 代理 / 控制台这些内部概念
  assert.ok(!/缓存|代理|控制台|Network|F12/.test(msg), '不得在业务提示里暴露部署细节');
});

test('validateFilters：合法条件无错误，越界条件报错', () => {
  assert.deepStrictEqual(PR.validateFilters({ compNum: 'E00301', pageSize: 10, pageNum: 1 }), []);
  assert.ok(PR.validateFilters({ compNum: '12345' }).length > 0, '数字开头的编号不合法');
  assert.ok(PR.validateFilters({ pageSize: 101 }).length > 0, 'pageSize 超 100');
  assert.ok(PR.validateFilters({ pageNum: 0 }).length > 0, 'pageNum 从 1 开始');
});
