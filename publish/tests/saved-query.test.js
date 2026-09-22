/**
 * 常用查询存储层（js/ui/saved-query.js）用例。
 *
 * 这个模块是首页「一键直达」的数据源，出问题的后果是：
 *   · 存不进去 / 读不出来 → 首页永远空着，功能形同没有；
 *   · 脏数据没过滤 → 首页渲染直接崩（白屏）；
 *   · localStorage 不可用时抛异常 → 整个页面脚本中断，连入口卡都点不动。
 * 所以负面场景（脏数据、存储不可用、非法入参）比 happy path 更重要。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ROOT, loadScript, test } = require('./harness');

/** 可注入内容的假 localStorage */
function fakeStorage(initial, opts = {}) {
  const data = { ...(initial || {}) };
  return {
    _data: data,
    getItem(k) {
      if (opts.throwOnGet) throw new Error('SecurityError: storage disabled');
      return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
    },
    setItem(k, v) {
      if (opts.throwOnSet) {
        const e = new Error('QuotaExceededError');
        e.name = 'QuotaExceededError';
        throw e;
      }
      data[k] = String(v);
    },
    removeItem(k) { delete data[k]; },
  };
}

/** 加载模块；storage 可以是 null（模拟完全不可用）或抛异常的假实现 */
function load(storage, win = {}) {
  if (storage) win.localStorage = storage;
  loadScript('js/ui/saved-query.js', {}, win);
  return win.SavedQuery;
}

const KEY = 'spider.savedQueries.v1';
const ANON_KEY = 'spider.savedQueries.anon.v1';

// ══════════════════════════════════════════════════════════
// 1) 保存与校验
// ══════════════════════════════════════════════════════════

test('saved-query：正常保存 → 返回 ok 且带 id / 时间戳', async () => {
  const S = load(fakeStorage());
  const r = (await S.save({ page: 'publish', name: '2611批次-全球汇划', fields: { f_prodBatch: '2611pc' }, summary: '变更批次：2611pc' }));
  assert.strictEqual(r.ok, true, '应保存成功：' + JSON.stringify(r));
  assert.ok(r.item.id, '必须生成 id（首页跳转要用 ?saved=<id>）');
  assert.ok(r.item.at > 0, '要记保存时间，列表按它倒序');
  assert.strictEqual(r.item.fields.f_prodBatch, '2611pc');
});

test('saved-query：名称为空 / 纯空格 → 拒绝保存，不写存储', async () => {
  const st = fakeStorage();
  const S = load(st);
  ['', '   ', undefined, null].forEach(async (name) => {
    const r = (await S.save({ page: 'publish', name, fields: { a: '1' } }));
    assert.strictEqual(r.ok, false, `名称 ${JSON.stringify(name)} 应被拒绝`);
  });
  assert.strictEqual(st.getItem(KEY), null, '被拒绝的保存不该落盘');
});

test('saved-query：未知页面类型 → 拒绝保存', async () => {
  const S = load(fakeStorage());
  const r = (await S.save({ page: 'notExist', name: 'x', fields: {} }));
  assert.strictEqual(r.ok, false);
  assert.ok(/页面类型/.test(r.error), '错误信息要说清原因：' + r.error);
});

test('saved-query：fields 只收 string / number / string[]，对象与 null 一律丢弃', async () => {
  const S = load(fakeStorage());
  const r = (await S.save({
    page: 'task',
    name: '清洗测试',
    fields: {
      a: '文本', b: 123, c: ['x', 'y'], d: ['x', {}, null],
      e: { nested: 1 }, f: null, g: undefined, h: '', i: NaN, j: Infinity,
    },
  }));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.item.fields, { a: '文本', b: 123, c: ['x', 'y'], d: ['x'] },
    '对象/null/空串/NaN/Infinity 都不该进入 fields（它会被回填进表单）');
});

test('saved-query：同一份条件重复保存 → 更新，不重复堆积、保留原 id', async () => {
  const S = load(fakeStorage());
  const a = (await S.save({ page: 'publish', name: '第一次起的名字', fields: { x: '1' } }));
  const b = (await S.save({ page: 'publish', name: '第一次起的名字', fields: { x: '1' } }));
  assert.strictEqual(b.ok, true);
  assert.strictEqual(b.item.id, a.item.id, '同一份条件应复用原 id，否则首页会堆一串卡片');
  assert.strictEqual(b.updated, true);
  assert.strictEqual(S.list().length, 1, '不该出现两条');
  assert.ok((S.list()[0].saves || 1) >= 2, '「保存次数」要累加 —— 高频榜看它');
});

test('saved-query：改了名字再保存 → 还是同一条（2026-09-22 用户报的重复来源之一）', async () => {
  // 现场：把常用查询改个名，同一个查询就多出一条。
  // 根因是判重比的是**名字**，而名字是用户随手改的 —— 判据该是「同一份筛选条件 + 同一个人」。
  const S = load(fakeStorage());
  const a = (await S.save({ page: 'publish', name: '原名', fields: { x: '1' }, owner: OWNER_A }));
  const b = (await S.save({ page: 'publish', name: '改过的名', fields: { x: '1' }, owner: OWNER_A }));
  assert.strictEqual(b.item.id, a.item.id, '改名字不该产生新记录');
  assert.strictEqual(b.updated, true);
  assert.strictEqual(S.list().length, 1);
  assert.strictEqual(S.listForUser(OWNER_A)[0].name, '改过的名', '名字要跟着更新');
});

test('saved-query：同一份条件换个人存 → 各自一条（部门榜靠聚合，不靠共用一条）', async () => {
  const S = load(fakeStorage());
  const a = (await S.save({ page: 'publish', name: '同一条件', fields: { x: '1' }, owner: OWNER_A }));
  const b = (await S.save({ page: 'publish', name: '同一条件', fields: { x: '1' }, owner: OWNER_B }));
  assert.notStrictEqual(b.item.id, a.item.id, '不同人各自一条，谁也别改到谁');
  assert.strictEqual(b.updated, false);
  assert.strictEqual(S.list().length, 2);
});

test('saved-query：什么条件都没填时不按条件归并（空条件各自独立）', async () => {
  // fingerprint 为空串表示"没有筛选条件可归并"，退回同页同名同人
  const S = load(fakeStorage());
  const a = (await S.save({ page: 'publish', name: '空条件', fields: {} }));
  const b = (await S.save({ page: 'publish', name: '空条件', fields: {} }));
  assert.strictEqual(b.item.id, a.item.id, '空条件 + 同名同人 → 仍是更新');
  const c = (await S.save({ page: 'publish', name: '另一个名字', fields: {} }));
  assert.notStrictEqual(c.item.id, a.item.id, '空条件 + 不同名 → 各自一条');
});

test('saved-query：同名同页但换了个人 → 新建一条，不复用别人的 id（2026-09-20 回归）', async () => {
  // 用户报的现场：A 存过一条，B 用同样的名字（默认名由筛选条件生成，很容易撞）再存。
  // 以前复用 A 的 id → 服务端按 id 覆盖 → A 的条件被改写，B 还看不到自己那条。
  const S = load(fakeStorage());
  const a = (await S.save({ page: 'publish', name: '同名', fields: { x: '1' }, owner: OWNER_A }));
  const b = (await S.save({ page: 'publish', name: '同名', fields: { x: '2' }, owner: OWNER_B }));
  assert.strictEqual(b.ok, true);
  assert.notStrictEqual(b.item.id, a.item.id, '同名不同人必须是两条记录');
  assert.strictEqual(b.updated, false, '不能算作对别人那条的更新');
  assert.strictEqual(S.list().length, 2);
  assert.strictEqual(S.listForUser(OWNER_A)[0].fields.x, '1', 'A 那条不能被 B 改掉');
  assert.strictEqual(S.listForUser(OWNER_B)[0].fields.x, '2');
});

test('saved-query：不同页同名互不干扰', async () => {
  const S = load(fakeStorage());
  (await S.save({ page: 'publish', name: '同名', fields: {} }));
  (await S.save({ page: 'task', name: '同名', fields: {} }));
  assert.strictEqual(S.list().length, 2);
});

test('saved-query：超过上限（50 条）→ 报错而不是无限写入', async () => {
  const S = load(fakeStorage());
  for (let i = 0; i < S.MAX_ITEMS; i += 1) {
    assert.strictEqual((await S.save({ page: 'task', name: 'q' + i, fields: {} })).ok, true);
  }
  const over = (await S.save({ page: 'task', name: '多出来的', fields: {} }));
  assert.strictEqual(over.ok, false, '第 51 条应被拒绝');
  assert.ok(/最多/.test(over.error), '错误信息要提示上限：' + over.error);
  assert.strictEqual(S.list().length, S.MAX_ITEMS, '存量不应被破坏');
});

// ══════════════════════════════════════════════════════════
// 2) 读取：脏数据必须被挡在页面之外
// ══════════════════════════════════════════════════════════

test('saved-query：存储里是坏 JSON / 非数组 → list() 返回空，不抛', async () => {
  ['{', 'null', '"字符串"', '{"a":1}', '123'].forEach((raw) => {
    const S = load(fakeStorage({ [KEY]: raw }));
    assert.deepStrictEqual(S.list(), [], `存量 ${raw} 应被当成空列表`);
  });
});

test('saved-query：数组里的脏条目逐条过滤（缺 id / 非法 page / 非对象）', async () => {
  const S = load(fakeStorage({
    [KEY]: JSON.stringify([
      { id: 'q1', page: 'publish', name: '合法', fields: {}, at: 2 },
      { id: 'q2', page: 'notExist', name: '页面非法', fields: {} },
      { page: 'publish', name: '缺 id', fields: {} },
      null,
      '字符串',
      { id: 'q3', page: 'task', name: '也合法', fields: {}, at: 1 },
    ]),
  }));
  const list = S.list();
  assert.strictEqual(list.length, 2, '只应剩下两条合法数据');
  assert.deepStrictEqual(list.map((x) => x.id), ['q1', 'q3'], '按 at 倒序');
});

test('saved-query：条目里的 fields 脏值在读取时也要清洗', async () => {
  const S = load(fakeStorage({
    [KEY]: JSON.stringify([{ id: 'q1', page: 'publish', name: 'x', fields: { good: '1', bad: { o: 1 }, empty: '' } }]),
  }));
  assert.deepStrictEqual(S.list()[0].fields, { good: '1' });
});

test('saved-query：name 缺失时补「未命名查询」，不渲染成 undefined', async () => {
  const S = load(fakeStorage({ [KEY]: JSON.stringify([{ id: 'q1', page: 'task', fields: {} }]) }));
  assert.strictEqual(S.list()[0].name, '未命名查询');
});

test('saved-query：get(id) 命中 / 未命中', async () => {
  const S = load(fakeStorage());
  const r = (await S.save({ page: 'publish', name: '甲', fields: { a: '1' } }));
  assert.strictEqual(S.get(r.item.id).name, '甲');
  assert.strictEqual(S.get('不存在'), null);
  assert.strictEqual(S.get(''), null);
  assert.strictEqual(S.get(null), null);
});

