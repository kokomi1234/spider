/**
 * publish-model.js 单测：覆盖从 index.js 抽出的纯业务逻辑。
 * 通过 tests/harness.js 的 loadScript 注入 window 后读取 window.PublishModel。
 *
 * 注意：本文件只验证纯函数本身，不涉及任何 DOM / 行为变更。
 */
'use strict';

const { loadScript, test } = require('./harness');
const assert = require('assert');

const win = loadScript('js/page/publish-model.js');
const PM = win.PublishModel;

test('PublishModel：暴露预期接口', () => {
  const funcs = [
    'rowKey', 'deptsToOptions', 'resolveBatchLabel',
    'resolveDeptCondition', 'applyLocalFilters', 'stateBadgeInfo', 'countByStatus',
    'subscribeStats', 'flattenPages', 'dedupeByKey', 'pageCount', 'pageNumbers',
    'emptyHint', 'droppedFilterHint', 'normalizeRow', 'isCheckedVal', 'absIndex',
  ];
  funcs.forEach((k) => assert.strictEqual(typeof PM[k], 'function', '缺少函数 ' + k));
  // FIELDS / API_BODY_DEFAULTS 是常量对象
  assert.strictEqual(typeof PM.FIELDS, 'object');
  assert.strictEqual(typeof PM.API_BODY_DEFAULTS, 'object');
  // 冻结，禁止外部改写
  assert.strictEqual(Object.isFrozen(PM), true);
});

test('rowKey：id 优先，回退编码组合，空值返回空串', () => {
  assert.strictEqual(PM.rowKey({ id: 'x' }), 'id:x');
  assert.strictEqual(PM.rowKey({ serverCoding: 'A' }), 'code:A');
  assert.strictEqual(PM.rowKey({ sysServeNo: 'N' }), 'code:N');
  assert.strictEqual(PM.rowKey({ id: '', serverCoding: 'A' }), 'code:A');
  assert.strictEqual(PM.rowKey({}), '');
  assert.strictEqual(PM.rowKey(null), '');
});

test('applyLocalFilters：模糊 / 精确 / 日期 三种匹配', () => {
  const rows = [
    { deptName: '财务部', deptId: 'D1', offerEffectiveTime: '2026-01-15T10:00:00' },
    { deptName: '研发部', deptId: 'D10', offerEffectiveTime: '2026-02-01T00:00:00' },
    { deptName: '', deptId: 'D2', offerEffectiveTime: '' },
  ];
  // 模糊：包含即可
  assert.deepStrictEqual(
    PM.applyLocalFilters(rows, [{ keys: ['deptName'], value: '财务', exact: false }]).map(r => r.deptId),
    ['D1'],
  );
  // 精确：deptId 必须全等（'D1' 不能命中 'D10'）
  assert.deepStrictEqual(
    PM.applyLocalFilters(rows, [{ keys: ['deptId'], value: 'D1', exact: true }]).map(r => r.deptId),
    ['D1'],
  );
  // 日期：按 YYYY-MM-DD 比对
  assert.deepStrictEqual(
    PM.applyLocalFilters(rows, [{ keys: ['offerEffectiveTime'], value: '2026-01-15', date: true }]).map(r => r.deptId),
    ['D1'],
  );
  // 空条件：原样返回
  assert.strictEqual(PM.applyLocalFilters(rows, []).length, 3);
});

test('flattenPages：按给定页码顺序拼接，跳过缺失页', () => {
  const byPage = new Map([[1, ['a']], [2, ['b']], [3, ['c']]]);
  assert.deepStrictEqual(PM.flattenPages([1, 2, 3], byPage), ['a', 'b', 'c']);
  assert.deepStrictEqual(PM.flattenPages([1, 3], byPage), ['a', 'c']);
  assert.deepStrictEqual(PM.flattenPages([], byPage), []);
});

