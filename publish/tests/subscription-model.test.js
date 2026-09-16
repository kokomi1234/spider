/**
 * subscription-model.js 单测：覆盖从 subscription.js 抽出的纯业务逻辑。
 * 通过 tests/harness.js 的 loadScript 注入 window 后读取 window.SubscriptionModel。
 *
 * 注意：本文件只验证纯函数本身（无 DOM、无行为变更），依赖模块（Priority / Fmt /
 * batchWindowLabels）按需注入到同一个 window，与浏览器里的脚本加载顺序一致。
 */
'use strict';

const { loadScript, test } = require('./harness');
const assert = require('assert');

/** 每个用例一个干净 window：模块常量与注入的依赖互不串味 */
function fresh() { return loadScript('js/page/subscription-model.js'); }

/** 带窗口依赖的 window：先 Fmt（转义/业务时区），再 Priority（优先级计算） */
function freshWithPriority() {
  const win = loadScript('js/core/format.js');
  loadScript('js/ui/priority.js', {}, win);
  return loadScript('js/page/subscription-model.js', {}, win);
}

/** 造 n 行假数据，行键可辨（page/i） */
function fakeRows(n, prefix) {
  return Array.from({ length: n }, (_, i) => ({ publishSubcriptionId: `${prefix}-${i}` }));
}

// ═══════════════════════════════════════════════════
// 接口 / 常量
// ═══════════════════════════════════════════════════

test('SubscriptionModel：暴露预期接口且冻结', () => {
  const M = fresh().SubscriptionModel;
  [
    'rowKey', 'toBatchOptions', 'buildCond', 'isEhrSplit', 'validateQuery', 'hasSpecificFilter',
    'buildPageNumbers', 'planPageFetches', 'slicePage', 'overdueCount', 'mergeBatchRows',
    'todayBase', 'decorateRow', 'decorateRows', 'redecorateRows', 'sortRows', 'batchWindow',
    'fetchAllPages', 'fetchBatchAllPages', 'fetchWindowAll', 'prioParts',
  ].forEach((k) => assert.strictEqual(typeof M[k], 'function', '缺少函数 ' + k));
  ['COLUMNS', 'FIXED_COL_CLASS', 'STATUS_CLASS', 'REVIEW_STATUS_MAP'].forEach((k) =>
    assert.strictEqual(typeof M[k], 'object', '缺少常量 ' + k));
  assert.strictEqual(Object.isFrozen(M), true);   // 冻结，禁止外部改写
});

test('常量：分页 / 上限 / 并发口径与搬出前一致', () => {
  const M = fresh().SubscriptionModel;
  assert.strictEqual(M.DEFAULT_CALLER, '');        // 默认不限定调用方
  assert.strictEqual(M.PAGE_SIZE, 10);
  assert.strictEqual(M.MIN_PAGE_SIZE, 10);
  assert.strictEqual(M.BULK_PAGE_SIZE, 50);
  assert.strictEqual(M.BULK_MAX, 5000);
  assert.strictEqual(M.CLIENT_SORT_MAX, 1000);
  assert.strictEqual(M.WINDOW_CONCURRENCY, 12);
  assert.strictEqual(M.PAGE_CONCURRENCY, 3);
  // 整批拉取的页数上限必须能整除（否则封顶会退化成 99 页）
  assert.strictEqual(M.BULK_MAX % M.BULK_PAGE_SIZE, 0);
});

test('COLUMNS / FIXED_COL_CLASS：列序与左固定列', () => {
  const M = fresh().SubscriptionModel;
  assert.strictEqual(M.COLUMNS.length, 22);
  // 前三列是左固定列，顺序不能动（HTML colgroup / thead 与 renderEmpty 的 colspan 都按这个）
  assert.deepStrictEqual(M.COLUMNS.slice(0, 3).map((c) => c[0]),
    ['_prioText', 'status', 'prodReviewStatus']);
  // 每列都是 [key, 中文名, 等宽] 三元组
  M.COLUMNS.forEach((c) => {
    assert.strictEqual(Array.isArray(c), true);
    assert.strictEqual(c.length, 3);
    assert.strictEqual(typeof c[0], 'string');
    assert.strictEqual(typeof c[1], 'string');
    assert.strictEqual(typeof c[2], 'boolean');
  });
  // 接口编码按等宽渲染（编码对不齐会看错行）
  const coding = M.COLUMNS.find((c) => c[0] === 'serverCoding');
  assert.strictEqual(coding[2], true);
  // 固定列表里的 key 必须都在 COLUMNS 里，否则渲染时永远不会命中
  const keys = M.COLUMNS.map((c) => c[0]);
  Object.keys(M.FIXED_COL_CLASS).forEach((k) => assert.ok(keys.includes(k), '固定列不在 COLUMNS：' + k));
  assert.deepStrictEqual(M.FIXED_COL_CLASS, {
    _prioText: 'col-prio', status: 'col-st', prodReviewStatus: 'col-review',
  });
});