// ══════════════════════════════════════════════════════════
// 3) 改删与存储不可用
// ══════════════════════════════════════════════════════════

test('saved-query：重命名成功 / 空名被拒 / 不存在的 id 报错', async () => {
  const S = load(fakeStorage());
  const r = (await S.save({ page: 'task', name: '原名', fields: {} }));
  assert.strictEqual((await S.rename(r.item.id, '新名')).ok, true);
  assert.strictEqual(S.get(r.item.id).name, '新名');
  assert.strictEqual((await S.rename(r.item.id, '  ')).ok, false, '空名应被拒');
  assert.strictEqual((await S.rename('不存在', 'x')).ok, false);
});

test('saved-query：删除存在 / 不存在的条目', async () => {
  const S = load(fakeStorage());
  const r = (await S.save({ page: 'task', name: '甲', fields: {} }));
  assert.strictEqual((await S.remove(r.item.id)).ok, true);
  assert.strictEqual(S.list().length, 0);
  assert.strictEqual((await S.remove(r.item.id)).ok, false, '重复删除应报错而不是静默成功');
});

test('saved-query：clear 清空', async () => {
  const S = load(fakeStorage());
  (await S.save({ page: 'task', name: '甲', fields: {} }));
  assert.strictEqual((await S.clear()).ok, true);
  assert.deepStrictEqual(S.list(), []);
});

test('saved-query：localStorage 完全不可用时 list() 不崩、save() 给出可读错误', async () => {
  // node 22 自带全局 localStorage，浏览器里「隐私模式」则是访问即抛。
  // 这里用「读取即抛」模拟后者，并**禁止**回落到 node 的全局实现——
  // 否则测试会假通过，而真实浏览器里这条路径是断的。
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const win = {};
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('SecurityError: storage disabled'); },
    });
    const S = load(null, win);
    assert.deepStrictEqual(S.list(), [], '读不到存储应返回空列表，不能抛');
    const r = (await S.save({ page: 'publish', name: '甲', fields: { a: '1' } }));
    assert.strictEqual(r.ok, false);
    assert.ok(/存储|保存失败/.test(r.error), '错误要能看懂：' + r.error);
  } finally {
    if (desc) Object.defineProperty(globalThis, 'localStorage', desc);
    else delete globalThis.localStorage;
  }
});

test('saved-query：getItem 抛异常（隐私模式）→ list() 仍返回空', async () => {
  const S = load(fakeStorage({}, { throwOnGet: true }));
  assert.deepStrictEqual(S.list(), []);
});

test('saved-query：写入配额满 → save 返回失败，且已存数据不受影响', async () => {
  const st = fakeStorage({}, { throwOnSet: true });
  const S = load(st);
  const r = (await S.save({ page: 'publish', name: '甲', fields: {} }));
  assert.strictEqual(r.ok, false);
  assert.ok(/空间|存储/.test(r.error), '错误要提示空间不足：' + r.error);
});

// ══════════════════════════════════════════════════════════
// 4) labels（人类可读文本）与旧记录升级
// ══════════════════════════════════════════════════════════

test('saved-query：保存时带上 labels，记录标记为 v2', async () => {
  const S = load(fakeStorage());
  const r = (await S.save({
    page: 'publish', name: '甲',
    fields: { f_prodBatch: '2611pc' },
    summary: '变更批次：2611批次',
    labels: { f_prodBatch: '2611批次' },
  }));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.item.labels, { f_prodBatch: '2611批次' });
  assert.strictEqual(r.item.v, S.SCHEMA_VERSION, '新记录应带版本号，便于判断是否需要升级');
});

test('saved-query：labels 只收非空字符串，脏值丢弃', async () => {
  const S = load(fakeStorage());
  const r = (await S.save({
    page: 'publish', name: '甲', fields: { a: '1' },
    labels: { good: '2611批次', bad: { o: 1 }, empty: '   ', num: 5, arr: ['x'] },
  }));
  assert.deepStrictEqual(r.item.labels, { good: '2611批次' });
});

test('saved-query：旧记录（无 v / 无 labels）读出来是 v1，可被识别为待升级', async () => {
  const S = load(fakeStorage({
    [KEY]: JSON.stringify([{ id: 'q1', page: 'publish', name: '旧卡片', fields: { f_prodBatch: '2611pc' }, summary: '变更批次：2611pc' }]),
  }));
  const it = S.get('q1');
  assert.strictEqual(it.v, 1, '缺 v 的记录按旧格式算');
  assert.deepStrictEqual(it.labels, {});
});

test('saved-query：update 只改展示字段（labels / summary / v），不动 id / name / fields / at', async () => {
  const S = load(fakeStorage());
  const r = (await S.save({ page: 'task', name: '原名', fields: { a: '1' }, summary: '旧摘要' }));
  const before = r.item;
  const u = S.update(before.id, { labels: { a: '可读名' }, summary: '新摘要', v: 2 });
  assert.strictEqual(u.ok, true);
  const after = S.get(before.id);
  assert.strictEqual(after.summary, '新摘要');
  assert.deepStrictEqual(after.labels, { a: '可读名' });
  assert.strictEqual(after.v, 2);
  // 这些不能被改坏，否则卡片会跳错页 / 回填错条件
  assert.strictEqual(after.id, before.id);
  assert.strictEqual(after.name, '原名');
  assert.deepStrictEqual(after.fields, { a: '1' });
  assert.strictEqual(after.at, before.at);
});

test('saved-query：update 忽略白名单外的字段（不许塞 fields / name 进来）', async () => {
  const S = load(fakeStorage());
  const r = (await S.save({ page: 'task', name: '原名', fields: { a: '1' }, summary: '旧摘要' }));
  S.update(r.item.id, { name: '被篡改', fields: { x: '2' }, labels: { a: 'L' } });
  const after = S.get(r.item.id);
  assert.strictEqual(after.name, '原名');
  assert.deepStrictEqual(after.fields, { a: '1' });
  assert.deepStrictEqual(after.labels, { a: 'L' }, '白名单内的仍要生效');
});

test('saved-query：update 不存在的 id → 报错', async () => {
  const S = load(fakeStorage());
  assert.strictEqual(S.update('不存在', { summary: 'x' }).ok, false);
  assert.strictEqual(S.update('', { summary: 'x' }).ok, false);
  assert.strictEqual(S.update(null, { summary: 'x' }).ok, false);
});

// ══════════════════════════════════════════════════════════
// 5) 查询人 / 打开计数 / 部门排行
// ══════════════════════════════════════════════════════════

// 与真实报文一致：orgName 是一级单位，teamName 才是「部门」
const OWNER_A = {
  userId: '4711510', userName: '张三',
  orgId: '1645A', orgName: '中国银行软件中心（深圳）',
  teamId: 'K4229', teamName: '中国银行软件中心（深圳）开发三部',
};
const OWNER_B = {
  userId: '1001', userName: '李四',
  orgId: '1645A', orgName: '中国银行软件中心（深圳）',
  teamId: 'M2534', teamName: '中国银行软件中心（深圳）开发一部',
};

test('saved-query：owner 只收字符串字段，脏结构不落库', async () => {
  const S = load(fakeStorage());
  const r = (await S.save({ page: 'publish', name: '甲', fields: {}, owner: { ...OWNER_A, extra: { x: 1 }, userId: 4711510 } }));
  assert.deepStrictEqual(
    Object.keys(r.item.owner).sort(),
    ['orgId', 'orgName', 'teamId', 'teamName', 'userId', 'userName'],
  );
  assert.strictEqual(r.item.owner.userId, '4711510', '数字工号要转成字符串');
  assert.strictEqual((await S.save({ page: 'publish', name: '乙', fields: {}, owner: {} })).item.owner, null);
});

test('saved-query：没显式传 owner 时回落到「当前用户」', async () => {
  const win = { localStorage: fakeStorage() };
  win.CurrentUser = { get: () => OWNER_A };
  loadScript('js/ui/saved-query.js', {}, win);
  const r = await win.SavedQuery.save({ page: 'task', name: '甲', fields: {} });
  assert.strictEqual(r.item.owner.orgName, '中国银行软件中心（深圳）', '页面忘了传也不能丢归属');
});

test('saved-query：新记录 hits=0 / saves=1；同名覆盖时 saves 累加、hits 保留', async () => {
  const S = load(fakeStorage());
  const a = (await S.save({ page: 'publish', name: '甲', fields: {} }));
  assert.strictEqual(a.item.saves, 1);
  assert.strictEqual(a.item.hits, 0);
  (await S.hit(a.item.id));
  (await S.hit(a.item.id));
  const b = (await S.save({ page: 'publish', name: '甲', fields: {} }));
  assert.strictEqual(b.item.saves, 2, '重复保存要累加，而不是重置');
  assert.strictEqual(b.item.hits, 2, '打开次数不能被保存重置');
});

test('saved-query：listForUser 认服务端回传的 saverKeys（owner 不是我，但我保存过）', async () => {
  // 服务端一条记录只带一个 owner（最早保存的那位），所以「我保存过」必须靠 saverKeys 认。
  // 这是 2026-09-20「第二个用户看不到自己存的」的根因之一。
  const S = load(fakeStorage());
  (await S.importJson(JSON.stringify({
    app: 'spider-saved-queries', v: 2,
    items: [{
      id: 'q1', page: 'publish', name: '共同条件', fields: { a: '1' },
      owner: OWNER_A, saverKeys: ['4711510', '1001'],
    }],
  })));
  assert.strictEqual(S.listForUser(OWNER_A).length, 1, 'owner 本人看得到');
  assert.strictEqual(S.listForUser(OWNER_B).length, 1, 'owner 不是我，但 saverKeys 里有我 → 也要看得到');
  assert.strictEqual(S.listForUser({ userId: '查无此人' }).length, 0, '没保存过的人不许看到');
  assert.deepStrictEqual(S.saverKeysOf(S.list()[0]).sort(), ['1001', '4711510'], 'owner 与 saverKeys 要合起来算');
});

test('saved-query：hit 累加打开次数并记最近打开时间', async () => {
  const S = load(fakeStorage());
  const r = (await S.save({ page: 'publish', name: '甲', fields: {} }));
  assert.strictEqual(S.get(r.item.id).lastAt, 0);
  (await S.hit(r.item.id));
  const after = S.get(r.item.id);
  assert.strictEqual(after.hits, 1);
  assert.ok(after.lastAt > 0, '要记最近打开时间，作为排序的次判据');
  assert.strictEqual((await S.hit('不存在')).ok, false);
});