test('dedupeByKey：按主键去重，默认用 rowKey', () => {
  const rows = [{ id: 1 }, { id: 1 }, { id: 2 }];
  assert.deepStrictEqual(PM.dedupeByKey(rows, r => r.id).length, 2);
  // 默认 keyFn = rowKey：同编码去重
  assert.deepStrictEqual(PM.dedupeByKey([{ serverCoding: 'A' }, { serverCoding: 'A' }]).length, 1);
});

test('countByStatus：按状态分类并派生 published/pending/failed', () => {
  const rows = [
    { offerServerState: '正式版基线' },
    { offerServerState: '运行中' },
    { offerServerState: '开发基线' },
    { offerServerState: '已下线' },
    { offerServerState: '未知状态' },
  ];
  const c = PM.countByStatus(rows);
  // 原实现是 counts['正式版基线'] || counts['运行中'] || 0（或链，非求和），这里原样保留
  assert.strictEqual(c.published, 1);   // 正式版基线命中
  assert.strictEqual(c.pending, 1);    // 开发基线
  assert.strictEqual(c.failed, 1);     // 已下线
  assert.strictEqual(c.counts['未知状态'], 1);
  // 缺失 status 归到「未设置」
  assert.strictEqual(PM.countByStatus([{}]).counts['未设置'], 1);
});

test('subscribeStats：已订阅计数 + 百分比', () => {
  const rows = [{ serverCoding: 'A' }, { serverCoding: 'B' }, { serverCoding: 'C' }];
  const isSub = (code) => code === 'A' || code === 'B';
  const s = PM.subscribeStats(rows, isSub);
  assert.strictEqual(s.subscribed, 2);
  assert.strictEqual(s.unsubscribed, 1);
  assert.strictEqual(s.rate, 67);   // round(2/3*100)
  // 编码回退到 sysServeNo
  const s2 = PM.subscribeStats([{ sysServeNo: 'X' }], (code) => code === 'X');
  assert.strictEqual(s2.subscribed, 1);
  // 空行：rate 为 0 而非 NaN
  assert.strictEqual(PM.subscribeStats([], () => true).rate, 0);
});

test('pageCount / pageNumbers：ceil + 上限封顶', () => {
  assert.strictEqual(PM.pageCount(1000, 200, 20), 5);          // ceil(5)=5
  assert.strictEqual(PM.pageCount(5000, 200, 20), 20);         // 25 封顶 20
  assert.strictEqual(PM.pageCount(0, 200), 0);                 // 无上限，ceil(0)=0
  assert.deepStrictEqual(PM.pageNumbers(3), [1, 2, 3]);
  assert.deepStrictEqual(PM.pageNumbers(3, 2), [2, 3]);
});

test('normalizeRow：字段兜底口径', () => {
  const n = PM.normalizeRow({
    serverCoding: 'S', sysServeNo: 'N', serviceName: '名字',
    interfaceCode: 'I', sheetProductBatch: 'B', offerServerState: '运行中',
    deptName: '财务',
  });
  assert.strictEqual(n.serverCoding, 'S');
  assert.strictEqual(n.compNum, 'N');                 // 编码回退
  assert.strictEqual(n.codeAndInterface, 'S / I');    // 主副编码组合
  assert.strictEqual(n.batch, 'B');
  assert.strictEqual(n.serviceStatus, '运行中');
  assert.strictEqual(n.deptName, '财务');
  // interfaceCode 与 serverCoding 相同 → 不重复拼接
  assert.strictEqual(PM.normalizeRow({ serverCoding: 'S', interfaceCode: 'S' }).codeAndInterface, 'S');
  // 全部缺省 → 兜底为「—」
  const empty = PM.normalizeRow({});
  assert.deepStrictEqual(
    [empty.serverCoding, empty.compNum, empty.batch, empty.serviceStatus, empty.deptName],
    ['—', '—', '—', '—', '—'],
  );
  assert.strictEqual(empty.interfaceCode, '');
});

test('resolveBatchLabel：空值放行，命中给 label，未命中 ok:false', () => {
  assert.deepStrictEqual(PM.resolveBatchLabel('', []), { value: '', label: '', ok: true });
  assert.deepStrictEqual(PM.resolveBatchLabel('v', [{ value: 'v', label: 'V批' }]), { value: 'v', label: 'V批', ok: true });
  assert.deepStrictEqual(PM.resolveBatchLabel('v', []), { value: 'v', label: '', ok: false });
});