test('STATUS_CLASS / REVIEW_STATUS_MAP：值→样式映射', () => {
  const M = fresh().SubscriptionModel;
  assert.deepStrictEqual(M.STATUS_CLASS, {
    '开发基线': 'is-dev',
    '功能测试基线': 'is-test',
    '正式版基线': 'is-official',
    '下线': 'is-offline',
  });
  assert.deepStrictEqual(M.REVIEW_STATUS_MAP, {
    '00': { text: '未审核', cls: '' },
    '01': { text: '审核中', cls: 'is-soon' },
    '02': { text: '审核中', cls: 'is-soon' },
    '03': { text: '审核完成', cls: 'is-official' },
    '04': { text: '关闭', cls: 'is-offline' },
  });
});

// ═══════════════════════════════════════════════════
// 行键 / 选项
// ═══════════════════════════════════════════════════

test('rowKey：订阅关系ID 优先，退化为编号拼接', () => {
  const M = fresh().SubscriptionModel;
  assert.strictEqual(M.rowKey({ publishSubcriptionId: 'ID-1' }), 'ID-1');
  // id 优先：其它编号都在也不拼
  assert.strictEqual(
    M.rowKey({ publishSubcriptionId: 'ID-1', sysServeNo: 'A', prodSysServeNo: 'B', publishId: 'C' }),
    'ID-1',
  );
  // 无 id：按 提供方服务编号|调用方服务编号|publishId 拼接，缺失项被 filter 掉
  assert.strictEqual(M.rowKey({ sysServeNo: 'A', prodSysServeNo: 'B', publishId: 'C' }), 'A|B|C');
  assert.strictEqual(M.rowKey({ sysServeNo: 'A', publishId: 'C' }), 'A|C');
  assert.strictEqual(M.rowKey({ publishId: 'C' }), 'C');
  // 全缺 / 空串 / null → 空串（filter(Boolean) 会把空串也滤掉）
  assert.strictEqual(M.rowKey({}), '');
  assert.strictEqual(M.rowKey({ publishSubcriptionId: '', sysServeNo: '', publishId: '' }), '');
  assert.strictEqual(M.rowKey({ publishSubcriptionId: null, sysServeNo: null }), '');
});

test('toBatchOptions：label 同时当 value；空输入不给 null', () => {
  const M = fresh().SubscriptionModel;
  assert.deepStrictEqual(
    M.toBatchOptions([{ label: '2609批次' }, { label: '2610批次', total: 3 }]),
    [{ value: '2609批次', label: '2609批次' }, { value: '2610批次', label: '2610批次' }],
  );
  assert.deepStrictEqual(M.toBatchOptions([]), []);
  assert.deepStrictEqual(M.toBatchOptions(null), []);
  assert.deepStrictEqual(M.toBatchOptions(undefined), []);
  // 不改入参
  const src = [{ label: 'X' }];
  M.toBatchOptions(src);
  assert.deepStrictEqual(src, [{ label: 'X' }]);
});

// ═══════════════════════════════════════════════════
// 筛选条件
// ═══════════════════════════════════════════════════

test('buildCond：DOM 取值器 → 请求体字段（EHR 走 subscriberId）', () => {
  const M = fresh().SubscriptionModel;
  const seen = {};
  const g = {
    selValue: (id) => {
      seen[id] = true;
      return {
        f_providerCompNum: 'E00406', f_providerBatch: '2609批次', f_isSendOutside: '1',
        f_callerBatch: '2610批次', f_status: '正式版基线', f_deptId: 'D1', f_prodDeptId: 'D2',
      }[id] ?? '';
    },
    textValue: (sel) => ({
      '#f_subscriberName': '12345', '#f_providerServiceNameAndId': '核心服务',
    }[sel] ?? ''),
    effectiveCaller: () => 'E00301',
    getMulti: (k) => ({ sysServeNo: ['N1'], serverCoding: ['C1', 'C2'], prodSysServeNo: ['X1'] }[k] || []),
  };
  assert.deepStrictEqual(M.buildCond(g), {
    compNum: 'E00406',
    putBatch: '2609批次',
    isSendOutsideSystem: '1',
    sysServeNoList: ['N1'],
    serverCodingList: ['C1', 'C2'],
    providerServiceNameAndId: '核心服务',
    prodSysServeNoList: ['X1'],
    useNum: 'E00301',
    callerComponent: 'E00301',
    prodBatch: '2610批次',
    subscriberId: '12345',      // 纯数字 = EHR 号
    subscriberName: '',
    status: '正式版基线',
    deptId: 'D1',
    prodDeptId: 'D2',
    prodSysServeNo: '',         // 抓包里恒空
    batch: '',
  });
});

test('buildCond：缺 getMulti / 姓名为中文 / 全空值器的兜底', () => {
  const M = fresh().SubscriptionModel;
  const empty = { selValue: () => '', textValue: () => '', effectiveCaller: () => '' };
  const c = M.buildCond(empty);
  // 没有 getMulti（旧调用点）→ 三个多选字段退化为空数组，而不是 undefined
  assert.deepStrictEqual(c.sysServeNoList, []);
  assert.deepStrictEqual(c.serverCodingList, []);
  assert.deepStrictEqual(c.prodSysServeNoList, []);
  assert.strictEqual(c.subscriberId, '');
  assert.strictEqual(c.subscriberName, '');
  assert.strictEqual(c.useNum, '');

  // 中文姓名 → subscriberName，subscriberId 留空
  const g = { selValue: () => '', textValue: () => '张三', effectiveCaller: () => '', getMulti: () => [] };
  const c2 = M.buildCond(g);
  assert.strictEqual(c2.subscriberName, '张三');
  assert.strictEqual(c2.subscriberId, '');
});