test('saved-query：listByDept 只返回同部门的记录，同命中条件合成一行', async () => {
  const S = load(fakeStorage());
  (await S.save({ page: 'publish', name: '本部门常用', fields: {}, labels: {}, owner: OWNER_A }));
  (await S.save({ page: 'task', name: '本部门少用', fields: {}, owner: OWNER_A }));
  (await S.save({ page: 'publish', name: '别的部门', fields: {}, owner: OWNER_B }));
  (await S.save({ page: 'publish', name: '没有归属', fields: {} }));

  const 常用 = S.list().find((x) => x.name === '本部门常用');
  (await S.hit(常用.id));
  (await S.hit(常用.id));

  const list = S.listByDept(OWNER_A, 10);
  // 顺序在这里不稳定：两条都只有 1 人保存，次判据是毫秒级时间戳，
  // 同一毫秒里完成 save/hit 就会翻转。**排序本身由「排行先比人数」那条用例钉住**，
  // 这里只断言「谁该进来、谁不该进来」。
  assert.deepStrictEqual(
    list.map((x) => x.name).sort(),
    ['本部门常用', '本部门少用'].sort(),
    '别的部门与无归属的都不能混进来',
  );
  assert.strictEqual(list.length, 2);
  list.forEach((x) => assert.strictEqual(x.savers, 1, '每条都要带出「几个人保存过」，首页靠它显示'));
  const 常用行 = list.find((x) => x.name === '本部门常用');
  assert.strictEqual(常用行.hits, 2, '打开次数仍然记录（只是不再参与排序）');
});

// ══════════════════════════════════════════════════════════
// 5.1) 部门排行的口径：**多少「人」保存过这份条件**（2026-09-19 改）
// ══════════════════════════════════════════════════════════
// 以前按「打开次数」排，排出来的常常是某个人反复点了自己那条；
// 现在要的是「大家都觉得该查的东西」，所以合并同一份条件、去重数人头。

const COND_A = { callerSystem: 'E00406', serviceName: '客户信息查询' };   // 同一份条件
// 同部门（同一个 teamId）的另一个人：部门排行先按部门过滤，跨部门的人进不来这个用例
const TEAMMATE = { ...OWNER_A, userId: '4711511', userName: '李四' };

test('saved-query：同一份条件被两个人保存 → 合成一行，人数=2', async () => {
  const S = load(fakeStorage());
  (await S.save({ page: 'publish', name: '张三取的名', fields: { ...COND_A }, owner: OWNER_A }));
  (await S.save({ page: 'publish', name: '李四取的名', fields: { ...COND_A }, owner: TEAMMATE }));
  const list = S.listByDept(OWNER_A, 10);
  assert.strictEqual(list.length, 1, '同一份条件不能因为两个人各存一份就刷两行');
  assert.strictEqual(list[0].savers, 2, '两个不同的人保存 → 2 人');
  assert.deepStrictEqual([...list[0].saverNames].sort(), ['张三', '李四'], '要能拿出保存者名单（hover 显示）');
  assert.strictEqual(list[0].recentUser, '李四', '最近一次保存的人要能显示出来');
});

test('saved-query：同一个人反复保存同一份条件 → 只算 1 人（不许刷人数）', async () => {
  const S = load(fakeStorage());
  const first = (await S.save({ page: 'publish', name: '重复保存', fields: { ...COND_A }, owner: OWNER_A }));
  // 换名字再存同一份条件：现在是「同名同页才更新」，名字不同会落成两条，
  // 但人头去重以后仍然只能算 1 人。
  (await S.save({ page: 'publish', name: '重复保存（第二次）', fields: { ...COND_A }, owner: OWNER_A }));
  (await S.hit(first.item.id));
  const list = S.listByDept(OWNER_A, 10);
  assert.strictEqual(list[0].savers, 1, '一个人存三遍也不是三个人');
});

test('saved-query：条件不同就不算同一份，各自独立计数', async () => {
  const S = load(fakeStorage());
  (await S.save({ page: 'publish', name: '条件甲', fields: { callerSystem: 'E00406' }, owner: OWNER_A }));
  (await S.save({ page: 'publish', name: '条件乙', fields: { callerSystem: 'E07701' }, owner: OWNER_A }));
  assert.strictEqual(S.listByDept(OWNER_A, 10).length, 2, 'fields 不同 = 不同的查询，不能合并');
  // 同一份条件换个 page 也不该合并（不同的查询页，打开目标不一样）
  (await S.save({ page: 'task', name: '条件甲', fields: { callerSystem: 'E00406' }, owner: OWNER_A }));
  assert.strictEqual(S.listByDept(OWNER_A, 10).length, 3, '不同页面的同名字段仍是两个入口');
});

test('saved-query：没填筛选条件的记录各自独立，不聚成一行', async () => {
  const S = load(fakeStorage());
  (await S.save({ page: 'publish', name: '甲', fields: {}, owner: OWNER_A }));
  (await S.save({ page: 'publish', name: '乙', fields: {}, owner: OWNER_A }));
  assert.strictEqual(S.listByDept(OWNER_A, 10).length, 2, '「什么都没填」不是同一份条件，不能归并');
});

test('saved-query：排行先比人数（人数多的排前面，哪怕它打开次数更少）', async () => {
  const S = load(fakeStorage());
  // 三人群:只用一次的条件
  const three = [
    { userId: '11', userName: '甲', teamId: 'K4229' },
    { userId: '12', userName: '乙', teamId: 'K4229' },
    { userId: '13', userName: '丙', teamId: 'K4229' },
  ];
  three.forEach(async (o, i) => (await S.save({ page: 'publish', name: '三人组' + i, fields: { q: 'popular' }, owner: { ...OWNER_A, ...o } })));
  const solo = (await S.save({ page: 'publish', name: '我的高频', fields: { q: 'mine' }, owner: OWNER_A }));
  for (let i = 0; i < 50; i += 1) (await S.hit(solo.item.id));   // 打开次数远超，但只有 1 人

  const list = S.listByDept(OWNER_A, 10);
  assert.strictEqual(list[0].savers, 3, '三个人保存的排第一');
  assert.ok(/三人组/.test(list[0].name), `排头位应是人多的那份，实际 ${list[0].name}`);
  assert.strictEqual(list[1].savers, 1);
});

test('saved-query：fingerprintOf 对字段顺序、空值不敏感', async () => {
  const S = load(fakeStorage());
  const a = S.fingerprintOf({ page: 'publish', fields: { x: '1', y: ['b', 'a'] } });
  const b = S.fingerprintOf({ page: 'publish', fields: { y: ['a', 'b'], x: '1' } });
  assert.strictEqual(a, b, '同一份条件换个写法仍是同一份');
  assert.strictEqual(S.fingerprintOf({ page: 'publish', fields: { x: '' } }), '', '空值字段不当成条件');
  assert.strictEqual(S.fingerprintOf({ page: 'publish', fields: {} }), '', '没有任何条件 → 不参与归并');
  assert.notStrictEqual(
    S.fingerprintOf({ page: 'publish', fields: { x: '1' } }),
    S.fingerprintOf({ page: 'task', fields: { x: '1' } }),
    '不同页面的同条件是两个入口',
  );
});

test('saved-query：listByDept 的 limit 就是首页的 5 / 10 / 20，非法值退回 10', async () => {
  const S = load(fakeStorage());
  for (let i = 0; i < 12; i += 1) {
    (await S.save({ page: 'publish', name: 'q' + i, fields: {}, owner: OWNER_A }));
  }
  assert.strictEqual(S.listByDept(OWNER_A, 5).length, 5);
  assert.strictEqual(S.listByDept(OWNER_A, 10).length, 10);
  assert.strictEqual(S.listByDept(OWNER_A, 20).length, 12, '不足 20 条时给全部');
  assert.strictEqual(S.listByDept(OWNER_A, 0).length, 10, '非法 limit 退回默认 10');
  assert.strictEqual(S.listByDept(OWNER_A, NaN).length, 10);
});

test('saved-query：listByDept 对「没设置用户」返回空，不误报全量', async () => {
  const S = load(fakeStorage());
  (await S.save({ page: 'publish', name: '甲', fields: {}, owner: OWNER_A }));
  assert.deepStrictEqual(S.listByDept(null, 10), []);
  assert.deepStrictEqual(S.listByDept({}, 10), []);
  assert.deepStrictEqual(S.listByDept({ orgId: '', orgName: '' }, 10), []);
});

test('saved-query：同一个一级单位、不同团队 → 算不同部门（team 优先）', async () => {
  const S = load(fakeStorage());
  (await S.save({ page: 'publish', name: '三部的查询', fields: {}, owner: OWNER_A }));
  (await S.save({ page: 'publish', name: '一部的查询', fields: {}, owner: OWNER_B }));

  const a = S.listByDept(OWNER_A, 10);
  assert.deepStrictEqual(a.map((x) => x.name), ['三部的查询'],
    'orgId 相同但 teamId 不同，不能混成一个部门（否则整个单位算一个部门）');
  const b = S.listByDept(OWNER_B, 10);
  assert.deepStrictEqual(b.map((x) => x.name), ['一部的查询']);
});

test('saved-query：没有 team 信息的人按其一级单位归类（org 兜底）', async () => {
  const S = load(fakeStorage());
  (await S.save({
    page: 'publish', name: '无团队的查询', fields: {},
    owner: { userId: '9', userName: '王五', orgId: '1645A', orgName: '中国银行软件中心（深圳）' },
  }));
  const list = S.listByDept({ userName: '赵六', orgId: '1645A', orgName: '中国银行软件中心（深圳）' }, 10);
  assert.strictEqual(list.length, 1, 'team 缺失时按 org 归组');
});

test('saved-query：没有 orgId 时用部门名兜底匹配', async () => {
  const S = load(fakeStorage());
  (await S.save({ page: 'publish', name: '甲', fields: {}, owner: { userName: '张三', orgName: '某部门' } }));
  const list = S.listByDept({ userName: '别人', orgId: '', orgName: '某部门' }, 10);
  assert.strictEqual(list.length, 1, '部门名相同也算同部门（orgId 缺失时的兜底）');
});

// ══════════════════════════════════════════════════════════
// 6) 跳转地址（首页卡片直达用的就是这个）
// ══════════════════════════════════════════════════════════

test('saved-query：hrefFor 三个页面各自对应干净路由，且 id 被转义', async () => {
  const S = load(fakeStorage());
  assert.strictEqual(S.hrefFor('publish', 'q1'), '/publish?saved=q1');
  assert.strictEqual(S.hrefFor('task', 'q1'), '/task?saved=q1');
  assert.strictEqual(S.hrefFor('subscription', 'q1'), '/subscription?saved=q1');
  assert.strictEqual(S.hrefFor('publish', 'a b&c'), '/publish?saved=a%20b%26c', 'id 必须编码，否则 URL 被截断');
});

test('saved-query：新增的保存排在最前（首页按最近使用展示）', async () => {
  const S = load(fakeStorage());
  const a = (await S.save({ page: 'publish', name: '先存的', fields: {} }));
  const b = (await S.save({ page: 'publish', name: '后存的', fields: {} }));
  // 同一毫秒内 Date.now() 可能相同，退而断言「后存的在前」或至少两条都在
  const ids = S.list().map((x) => x.id);
  assert.ok(ids.includes(a.item.id) && ids.includes(b.item.id));
  if (b.item.at > a.item.at) assert.strictEqual(ids[0], b.item.id, '最近保存的应排最前');
});

// ══════════════════════════════════════════════════════════
// 6) 导出 / 导入（跨浏览器、跨电脑的唯一通路）
// ══════════════════════════════════════════════════════════