test('resolveDeptCondition：实例建起走 api，未建走本地模糊', () => {
  // 实例 + 有 id → api
  assert.deepStrictEqual(
    PM.resolveDeptCondition({ deptId: 'D1', hasInstance: true }),
    { api: 'D1', local: null },
  );
  // 实例 + 仅手输未选 → 退回本地模糊
  assert.deepStrictEqual(
    PM.resolveDeptCondition({ deptId: '', freeText: '财务', hasInstance: true }),
    { api: null, local: { keys: ['deptName'], value: '财务', exact: false } },
  );
  // 实例 + 啥都没有 → null
  assert.strictEqual(PM.resolveDeptCondition({ deptId: '', freeText: '', hasInstance: true }), null);
  // 未建实例，手输中文名 → 本地模糊
  assert.deepStrictEqual(
    PM.resolveDeptCondition({ deptId: '财务', hasInstance: false }),
    { api: null, local: { keys: ['deptName'], value: '财务', exact: false } },
  );
});

test('emptyHint：回放 / 过滤 / 无数据 三态文案决策', () => {
  assert.strictEqual(
    PM.emptyHint({ replayLoose: true, dropped: 1, droppedDup: 0 }).includes('旧录制数据'),
    true,
  );
  assert.strictEqual(
    PM.emptyHint({ replayLoose: false, dropped: 1, droppedDup: 0 }).includes('不满足筛选条件'),
    true,
  );
  assert.strictEqual(
    PM.emptyHint({ replayLoose: false, dropped: 0, droppedDup: 0 }).includes('未找到匹配的数据'),
    true,
  );
});

test('emptyHint 与 droppedFilterHint 文案稳定（行为锚点）', () => {
  // 这些字符串是被抽走前的原值，改动会破坏前端提示，这里钉死。
  assert.strictEqual(
    PM.emptyHint({ replayLoose: true, dropped: 1, droppedDup: 0 }),
    '本地代理回放的是旧录制数据，与当前查询条件不符，已被前端过滤。请连内网用当前条件重新请求一次以重新录制',
  );
  assert.strictEqual(
    PM.emptyHint({ replayLoose: false, dropped: 1, droppedDup: 0 }),
    '本页数据均不满足筛选条件（部分条件后端未支持，已由前端过滤）',
  );
  assert.strictEqual(
    PM.droppedFilterHint(
      [{ label: '变更批次' }, { label: '部门名称' }],
      3,
    ),
    'ℹ️ 本页过滤掉 3 条不满足「变更批次、部门名称」的数据（后端未支持该字段）',
  );
});

test('stateBadgeInfo：状态→{cls,text}，空值兜底未设置', () => {
  assert.deepStrictEqual(PM.stateBadgeInfo(''), { cls: 'b-off', text: '未设置' });
  assert.deepStrictEqual(PM.stateBadgeInfo(null), { cls: 'b-off', text: '未设置' });
  assert.deepStrictEqual(PM.stateBadgeInfo('正式版基线'), { cls: 'b-run', text: '正式版基线' });
  assert.deepStrictEqual(PM.stateBadgeInfo('未知状态'), { cls: 'b-off', text: '未知状态' });
});

test('isCheckedVal / absIndex：归一与绝对下标', () => {
  assert.strictEqual(PM.isCheckedVal({ isChecked: '1' }), true);
  assert.strictEqual(PM.isCheckedVal({ isChecked: 1 }), true);
  assert.strictEqual(PM.isCheckedVal({ isChecked: '0' }), false);
  assert.strictEqual(PM.isCheckedVal({}), false);
  // 第 2 页、页长 20、页内第 0 行 → 绝对下标 20
  assert.strictEqual(PM.absIndex(2, 20, 0), 20);
  assert.strictEqual(PM.absIndex(1, 20, 3), 3);
});
