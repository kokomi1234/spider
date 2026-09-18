/**
 * 当前用户模块（js/ui/current-user.js）用例。
 *
 * 它决定了「常用查询归到哪个部门」，所以两组行为最关键：
 *   · 工号 / 姓名的分流与错误透传（查不到、同名多命中、接口挂了）
 *   · localStorage 不可用时不能把首页拖崩
 */
'use strict';

const assert = require('assert');
const { loadScript, test } = require('./harness');

function fakeStorage(initial, opts = {}) {
  const data = { ...(initial || {}) };
  return {
    getItem(k) {
      if (opts.throwOnGet) throw new Error('SecurityError');
      return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
    },
    setItem(k, v) { if (opts.throwOnSet) throw new Error('QuotaExceededError'); data[k] = String(v); },
    removeItem(k) { delete data[k]; },
  };
}

function load(storage, win = {}) {
  if (storage) win.localStorage = storage;
  loadScript('js/ui/current-user.js', {}, win);
  return win;
}

// 字段名与真实报文一致：orgName 是整个一级单位，teamName 才是口语里的「部门」
const USER = {
  userId: '4711510', userName: '张三',
  orgId: '1645A', orgName: '中国银行软件中心（深圳）',
  teamId: 'K4229', teamName: '中国银行软件中心（深圳）开发三部',
};

// ══════════════════════════════════════════════════════════
// 1) 工号 / 姓名的判定
// ══════════════════════════════════════════════════════════

test('current-user：纯数字（≥3 位）当工号，其余当姓名', () => {
  const w = load(fakeStorage());
  assert.strictEqual(w.CurrentUser.looksLikeId('4711510'), true);
  assert.strictEqual(w.CurrentUser.looksLikeId('123'), true);
  assert.strictEqual(w.CurrentUser.looksLikeId(' 4711510 '), true, '两侧空格要能容忍');
  assert.strictEqual(w.CurrentUser.looksLikeId('张三'), false);
  assert.strictEqual(w.CurrentUser.looksLikeId('E00406'), false);
  assert.strictEqual(w.CurrentUser.looksLikeId('12'), false, '两位数字不像工号');
});

// ══════════════════════════════════════════════════════════
// 2) 存取
// ══════════════════════════════════════════════════════════

test('current-user：set → get 往返，字段被规整为字符串', () => {
  const w = load(fakeStorage());
  const CU = w.CurrentUser;
  assert.strictEqual(CU.get(), null, '初始应为空');
  const r = CU.set(USER);
  assert.strictEqual(r.ok, true);
  const got = CU.get();
  assert.strictEqual(got.userId, '4711510');
  assert.strictEqual(got.orgName, '中国银行软件中心（深圳）');
  assert.ok(got.at > 0, '要记设置时间');
});

test('current-user：缺 userId 与 userName → 拒绝保存', () => {
  const w = load(fakeStorage());
  assert.strictEqual(w.CurrentUser.set({ orgName: '某部门' }).ok, false);
  assert.strictEqual(w.CurrentUser.set(null).ok, false);
  assert.strictEqual(w.CurrentUser.set('张三').ok, false, '字符串不是合法用户对象');
});

test('current-user：clear 清空', () => {
  const w = load(fakeStorage());
  w.CurrentUser.set(USER);
  assert.strictEqual(w.CurrentUser.clear().ok, true);
  assert.strictEqual(w.CurrentUser.get(), null);
});

test('current-user：存量是坏 JSON → get() 返回 null，不抛', () => {
  const w = load(fakeStorage({ 'spider.currentUser.v1': '{坏' }));
  assert.strictEqual(w.CurrentUser.get(), null);
});

test('current-user：存储不可用 → get 返回 null、set 给出可读错误', () => {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const win = {};
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('SecurityError: storage disabled'); },
    });
    loadScript('js/ui/current-user.js', {}, win);
    assert.strictEqual(win.CurrentUser.get(), null, '读不到就当没设置');
    const r = win.CurrentUser.set(USER);
    assert.strictEqual(r.ok, false);
    assert.ok(/存储/.test(r.error), '错误要能看懂：' + r.error);
  } finally {
    if (desc) Object.defineProperty(globalThis, 'localStorage', desc);
    else delete globalThis.localStorage;
  }
});

// ══════════════════════════════════════════════════════════
// 3) lookup：工号走 getUserInfo、姓名走 getUserList
// ══════════════════════════════════════════════════════════

test('current-user：空关键字直接报错，不发请求', async () => {
  const w = load(fakeStorage());
  let called = 0;
  w.UserApi = { fetchUserDetail: async () => { called += 1; return { ok: true, user: USER }; } };
  const r = await w.CurrentUser.lookup('   ');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(called, 0, '不该发请求');
});