test('saved-query：导出 → 导入 往返，记录与归属都在', async () => {
  // 2026-09-22 起 exportJson 的口径与列表一致（listForUser）：有身份导 ta 的、
  // 没身份只导本机匿名的。所以这条往返用例必须**带着「当前用户」**跑（与真实页面一致），
  // 否则显式传的 owner 会被"没身份只导匿名的"过滤掉。
  const noNet = async () => { throw new Error('离线'); };
  const a = loadUserSync(fakeStorage(), noNet, OWNER_A);
  (await a.save({ page: 'publish', name: '甲', fields: { f_prodBatch: '2611pc' }, summary: '变更批次：2611批次', owner: OWNER_A, labels: { f_prodBatch: '2611批次' } }));
  const text = a.exportJson();
  const parsed = JSON.parse(text);
  assert.strictEqual(parsed.app, 'spider-saved-queries', '要带标识，导入方好判断文件来源');
  assert.strictEqual(parsed.items.length, 1);

  const b = loadUserSync(fakeStorage(), noNet, OWNER_A);
  const r = (await b.importJson(text));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.added, 1);
  assert.strictEqual(r.merged, 0);
  const got = b.list()[0];
  assert.strictEqual(got.name, '甲');
  assert.strictEqual(got.owner.userName, '张三', '归属要跟着走，否则导入后不进部门排行');
  assert.deepStrictEqual(got.labels, { f_prodBatch: '2611批次' });
});

test('saved-query：清了登录态再导出，不得把上一个登录的人的记录混进去', async () => {
  // 2026-09-22 用户实测：吴树海登录存过记录 → 清了登录态（**镜像不会清**）→ 匿名又存了几条
  // → 导出 → 文件里混着吴树海的记录。导出口径必须与列表一致（listForUser）：
  // 没身份时只导「无人认领」的本机记录，别人的（有归属人的）一条都不能混入。
  const noNet = async () => { throw new Error('离线'); };
  const st = fakeStorage();
  const WU = { userId: '6464402', userName: '吴树海', teamId: 'K4229', teamName: '开发三部' };
  const S1 = loadUserSync(st, noNet, WU);
  (await S1.save({ page: 'publish', name: '吴树海的', fields: {} }));

  // 同一份 localStorage 换到「没设用户」的环境（模拟清除登录态后镜像未清）
  const S2 = loadSync(st, noNet);
  (await S2.save({ page: 'publish', name: '匿名存的', fields: {} }));

  const parsed = JSON.parse(S2.exportJson());
  assert.deepStrictEqual(parsed.items.map((x) => x.name), ['匿名存的'],
    '只导本机匿名的，上一个登录的人的记录不得混入导出文件');
});

test('saved-query：同 id → 视为同一条合并，不重复堆积', async () => {
  const S = load(fakeStorage());
  const mine = (await S.save({ page: 'publish', name: '共同查询', fields: { a: '1' }, owner: OWNER_A }));
  (await S.hit(mine.item.id));
  (await S.hit(mine.item.id));   // 本机打开 2 次

  const other = {
    app: 'spider-saved-queries', v: 2,
    items: [{
      id: mine.item.id, page: 'publish', name: '共同查询',
      fields: { a: '1' }, owner: OWNER_A, hits: 5, saves: 3, lastAt: Date.now(),
    }],
  };
  const r = (await S.importJson(JSON.stringify(other)));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.added, 0, '同 id 就是同一条，不能再加一条');
  assert.strictEqual(r.merged, 1);
  assert.strictEqual(S.list().length, 1);
  assert.strictEqual(S.list()[0].hits, 5, '打开次数取较大值（本机 2 次 vs 对方 5 次）');
  assert.strictEqual(S.list()[0].owner.userName, '张三', '本地已有归属时不覆盖');
});

// 2026-09-20：判重从「同页面 + 同名」改成「同 id，或同页面 + 同名 + 同一个人」。
// 拆成下面两条：同名**同人**该合，同名**不同人**绝不能合（原来就是后者被吃掉，
// 用户报成「第二个用户怎么搞都没法保存」）。
test('saved-query：同页面同名 + 同一个人（跨机器各存了一份）→ 仍然合并', async () => {
  const S = load(fakeStorage());
  (await S.save({ page: 'publish', name: '共同查询', fields: { a: '1' }, owner: OWNER_A }));
  const r = (await S.importJson(JSON.stringify({
    app: 'spider-saved-queries', v: 2,
    items: [{
      id: '另一台机器上的id', page: 'publish', name: '共同查询',
      fields: { a: '1' }, owner: OWNER_A, hits: 5,
    }],
  })));
  assert.strictEqual(r.added, 0, '同一个人存同名 → 还是同一条');
  assert.strictEqual(r.merged, 1);
  assert.strictEqual(S.list().length, 1);
});

test('saved-query：同页面同名但不是同一个人 → 各自独立，绝不合并（2026-09-20 回归）', async () => {
  // 两个人从同一份筛选条件保存，默认名由条件生成 → 必然同名。
  // 以前只看 page+name，第二个人那条会被并进第一个人的记录里，等于"存不进去"。
  const S = load(fakeStorage());
  (await S.save({ page: 'publish', name: '共同查询', fields: { a: '1' }, owner: OWNER_A }));
  const r = (await S.importJson(JSON.stringify({
    app: 'spider-saved-queries', v: 2,
    items: [{
      id: '别人的id', page: 'publish', name: '共同查询',
      fields: { a: '1' }, owner: OWNER_B, hits: 5,
    }],
  })));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.added, 1, '同名不同人 = 两条记录，不许把别人的合并掉');
  assert.strictEqual(S.list().length, 2);
  assert.strictEqual(S.listForUser(OWNER_A).length, 1, 'A 还能看到自己那条');
  assert.strictEqual(S.listForUser(OWNER_B).length, 1, 'B 也能看到自己那条');
});

test('saved-query：重复导入同一文件幂等 —— 不会把「高频」刷上去', async () => {
  const S = load(fakeStorage());
  const payload = JSON.stringify({
    app: 'spider-saved-queries', v: 2,
    items: [{ id: 'q1', page: 'task', name: '甲', fields: {}, hits: 3, saves: 2, owner: OWNER_A }],
  });
  (await S.importJson(payload));
  (await S.importJson(payload));
  (await S.importJson(payload));
  assert.strictEqual(S.list().length, 1);
  assert.strictEqual(S.list()[0].hits, 3, '反复导入不该累加，否则排行会被刷');
});

test('saved-query：本机没归属的同名记录，不会被别人的同名记录顶掉', async () => {
  // 归属不明的那条（页面没引 current-user.js 那类）跟「别人的同名记录」不是同一条：
  // 判重时 owner 对不上就不合并 —— 宁可多留一条，也不能把别人的记录标成自己的。
  const S = load(fakeStorage());
  (await S.save({ page: 'task', name: '甲', fields: {} }));   // 没设当前用户 → owner 为 null
  assert.strictEqual(S.list()[0].owner, null);
  (await S.importJson(JSON.stringify({
    app: 'spider-saved-queries', v: 2,
    items: [{ id: 'q9', page: 'task', name: '甲', fields: {}, owner: OWNER_A }],
  })));
  assert.strictEqual(S.list().length, 2, '归属不明那条不能被吞掉');
  const imported = S.list().find((x) => x.id === 'q9');
  assert.strictEqual(imported.owner.userName, '张三', '导入的那条带着自己的归属');
});

test('saved-query：导入脏文件一律报错，不破坏现有数据', async () => {
  const S = load(fakeStorage());
  (await S.save({ page: 'task', name: '原有', fields: {} }));
  const bad = [
    ['坏 JSON', '{不是 json'],
    ['不是本工具的结构', '{"hello":"world"}'],
    ['items 全是不合法项', '{"items":[{"id":""},{"page":"不存在"}]}'],
    ['空文本', ''],
  ];
  bad.forEach(async ([label, text]) => {
    const r = (await S.importJson(text));
    assert.strictEqual(r.ok, false, `${label} 应报错`);
    assert.ok(r.error, `${label} 要给出原因`);
  });
  assert.strictEqual(S.list().length, 1, '失败的导入不能动到已有记录');
});

test('saved-query：合并后超过上限 → 拒绝并保留原数据', async () => {
  const S = load(fakeStorage());
  const items = [];
  for (let i = 0; i < S.MAX_ITEMS + 5; i += 1) {
    items.push({ id: 'x' + i, page: 'task', name: 'q' + i, fields: {} });
  }
  const r = (await S.importJson(JSON.stringify({ app: 'spider-saved-queries', items })));
  assert.strictEqual(r.ok, false);
  assert.ok(/上限/.test(r.error), '要说清为什么拒绝：' + r.error);
  assert.strictEqual(S.list().length, 0, '拒绝时不能只写一半');
});

// ══════════════════════════════════════════════════════════
// 7) 与代理端点的同步（团队共享，与批次时间同一套路）
// ══════════════════════════════════════════════════════════

/** 带同步能力的加载：注入 location + fetch 桩（模块从 window 上取，可替换） */
function loadSync(storage, fetchStub, user) {
  const win = { localStorage: storage, location: { href: 'http://localhost:3000/' }, fetch: fetchStub };
  // 第三参：给不给「当前用户」。2026-09-22 复测 D-3 之后，没用户时 push 也只许记 'nouser'
  //（服务端本来就拒绝没有归属人的记录，`if (!uk) return`），所以那些讲「已同步」状态机的用例
  // 必须显式带上身份，否则测的是匿客户端的行为。
  if (user) win.CurrentUser = { get: () => user };
  loadScript('js/ui/saved-query.js', {}, win);
  return win.SavedQuery;
}

/** 让 microtask + 一次 setTimeout(0) 都跑完：等「fire-and-forget」的那次推送落定 */
const flush = async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };

const okJson = (data) => async () => ({ ok: true, status: 200, json: async () => ({ code: 200, data }) });

test('sync：没有端点能力时安静跳过，不抛也不假装成功', async () => {
  const S = load(fakeStorage());       // 没有 location / fetch
  const a = await S.syncFromServer();
  assert.strictEqual(a.ok, false, '静态部署/离线时应明确说不可用');
  const b = await S.pushToServer();
  assert.strictEqual(b.ok, false);
});

test('sync：push 提交本机记录后，**绝不让服务端全集污染本机镜像**（2026-09-20 回归）', async () => {
  const st = fakeStorage();
  let posted = null;
  const S = loadSync(st, async (url, opts) => {
    if (!opts || opts.method !== 'POST') throw new Error('不该走 GET');
    posted = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ code: 200, data: { items: [
      ...posted.items,
      { id: 'peer1', page: 'task', name: '同事的查询', fields: {}, hits: 3, saves: 1,
        owner: { userId: '1001', userName: '李四', teamId: 'M2534', teamName: '开发一部' } },
    ] } }) };
  });
  (await S.save({ page: 'publish', name: '我的查询', fields: {} }));

  const r = await S.pushToServer();
  assert.strictEqual(r.ok, true);
  assert.ok(posted.items.some((it) => it.name === '我的查询'), '本机记录要提交上去');
  // 2026-09-20 架构改版：镜像只留「我的」。旧版把服务端全集 writeRaw 回本机，
  // 让李四的机器上混进张三的记录 —— 那是「改名弹回/导入被盖/第二个人存了看不到」的共同根源。
  assert.strictEqual(S.list().length, 1, '本机镜像不得混入服务端全集（同事那条不能进来）');
  assert.ok(!S.list().some((it) => it.name === '同事的查询'), '同事的记录只能留在服务端');
});

