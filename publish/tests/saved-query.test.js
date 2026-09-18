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
const { loadScript, test } = require('./harness');

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

// ══════════════════════════════════════════════════════════
// 1) 保存与校验
// ══════════════════════════════════════════════════════════

test('saved-query：正常保存 → 返回 ok 且带 id / 时间戳', () => {
  const S = load(fakeStorage());
  const r = S.save({ page: 'publish', name: '2611批次-全球汇划', fields: { f_prodBatch: '2611pc' }, summary: '变更批次：2611pc' });
  assert.strictEqual(r.ok, true, '应保存成功：' + JSON.stringify(r));
  assert.ok(r.item.id, '必须生成 id（首页跳转要用 ?saved=<id>）');
  assert.ok(r.item.at > 0, '要记保存时间，列表按它倒序');
  assert.strictEqual(r.item.fields.f_prodBatch, '2611pc');
});

test('saved-query：名称为空 / 纯空格 → 拒绝保存，不写存储', () => {
  const st = fakeStorage();
  const S = load(st);
  ['', '   ', undefined, null].forEach((name) => {
    const r = S.save({ page: 'publish', name, fields: { a: '1' } });
    assert.strictEqual(r.ok, false, `名称 ${JSON.stringify(name)} 应被拒绝`);
  });
  assert.strictEqual(st.getItem(KEY), null, '被拒绝的保存不该落盘');
});

test('saved-query：未知页面类型 → 拒绝保存', () => {
  const S = load(fakeStorage());
  const r = S.save({ page: 'notExist', name: 'x', fields: {} });
  assert.strictEqual(r.ok, false);
  assert.ok(/页面类型/.test(r.error), '错误信息要说清原因：' + r.error);
});

test('saved-query：fields 只收 string / number / string[]，对象与 null 一律丢弃', () => {
  const S = load(fakeStorage());
  const r = S.save({
    page: 'task',
    name: '清洗测试',
    fields: {
      a: '文本', b: 123, c: ['x', 'y'], d: ['x', {}, null],
      e: { nested: 1 }, f: null, g: undefined, h: '', i: NaN, j: Infinity,
    },
  });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.item.fields, { a: '文本', b: 123, c: ['x', 'y'], d: ['x'] },
    '对象/null/空串/NaN/Infinity 都不该进入 fields（它会被回填进表单）');
});

test('saved-query：同名同页视为更新 —— 不重复堆积、保留原 id', () => {
  const S = load(fakeStorage());
  const a = S.save({ page: 'publish', name: '同名', fields: { x: '1' } });
  const b = S.save({ page: 'publish', name: '同名', fields: { x: '2' } });
  assert.strictEqual(b.ok, true);
  assert.strictEqual(b.item.id, a.item.id, '更新应复用原 id，否则首页会存下一堆同名卡片');
  assert.strictEqual(b.updated, true);
  assert.strictEqual(S.list().length, 1, '不该出现两条同名记录');
  assert.strictEqual(S.list()[0].fields.x, '2', '应覆盖为最新条件');
});

test('saved-query：不同页同名互不干扰', () => {
  const S = load(fakeStorage());
  S.save({ page: 'publish', name: '同名', fields: {} });
  S.save({ page: 'task', name: '同名', fields: {} });
  assert.strictEqual(S.list().length, 2);
});

test('saved-query：超过上限（50 条）→ 报错而不是无限写入', () => {
  const S = load(fakeStorage());
  for (let i = 0; i < S.MAX_ITEMS; i += 1) {
    assert.strictEqual(S.save({ page: 'task', name: 'q' + i, fields: {} }).ok, true);
  }
  const over = S.save({ page: 'task', name: '多出来的', fields: {} });
  assert.strictEqual(over.ok, false, '第 51 条应被拒绝');
  assert.ok(/最多/.test(over.error), '错误信息要提示上限：' + over.error);
  assert.strictEqual(S.list().length, S.MAX_ITEMS, '存量不应被破坏');
});

// ══════════════════════════════════════════════════════════
// 2) 读取：脏数据必须被挡在页面之外
// ══════════════════════════════════════════════════════════

test('saved-query：存储里是坏 JSON / 非数组 → list() 返回空，不抛', () => {
  ['{', 'null', '"字符串"', '{"a":1}', '123'].forEach((raw) => {
    const S = load(fakeStorage({ [KEY]: raw }));
    assert.deepStrictEqual(S.list(), [], `存量 ${raw} 应被当成空列表`);
  });
});