test('isEhrSplit：纯数字才算 EHR 号', () => {
  const M = fresh().SubscriptionModel;
  assert.strictEqual(M.isEhrSplit('12345'), true);
  assert.strictEqual(M.isEhrSplit('007'), true);
  assert.strictEqual(M.isEhrSplit(0), true);          // String(0) = '0'
  assert.strictEqual(M.isEhrSplit(12345), true);
  assert.strictEqual(M.isEhrSplit('123a'), false);
  assert.strictEqual(M.isEhrSplit(' 123'), false);    // 前后空白不算纯数字
  assert.strictEqual(M.isEhrSplit('1.5'), false);
  assert.strictEqual(M.isEhrSplit('张三'), false);
  assert.strictEqual(M.isEhrSplit(''), false);
  assert.strictEqual(M.isEhrSplit(null), false);
  assert.strictEqual(M.isEhrSplit(undefined), false);
});

test('validateQuery：两个系统都没选才拦；文案钉死', () => {
  const M = fresh().SubscriptionModel;
  assert.strictEqual(
    M.validateQuery('', ''),
    '⚠️ 请至少选择「调用方系统/分行」或「提供方系统」之一',
  );
  assert.strictEqual(M.validateQuery('', '').indexOf('⚠️'), 0);
  assert.strictEqual(M.validateQuery('E00406', ''), null);
  assert.strictEqual(M.validateQuery('', 'E00406'), null);
  assert.strictEqual(M.validateQuery('E00406', 'E00301'), null);
  // 假值（undefined / null）与空串同解
  assert.strictEqual(M.validateQuery(undefined, null).indexOf('⚠️'), 0);
});

test('hasSpecificFilter：6 类精确条件任一命中即 true', () => {
  const M = fresh().SubscriptionModel;
  const base = {
    prodBatch: '', putBatch: '', sysServeNoList: [], serverCodingList: [],
    providerServiceNameAndId: '', prodSysServeNoList: [],
  };
  assert.strictEqual(M.hasSpecificFilter(base), false);
  assert.strictEqual(M.hasSpecificFilter({ ...base, prodBatch: '2610批次' }), true);
  assert.strictEqual(M.hasSpecificFilter({ ...base, putBatch: '2609批次' }), true);
  assert.strictEqual(M.hasSpecificFilter({ ...base, sysServeNoList: ['N1'] }), true);
  assert.strictEqual(M.hasSpecificFilter({ ...base, serverCodingList: ['C1'] }), true);
  assert.strictEqual(M.hasSpecificFilter({ ...base, providerServiceNameAndId: '核心服务' }), true);
  assert.strictEqual(M.hasSpecificFilter({ ...base, prodSysServeNoList: ['X1'] }), true);
  // 空数组 / 空串不算条件；字段缺失（undefined）不能抛
  assert.strictEqual(M.hasSpecificFilter({}), false);
  assert.strictEqual(
    M.hasSpecificFilter({ prodBatch: '', sysServeNoList: [], serverCodingList: [], prodSysServeNoList: [] }),
    false,
  );
});

// ═══════════════════════════════════════════════════
// 分页数学
// ═══════════════════════════════════════════════════

test('buildPageNumbers：首页 + 当前页 ±2 + 末页，中间省略号', () => {
  const M = fresh().SubscriptionModel;
  const btnCount = (h) => h.split('<button').length - 1;
  const dots = (h) => h.split('page-ellipsis').length - 1;

  // 只有一页：单个按钮，无省略号
  const one = M.buildPageNumbers(1, 1);
  assert.strictEqual(btnCount(one), 1);
  assert.strictEqual(dots(one), 0);
  assert.ok(one.indexOf('data-page="1" class="is-current">1') > -1);

  // 页数少：全列
  assert.strictEqual(btnCount(M.buildPageNumbers(3, 2)), 3);
  assert.strictEqual(dots(M.buildPageNumbers(3, 2)), 0);

  // 首页：1~3 + 末页 10，中间一个省略号
  const first = M.buildPageNumbers(10, 1);
  assert.strictEqual(btnCount(first), 4);
  assert.strictEqual(dots(first), 1);
  assert.ok(first.indexOf('data-page="10"') > -1);

  // 中间页 5：1 / …… / 3~7 / …… / 10
  const mid = M.buildPageNumbers(10, 5);
  assert.strictEqual(btnCount(mid), 7);
  assert.strictEqual(dots(mid), 2);
  assert.ok(mid.indexOf('data-page="5" class="is-current">5') > -1);
  // 当前页以外的按钮不带 is-current
  assert.strictEqual(mid.split('is-current').length - 1, 1);

  // 末页：倒数三页 + 首页
  assert.strictEqual(btnCount(M.buildPageNumbers(10, 10)), 4);

  // 乱序/越界入参不炸且不产生越界按钮
  const weird = M.buildPageNumbers(10, 99);
  assert.strictEqual(weird.indexOf('data-page="99"'), -1);
  assert.strictEqual(weird.indexOf('data-page="0"'), -1);
  assert.strictEqual(M.buildPageNumbers(1, 1).indexOf('data-page="0"'), -1);
});