test('sync：删除意图会带给服务端（否则合并时会把删掉的记录复活）', async () => {
  const st = fakeStorage();
  const posts = [];
  const S = loadSync(st, async (url, opts) => {
    posts.push(JSON.parse(opts.body));
    return { ok: true, status: 200, json: async () => ({ code: 200, data: { items: [] } }) };
  });
  const keep = (await S.save({ page: 'publish', name: '保留', fields: {} }));
  const del = (await S.save({ page: 'publish', name: '要删的', fields: {} }));
  // remove() 内部就会 await pushToServer（2026-09-20 改：不再是 fire-and-forget）
  (await S.remove(del.item.id));

  const removePush = posts.find((p) => (p.deletedIds || []).includes(del.item.id));
  assert.ok(removePush, '删除那次推送必须带上被删的 id');
  assert.ok(removePush.items.some((it) => it.name === '保留'), '同一批里没删的要一起提交');

  // 服务端已确认 → 待办清空，下次不再重复提交
  await S.pushToServer();
  assert.deepStrictEqual(posts[posts.length - 1].deletedIds, [], '确认过的删除意图不该重复提交');
  assert.ok(keep.ok);
});

test('sync：syncFromServer 刷新「我的」镜像（服务端为准，不再把全集合并进本机）', async () => {
  const st = fakeStorage();
  const win = { localStorage: st, location: { href: 'http://localhost:3000/' }, CurrentUser: { get: () => ME } };
  let sawUrl = '';
  win.fetch = async (url) => {
    sawUrl = String(url);
    return { ok: true, status: 200, json: async () => ({ code: 200, data: { mode: 'user', user: '1001', items: [
      { id: 'm1', page: 'publish', name: '我的（服务端）', fields: {}, hits: 9, saves: 2, owner: ME },
    ], storage: 'sqlite', file: '/srv/a.db' } }) };
  };
  loadScript('js/ui/saved-query.js', {}, win);
  const S = win.SavedQuery;
  // 本机镜像里有条服务端没有的陈旧记录 → 刷新后应以服务端为准
  st.setItem(KEY, JSON.stringify([{ id: 'stale', page: 'task', name: '本机陈旧记录', fields: {}, owner: ME, at: 5 }]));
  const r1 = await S.syncFromServer();
  assert.strictEqual(r1.ok, true);
  assert.ok(/user=/.test(sawUrl), '要按人拉取（?user=），不是拉全集');
  assert.deepStrictEqual(S.list().map((x) => x.id), ['m1'], '镜像 = 服务端里我的列表（陈记录被刷掉）');
});

test('sync：端点报错 / 返回坏数据时只影响同步，不动本地数据', async () => {
  const st = fakeStorage();
  const S = loadSync(st, async () => { throw new Error('Failed to fetch'); });
  (await S.save({ page: 'publish', name: '本机数据', fields: {} }));
  const r = await S.pushToServer();
  assert.strictEqual(r.ok, false);
  assert.ok(/同步失败/.test(r.error), '要说清是同步失败：' + r.error);
  assert.strictEqual(S.list().length, 1, '同步失败不能动本机记录');
});

test('sync：HTTP 500 与坏 JSON 都要被当成失败而不是崩', async () => {
  const st = fakeStorage();
  const S = loadSync(st, async () => ({ ok: false, status: 500, json: async () => ({}) }));
  const a = await S.pushToServer();
  assert.strictEqual(a.ok, false);
  assert.ok(/500/.test(a.error));

  const S2 = loadSync(fakeStorage(), async () => ({ ok: true, status: 200, json: async () => { throw new Error('Unexpected token'); } }));
  const b = await S2.pushToServer();
  assert.strictEqual(b.ok, false);
  assert.ok(b.error);
});

// ══════════════════════════════════════════════════════════
// 8) 同步状态（首页「已同步 / 仅本机 / 同步失败」角标的唯一数据源）
// ══════════════════════════════════════════════════════════
//
// 守的是**口径**而不是样式：角标本身只是把 lastSyncState() 如实翻译出来，
// 判断（哪种情况算连上、哪种算故障）全在这里。之前同步是静默的，
// 用户看不出自己看的是团队库还是本机那一份，所以这套判定必须有用例钉住。

test('同步状态：没同步过之前是 pending，不给任何结论', async () => {
  const S = loadSync(fakeStorage(), okJson({ items: [], file: '/srv/shared/saved-queries.db' }), ME);
  assert.strictEqual(S.lastSyncState().state, 'pending');
});

test('同步状态：成功且代理报了库文件 → shared，file/storage/people/total 都记下来', async () => {
  const S = loadSync(fakeStorage(), okJson({
    items: [], file: '/srv/shared/saved-queries.db', storage: 'sqlite', people: 3,
  }), ME);
  const r = await S.pushToServer();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.file, '/srv/shared/saved-queries.db', '返回值也要带 file，首页角标之外的人要用');
  const st = S.lastSyncState();
  assert.strictEqual(st.state, 'shared');
  // 状态里只留**文件名**，不留代理机器的绝对路径（角标人人可见，代理又默认监听所有网卡）
  assert.strictEqual(st.file, 'saved-queries.db');
  assert.strictEqual(st.storage, 'sqlite');
  assert.strictEqual(st.people, 3);
  assert.strictEqual(st.error, '');
  assert.ok(Number(st.at) > 0, '要记下这次同步发生在什么时候');
});

test('同步状态：端点 404（没起代理 / 静态部署）算「仅本机」，不算故障', async () => {
  const S = loadSync(fakeStorage(), async () => ({ ok: false, status: 404, json: async () => ({}) }), ME);
  const r = await S.pushToServer();
  assert.strictEqual(r.ok, false, '返回值照实说失败');
  assert.strictEqual(S.lastSyncState().state, 'local', '但状态是「仅本机」：没有端点不是谁的错');
});

test('同步状态：网络断了（Failed to fetch）也算「仅本机」，HTTP 500 才算故障', async () => {
  const a = loadSync(fakeStorage(), async () => { throw new Error('Failed to fetch'); }, ME);
  await a.pushToServer();
  assert.strictEqual(a.lastSyncState().state, 'local');

  const b = loadSync(fakeStorage(), async () => ({ ok: false, status: 500, json: async () => ({}) }), ME);
  await b.syncFromServer();
  assert.strictEqual(b.lastSyncState().state, 'fail');
  assert.ok(/500/.test(b.lastSyncState().error), '故障要把原因留给角标的 title');
});

test('同步状态：压根没有 fetch 能力时是 local，不是 fail', async () => {
  const S = load(fakeStorage());   // 没有 location / fetch
  await S.pushToServer();
  assert.strictEqual(S.lastSyncState().state, 'local');
  assert.ok(/没有同步端点/.test(S.lastSyncState().error));
});

test('同步状态：坏 JSON / 抛异常这类真故障要落 fail 并带上原因', async () => {
  const S = loadSync(fakeStorage(), async () => ({ ok: true, status: 200, json: async () => { throw new Error('Unexpected token'); } }), ME);
  const r = await S.pushToServer();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(S.lastSyncState().state, 'fail');
  assert.ok(/Unexpected token/.test(S.lastSyncState().error));
});

test('同步状态：sendBeacon 那条路拿不到响应，不能把「已同步」翻成「同步失败」', async () => {
  const win = {
    localStorage: fakeStorage(),
    location: { href: 'http://localhost:3000/' },
    CurrentUser: { get: () => ME },
    fetch: okJson({ items: [], file: '/srv/shared/saved-queries.db', storage: 'sqlite' }),
  };
  loadScript('js/ui/saved-query.js', {}, win);
  const S = win.SavedQuery;
  await S.pushToServer();
  assert.strictEqual(S.lastSyncState().state, 'shared');

  // 关页面：navigator 里没有 sendBeacon（或被拒），只是发不出去，不代表同步出了错
  const r = await S.pushToServer({ beacon: true });
  assert.strictEqual(r.ok, false, '没 sendBeacon 时该照实返回不可用');
  assert.strictEqual(r.beacon, true, '但要标出这是 beacon 路径');
  assert.strictEqual(S.lastSyncState().state, 'shared', '角标不该被这条路径改写');
});

test('同步状态：save() 之后的顺手推送会自动更新状态，调用方不必自己传回调', async () => {
  const peer = { id: 'peer1', page: 'publish', name: '同事的', fields: {}, hits: 1, saves: 1,
    owner: { userId: '1001', userName: '李四', teamName: '开发一部' } };
  // 真实代理返回的是「合并后的全集」，桩也照这个来
  const S = loadSync(fakeStorage(), async (url, opts) => ({
    ok: true, status: 200,
    json: async () => ({
      code: 200,
      data: { items: [...JSON.parse(opts.body).items, peer], file: '/srv/shared/saved-queries.db', storage: 'sqlite', people: 2 },
    }),
  }), ME);
  assert.strictEqual(S.lastSyncState().state, 'pending');
  (await S.save({ page: 'publish', name: '我的', fields: {} }));   // autoPush 是 fire-and-forget
  await flush();
  await flush();
  const st = S.lastSyncState();
  assert.strictEqual(st.state, 'shared', '写完本地顺手推的那次也要落到状态里');
  // 2026-09-20 架构改版：全集只活在服务端，镜像/条数都是「我的」那份
  assert.strictEqual(st.total, 1, '条数是镜像里的「我的」条数，不是团队全集');
  assert.strictEqual(S.list().length, 1, '同事那条不能进本机镜像');
});

test('同步状态：订阅能收到变化，取消订阅后不再收到；返回值是副本', async () => {
  const S = loadSync(fakeStorage(), okJson({ items: [], file: '/srv/shared/a.db' }), ME);
  const seen = [];
  const off = S.onSyncStateChange((st) => seen.push(st.state));
  await S.pushToServer();
  assert.deepStrictEqual(seen, ['shared']);

  const st = S.lastSyncState();
  st.state = '篡改';
  assert.strictEqual(S.lastSyncState().state, 'shared', 'lastSyncState 要给副本，改不坏内部状态');

  off();
  await S.pushToServer();
  assert.deepStrictEqual(seen, ['shared'], '取消订阅后不该再被叫到');
});

test('同步状态：订阅方自己抛异常，不能把存储层的同步带崩', async () => {
  const S = loadSync(fakeStorage(), okJson({ items: [], file: '/srv/shared/a.db' }), ME);
  // 故意保持**同步**回调：这条测的是「同步 throw 也要被 recordSync 接住」，
  // 不能被批量 async 化误伤（async throw 会变成 rejection，try/catch 接不住）
  S.onSyncStateChange(() => { throw new Error('订阅方炸了'); });
  const r = await S.pushToServer();
  assert.strictEqual(r.ok, true, '同步本身该成功');
  assert.strictEqual(S.lastSyncState().state, 'shared');
});

