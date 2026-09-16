/**
 * 传输层单测（core/api-client.js 的 call）。
 *
 * 为什么专门钉这里：这一层管「超时 / 中止」两件事，而查询路径全都传了 signal。
 * 一旦「传了 signal 就没有超时」，后端挂起时页面会永久转圈（全屏 loading 掩盖弹窗），
 * 是用户能直接撞上的故障 —— 所以超时、调用方中止、二者叠加三种情形都要有断言。
 *
 * 手法：注入可控 setTimeout（计时行为手动触发，不必真等 20 秒）+ 假 fetch
 * （只有 signal 被 abort 时才 reject，等价「后端挂起」）。
 */
'use strict';

const { loadScript, test } = require('./harness');
const assert = require('assert');

/** 加载 api-client 并注入可控 setTimeout；返回手动触发定时器的句柄 */
function fresh() {
  const timers = [];
  const win = {};
  loadScript('js/core/api-client.js', {
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length - 1; },
  }, win);
  return { API: win.API, timers };
}

/** 假 fetch：永不主动返回；有 signal 且被 abort 时按 fetch 的规范抛 AbortError */
function hangingFetch() {
  return (url, opts) => new Promise((_, reject) => {
    const sig = opts && opts.signal;
    if (!sig) return;                       // 没有任何 signal：一直挂着
    const abort = () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); };
    if (sig.aborted) return abort();
    sig.addEventListener('abort', abort);
  });
}

/** 替换 global.fetch 跑一段断言，结束后还原，避免污染其它用例 */
async function withFetch(stub, fn) {
  const origin = global.fetch;
  global.fetch = stub;
  try { return await fn(); } finally { global.fetch = origin; }
}

test('API.call：传了调用方 signal 也必须有超时兜底（否则后端挂起就永久转圈）', async () => {
  const { API, timers } = fresh();
  const ac = new AbortController();

  await withFetch(hangingFetch(), async () => {
    const p = API.call('/itamp-tool/x', { signal: ac.signal, timeout: 20000 });
    // 关键断言：即便调用方传了 signal，定时器也要挂上（旧实现在这里是 0 个）
    assert.strictEqual(timers.length, 1, '传了 signal 时仍应挂默认超时');
    assert.strictEqual(timers[0].ms, 20000);
    timers[0].fn();                       // 模拟「20s 后端仍无响应」
    let err = null;
    try { await p; } catch (e) { err = e; }
    assert.ok(err, '应当以失败结束，而不是永远挂着');
    assert.match(String(err.message), /请求超时（20000ms 未响应）/);
  });
});

test('API.call：调用方自己中止 → 抛原始 AbortError，不谎报成超时', async () => {
  const { API } = fresh();
  const ac = new AbortController();

  await withFetch(hangingFetch(), async () => {
    const p = API.call('/y', { signal: ac.signal });
    ac.abort();                            // 用户发起新查询 / 重置表单
    let err = null;
    try { await p; } catch (e) { err = e; }
    assert.ok(err, '中止也要以失败结束');
    assert.strictEqual(err.name, 'AbortError', '中止不是超时，查询层靠 name 判定「不算失败」');
  });
});

test('API.call：调用方已中止过的 signal → 不发无效请求，立即失败', async () => {
  const { API } = fresh();
  const ac = new AbortController();
  ac.abort();

  let calls = 0;
  await withFetch((url, opts) => {
    calls += 1;
    return hangingFetch()(url, opts);
  }, async () => {
    await assert.rejects(() => API.call('/z', { signal: ac.signal }));
  });
  assert.strictEqual(calls, 1, '仍走一次 fetch，但由已中止的 signal 立即失败');
});

test('API.call：没传 signal 时同样有超时兜底（回归保护）', async () => {
  const { API, timers } = fresh();

  await withFetch(hangingFetch(), async () => {
    const p = API.call('/no-signal', { timeout: 5000 });
    assert.strictEqual(timers.length, 1);
    assert.strictEqual(timers[0].ms, 5000);
    timers[0].fn();
    let err = null;
    try { await p; } catch (e) { err = e; }
    assert.match(String(err && err.message), /请求超时（5000ms 未响应）/);
  });
});

test('API.call：timeout <= 0 表示不限时（不挂定时器，尊重调用方意愿）', async () => {
  const { API, timers } = fresh();
  await withFetch(async () => ({ ok: true, status: 200, json: async () => ({}) }), async () => {
    const resp = await API.call('/no-timeout', { timeout: 0 });
    assert.strictEqual(resp.status, 200);
  });
  assert.strictEqual(timers.length, 0, 'timeout<=0 时不应挂定时器');
});

test('API.call：正常响应原样返回，且事后调用方 abort 不会反咬', async () => {
  const { API } = fresh();
  const ac = new AbortController();
  await withFetch(async () => ({ ok: true, status: 200, json: async () => ({ code: 0 }) }), async () => {
    const resp = await API.call('/ok', { signal: ac.signal, timeout: 1000 });
    assert.strictEqual(resp.status, 200);
  });
  // 请求已结束，此时调用方再 abort：不该抛错、不该留下未处理的 rejection
  ac.abort();
});