test('saved-query：数组里的脏条目逐条过滤（缺 id / 非法 page / 非对象）', () => {
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

test('saved-query：条目里的 fields 脏值在读取时也要清洗', () => {
  const S = load(fakeStorage({
    [KEY]: JSON.stringify([{ id: 'q1', page: 'publish', name: 'x', fields: { good: '1', bad: { o: 1 }, empty: '' } }]),
  }));
  assert.deepStrictEqual(S.list()[0].fields, { good: '1' });
});

test('saved-query：name 缺失时补「未命名查询」，不渲染成 undefined', () => {
  const S = load(fakeStorage({ [KEY]: JSON.stringify([{ id: 'q1', page: 'task', fields: {} }]) }));
  assert.strictEqual(S.list()[0].name, '未命名查询');
});

test('saved-query：get(id) 命中 / 未命中', () => {
  const S = load(fakeStorage());
  const r = S.save({ page: 'publish', name: '甲', fields: { a: '1' } });
  assert.strictEqual(S.get(r.item.id).name, '甲');
  assert.strictEqual(S.get('不存在'), null);
  assert.strictEqual(S.get(''), null);
  assert.strictEqual(S.get(null), null);
});

// ══════════════════════════════════════════════════════════
// 3) 改删与存储不可用
// ══════════════════════════════════════════════════════════

test('saved-query：重命名成功 / 空名被拒 / 不存在的 id 报错', () => {
  const S = load(fakeStorage());
  const r = S.save({ page: 'task', name: '原名', fields: {} });
  assert.strictEqual(S.rename(r.item.id, '新名').ok, true);
  assert.strictEqual(S.get(r.item.id).name, '新名');
  assert.strictEqual(S.rename(r.item.id, '  ').ok, false, '空名应被拒');
  assert.strictEqual(S.rename('不存在', 'x').ok, false);
});

test('saved-query：删除存在 / 不存在的条目', () => {
  const S = load(fakeStorage());
  const r = S.save({ page: 'task', name: '甲', fields: {} });
  assert.strictEqual(S.remove(r.item.id).ok, true);
  assert.strictEqual(S.list().length, 0);
  assert.strictEqual(S.remove(r.item.id).ok, false, '重复删除应报错而不是静默成功');
});

test('saved-query：clear 清空', () => {
  const S = load(fakeStorage());
  S.save({ page: 'task', name: '甲', fields: {} });
  assert.strictEqual(S.clear().ok, true);
  assert.deepStrictEqual(S.list(), []);
});

test('saved-query：localStorage 完全不可用时 list() 不崩、save() 给出可读错误', () => {
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
    const r = S.save({ page: 'publish', name: '甲', fields: { a: '1' } });
    assert.strictEqual(r.ok, false);
    assert.ok(/存储|保存失败/.test(r.error), '错误要能看懂：' + r.error);
  } finally {
    if (desc) Object.defineProperty(globalThis, 'localStorage', desc);
    else delete globalThis.localStorage;
  }
});

test('saved-query：getItem 抛异常（隐私模式）→ list() 仍返回空', () => {
  const S = load(fakeStorage({}, { throwOnGet: true }));
  assert.deepStrictEqual(S.list(), []);
});

test('saved-query：写入配额满 → save 返回失败，且已存数据不受影响', () => {
  const st = fakeStorage({}, { throwOnSet: true });
  const S = load(st);
  const r = S.save({ page: 'publish', name: '甲', fields: {} });
  assert.strictEqual(r.ok, false);
  assert.ok(/空间|存储/.test(r.error), '错误要提示空间不足：' + r.error);
});

// ══════════════════════════════════════════════════════════
// 4) labels（人类可读文本）与旧记录升级
// ══════════════════════════════════════════════════════════

test('saved-query：保存时带上 labels，记录标记为 v2', () => {
  const S = load(fakeStorage());
  const r = S.save({
    page: 'publish', name: '甲',
    fields: { f_prodBatch: '2611pc' },
    summary: '变更批次：2611批次',
    labels: { f_prodBatch: '2611批次' },
  });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.item.labels, { f_prodBatch: '2611批次' });
  assert.strictEqual(r.item.v, S.SCHEMA_VERSION, '新记录应带版本号，便于判断是否需要升级');
});