test('同步状态：代理没报 file 就不能说「已同步」，要退回 local', async () => {
  // 角标的判据是「代理告诉我们在读写哪个库」；少了这句话，就不该给用户一个共享的结论
  const S = loadSync(fakeStorage(), okJson({ items: [] }), ME);
  await S.pushToServer();
  assert.strictEqual(S.lastSyncState().state, 'local', '没 file 就没证据：不能报 shared');
});

test('同步状态：没设「当前用户」时 syncFromServer → nouser（角标隐藏，不谎报已同步）', async () => {
  // 2026-09-21 用户拍板：没设当前用户时只探活，没有「我的列表」可同步 —— 不能说「已同步」
  const S = loadSync(fakeStorage(), okJson({ items: [], file: '/srv/shared/a.db', storage: 'sqlite', people: 3 }));
  const r = await S.syncFromServer();
  assert.strictEqual(r.ok, true, '探活本身是成功的');
  assert.strictEqual(r.file, '/srv/shared/a.db', '端点信息仍如实带回来（排查用）');
  assert.strictEqual(S.lastSyncState().state, 'nouser', '但要标成 nouser，首页角标对它隐藏');
});

test('同步状态：设了当前用户 → syncFromServer 走「我的列表」，拿得到 shared', async () => {
  const me = { userId: '1001', userName: '张三' };
  const stub = async (url) => {
    const u = new URL(String(url), 'http://localhost');
    const isUserQuery = !!u.searchParams.get('user');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        code: 200,
        data: isUserQuery
          ? { mode: 'user', items: [], storage: 'sqlite' }
          : { items: [], file: '/srv/a.db', storage: 'sqlite', people: 3 },
      }),
    };
  };
  const S = loadUserSync(fakeStorage(), stub, me);
  const r = await S.syncFromServer();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(S.lastSyncState().state, 'shared', '有「我的列表」可同步 → 才是真的已同步');
});

test('同步状态：已经 shared 过之后，一次拿不到 file 的成功不该把它打成 local', async () => {
  // 首屏 push 通常能拿到 file，之后的顺手推送若遇到一个不报 file 的实现，
  // 把「已同步」翻成「仅本机」会让人以为共享库掉了 —— 粘性是对的方向。
  let n = 0;
  const S = loadSync(fakeStorage(), async (...a) => {
    n += 1;
    return { ok: true, status: 200, json: async () => ({ code: 200, data: n === 1 ? { items: [], file: '/srv/a.db' } : { items: [] } }) };
  }, ME);
  await S.pushToServer();
  assert.strictEqual(S.lastSyncState().state, 'shared');
  await S.pushToServer();
  assert.strictEqual(S.lastSyncState().state, 'shared', '第一次的证据要能撑住后续这些无证据的成功');
});

test('同步状态：从失败恢复到成功后，要把上一次的 error 清掉', async () => {
  let fail = true;
  const S = loadSync(fakeStorage(), async () => (fail
    ? { ok: false, status: 500, json: async () => ({}) }
    : { ok: true, status: 200, json: async () => ({ code: 200, data: { items: [], file: '/srv/a.db', storage: 'sqlite' } }) }), ME);
  await S.pushToServer();
  assert.strictEqual(S.lastSyncState().state, 'fail');
  fail = false;
  await S.pushToServer();
  const st = S.lastSyncState();
  assert.strictEqual(st.state, 'shared');
  assert.strictEqual(st.error, '', '恢复之后还留着旧原因，title 会自相矛盾');
});

test('同步状态：200 但回来的不是 JSON（静态站的 fallback 页）算「没有端点」，不是故障', async () => {
  const S = loadSync(fakeStorage(), async () => ({
    ok: true, status: 200,
    json: async () => { throw new Error('Unexpected token < in JSON at position 0'); },
  }), ME);
  const r = await S.pushToServer();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(S.lastSyncState().state, 'local',
    'SPA 站点会把未知路径 fallback 成 200 + HTML，这时候说「同步失败」会让人以为共享库坏了');
});

test('同步状态：后端明确不支持部门排行时（mode 缺失或不是 dept）一律拒绝采用', async () => {
  // JSON 兜底分支以前不发 mode —— 旧防线 `data.mode && ...` 在 mode 缺失时放行，
  // 会把「全部门全量」当成本部门排行渲染到首页卡片上。现在要求**明确**是 dept。
  const ME = { userId: '1', userName: '甲', teamId: 'T1', teamName: '开发一部' };
  const noMode = loadSync(fakeStorage(), okJson({ items: [{ id: 'x', page: 'publish', name: '别人的', fields: {} }] }), ME);
  const a = await noMode.deptTopFromServer(ME, 10);
  assert.strictEqual(a.ok, false, '没有 mode = 没证明自己按部门筛过，不能用');
  const allMode = loadSync(fakeStorage(), okJson({ mode: 'all', items: [] }), ME);
  assert.strictEqual((await allMode.deptTopFromServer(ME, 10)).ok, false);
  const deptMode = loadSync(fakeStorage(), okJson({ mode: 'dept', items: [], people: 0 }), ME);
  assert.strictEqual((await deptMode.deptTopFromServer(ME, 10)).ok, true, 'mode=dept 才放行');
});

test('同步后缀：各页「已保存到首页」的提示与角标同一口径，没同步过时不加话', async () => {
  const S = loadSync(fakeStorage(), okJson({ items: [], file: '/srv/a.db', storage: 'sqlite' }), ME);
  assert.strictEqual(S.syncSuffix(), '', '还没同步过就别瞎猜');
  await S.pushToServer();
  assert.ok(/共享库已连上/.test(S.syncSuffix()), S.syncSuffix());
  const bad = loadSync(fakeStorage(), async () => ({ ok: false, status: 500, json: async () => ({}) }), ME);
  await bad.pushToServer();
  assert.ok(/共享同步失败.*500.*先存本机/.test(bad.syncSuffix()), bad.syncSuffix());
});

// ══════════════════════════════════════════════════════════
// 8) 归属人（owner）—— 「谁存的」决定这条记录能不能被看见
//
// 2026-09-19 的教训：current-user.js 以前只在首页引入，另外三个查询页只引了
// saved-query.js，于是 save() 里的归属兜底静默变成 null —— 保存是成功的、
// 不报错、角标也说「已同步」，但那条记录在「我的常用查询」和部门排行里永远隐形。
// 下面的用例把这个契约钉住，尤其是最后那条静态防线。
// ══════════════════════════════════════════════════════════

const ME = { userId: '4711510', userName: '甲', teamId: 'T1', teamName: '开发一部' };
const OTHER = { userId: '6464402', userName: '乙', teamId: 'T2', teamName: '开发二部' };

test('归属：userKeyOf 与服务端 lib/queries-db.js 同口径（有工号用工号，否则姓名）', async () => {
  const S = load(fakeStorage());
  assert.strictEqual(S.userKeyOf(ME), '4711510');
  assert.strictEqual(S.userKeyOf({ userName: '甲' }), '甲', '没工号时姓名兜底');
  assert.strictEqual(S.userKeyOf({ userId: 4711510 }), '4711510', '数字工号要转成字符串');
  assert.strictEqual(S.userKeyOf(null), '');
  assert.strictEqual(S.userKeyOf('不是对象'), '', '非对象不能抛');
});

test('归属：save() 取不到当前用户时 owner 为空，但要把这件事显式回给调用方', async () => {
  const S = load(fakeStorage());   // 没有 CurrentUser
  const r = (await S.save({ page: 'publish', name: '没人归属的一条', fields: { f_prodBatch: '2611' } }));
  assert.strictEqual(r.ok, true, '没身份不该阻止保存');
  assert.strictEqual(r.item.owner, null);
  assert.strictEqual(r.ownerMissing, true, '必须把「没记到归属」回传，否则三页 toast 无从提示');
  assert.ok(/归属/.test(S.ownerSuffix(r)), '措辞要提到归属：' + S.ownerSuffix(r));
  assert.strictEqual(S.ownerSuffix({ ok: true, ownerMissing: false }), '', '正常保存别加话');
});

test('归属：save() 有当前用户时自动落 owner，且 ownerMissing 为假', async () => {
  const S = load(fakeStorage(), { CurrentUser: { get: () => ME } });
  const r = (await S.save({ page: 'publish', name: '我存的', fields: { f_prodBatch: '2611' } }));
  assert.strictEqual(r.ownerMissing, false, JSON.stringify(r));
  assert.strictEqual(S.ownerSuffix(r), '');
  const saved = S.get(r.item.id);
  assert.strictEqual(saved.owner.userId, '4711510', '归属人必须真的落盘');
  assert.strictEqual(saved.owner.teamName, '开发一部', '部门要一起存，否则部门排行算不出');
});

test('归属：显式传的 owner 优先于「当前用户」（导入/代录场景不该被覆盖）', async () => {
  const S = load(fakeStorage(), { CurrentUser: { get: () => ME } });
  const r = (await S.save({ page: 'task', name: '替乙存的', fields: {}, owner: OTHER }));
  assert.strictEqual(S.get(r.item.id).owner.userId, '6464402');
});

test('「我的」列表：没有当前用户时返回空，绝不退化成"显示全部"', async () => {
  const S = load(fakeStorage(), { CurrentUser: { get: () => ME } });
  (await S.save({ page: 'publish', name: '我的', fields: { a: '1' } }));
  (await S.save({ page: 'publish', name: '显式给乙的', fields: { a: '1' }, owner: OTHER }));
  assert.deepStrictEqual(S.listForUser(null), [], '拿不到身份就只能空着');
  assert.deepStrictEqual(S.listForUser({}), [], '空对象也拿不到键');
  const mine = S.listForUser(ME);
  assert.strictEqual(mine.length, 1, '不该把同事的记录算进我的');
  assert.strictEqual(mine[0].name, '我的');
});

test('「我的」列表：owner 为空的历史记录不属于任何人，limit 与倒序都要生效', async () => {
  const st = fakeStorage();
  const anon = load(st);   // 故意不注入 CurrentUser：从这种页面存出去的就是孤儿
  const orphan = await anon.save({ page: 'publish', name: '孤儿（没归属）', fields: {} });
  assert.strictEqual(orphan.ownerMissing, true);
  const S = load(st, { CurrentUser: { get: () => ME } });
  // 直接改盘：塞两条我自己的、时间不同（save 同名会覆盖，所以用不同名字）
  const rows = JSON.parse(st.getItem(KEY)).map((it) => ({ ...it }));   // 存的是裸数组，不是 { items }
  const withMine = rows.concat([
    { id: 'm1', page: 'task', name: '早的', fields: {}, owner: ME, hits: 0, saves: 1, at: 100 },
    { id: 'm2', page: 'task', name: '晚的', fields: {}, owner: ME, hits: 0, saves: 1, at: 900 },
  ]);
  st.setItem(KEY, JSON.stringify(withMine));   // 存储就是裸数组，别包一层 { items }
  const mine = S.listForUser(ME);
  assert.deepStrictEqual(mine.map((x) => x.name), ['晚的', '早的'], '按最近使用倒序');
  assert.ok(!mine.some((x) => x.id === orphan.item.id), '没归属的记录不该出现在任何人的列表里');
  assert.deepStrictEqual(S.listForUser(ME, 1).map((x) => x.name), ['晚的'], 'limit 要生效');
});