test('planPageFetches：按 BULK_PAGE_SIZE 算页数并对 BULK_MAX 封顶', () => {
  const M = fresh().SubscriptionModel;
  assert.strictEqual(M.planPageFetches(0), 0);
  assert.strictEqual(M.planPageFetches(-5), 0);
  assert.strictEqual(M.planPageFetches(null), 0);
  assert.strictEqual(M.planPageFetches(undefined), 0);
  assert.strictEqual(M.planPageFetches(1), 1);
  assert.strictEqual(M.planPageFetches(50), 1);
  assert.strictEqual(M.planPageFetches(51), 2);
  assert.strictEqual(M.planPageFetches(100), 2);
  assert.strictEqual(M.planPageFetches(5000), 100);
  // 超过上限一律截断到 100 页（5000/50），不再继续加请求
  assert.strictEqual(M.planPageFetches(5001), 100);
  assert.strictEqual(M.planPageFetches(1000000), 100);
});

test('slicePage：按页切分，不动入参，越界为空数组', () => {
  const M = fresh().SubscriptionModel;
  const all = [1, 2, 3, 4, 5];
  assert.deepStrictEqual(M.slicePage(all, 1, 2), [1, 2]);
  assert.deepStrictEqual(M.slicePage(all, 2, 2), [3, 4]);
  assert.deepStrictEqual(M.slicePage(all, 3, 2), [5]);
  assert.deepStrictEqual(M.slicePage(all, 4, 2), []);
  assert.deepStrictEqual(M.slicePage(all, 1, 0), []);
  assert.deepStrictEqual(M.slicePage(null, 1, 10), []);
  assert.deepStrictEqual(M.slicePage(all, 1, 10), [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(all, [1, 2, 3, 4, 5]);   // 原数组不变
});

test('overdueCount：只数 _prio.overdue 为真的行', () => {
  const M = fresh().SubscriptionModel;
  assert.strictEqual(M.overdueCount([
    { _prio: { overdue: true } },
    { _prio: { overdue: false } },
    { _prio: { overdue: true } },
    {},                       // 没 decorate 过
    { _prio: null },
  ]), 2);
  assert.strictEqual(M.overdueCount([]), 0);
  assert.strictEqual(M.overdueCount(null), 0);
  assert.strictEqual(M.overdueCount([{}, {}]), 0);
});

test('mergeBatchRows：按窗口顺序遍历 + 去重，与完成顺序无关', () => {
  const M = fresh().SubscriptionModel;
  const a1 = { publishSubcriptionId: 'a1' };
  const a2 = { publishSubcriptionId: 'a2' };
  const b1 = { publishSubcriptionId: 'b1' };
  const bDup = { publishSubcriptionId: 'a1' };   // 与 a1 同键

  // Map 形态（窗口扇出的实际形态）
  const map = new Map([['2609批次', [a1, a2]], ['2610批次', [bDup, b1]]]);
  assert.deepStrictEqual(M.mergeBatchRows(map, ['2609批次', '2610批次']).map((r) => r.publishSubcriptionId),
    ['a1', 'a2', 'b1']);
  // 批次顺序决定行序，不按 Map 插入顺序
  assert.deepStrictEqual(M.mergeBatchRows(map, ['2610批次', '2609批次']).map((r) => r.publishSubcriptionId),
    ['a1', 'b1', 'a2']);
  // 对象形态也接受
  assert.deepStrictEqual(M.mergeBatchRows({ '2609批次': [a1] }, ['2609批次']), [a1]);
  // 缺批次 / 空数组 / 空批次列表 → 空结果，不抛
  assert.deepStrictEqual(M.mergeBatchRows(new Map(), ['2609批次']), []);
  assert.deepStrictEqual(M.mergeBatchRows(map, []), []);
  assert.deepStrictEqual(M.mergeBatchRows(map, null), []);
  assert.deepStrictEqual(M.mergeBatchRows(null, ['2609批次']), []);
});

// ═══════════════════════════════════════════════════
// 优先级 / 排序
// ═══════════════════════════════════════════════════

test('todayBase：优先 Fmt.businessToday，缺失时退化为当天', () => {
  // 有 Fmt：直接用它的业务时区基准
  const win = loadScript('js/core/format.js');
  const fixed = new Date(2026, 0, 2);
  win.Fmt.businessToday = () => fixed;
  loadScript('js/page/subscription-model.js', {}, win);
  assert.strictEqual(win.SubscriptionModel.todayBase().getTime(), fixed.getTime());

  // 没 Fmt：仍返回 Date（不抛）
  const M2 = fresh().SubscriptionModel;
  assert.ok(M2.todayBase() instanceof Date);
  assert.strictEqual(isNaN(M2.todayBase().getTime()), false);
});

test('decorateRow / decorateRows：有 Priority 走它，没有则退化占位', () => {
  // 无 Priority：占位字段齐全且不影响展示
  const M = fresh().SubscriptionModel;
  const row = M.decorateRow({ prodBatch: '2609批次', status: '开发基线' });
  assert.deepStrictEqual(row._prio, {
    level: 'unknown', days: null, text: '—', next: '', deadline: '', sortKey: 9e6, overdue: false,
  });
  assert.strictEqual(row._prioText, '—');
  assert.strictEqual(row._prioNext, '');
  assert.strictEqual(row._prioDeadline, '');
  // 同一个对象被就地写入（返回值即入参）
  assert.strictEqual(M.decorateRow(row), row);

  // 有 Priority：写回真实的优先级
  const MP = freshWithPriority().SubscriptionModel;
  const done = MP.decorateRow({ prodBatch: '2609批次', status: '正式版基线' });
  assert.strictEqual(done._prio.level, 'done');
  assert.strictEqual(done._prioText, '已完成');
  // 开发基线 2609批次 → 截止日 2026-08-15（批次月 -1 的 15 日），与"今天"无关
  const dev = MP.decorateRow({ prodBatch: '2609批次', status: '开发基线' });
  assert.strictEqual(dev._prio.deadline, '2026-08-15');
  assert.strictEqual(typeof dev._prio.days, 'number');
  assert.strictEqual(dev._prioText.indexOf('天') > -1, true);
});

test('decorateRows / redecorateRows：整批共用同一个"今天"', () => {
  const MP = freshWithPriority().SubscriptionModel;
  const rows = [
    { prodBatch: '2609批次', status: '开发基线' },
    { prodBatch: '2610批次', status: '功能测试基线' },
    { prodBatch: '2609批次', status: '正式版基线' },
  ];
  const out = MP.decorateRows(rows);
  assert.strictEqual(out.length, 3);
  // 返回新数组，但元素是同一批对象（就地 decorate）
  assert.notStrictEqual(out, rows);
  out.forEach((r, i) => assert.strictEqual(r, rows[i]));
  rows.forEach((r) => assert.ok(r._prio && typeof r._prio.level === 'string'));
  // 共用基准：同一批次的同一状态，算出的剩余天数必须完全一致
  assert.strictEqual(rows[0]._prio.days, MP.decorateRow({ prodBatch: '2609批次', status: '开发基线' })._prio.days);

  // 空数组 / null 不炸
  assert.deepStrictEqual(MP.decorateRows([]), []);
  assert.deepStrictEqual(MP.decorateRows(null), []);

  // redecorateRows：原地重算，返回 undefined
  const rows2 = [{ prodBatch: '2609批次', status: '开发基线' }];
  assert.strictEqual(MP.redecorateRows(rows2), undefined);
  assert.strictEqual(rows2[0]._prio.deadline, '2026-08-15');
});

test('sortRows：无排序条件只复制；有 Priority 时按 sortKey 升/降序', () => {
  const M = fresh().SubscriptionModel;
  const rows = [{ _prio: { sortKey: 5 } }, { _prio: { sortKey: 1 } }];
  const copy = M.sortRows(rows, '');
  assert.notStrictEqual(copy, rows);
  assert.deepStrictEqual(copy.map((r) => r._prio.sortKey), [5, 1]);   // 不改顺序
  assert.deepStrictEqual(M.sortRows(null, 'asc'), []);

  const MP = freshWithPriority().SubscriptionModel;
  assert.deepStrictEqual(
    MP.sortRows(rows, 'asc').map((r) => r._prio.sortKey), [1, 5],
  );
  assert.deepStrictEqual(
    MP.sortRows(rows, 'desc').map((r) => r._prio.sortKey), [5, 1],
  );
  // 没 decorate 过的行按 9e6 兜底排最后
  assert.deepStrictEqual(
    MP.sortRows([{}, { _prio: { sortKey: 0 } }], 'asc').map((r) => r._prio ? r._prio.sortKey : 'none'),
    [0, 'none'],
  );
  assert.deepStrictEqual(rows.map((r) => r._prio.sortKey), [5, 1]);   // 入参顺序不变
});

test('batchWindow：委托 batchWindowLabels，模块缺失时返回空窗口', () => {
  // 缺 batchWindowLabels：宁可空窗口也不猜月份
  assert.deepStrictEqual(fresh().SubscriptionModel.batchWindow(), []);

  // 有 batchWindowLabels：原样透传，且拿到的是 Date 基准
  const win = loadScript('js/page/subscription-model.js');
  let gotArg = null;
  win.batchWindowLabels = (now) => { gotArg = now; return ['2609批次', '2610批次']; };
  assert.deepStrictEqual(win.SubscriptionModel.batchWindow(), ['2609批次', '2610批次']);
  assert.ok(gotArg instanceof Date);

  // 与真正的 batchWindowLabels 联动：近 12 个月窗口，长度 12、YYMM批次 格式
  const win2 = loadScript('js/data/batch-data.js');
  loadScript('js/page/subscription-model.js', {}, win2);
  const labels = win2.SubscriptionModel.batchWindow();
  assert.strictEqual(labels.length, 12);
  labels.forEach((l) => assert.strictEqual(/^\d{4}批次$/.test(l), true, '格式异常：' + l));
});

// ═══════════════════════════════════════════════════
// 优先级单元格数据
// ═══════════════════════════════════════════════════

test('prioParts：色块文案 + 临期 days 0..3 判定', () => {
  const MP = freshWithPriority().SubscriptionModel;
  // 有下一里程碑：hint 里写清批次、截止日与目标状态
  const near = MP.prioParts({
    prodBatch: '2609批次',
    _prio: { level: 'critical', days: 2, text: '剩 2 天', next: '正式版基线', deadline: '2026-09-15' },
  });
  assert.deepStrictEqual(near, {
    level: 'critical',
    text: '剩 2 天',
    near: true,
    hint: '2609批次：应于 2026-09-15 前转为正式版基线',
  });

  // 边界：0 和 3 天仍然临期，-1（逾期）和 4 天不临期
  const daysOf = (days) => ({
    prodBatch: 'B', _prio: { level: 'x', days, text: 't', next: '', deadline: '' },
  });
  assert.strictEqual(MP.prioParts(daysOf(0)).near, true);
  assert.strictEqual(MP.prioParts(daysOf(3)).near, true);
  assert.strictEqual(MP.prioParts(daysOf(4)).near, false);
  assert.strictEqual(MP.prioParts(daysOf(-1)).near, false);
  assert.strictEqual(MP.prioParts(daysOf(null)).near, false);

  // 已完成：不再提示转基线；批次缺失时用（无批次）占位
  assert.strictEqual(MP.prioParts({ prodBatch: 'B', _prio: { level: 'done', days: null, text: '已完成', next: '', deadline: '' } }).hint,
    '已到正式版基线 / 已下线');
  assert.strictEqual(MP.prioParts({ _prio: { level: 'x', days: 1, text: 't', next: '正式版基线', deadline: '2026-09-15' } }).hint,
    '（无批次）：应于 2026-09-15 前转为正式版基线');
  // 截止日来自批次时间配置 → hint 里标注来源
  const cfg = MP.prioParts({
    prodBatch: 'B',
    _prio: { level: 'x', days: 1, text: 't', next: '正式版基线', deadline: '2026-09-15', from: 'config' },
  });
  assert.strictEqual(cfg.hint, 'B：应于 2026-09-15 前转为正式版基线（按批次时间配置）');

  // 没有 _prio（未 decorate）→ 退化占位，不抛
  assert.deepStrictEqual(MP.prioParts({}), {
    level: 'unknown', text: '—', near: false, hint: '批次或基线状态无法判断',
  });
});

// ═══════════════════════════════════════════════════
// 整批取数（fetchHistory / isAborted / onProgress 注入）
// ═══════════════════════════════════════════════════

/** 造一个按页码返回的假 fetchHistory，records 形如 { pageNum: {ok,rows,total,error,local} } */
function makePagedFetch(records, calls = []) {
  return async (pagedCond) => {
    calls.push(pagedCond);
    const rec = records[pagedCond.pageNum];
    if (!rec) return { ok: true, rows: [], total: 0 };
    return rec;
  };
}

test('fetchAllPages：按页并发拉全量并按页码顺序拼接', async () => {
  const M = fresh().SubscriptionModel;
  const calls = [];
  const fh = makePagedFetch({
    1: { ok: true, rows: fakeRows(50, 'p1') },
    2: { ok: true, rows: fakeRows(50, 'p2') },
    3: { ok: true, rows: fakeRows(20, 'p3') },
  }, calls);
  const progress = [];
  const out = await M.fetchAllPages({ status: 'x' }, 120, fh, (done, total) => progress.push([done, total]));

  assert.strictEqual(out.rows.length, 120);
  assert.strictEqual(out.truncated, false);
  // 页码顺序：p1 的 50 行在前，p3 的 20 行在后（并发完成顺序不影响行序）
  assert.strictEqual(out.rows[0].publishSubcriptionId, 'p1-0');
  assert.strictEqual(out.rows[49].publishSubcriptionId, 'p1-49');
  assert.strictEqual(out.rows[50].publishSubcriptionId, 'p2-0');
  assert.strictEqual(out.rows[119].publishSubcriptionId, 'p3-19');
  // 请求体带上 pageNum / pageSize，且保留原条件
  calls.forEach((c) => {
    assert.strictEqual(c.pageSize, 50);
    assert.strictEqual(c.status, 'x');
    assert.strictEqual(typeof c.pageNum, 'number');
  });
  assert.deepStrictEqual(calls.map((c) => c.pageNum).sort((a, b) => a - b), [1, 2, 3]);
  // 进度回调：pageCount = 3
  assert.ok(progress.length >= 1);
  progress.forEach(([, total]) => assert.strictEqual(total, 3));
});

test('fetchAllPages：第一页就不 OK → 抛错；空结果 / 单页直接收尾', async () => {
  const M = fresh().SubscriptionModel;
  await assert.rejects(
    () => M.fetchAllPages({}, 100, makePagedFetch({ 1: { ok: false, error: '接口 500' } })),
    /接口 500/,
  );
  // 没有 error 文案时给兜底
  await assert.rejects(() => M.fetchAllPages({}, 100, makePagedFetch({ 1: { ok: false } })), /未知错误/);
  // 后续页失败也要抛
  await assert.rejects(
    () => M.fetchAllPages({}, 120, makePagedFetch({
      1: { ok: true, rows: fakeRows(50, 'p1') },
      2: { ok: false, error: '第二页炸了' },
    })),
    /第二页炸了/,
  );

  // 第一页空 → 直接返回空结果，不再翻页
  const calls = [];
  const empty = await M.fetchAllPages({}, 100, makePagedFetch({ 1: { ok: true, rows: [] } }, calls), undefined);
  assert.deepStrictEqual(empty, { rows: [], truncated: false });
  assert.deepStrictEqual(calls.map((c) => c.pageNum), [1]);

  // total <= 单页条数 → 一页收尾
  const one = await M.fetchAllPages({}, 30, makePagedFetch({ 1: { ok: true, rows: fakeRows(30, 'p1') } }));
  assert.strictEqual(one.rows.length, 30);
  assert.strictEqual(one.truncated, false);
});

test('fetchAllPages：total 超 BULK_MAX → 截断到 5000 并标记 truncated', async () => {
  const M = fresh().SubscriptionModel;
  // 每页 50 行、total 6000 → 只该拉 100 页（= BULK_MAX / BULK_PAGE_SIZE）
  const records = {};
  for (let p = 1; p <= 100; p++) records[p] = { ok: true, rows: fakeRows(50, 'p' + p) };
  const calls = [];
  const out = await M.fetchAllPages({}, 6000, makePagedFetch(records, calls));
  assert.strictEqual(out.truncated, true);
  assert.strictEqual(out.rows.length, 5000);
  assert.deepStrictEqual(calls.map((c) => c.pageNum).sort((a, b) => a - b).slice(-1), [100]);
  assert.strictEqual(calls.map((c) => c.pageNum).includes(101), false);
});

test('fetchBatchAllPages：一页装完 / 多页拼接 / 失败回包', async () => {
  const M = fresh().SubscriptionModel;
  const calls = [];
  // 一页装完（got >= total）
  const one = await M.fetchBatchAllPages({ status: 'x' }, '2609批次',
    makePagedFetch({ 1: { ok: true, rows: fakeRows(20, 'a'), total: 20, local: true } }, calls));
  assert.strictEqual(one.ok, true);
  assert.strictEqual(one.local, true);
  assert.strictEqual(one.rows.length, 20);
  // 单批次条件被写进请求体
  assert.strictEqual(calls[0].prodBatch, '2609批次');
  assert.strictEqual(calls[0].pageSize, 50);
  assert.strictEqual(calls[0].pageNum, 1);
  assert.strictEqual(calls[0].status, 'x');

  // 多页：total 120 → 3 页按序拼接
  const multi = await M.fetchBatchAllPages({}, '2609批次', makePagedFetch({
    1: { ok: true, rows: fakeRows(50, 'm1'), total: 120 },
    2: { ok: true, rows: fakeRows(50, 'm2') },
    3: { ok: true, rows: fakeRows(20, 'm3') },
  }));
  assert.strictEqual(multi.ok, true);
  assert.strictEqual(multi.rows.length, 120);
  assert.strictEqual(multi.rows[0].publishSubcriptionId, 'm1-0');
  assert.strictEqual(multi.rows[119].publishSubcriptionId, 'm3-19');

  // 第一页失败 → 原样回传 error / local
  const bad = await M.fetchBatchAllPages({}, '2609批次',
    makePagedFetch({ 1: { ok: false, error: '批次查询失败', local: true } }));
  assert.deepStrictEqual(bad, { ok: false, error: '批次查询失败', local: true });
  const bad2 = await M.fetchBatchAllPages({}, '2609批次', makePagedFetch({ 1: { ok: false } }));
  assert.strictEqual(bad2.ok, false);

  // 后续页失败 → ok:false，local 归 false（不拿半截数据当成功）
  const later = await M.fetchBatchAllPages({}, '2609批次', makePagedFetch({
    1: { ok: true, rows: fakeRows(50, 'm1'), total: 120, local: true },
    2: { ok: false, error: '第 2 页失败' },
  }));
  assert.deepStrictEqual(later, { ok: false, error: '第 2 页失败', local: false });

  // 第一页就返回空 → 收尾（接口未接入 / 该批次无数据）
  const empty = await M.fetchBatchAllPages({}, '2609批次',
    makePagedFetch({ 1: { ok: true, rows: [], total: 100 } }));
  assert.deepStrictEqual(empty, { ok: true, local: false, rows: [] });
});

test('fetchBatchAllPages：单页条数已达 BULK_MAX → 截断不再翻页', async () => {
  const M = fresh().SubscriptionModel;
  const calls = [];
  const out = await M.fetchBatchAllPages({}, '2609批次',
    makePagedFetch({ 1: { ok: true, rows: fakeRows(6000, 'big'), total: 9000 } }, calls));
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.rows.length, 5000);              // 截到上限
  assert.deepStrictEqual(calls.map((c) => c.pageNum), [1]);   // 不再发第 2 页
});

test('fetchWindowAll：窗口扇出合并、去重、部分失败仍算成功', async () => {
  const win = loadScript('js/page/subscription-model.js');
  const M = win.SubscriptionModel;
  win.batchWindowLabels = () => ['2609批次', '2610批次', '2611批次'];

  const a1 = { publishSubcriptionId: 'a1' };
  const a2 = { publishSubcriptionId: 'a2' };
  const b1 = { publishSubcriptionId: 'b1' };
  const bDup = { publishSubcriptionId: 'a1' };     // 跨批次重复，应被去掉
  const progress = [];
  const fh = async (c) => {
    if (c.prodBatch === '2609批次') return { ok: true, rows: [a1, a2], total: 2 };
    if (c.prodBatch === '2610批次') return { ok: true, rows: [bDup, b1], total: 2, local: true };
    return { ok: false, error: '批次不存在' };
  };
  const out = await M.fetchWindowAll({ status: 'x' }, () => false, (rows, done, total) => {
    progress.push([rows.length, done, total]);
  }, fh);

  assert.strictEqual(out.ok, true);            // 全失败才算失败
  assert.deepStrictEqual(out.partial, ['2611批次']);
  assert.strictEqual(out.local, true);         // 任一命中本地回放即标记
  assert.strictEqual(out.error, '');
  // 行序按窗口顺序且去重：a1 a2（2610 的 a1 重复被丢）b1
  assert.deepStrictEqual(out.rows.map((r) => r.publishSubcriptionId), ['a1', 'a2', 'b1']);
  // 增量回调：3 个批次里 2 个成功，done 递增，最后一个回调已经能看到全部 3 行
  assert.deepStrictEqual(progress.map((p) => p[1]).sort(), [1, 2]);
  progress.forEach((p) => assert.strictEqual(p[2], 3));
  assert.strictEqual(progress[progress.length - 1][0], 3);
});

test('fetchWindowAll：批次多于 WINDOW_CONCURRENCY 时分波，并发不超上限', async () => {
  const win = loadScript('js/page/subscription-model.js');
  const M = win.SubscriptionModel;
  const batches = Array.from({ length: 13 }, (_, i) => `26${String(i + 1).padStart(2, '0')}批次`);
  win.batchWindowLabels = () => batches;

  let inFlight = 0;
  let maxInFlight = 0;
  const done = [];
  const rows = await M.fetchWindowAll({}, () => false, undefined, async (c) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));   // 让同一波的请求真正并存
    inFlight--;
    done.push(c.prodBatch);
    return { ok: true, rows: [{ publishSubcriptionId: c.prodBatch }] };
  });

  assert.strictEqual(rows.ok, true);
  assert.strictEqual(rows.partial.length, 0);
  // 13 个批次全部取到，且行序仍按窗口顺序（第二波回来得晚也不影响）
  assert.deepStrictEqual(rows.rows.map((r) => r.publishSubcriptionId), batches);
  assert.strictEqual(done.length, 13);
  // 并发封顶 12：不可能 13 个请求同时在飞
  assert.strictEqual(maxInFlight, M.WINDOW_CONCURRENCY);
});

