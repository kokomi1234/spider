/**
 * user-api.js 单测：钉住「传参位置」这一个点。
 *
 * 为什么专门钉这里：抓包（har/userinfo.har）确认两个接口都是
 * 「POST + 纯查询参数 + 无请求体」—— userName / userId / n 全在 URL 上。
 * 曾经把 {userName, n} 塞进 request() 的第 2 参（body）发 JSON：
 * 后端按 query 取参什么都取不到，按姓名 / 按工号全部查不到结果，
 * 而且前端不报错、只是空列表，极难排查。这里用真实协议层
 * （api-client 的 call + 假 fetch 捕获实际请求）验证线上形态。
 */
'use strict';

const { loadScript, test } = require('./harness');
const assert = require('assert');

/** 加载真实协议层 + user-api（同一 window，与浏览器脚本顺序一致） */
function freshUserApi() {
  const win = {};
  // harness 的 new Function 会把 setTimeout / clearTimeout 注进来（未显式传时兜底到宿主实现），
  // api-client 的超时计时要用它们。这里仍然显式传一份：万一将来换掉兜底策略，这条仍走我们给的版本
  loadScript('js/core/api-client.js', { setTimeout: (fn, ms) => setTimeout(fn, ms) }, win);
  loadScript('js/api/user-api.js', {}, win);
  return win.UserApi;
}

/** 替换 global.fetch 捕获请求，结束后还原 */
async function withFetch(recorder, fn) {
  const origin = global.fetch;
  global.fetch = recorder;
  try { return await fn(); } finally { global.fetch = origin; }
}

test('fetchUserList：userName / n 必须走 query，body 必须为空（否则后端取不到参数）', async () => {
  const UserApi = freshUserApi();
  const seen = [];
  await withFetch(async (url, opts) => {
    seen.push({ url: String(url), body: opts ? opts.body : undefined, method: opts && opts.method });
    return {
      ok: true, status: 200,
      json: async () => ({ code: 200, msg: '操作成功', data: [{ userId: '4711510', userName: '李胜', orgName: '开发三部' }] }),
    };
  }, async () => {
    const r = await UserApi.fetchUserList('李胜');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.list.length, 1, '响应 data 数组要适配成 list');
    assert.strictEqual(r.list[0].userName, '李胜');
  });

  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].method, 'POST');
  const u = new URL(seen[0].url, 'http://localhost');
  assert.ok(u.pathname.endsWith('/itamp-ems/alaysis/approval/common/getUserList'), '路径要与抓包一致');
  assert.strictEqual(u.searchParams.get('userName'), '李胜', 'userName 必须在 query 上');
  assert.ok(u.searchParams.get('n'), 'n（防缓存随机数）要带上');
  assert.strictEqual(seen[0].body, undefined, 'body 必须为空 —— 放进 body 后端什么都取不到');
});

test('fetchUserDetail：userId / n 必须走 query，body 必须为空', async () => {
  const UserApi = freshUserApi();
  const seen = [];
  await withFetch(async (url, opts) => {
    seen.push({ url: String(url), body: opts ? opts.body : undefined });
    return {
      ok: true, status: 200,
      json: async () => ({ code: 200, msg: '操作成功', data: { userId: '4711510', userName: '李胜' } }),
    };
  }, async () => {
    const r = await UserApi.fetchUserDetail('4711510');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.user.userId, '4711510');
  });

  assert.strictEqual(seen.length, 1);
  const u = new URL(seen[0].url, 'http://localhost');
  assert.ok(u.pathname.endsWith('/itamp-ems/alaysis/approval/common/getUserInfo'), '路径要与抓包一致');
  assert.strictEqual(u.searchParams.get('userId'), '4711510', 'userId 必须在 query 上');
  assert.ok(u.searchParams.get('n'));
  assert.strictEqual(seen[0].body, undefined);
});