test('「我的」服务端版：mode 不是 user 一律拒绝（否则会把全量当"我的"）', async () => {
  const noMode = loadSync(fakeStorage(), okJson({ items: [{ id: 'x', page: 'publish', name: '别人的', fields: {} }] }));
  assert.strictEqual((await noMode.mineFromServer(ME)).ok, false, '没 mode = 没证明自己按人筛过');
  const allMode = loadSync(fakeStorage(), okJson({ mode: 'all', items: [] }));
  assert.strictEqual((await allMode.mineFromServer(ME)).ok, false);
  const good = loadSync(fakeStorage(), okJson({ mode: 'user', items: [{ id: 'y', page: 'publish', name: '我的', fields: {}, owner: ME }] }));
  const r = await good.mineFromServer(ME);
  assert.strictEqual(r.ok, true, 'mode=user 才放行');
  assert.strictEqual(r.items[0].name, '我的');
  assert.strictEqual((await good.mineFromServer(null)).ok, false, '没身份不发请求');
});

test('「我的」服务端版：请求要带上工号，且工号做 URL 编码', async () => {
  const seen = [];
  const S = loadSync(fakeStorage(), async (url) => {
    seen.push(url);
    return { ok: true, status: 200, json: async () => ({ code: 200, data: { mode: 'user', items: [] } }) };
  });
  await S.mineFromServer({ userId: '甲 乙&丙', userName: '' });
  assert.ok(/user=%E7%94%B2%20%E4%B9%99%26%E4%B8%99/.test(seen[0]), '必须编码：' + seen[0]);
});

test('页面接线防线：凡引用 saved-query.js 的页面，必须同时引用 current-user.js 且在它之前', async () => {
  // 为什么钉这条（而不是只写进文档）：漏引 current-user.js 不会产生任何报错，
  // 只会让从那一页保存的查询 owner 为空 —— 用户表现为「我存了但首页没有」，
  // 排查时又会先怀疑同步、再怀疑 SQLite，成本极高（2026-09-19 就是这么坏的）。
  const pages = ['index.html', 'publish.html', 'subscription.html', 'task.html'];
  pages.forEach((f) => {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const src = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    const iSaved = src.findIndex((s) => /saved-query\.js$/.test(s));
    if (iSaved < 0) return;   // 这页不用常用查询模块，不该被这条用例管
    const iUser = src.findIndex((s) => /current-user\.js$/.test(s));
    assert.ok(iUser >= 0, `${f} 引了 saved-query.js 却没引 current-user.js：从本页保存的查询会没有归属人`);
    assert.ok(iUser < iSaved, `${f} 的 current-user.js 必须排在 saved-query.js 之前`);
  });
});

// ══════════════════════════════════════════════════════════
// 8) 服务端优先架构（2026-09-20 改版）：数据库为唯一真相源
// ══════════════════════════════════════════════════════════

/** 造一个「假代理」：GET ?user= 按人回、POST 按 id upsert，行为对齐 proxy.js + queries-db.js */
function fakeProxy() {
  const db = new Map();          // id → item
  const tomb = new Set();
  const handle = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    if (method === 'GET') {
      const user = new URL(u, 'http://localhost').searchParams.get('user');
      const items = [...db.entries()]
        .filter(([id, it]) => !tomb.has(id) && (!user || String((it.owner && (it.owner.userId || it.owner.userName)) || '') === user))
        .map(([, it]) => it);
      return { ok: true, status: 200, json: async () => ({ code: 200, data: { mode: user ? 'user' : 'all', user, items } }) };
    }
    const body = JSON.parse(opts.body || '{}');
    (body.items || []).forEach((it) => db.set(it.id, it));
    (body.deletedIds || []).forEach((id) => { tomb.add(id); db.delete(id); });
    const items = [...db.entries()].filter(([id]) => !tomb.has(id)).map(([, it]) => it);
    return { ok: true, status: 200, json: async () => ({ code: 200, data: { mode: 'all', items, storage: 'sqlite', file: '/srv/fake.db', people: 2 } }) };
  };
  handle.db = db;
  return handle;
}

/** 带 CurrentUser 的同步环境（服务端路径要按人） */
function loadUserSync(storage, fetchStub, me) {
  const win = { localStorage: storage, location: { href: 'http://localhost:3000/' }, fetch: fetchStub, CurrentUser: { get: () => me } };
  loadScript('js/ui/saved-query.js', {}, win);
  return win.SavedQuery;
}

test('服务端优先：同一台机器先后两个人各存同名查询 → 服务端两条、镜像各只有自己的', async () => {
  const proxy = fakeProxy();
  const st = fakeStorage();
  const ZS = { userId: '1001', userName: '张三', teamName: '开发一部' };
  const LS = { userId: '1002', userName: '李四', teamName: '开发一部' };
  const S = loadUserSync(st, proxy, ZS);

  const r1 = await S.save({ page: 'publish', name: '服务X', fields: { f_serviceName: '服务X' } });
  assert.strictEqual(r1.ok, true, '张三保存成功');
  assert.strictEqual(r1.server, true, '连得上代理时必须走服务端路径');

  // 同一台机器换人（真实场景：公用电脑）：同一份 localStorage，不同身份。
  const S2 = loadUserSync(st, proxy, LS);   // 同一份 localStorage（同机），不同身份
  const r2 = await S2.save({ page: 'publish', name: '服务X', fields: { f_serviceName: '服务X' } });
  assert.strictEqual(r2.ok, true, '李四保存也成功');
  assert.notStrictEqual(r1.item.id, r2.item.id, '两人各一条，绝不复用对方的 id');
  assert.strictEqual(proxy.db.size, 2, '服务端库里是两条');

  // 镜像里只有「自己」的：张三的记录不得出现在李四的镜像里
  const S2list = S2.list();
  assert.strictEqual(S2list.length, 1, '李四的镜像只有他自己那条');
  assert.strictEqual(S2list[0].owner.userId, '1002');

  // 换回张三看：?user=1001 还是只有张三那条
  const again = await S.mineFromServer(ZS);
  assert.strictEqual(again.items.length, 1);
  assert.strictEqual(again.items[0].owner.userId, '1001');
});

test('服务端优先：服务端失败时 save 回落本机（localOnly:true），数据不丢', async () => {
  const S = loadSync(fakeStorage(), async () => { throw new Error('Failed to fetch'); });
  const me = { userId: '1003', userName: '王五', teamName: '开发二部' };
  // loadSync 没有 CurrentUser —— 手工把身份借给 save（显式传 owner 与页面行为一致）
  const r = await S.save({ page: 'publish', name: '离线也要能存', fields: {}, owner: me });
  assert.strictEqual(r.ok, true, '服务端炸了也要存下来');
  assert.strictEqual(r.localOnly, true, '且要如实告诉调用方这是「仅本机」');
  assert.strictEqual(S.list().length, 1);
});

test('服务端优先：exportJsonAsync → 只导当前用户自己的（2026-09-21 改口径）', async () => {
  const proxy = fakeProxy();
  const S = loadUserSync(fakeStorage(), proxy, { userId: '1001', userName: '张三', teamName: '开发一部' });
  await S.save({ page: 'publish', name: '张三的', fields: {}, owner: { userId: '1001', userName: '张三', teamName: '开发一部' } });
  // 别人直接写进库里（模拟另一台机器推上来的）
  proxy.db.set('peerX', { id: 'peerX', page: 'task', name: '李四的', fields: {}, owner: { userId: '1002', userName: '李四', teamName: '开发一部' } });
  const text = await S.exportJsonAsync();
  const parsed = JSON.parse(text);
  // ⚠️ 这条断言 2026-09-21 反过来了：以前导出主体是**团队库全集**，断言「含张三+李四两条」；
  // 用户实测导出文件 12 条跨了 6 个人，拍板改成「只导当前用户自己的」。
  assert.strictEqual(parsed.items.length, 1, '导出只该有当前用户自己那一条，实际 ' + parsed.items.length);
  assert.strictEqual(parsed.items[0].name, '张三的');
  assert.ok(!parsed.items.some((x) => x.id === 'peerX'), '别人的记录不得出现在导出里');
});

test('服务端优先：没设「当前用户」时导出的是本机镜像（不含别人的）', async () => {
  const proxy = fakeProxy();
  // loadSync 不注入 CurrentUser —— 与没设用户时的页面一致
  const S = loadSync(fakeStorage(), proxy);
  S.clear();
  const w = await S.save({ page: 'publish', name: '匿名的', fields: {} });   // 无归属人 → 本地兜底
  assert.strictEqual(w.ok, true);
  proxy.db.set('peerX', { id: 'peerX', page: 'task', name: '别人的', fields: {}, owner: { userId: '1002', userName: '李四' } });
  const parsed = JSON.parse(await S.exportJsonAsync());
  assert.deepStrictEqual(parsed.items.map((x) => x.name), ['匿名的'], '没设用户时导本机镜像，且不得混入别人的记录');
});

test('服务端优先：导入的记录归当前用户（2026-09-21 改）—— 导同事的文件后自己也能看到', async () => {
  const proxy = fakeProxy();
  const S = loadUserSync(fakeStorage(), proxy, { userId: '1001', userName: '张三', teamName: '开发一部' });
  // 李四导出的文件：文件里那条的 owner 是李四
  const peerFile = JSON.stringify({
    app: 'spider-saved-queries',
    v: 2,
    items: [{
      id: 'p1', page: 'publish', name: '李四的查询', fields: { f_prodBatch: '2611' },
      owner: { userId: '1002', userName: '李四', teamName: '开发一部' },
    }],
  });
  const r = await S.importJson(peerFile);
  assert.strictEqual(r.ok, true);
  // 镜像只刷「我的」：这条能出现在镜像里，就说明它已经归了张三（否则按人拉不回来）
  assert.strictEqual(S.list().length, 1, '导入后本机镜像（=我的列表）里应能看到它');
  assert.strictEqual(S.list()[0].owner.userId, '1001', '归属已改写成当前用户');
  // 服务端库里那条同样归张三（合并后整份写回的）。
  // ⚠️ 2026-09-22 复测 D-4：导入换归属人的同时**换发新 id** —— 共享代理下文件里的 id
  //   在服务端必然已存在（属于原主人），沿用会让 `sameQuery` 第一步按 id 短路判同，
  //   结果导入变成静默空操作、归属仍是李四。所以这里按新 id 查，不能再查 'p1'。
  const stored = [...proxy.db.values()].filter((x) => x.owner && x.owner.userId === '1001');
  assert.strictEqual(stored.length, 1, '服务端库里应有且只有一条归当前用户的');
  assert.notStrictEqual(stored[0].id, 'p1', '导入别人的文件要换发新 id，不与服务端同 id 的行相撞');
});