test('fetchWindowAll：全部失败 → ok:false + 错误文案；已中止 → aborted', async () => {
  const win = loadScript('js/page/subscription-model.js');
  const M = win.SubscriptionModel;
  win.batchWindowLabels = () => ['2609批次', '2610批次'];
  const allFail = await M.fetchWindowAll({}, () => false, undefined,
    async () => ({ ok: false, error: '炸' }));
  assert.strictEqual(allFail.ok, false);
  assert.deepStrictEqual(allFail.rows, []);
  assert.deepStrictEqual(allFail.partial, ['2609批次', '2610批次']);
  assert.strictEqual(allFail.error, '批次 2609批次、2610批次 查询失败');

  // 已被更新的查询取代：直接返回 aborted，不发任何请求
  let called = 0;
  const aborted = await M.fetchWindowAll({}, () => true, undefined, async () => {
    called++;
    return { ok: true, rows: [] };
  });
  assert.deepStrictEqual(aborted, { aborted: true });
  assert.strictEqual(called, 0);

  // 窗口为空（batchWindowLabels 缺失）→ 一个批次都没发，空结果且不动任何状态
  const win3 = loadScript('js/page/subscription-model.js');
  const none = await win3.SubscriptionModel.fetchWindowAll({}, () => false, undefined,
    async () => ({ ok: true, rows: [] }));
  assert.deepStrictEqual(none.rows, []);
  assert.deepStrictEqual(none.partial, []);
  assert.strictEqual(none.local, false);
  assert.strictEqual(none.error.indexOf('查询失败') > -1, true);
});
