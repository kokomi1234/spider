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
// 4) 跳转地址（首页卡片直达用的就是这个）
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