test('服务端优先：getAsync 镜像未命中 → 从服务端按 id 捞回（深链回填用）', async () => {
  const proxy = fakeProxy();
  const S = loadUserSync(fakeStorage(), proxy, { userId: '1001', userName: '张三', teamName: '开发一部' });
  proxy.db.set('deep1', { id: 'deep1', page: 'publish', name: '深链那条', fields: { a: '1' }, owner: { userId: '1002', userName: '李四', teamName: '开发一部' } });
  assert.strictEqual(S.get('deep1'), null, '镜像里确实没有（换电脑场景）');
  const item = await S.getAsync('deep1');
  assert.strictEqual(item.id, 'deep1', '从服务端捞回来');
  assert.strictEqual(S.list().length, 0, '别人的记录只回填用，不进镜像');
});

test('saved-query：分键 —— 登录同步整段覆盖登录镜像，匿名记录不受影响', async () => {
  // 2026-09-22 用户报「登录了再退出的未登录用户又会被覆盖」：以前只有一个键，
  // 登录时 syncFromServer 用服务端拉回的「我的列表」**全量覆盖**镜像，
  // 没登录时保存的匿名记录跟着被冲掉。分键后同步只覆盖登录段，匿名段独立存活。
  const noNet = async () => { throw new Error('离线'); };
  const st = fakeStorage();
  // ① 没登录，先存一条匿名的
  const S0 = loadSync(st, noNet);
  await S0.save({ page: 'publish', name: '匿名存的', fields: {} });
  assert.strictEqual(S0.list().length, 1);
  // ② 同一份 localStorage 换到登录环境：同步会用服务端的「我的列表」整段覆盖登录镜像。
  //    fakeProxy 的库里是空的 → 覆盖后登录段为空 —— 但匿名那条必须活着。
  const S1 = loadUserSync(st, fakeProxy(), { userId: '6464402', userName: '吴树海' });
  await S1.syncFromServer();
  assert.deepStrictEqual(S1.list().map((x) => x.name), ['匿名存的'],
    '匿名记录被登录同步冲掉了');
  // 匿名记录确实落在独立段里（不与登录镜像混存）
  assert.deepStrictEqual(JSON.parse(st.getItem(ANON_KEY)).map((x) => x.name), ['匿名存的']);
});

test('saved-query：旧单键里的匿名记录会被迁移进匿名段（升级兼容）', () => {
  // 旧版只有一个键、登录与匿名的混在一起。分键后首次读取必须把匿名记录挪出去 ——
  // 否则迁移前的一次登录同步就会把它们冲掉，等于白迁移。
  const st = fakeStorage({
    [KEY]: JSON.stringify([
      { id: 'u1', page: 'publish', name: '有归属的', fields: {}, owner: OWNER_A },
      { id: 'a1', page: 'publish', name: '旧键里的匿名', fields: {} },
    ]),
  });
  const S = loadSync(st, async () => { throw new Error('离线'); });
  assert.deepStrictEqual(S.list().map((x) => x.name).sort(), ['旧键里的匿名', '有归属的'], '迁移不该丢数据');
  assert.deepStrictEqual(JSON.parse(st.getItem(ANON_KEY)).map((x) => x.name), ['旧键里的匿名'], '匿名记录要落进匿名段');
  assert.deepStrictEqual(JSON.parse(st.getItem(KEY)).map((x) => x.name), ['有归属的'], '登录段里不再混匿名记录');
});

test('saved-query：长编码截断 shortCode —— 只留尾部英文编码（2026-09-22 用户要求）', () => {
  // 用户报：「E00301-互联网金融服务平台-BOCNET-G-IFS 命名太长了，
  //          截断一下 BOCNET-G-IFS 这个就行，前面的编号和中文都不要」。
  const S = load(fakeStorage());
  assert.strictEqual(S.shortCode('E00301-互联网金融服务平台-BOCNET-G-IFS'), 'BOCNET-G-IFS');
  assert.strictEqual(S.shortCode('E00406-网上银行服务前端-海外个人手机银行客户端-BOCNETC-O-MAPSN'), 'BOCNETC-O-MAPSN');
  assert.strictEqual(S.shortCode('E00404-网上银行服务前端-海外个人网银-BOCNETC-O-WPSN'), 'BOCNETC-O-WPSN');
  // 前面还挂着别的内容时，照样能取到尾部编码
  assert.strictEqual(S.shortCode('探针批次 E00301-互联网金融服务平台-BOCNET-G-IFS'), 'BOCNET-G-IFS');
  // ⚠️ 中文前缀与英文编码**粘在同一段**（中间没有 -）—— 2026-09-22 用户截图报的
  //    「发布查询也应该是 BOCNET-O-WPSN，但是截错了」：那时只取到了尾巴的 O-WPSN。
  assert.strictEqual(S.shortCode('调用方系统：BOCNETC-O-MAPSN'), 'BOCNETC-O-MAPSN');
  assert.strictEqual(S.shortCode('调用方系统：BOCNETC-O-WPSN'), 'BOCNETC-O-WPSN');
  assert.strictEqual(S.shortCode('提供方系统：E00301-互联网金融服务平台-BOCNET-G-IFS'), 'BOCNET-G-IFS');
  // 本来就没有英文编码的（批次名 / 纯编号）原样返回 —— 宁可长一点，也不要把值弄成空的
  assert.strictEqual(S.shortCode('27年6月独立'), '27年6月独立');
  assert.strictEqual(S.shortCode('2611批次'), '2611批次');
  assert.strictEqual(S.shortCode('E00301'), 'E00301');
  // 空值 / 小写段不当编码（别把普通英文名也切了）
  assert.strictEqual(S.shortCode(''), '');
  assert.strictEqual(S.shortCode(null), '');
  assert.strictEqual(S.shortCode('abc-def'), 'abc-def');
});

test('saved-query：shortCode 不许把名字截成一个字母/一个数字，也不许多值串截成假编码（2026-09-22 复测 D-2）', () => {
  const S = load(fakeStorage());
  // 真实团队库现例（只读跑出来的）：尾巴的 `-B` 是环境标识不是编码，修复前首页与部门榜都显示成「B」
  const FULL_B = '调用方系统：E00404-网上银行服务前端-海外个人网银-B';
  assert.strictEqual(S.shortCode(FULL_B), FULL_B, '单个字母不算编码 —— 宁可整条显示');
  assert.strictEqual(S.shortCode('批次-2'), '批次-2');
  assert.strictEqual(S.shortCode('网上银行为主-备2'), '网上银行为主-备2');
  // 多个取值拼出来的串：只截最后一个会把前面的字段丢掉，拼成「甲-O-261」更是造假
  assert.strictEqual(S.shortCode('调用方：E00301 提供方：E00406'), '调用方：E00301 提供方：E00406');
  assert.strictEqual(S.shortCode('调用方系统：BOCNETC-O-MAPSN · 批次：261'),
    '调用方系统：BOCNETC-O-MAPSN · 批次：261');
  assert.strictEqual(S.shortCode('E00301-E00406-2611'), 'E00301-E00406-2611', '塌成一个数字算错');
  // 用户自己改的名字同样不许被截（显示端 home.js 已不再过 shortCode，这里守住函数本身）
  assert.strictEqual(S.shortCode('发布查询-2'), '发布查询-2');
  // 真编码照旧截得出来 —— 防反向改坏（口径与上面那条 2026-09-22 的用例一致）
  assert.strictEqual(S.shortCode('E00301-互联网金融服务平台-BOCNET-G-IFS'), 'BOCNET-G-IFS');
  assert.strictEqual(S.shortCode('调用方系统：BOCNETC-O-MAPSN'), 'BOCNETC-O-MAPSN');
});

test('saved-query：condNameOf 先截码再限长，不许先砍 30 字把编码截成半截（复测 D-2）', () => {
  const S = load(fakeStorage());
  const long = '一些很长的中文说明文字用来把长度撑过三十个字以验证顺序问题确实存在啊'
    + '-E00301-互联网金融服务平台-BOCNET-G-IFS';
  assert.strictEqual(S.condNameOf({ autoName: long }), 'BOCNET-G-IFS');
  // 没有 autoName 时退回 summary：同样要能截出完整编码（旧顺序先 slice(0,30) 就截没了）
  assert.strictEqual(S.condNameOf({ summary: long }), 'BOCNET-G-IFS');
});

test('sync：未登录时 pushToServer 之后角标仍是 nouser，不许谎报「已同步」（2026-09-22 复测 D-3）', async () => {
  // loadSync 不给 CurrentUser → 走的正是「没设当前用户」那条分支。
  // 09-21 的修法只覆盖了 syncFromServer（GET），首页每次加载都会 pushToServer（POST）把它盖回 shared。
  const st = fakeStorage();
  const S = loadSync(st, okJson({ items: [], file: '/srv/a.db', storage: 'sqlite', people: 2 }));
  await S.save({ page: 'publish', name: '匿名保存', fields: {} });
  const r = await S.pushToServer();
  assert.strictEqual(r.ok, true, '没登录也能推本机记录，不该报错');
  assert.strictEqual(S.lastSyncState().state, 'nouser',
    `未登录推送后角标必须仍是 nouser，实际：${S.lastSyncState().state}`);
});

test('导入：把同事的文件导给另一个登录人时换发新 id，归属真的变成「我」（2026-09-22 复测 D-4）', async () => {
  const st = fakeStorage();
  const X = { userId: '4711510', userName: '甲', teamId: 'T1', teamName: '开发一部' };
  const Y = { userId: '6464402', userName: '乙', teamId: 'T1', teamName: '开发一部' };
  // 服务端已经有甲的那一条（同一份共享代理 → id 必然与甲导出的文件里完全一样）
  const serverItems = [{ id: 'q-same', page: 'publish', name: '甲的条件', fields: { a: 1 },
    autoName: '甲的条件', owner: X, savers: [X], hits: 1, saves: 1, at: 10 }];
  let posted = null;
  const win = {
    localStorage: st,
    location: { href: 'http://localhost:3000/' },
    CurrentUser: { get: () => Y },
    fetch: async (url, opts) => {
      if (!opts || !opts.body) return { ok: true, status: 200, json: async () => ({ code: 200, data: { items: serverItems, mode: 'all', file: '/srv/a.db', storage: 'sqlite', people: 1 } }) };
      posted = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ code: 200, data: { items: posted.items, file: '/srv/a.db', storage: 'sqlite', people: 2 } }) };
    },
  };
  loadScript('js/ui/saved-query.js', {}, win);
  const S = win.SavedQuery;
  const file = JSON.stringify({ version: 1, items: [{ id: 'q-same', page: 'publish',
    name: '甲的条件', fields: { a: 1 }, autoName: '甲的条件', owner: X, hits: 1, saves: 1, at: 10 }] });
  const r = await S.importJson(file);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.added, 1, '乙导进来必须算**新增一条属于乙的**，不是静默合并到甲那行');
  const mine = posted.items.find((it) => it.id !== 'q-same');
  assert.ok(mine, '提交里应有一条换了新 id 的记录');
  assert.strictEqual(String(mine.owner.userId), '6464402', '新记录的归属要是乙');
  assert.ok(!serverItems.some((it) => it.id === mine.id), '新 id 不该撞上服务端已有的行');
});