test('saved-query：labels 只收非空字符串，脏值丢弃', () => {
  const S = load(fakeStorage());
  const r = S.save({
    page: 'publish', name: '甲', fields: { a: '1' },
    labels: { good: '2611批次', bad: { o: 1 }, empty: '   ', num: 5, arr: ['x'] },
  });
  assert.deepStrictEqual(r.item.labels, { good: '2611批次' });
});

test('saved-query：旧记录（无 v / 无 labels）读出来是 v1，可被识别为待升级', () => {
  const S = load(fakeStorage({
    [KEY]: JSON.stringify([{ id: 'q1', page: 'publish', name: '旧卡片', fields: { f_prodBatch: '2611pc' }, summary: '变更批次：2611pc' }]),
  }));
  const it = S.get('q1');
  assert.strictEqual(it.v, 1, '缺 v 的记录按旧格式算');
  assert.deepStrictEqual(it.labels, {});
});

test('saved-query：update 只改展示字段（labels / summary / v），不动 id / name / fields / at', () => {
  const S = load(fakeStorage());
  const r = S.save({ page: 'task', name: '原名', fields: { a: '1' }, summary: '旧摘要' });
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

test('saved-query：update 忽略白名单外的字段（不许塞 fields / name 进来）', () => {
  const S = load(fakeStorage());
  const r = S.save({ page: 'task', name: '原名', fields: { a: '1' }, summary: '旧摘要' });
  S.update(r.item.id, { name: '被篡改', fields: { x: '2' }, labels: { a: 'L' } });
  const after = S.get(r.item.id);
  assert.strictEqual(after.name, '原名');
  assert.deepStrictEqual(after.fields, { a: '1' });
  assert.deepStrictEqual(after.labels, { a: 'L' }, '白名单内的仍要生效');
});

test('saved-query：update 不存在的 id → 报错', () => {
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

test('saved-query：owner 只收字符串字段，脏结构不落库', () => {
  const S = load(fakeStorage());
  const r = S.save({ page: 'publish', name: '甲', fields: {}, owner: { ...OWNER_A, extra: { x: 1 }, userId: 4711510 } });
  assert.deepStrictEqual(
    Object.keys(r.item.owner).sort(),
    ['orgId', 'orgName', 'teamId', 'teamName', 'userId', 'userName'],
  );
  assert.strictEqual(r.item.owner.userId, '4711510', '数字工号要转成字符串');
  assert.strictEqual(S.save({ page: 'publish', name: '乙', fields: {}, owner: {} }).item.owner, null);
});

test('saved-query：没显式传 owner 时回落到「当前用户」', () => {
  const win = { localStorage: fakeStorage() };
  win.CurrentUser = { get: () => OWNER_A };
  loadScript('js/ui/saved-query.js', {}, win);
  const r = win.SavedQuery.save({ page: 'task', name: '甲', fields: {} });
  assert.strictEqual(r.item.owner.orgName, '中国银行软件中心（深圳）', '页面忘了传也不能丢归属');
});

test('saved-query：新记录 hits=0 / saves=1；同名覆盖时 saves 累加、hits 保留', () => {
  const S = load(fakeStorage());
  const a = S.save({ page: 'publish', name: '甲', fields: {} });
  assert.strictEqual(a.item.saves, 1);
  assert.strictEqual(a.item.hits, 0);
  S.hit(a.item.id);
  S.hit(a.item.id);
  const b = S.save({ page: 'publish', name: '甲', fields: {} });
  assert.strictEqual(b.item.saves, 2, '重复保存要累加，而不是重置');
  assert.strictEqual(b.item.hits, 2, '打开次数不能被保存重置');
});

test('saved-query：hit 累加打开次数并记最近打开时间', () => {
  const S = load(fakeStorage());
  const r = S.save({ page: 'publish', name: '甲', fields: {} });
  assert.strictEqual(S.get(r.item.id).lastAt, 0);
  S.hit(r.item.id);
  const after = S.get(r.item.id);
  assert.strictEqual(after.hits, 1);
  assert.ok(after.lastAt > 0, '要记最近打开时间，作为排序的次判据');
  assert.strictEqual(S.hit('不存在').ok, false);
});

test('saved-query：listByDept 只返回同部门的记录，同命中条件合成一行', () => {
  const S = load(fakeStorage());
  S.save({ page: 'publish', name: '本部门常用', fields: {}, labels: {}, owner: OWNER_A });
  S.save({ page: 'task', name: '本部门少用', fields: {}, owner: OWNER_A });
  S.save({ page: 'publish', name: '别的部门', fields: {}, owner: OWNER_B });
  S.save({ page: 'publish', name: '没有归属', fields: {} });

  const 常用 = S.list().find((x) => x.name === '本部门常用');
  S.hit(常用.id);
  S.hit(常用.id);

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

test('saved-query：同一份条件被两个人保存 → 合成一行，人数=2', () => {
  const S = load(fakeStorage());
  S.save({ page: 'publish', name: '张三取的名', fields: { ...COND_A }, owner: OWNER_A });
  S.save({ page: 'publish', name: '李四取的名', fields: { ...COND_A }, owner: TEAMMATE });
  const list = S.listByDept(OWNER_A, 10);
  assert.strictEqual(list.length, 1, '同一份条件不能因为两个人各存一份就刷两行');
  assert.strictEqual(list[0].savers, 2, '两个不同的人保存 → 2 人');
  assert.deepStrictEqual([...list[0].saverNames].sort(), ['张三', '李四'], '要能拿出保存者名单（hover 显示）');
  assert.strictEqual(list[0].recentUser, '李四', '最近一次保存的人要能显示出来');
});

test('saved-query：同一个人反复保存同一份条件 → 只算 1 人（不许刷人数）', () => {
  const S = load(fakeStorage());
  const first = S.save({ page: 'publish', name: '重复保存', fields: { ...COND_A }, owner: OWNER_A });
  // 换名字再存同一份条件：现在是「同名同页才更新」，名字不同会落成两条，
  // 但人头去重以后仍然只能算 1 人。
  S.save({ page: 'publish', name: '重复保存（第二次）', fields: { ...COND_A }, owner: OWNER_A });
  S.hit(first.item.id);
  const list = S.listByDept(OWNER_A, 10);
  assert.strictEqual(list[0].savers, 1, '一个人存三遍也不是三个人');
});

test('saved-query：条件不同就不算同一份，各自独立计数', () => {
  const S = load(fakeStorage());
  S.save({ page: 'publish', name: '条件甲', fields: { callerSystem: 'E00406' }, owner: OWNER_A });
  S.save({ page: 'publish', name: '条件乙', fields: { callerSystem: 'E07701' }, owner: OWNER_A });
  assert.strictEqual(S.listByDept(OWNER_A, 10).length, 2, 'fields 不同 = 不同的查询，不能合并');
  // 同一份条件换个 page 也不该合并（不同的查询页，打开目标不一样）
  S.save({ page: 'task', name: '条件甲', fields: { callerSystem: 'E00406' }, owner: OWNER_A });
  assert.strictEqual(S.listByDept(OWNER_A, 10).length, 3, '不同页面的同名字段仍是两个入口');
});

test('saved-query：没填筛选条件的记录各自独立，不聚成一行', () => {
  const S = load(fakeStorage());
  S.save({ page: 'publish', name: '甲', fields: {}, owner: OWNER_A });
  S.save({ page: 'publish', name: '乙', fields: {}, owner: OWNER_A });
  assert.strictEqual(S.listByDept(OWNER_A, 10).length, 2, '「什么都没填」不是同一份条件，不能归并');
});

test('saved-query：排行先比人数（人数多的排前面，哪怕它打开次数更少）', () => {
  const S = load(fakeStorage());
  // 三人群:只用一次的条件
  const three = [
    { userId: '11', userName: '甲', teamId: 'K4229' },
    { userId: '12', userName: '乙', teamId: 'K4229' },
    { userId: '13', userName: '丙', teamId: 'K4229' },
  ];
  three.forEach((o, i) => S.save({ page: 'publish', name: '三人组' + i, fields: { q: 'popular' }, owner: { ...OWNER_A, ...o } }));
  const solo = S.save({ page: 'publish', name: '我的高频', fields: { q: 'mine' }, owner: OWNER_A });
  for (let i = 0; i < 50; i += 1) S.hit(solo.item.id);   // 打开次数远超，但只有 1 人

  const list = S.listByDept(OWNER_A, 10);
  assert.strictEqual(list[0].savers, 3, '三个人保存的排第一');
  assert.ok(/三人组/.test(list[0].name), `排头位应是人多的那份，实际 ${list[0].name}`);
  assert.strictEqual(list[1].savers, 1);
});

test('saved-query：fingerprintOf 对字段顺序、空值不敏感', () => {
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

test('saved-query：listByDept 的 limit 就是首页的 5 / 10 / 20，非法值退回 10', () => {
  const S = load(fakeStorage());
  for (let i = 0; i < 12; i += 1) {
    S.save({ page: 'publish', name: 'q' + i, fields: {}, owner: OWNER_A });
  }
  assert.strictEqual(S.listByDept(OWNER_A, 5).length, 5);
  assert.strictEqual(S.listByDept(OWNER_A, 10).length, 10);
  assert.strictEqual(S.listByDept(OWNER_A, 20).length, 12, '不足 20 条时给全部');
  assert.strictEqual(S.listByDept(OWNER_A, 0).length, 10, '非法 limit 退回默认 10');
  assert.strictEqual(S.listByDept(OWNER_A, NaN).length, 10);
});

test('saved-query：listByDept 对「没设置用户」返回空，不误报全量', () => {
  const S = load(fakeStorage());
  S.save({ page: 'publish', name: '甲', fields: {}, owner: OWNER_A });
  assert.deepStrictEqual(S.listByDept(null, 10), []);
  assert.deepStrictEqual(S.listByDept({}, 10), []);
  assert.deepStrictEqual(S.listByDept({ orgId: '', orgName: '' }, 10), []);
});

test('saved-query：同一个一级单位、不同团队 → 算不同部门（team 优先）', () => {
  const S = load(fakeStorage());
  S.save({ page: 'publish', name: '三部的查询', fields: {}, owner: OWNER_A });
  S.save({ page: 'publish', name: '一部的查询', fields: {}, owner: OWNER_B });

  const a = S.listByDept(OWNER_A, 10);
  assert.deepStrictEqual(a.map((x) => x.name), ['三部的查询'],
    'orgId 相同但 teamId 不同，不能混成一个部门（否则整个单位算一个部门）');
  const b = S.listByDept(OWNER_B, 10);
  assert.deepStrictEqual(b.map((x) => x.name), ['一部的查询']);
});

test('saved-query：没有 team 信息的人按其一级单位归类（org 兜底）', () => {
  const S = load(fakeStorage());
  S.save({
    page: 'publish', name: '无团队的查询', fields: {},
    owner: { userId: '9', userName: '王五', orgId: '1645A', orgName: '中国银行软件中心（深圳）' },
  });
  const list = S.listByDept({ userName: '赵六', orgId: '1645A', orgName: '中国银行软件中心（深圳）' }, 10);
  assert.strictEqual(list.length, 1, 'team 缺失时按 org 归组');
});

test('saved-query：没有 orgId 时用部门名兜底匹配', () => {
  const S = load(fakeStorage());
  S.save({ page: 'publish', name: '甲', fields: {}, owner: { userName: '张三', orgName: '某部门' } });
  const list = S.listByDept({ userName: '别人', orgId: '', orgName: '某部门' }, 10);
  assert.strictEqual(list.length, 1, '部门名相同也算同部门（orgId 缺失时的兜底）');
});

// ══════════════════════════════════════════════════════════
// 6) 跳转地址（首页卡片直达用的就是这个）
// ══════════════════════════════════════════════════════════

test('saved-query：hrefFor 三个页面各自对应干净路由，且 id 被转义', () => {
  const S = load(fakeStorage());
  assert.strictEqual(S.hrefFor('publish', 'q1'), '/publish?saved=q1');
  assert.strictEqual(S.hrefFor('task', 'q1'), '/task?saved=q1');
  assert.strictEqual(S.hrefFor('subscription', 'q1'), '/subscription?saved=q1');
  assert.strictEqual(S.hrefFor('publish', 'a b&c'), '/publish?saved=a%20b%26c', 'id 必须编码，否则 URL 被截断');
});

test('saved-query：新增的保存排在最前（首页按最近使用展示）', () => {
  const S = load(fakeStorage());
  const a = S.save({ page: 'publish', name: '先存的', fields: {} });
  const b = S.save({ page: 'publish', name: '后存的', fields: {} });
  // 同一毫秒内 Date.now() 可能相同，退而断言「后存的在前」或至少两条都在
  const ids = S.list().map((x) => x.id);
  assert.ok(ids.includes(a.item.id) && ids.includes(b.item.id));
  if (b.item.at > a.item.at) assert.strictEqual(ids[0], b.item.id, '最近保存的应排最前');
});

// ══════════════════════════════════════════════════════════
// 6) 导出 / 导入（跨浏览器、跨电脑的唯一通路）
// ══════════════════════════════════════════════════════════

test('saved-query：导出 → 导入 往返，记录与归属都在', () => {
  const a = load(fakeStorage());
  a.save({ page: 'publish', name: '甲', fields: { f_prodBatch: '2611pc' }, summary: '变更批次：2611批次', owner: OWNER_A, labels: { f_prodBatch: '2611批次' } });
  const text = a.exportJson();
  const parsed = JSON.parse(text);
  assert.strictEqual(parsed.app, 'spider-saved-queries', '要带标识，导入方好判断文件来源');
  assert.strictEqual(parsed.items.length, 1);

  const b = load(fakeStorage());
  const r = b.importJson(text);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.added, 1);
  assert.strictEqual(r.merged, 0);
  const got = b.list()[0];
  assert.strictEqual(got.name, '甲');
  assert.strictEqual(got.owner.userName, '张三', '归属要跟着走，否则导入后不进部门排行');
  assert.deepStrictEqual(got.labels, { f_prodBatch: '2611批次' });
});

test('saved-query：同 id / 同页面同名 视为同一条合并，不重复堆积', () => {
  const S = load(fakeStorage());
  const mine = S.save({ page: 'publish', name: '共同查询', fields: { a: '1' }, owner: OWNER_A });
  S.hit(mine.item.id);
  S.hit(mine.item.id);   // 本机打开 2 次

  const other = {
    app: 'spider-saved-queries', v: 2,
    items: [{
      id: '别人的id', page: 'publish', name: '共同查询',
      fields: { a: '1' }, owner: OWNER_B, hits: 5, saves: 3, lastAt: Date.now(),
    }],
  };
  const r = S.importJson(JSON.stringify(other));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.added, 0, '同页面同名要合并，不能再加一条');
  assert.strictEqual(r.merged, 1);
  assert.strictEqual(S.list().length, 1);
  assert.strictEqual(S.list()[0].hits, 5, '打开次数取较大值（本机 2 次 vs 对方 5 次）');
  assert.strictEqual(S.list()[0].owner.userName, '张三', '本地已有归属时不覆盖');
});

test('saved-query：重复导入同一文件幂等 —— 不会把「高频」刷上去', () => {
  const S = load(fakeStorage());
  const payload = JSON.stringify({
    app: 'spider-saved-queries', v: 2,
    items: [{ id: 'q1', page: 'task', name: '甲', fields: {}, hits: 3, saves: 2, owner: OWNER_A }],
  });
  S.importJson(payload);
  S.importJson(payload);
  S.importJson(payload);
  assert.strictEqual(S.list().length, 1);
  assert.strictEqual(S.list()[0].hits, 3, '反复导入不该累加，否则排行会被刷');
});

test('saved-query：本地没归属时，导入能把 owner 补上', () => {
  const S = load(fakeStorage());
  S.save({ page: 'task', name: '甲', fields: {} });   // 没设当前用户 → owner 为 null
  assert.strictEqual(S.list()[0].owner, null);
  S.importJson(JSON.stringify({
    app: 'spider-saved-queries', v: 2,
    items: [{ id: 'q9', page: 'task', name: '甲', fields: {}, owner: OWNER_A }],
  }));
  assert.strictEqual(S.list()[0].owner.userName, '张三');
});

test('saved-query：导入脏文件一律报错，不破坏现有数据', () => {
  const S = load(fakeStorage());
  S.save({ page: 'task', name: '原有', fields: {} });
  const bad = [
    ['坏 JSON', '{不是 json'],
    ['不是本工具的结构', '{"hello":"world"}'],
    ['items 全是不合法项', '{"items":[{"id":""},{"page":"不存在"}]}'],
    ['空文本', ''],
  ];
  bad.forEach(([label, text]) => {
    const r = S.importJson(text);
    assert.strictEqual(r.ok, false, `${label} 应报错`);
    assert.ok(r.error, `${label} 要给出原因`);
  });
  assert.strictEqual(S.list().length, 1, '失败的导入不能动到已有记录');
});

test('saved-query：合并后超过上限 → 拒绝并保留原数据', () => {
  const S = load(fakeStorage());
  const items = [];
  for (let i = 0; i < S.MAX_ITEMS + 5; i += 1) {
    items.push({ id: 'x' + i, page: 'task', name: 'q' + i, fields: {} });
  }
  const r = S.importJson(JSON.stringify({ app: 'spider-saved-queries', items }));
  assert.strictEqual(r.ok, false);
  assert.ok(/上限/.test(r.error), '要说清为什么拒绝：' + r.error);
  assert.strictEqual(S.list().length, 0, '拒绝时不能只写一半');
});

// ══════════════════════════════════════════════════════════
// 7) 与代理端点的同步（团队共享，与批次时间同一套路）
// ══════════════════════════════════════════════════════════

/** 带同步能力的加载：注入 location + fetch 桩（模块从 window 上取，可替换） */
function loadSync(storage, fetchStub) {
  const win = { localStorage: storage, location: { href: 'http://localhost:3000/' }, fetch: fetchStub };
  loadScript('js/ui/saved-query.js', {}, win);
  return win.SavedQuery;
}

const okJson = (data) => async () => ({ ok: true, status: 200, json: async () => ({ code: 200, data }) });

test('sync：没有端点能力时安静跳过，不抛也不假装成功', async () => {
  const S = load(fakeStorage());       // 没有 location / fetch
  const a = await S.syncFromServer();
  assert.strictEqual(a.ok, false, '静态部署/离线时应明确说不可用');
  const b = await S.pushToServer();
  assert.strictEqual(b.ok, false);
});

test('sync：push 会把本机记录提交上去，并用服务端返回的全集覆盖本地', async () => {
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
  S.save({ page: 'publish', name: '我的查询', fields: {} });

  const r = await S.pushToServer();
  assert.strictEqual(r.ok, true);
  assert.ok(posted.items.some((it) => it.name === '我的查询'), '本机记录要提交上去');
  assert.strictEqual(S.list().length, 2, '服务端返回的全集要覆盖本地（含同事那条）');
  assert.ok(S.list().some((it) => it.name === '同事的查询'));
});

test('sync：删除意图会带给服务端（否则合并时会把删掉的记录复活）', async () => {
  const st = fakeStorage();
  let posted = null;
  const S = loadSync(st, async (url, opts) => {
    posted = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ code: 200, data: { items: [] } }) };
  });
  const keep = S.save({ page: 'publish', name: '保留', fields: {} });
  const del = S.save({ page: 'publish', name: '要删的', fields: {} });
  S.remove(del.item.id);

  await S.pushToServer();
  assert.deepStrictEqual(posted.deletedIds, [del.item.id], '删掉的 id 必须带上');
  assert.ok(posted.items.some((it) => it.name === '保留'));

  // 服务端已确认 → 待办清空，下次不再重复提交
  await S.pushToServer();
  assert.deepStrictEqual(posted.deletedIds, [], '确认过的删除意图不该重复提交');
  assert.ok(keep.ok);
});

test('sync：syncFromServer 把服务端的记录合并进本地（幂等，计数取 max）', async () => {
  const st = fakeStorage();
  const S = loadSync(st, okJson({ items: [
    { id: 'p1', page: 'publish', name: '同事的', fields: {}, hits: 9, saves: 2,
      owner: { userId: '1001', userName: '李四', teamId: 'M2534', teamName: '开发一部' } },
  ] }));
  const r1 = await S.syncFromServer();
  assert.deepStrictEqual({ ok: r1.ok, added: r1.added }, { ok: true, added: 1 });

  const r2 = await S.syncFromServer();   // 再拉一次不该变成两条
  assert.strictEqual(r2.added, 0);
  assert.strictEqual(r2.merged, 1);
  assert.strictEqual(S.list().length, 1);
  assert.strictEqual(S.list()[0].hits, 9, '计数取 max');
});

test('sync：端点报错 / 返回坏数据时只影响同步，不动本地数据', async () => {
  const st = fakeStorage();
  const S = loadSync(st, async () => { throw new Error('Failed to fetch'); });
  S.save({ page: 'publish', name: '本机数据', fields: {} });
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