test('current-user：工号 → 调 fetchUserDetail，命中一人', async () => {
  const w = load(fakeStorage());
  const calls = [];
  w.UserApi = {
    fetchUserDetail: async (id) => { calls.push(['detail', id]); return { ok: true, user: USER }; },
    fetchUserList: async (n) => { calls.push(['list', n]); return { ok: true, list: [] }; },
  };
  const r = await w.CurrentUser.lookup('4711510');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.mode, 'id');
  assert.strictEqual(r.list.length, 1);
  assert.strictEqual(r.list[0].orgName, '中国银行软件中心（深圳）');
  assert.deepStrictEqual(calls, [['detail', '4711510']], '只该走工号那条路');
});

test('current-user：姓名 → 调 fetchUserList，可返回多人', async () => {
  const w = load(fakeStorage());
  const calls = [];
  w.UserApi = {
    fetchUserDetail: async () => { calls.push('detail'); return { ok: true, user: null }; },
    fetchUserList: async (n) => { calls.push(['list', n]); return { ok: true, list: [USER, { ...USER, userId: '1', userName: '张三三' }] }; },
  };
  const r = await w.CurrentUser.lookup('张三');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.mode, 'name');
  assert.strictEqual(r.list.length, 2);
  assert.deepStrictEqual(calls, [['list', '张三']], '只该走姓名那条路');
});

test('current-user：查不到人时 ok:true + empty:true（不是错误）', async () => {
  const w = load(fakeStorage());
  w.UserApi = { fetchUserList: async () => ({ ok: true, list: [] }) };
  const r = await w.CurrentUser.lookup('查无此人');
  assert.strictEqual(r.ok, true, '「没找到」是正常结果，不该报错');
  assert.strictEqual(r.empty, true);
  assert.deepStrictEqual(r.list, []);
});

test('current-user：接口失败的原因要原样透出来（同名多命中后端会返错误码）', async () => {
  const w = load(fakeStorage());
  w.UserApi = { fetchUserList: async () => ({ ok: false, list: [], error: '查询失败：匹配到多个人，请用工号' }) };
  const r = await w.CurrentUser.lookup('郑梓');
  assert.strictEqual(r.ok, false);
  assert.ok(/多个人/.test(r.error), '不能被吞成「查询失败」四个字：' + r.error);
});

test('current-user：UserApi 未加载 → 明确提示缺哪个模块', async () => {
  const w = load(fakeStorage());
  const r = await w.CurrentUser.lookup('张三');
  assert.strictEqual(r.ok, false);
  assert.ok(/user-api/.test(r.error || ''), '要指出缺的是 user-api.js：' + r.error);
});

test('current-user：接口返回脏数据（缺 userId/userName）被过滤掉', async () => {
  const w = load(fakeStorage());
  w.UserApi = { fetchUserList: async () => ({ ok: true, list: [null, {}, { orgName: '只有部门' }, USER] }) };
  const r = await w.CurrentUser.lookup('张三');
  assert.strictEqual(r.list.length, 1, '只应剩下合法的那条');
  assert.strictEqual(r.list[0].userId, '4711510');
});

// ══════════════════════════════════════════════════════════
// 4) 展示文案
// ══════════════════════════════════════════════════════════

test('current-user：label 拼成「姓名（工号） · 部门」，团队优先于一级单位', () => {
  const w = load(fakeStorage());
  assert.strictEqual(
    w.CurrentUser.label(USER),
    '张三（4711510） · 中国银行软件中心（深圳）开发三部',
    'orgName 是整个单位（几百人），拿它当部门排行就没意义了，要显示 teamName',
  );
  assert.strictEqual(w.CurrentUser.label({ userName: '李四' }), '李四');
  assert.strictEqual(w.CurrentUser.label(null), '');
});

test('current-user：deptLabel 团队优先、一级单位兜底', () => {
  const w = load(fakeStorage());
  assert.strictEqual(w.CurrentUser.deptLabel(USER), '中国银行软件中心（深圳）开发三部');
  // 没有 team 信息的人（真实接口里 teamName 可能为空）→ 回落到 orgName
  assert.strictEqual(
    w.CurrentUser.deptLabel({ userName: '王五', orgName: '中国银行软件中心（深圳）' }),
    '中国银行软件中心（深圳）',
  );
  assert.strictEqual(w.CurrentUser.deptLabel({ userName: '王五' }), '');
  assert.strictEqual(w.CurrentUser.deptLabel(null), '');
});
