/**
 * boundary-core.test.js —— 补写的「边界场景」单元测试。
 *
 * 目标：对照 publish/tests/run.js 已有 happy-path 用例，补齐负面 / 边界链路，
 * 覆盖 publish-model / publish-view / subscription-model / subscription-view /
 * priority / table-utils / format / publish-response 八个模块。
 *
 * 约定（与 harness 一致）：
 *   - 零第三方依赖、纯 node；用 loadScript 把浏览器 IIFE 注入同一个 win。
 *   - document 必须作为 loadScript 的第二个参数传入（形参遮蔽全局）。
 *   - 被测导出多为 Object.freeze，打桩要在 loadScript 之前放进传入的 win。
 *   - 断言真实返回值，不写「只断言函数存在」的用例。
 *
 * 跑本文件：
 *   cd C:/Users/admin/Desktop/spider/publish && C:/Users/admin/.workbuddy/binaries/node/versions/22.22.2-3/node.exe -e "require('./tests/boundary-core.test');require('./harness').runAll()"
 */

'use strict';

const { loadScript, test } = require('./harness');
const assert = require('assert');

// ── 最小 DOM 替身（与 subscription-view.test.js 同款，这里内联）────────
function stubBody(jumps = [], copies = []) {
  return {
    innerHTML: '',
    dataset: {},
    addEventListener() {},
    _jumps: jumps,
    _copies: copies,
    querySelectorAll(sel) {
      if (sel === 'button[data-jump]') return this._jumps;
      if (sel === 'td.copy-cell') return this._copies;
      return [];
    },
  };
}
function stubPaginationEls(btns = []) {
  return {
    bar: { style: {} },
    pageTotal: { textContent: '' },
    pageNumbers: { innerHTML: '', querySelectorAll: (sel) => (sel === 'button[data-page]' ? btns : []) },
    btnPrev: { disabled: false },
    btnNext: { disabled: false },
    pageJumpInput: { max: '', value: '' },
  };
}

// ── 各种干净 window 构建器（每类测试独立，避免冻结对象 / 模块级状态串味）──
function winPublishView() {                 // 带真 Fmt（真 esc）
  const win = loadScript('js/core/format.js');
  loadScript('js/page/publish-model.js', {}, win);
  loadScript('js/page/publish-view.js', {}, win);
  return win;
}
function winPublishViewNoFmt() {             // 不加载 Fmt → 逼出内置兜底 esc
  const win = loadScript('js/page/publish-model.js');
  loadScript('js/page/publish-view.js', {}, win);
  return win;
}
function winSubModel() {                     // 订阅模型，不带 Priority
  return loadScript('js/page/subscription-model.js');
}
function winSubModelPrio() {                 // 订阅模型 + Fmt + Priority
  const win = loadScript('js/core/format.js');
  loadScript('js/ui/priority.js', {}, win);
  loadScript('js/page/subscription-model.js', {}, win);
  return win;
}
function winSubView() {                       // 订阅视图（Fmt + table-utils + model + view）
  const win = loadScript('js/core/format.js');
  loadScript('js/ui/table-utils.js', {}, win);
  loadScript('js/page/subscription-model.js', {}, win);
  loadScript('js/page/subscription-view.js', {}, win);
  return win;
}
function winPriority() {                      // 仅 Priority（evaluate 用显式 now，不需要 Fmt）
  return loadScript('js/ui/priority.js');
}
function winTableUtils() {                    // table-utils + Fmt + 真实 document 替身
  const bodyEl = { innerHTML: '' };
  const barEl = { style: {} };
  const doc = {
    querySelector: (s) => (s === '#resultBody' ? bodyEl : s === '#pagination' ? barEl : null),
  };
  const win = loadScript('js/core/format.js', { document: doc });
  loadScript('js/ui/table-utils.js', { document: doc }, win);
  win.__body = bodyEl;
  win.__bar = barEl;
  return win;
}
function winFmt() { return loadScript('js/core/format.js'); }
function winResponse() { return loadScript('js/core/publish-response.js'); }

/** 造最小 Response 替身（publish-response 用） */
function resp({ ok = true, status = 200, json = {}, headers = {} } = {}) {
  return {
    ok, status,
    json: async () => json,
    headers: { get: (k) => (String(k).toLowerCase() in headers ? headers[String(k).toLowerCase()] : null) },
  };
}

// ═══════════════════════════════════════════════════════════════════════
// publish-model.js
// ═══════════════════════════════════════════════════════════════════════

const PM = winPublishView().PublishModel;

test('✗ applyLocalFilters：rows=null 且无条件时不崩，返回 null', () => {
  assert.doesNotThrow(() => PM.applyLocalFilters(null, []));
  assert.strictEqual(PM.applyLocalFilters(null, []), null);
});

test('✗ applyLocalFilters：rows=[] 带条件返回空数组，不崩', () => {
  assert.deepStrictEqual(PM.applyLocalFilters([], [{ keys: ['x'], value: 'a' }]), []);
  assert.deepStrictEqual(PM.applyLocalFilters(undefined, undefined), undefined); // 无条件原样返回
});

test('✓ applyLocalFilters：rows=null 且带条件时不崩，视为无数据（2026-09-18 已修）', () => {
  assert.deepStrictEqual(PM.applyLocalFilters(null, [{ keys: ['x'], value: 'a' }]), []);
  // 混入 null 行也不能崩：脏行直接判为不满足条件
  assert.deepStrictEqual(PM.applyLocalFilters([null, { x: 'a' }], [{ keys: ['x'], value: 'a' }]), [{ x: 'a' }]);
});

test('✗ pageCount：0 / NaN / undefined 入参返回非负且非 NaN', () => {
  assert.strictEqual(PM.pageCount(0, 0), 0);
  assert.strictEqual(PM.pageCount(NaN, 10), 0);
  assert.strictEqual(PM.pageCount(undefined, undefined), 0);
  assert.strictEqual(PM.pageCount(100, NaN), 100);
  [0, NaN, undefined, 100].forEach((t) => {
    const v = PM.pageCount(t, 20);
    assert.ok(v >= 0 && !Number.isNaN(v), 'pageCount 应非负且非 NaN: ' + t);
  });
});

test('✓ pageCount：负 total 被 clamp 到 0，不产生负页数（2026-09-18 已修）', () => {
  assert.strictEqual(PM.pageCount(-100, 10), 0, '负 total 不得给出负页数');
  assert.strictEqual(PM.pageCount(-1, 10), 0);
  assert.strictEqual(PM.pageCount(100, 10), 10, '正常值不受影响');
});

test('✗ pageNumbers：count=0 / 负数 / NaN 返回空数组，不崩', () => {
  assert.deepStrictEqual(PM.pageNumbers(0), []);
  assert.deepStrictEqual(PM.pageNumbers(-5), []);
  assert.deepStrictEqual(PM.pageNumbers(NaN), []);
  assert.deepStrictEqual(PM.pageNumbers(3, 0), [1, 2, 3]); // start 0 → 兜底 1
});

test('✗ flattenPages：pages=null / [] 不崩返回空数组', () => {
  const m = new Map([[1, ['a']], [2, ['b']], [3, ['c']]]);
  assert.deepStrictEqual(PM.flattenPages(null, m), []);
  assert.deepStrictEqual(PM.flattenPages([], m), []);
  assert.deepStrictEqual(PM.flattenPages([1, 2, 3], m), ['a', 'b', 'c']);
});

test('✓ flattenPages：byPage=null / 普通对象不崩，返回空数组（2026-09-18 已修）', () => {
  assert.deepStrictEqual(PM.flattenPages([1], null), []);
  assert.deepStrictEqual(PM.flattenPages([1], undefined), []);
  // 普通对象（无 .get）也按 key 取值，不抛
  assert.deepStrictEqual(PM.flattenPages([1], { 1: ['a'] }), ['a']);
});

test('✗ dedupeByKey：rows=null / [] 不崩；全部空 key 不误合并', () => {
  assert.deepStrictEqual(PM.dedupeByKey(null, (r) => r.id), []);
  assert.deepStrictEqual(PM.dedupeByKey([], (r) => r.id), []);
  // 自定义 keyFn 全返回 '' → 每行都保留（空 key 的行不会被判为重复）
  assert.strictEqual(PM.dedupeByKey([{ x: 1 }, { x: 2 }], () => '').length, 2);
  // 默认 rowKey：缺 id/编码的行 key 为空，三行全部保留不合并
  assert.strictEqual(PM.dedupeByKey([{}, {}, {}]).length, 3);
});

test('✗ countByStatus：rows=null / undefined 不崩，返回全 0 统计', () => {
  const c = PM.countByStatus(null);
  assert.strictEqual(c.published, 0);
  assert.strictEqual(c.pending, 0);
  assert.strictEqual(c.failed, 0);
  assert.deepStrictEqual(PM.countByStatus(undefined).counts, {});
});

test('✗ countByStatus：含 null 元素的数组现状抛 TypeError（疑似 bug，已报告）', () => {
  // 源码 (rows||[]).forEach(r => r.offerServerState)，r 为 null 时崩。
  const c = PM.countByStatus([null, { offerServerState: '正式版基线' }, null]);
  assert.strictEqual(c.published, 1, '脏行被跳过，正常行照常统计');
  assert.strictEqual(PM.countByStatus([null]).published, 0);
});

test('✗ subscribeStats：rows=null 不崩，rate 为 0 而非 NaN', () => {
  const s = PM.subscribeStats(null);
  assert.strictEqual(s.subscribed, 0);
  assert.strictEqual(s.unsubscribed, 0);
  assert.strictEqual(s.rate, 0);
  // isSubscribed 缺省 → 全部未订阅，rate 0
  assert.deepStrictEqual(PM.subscribeStats([{ serverCoding: 'A' }]), { subscribed: 0, unsubscribed: 1, rate: 0 });
});

test('✗ normalizeRow：row=null 兜底全部占位符 —，不崩', () => {
  const n = PM.normalizeRow(null);
  assert.deepStrictEqual(
    [n.serverCoding, n.compNum, n.batch, n.serviceStatus, n.deptName],
    ['—', '—', '—', '—', '—'],
  );
  assert.strictEqual(n.interfaceCode, '');
});

// ═══════════════════════════════════════════════════════════════════════
// publish-view.js
// ═══════════════════════════════════════════════════════════════════════

const PV = winPublishView().PublishView;

test('✗ renderRows：rows=null / [] 返回空串，不崩', () => {
  assert.strictEqual(PV.renderRows(null, { pageNum: 1, pageSize: 20, checkSubscribe: () => 'unknown' }), '');
  assert.strictEqual(PV.renderRows([], { pageNum: 1, pageSize: 20, checkSubscribe: () => 'unknown' }), '');
});

test('✗ renderRows：row=null 安全降级为 — 行（normalizeRow 兜底），不崩', () => {
  const html = PV.renderRows([null], { pageNum: 1, pageSize: 20, checkSubscribe: () => 'unknown' });
  assert.doesNotThrow(() => PV.renderRows([null], { pageNum: 1, pageSize: 20, checkSubscribe: () => 'unknown' }));
  assert.ok(html.includes('data-code="—"'), 'null 行应渲染成占位 — 而非崩');
});

test('✗ renderRows：XSS —— data-code 含引号/< 不被截断、不产生裸标签', () => {
  const html = PV.renderRows(
    [{ serverCoding: '"><script>alert(1)</script>', serviceName: 'x' }],
    { pageNum: 1, pageSize: 20, checkSubscribe: () => 'unknown' },
  );
  assert.strictEqual(html.indexOf('<script'), -1, '不允许裸 <script');
  assert.strictEqual(html.indexOf('"><script'), -1, 'data-code 不得被引号截断注入');
  assert.ok(html.includes('data-code="&quot;'), '引号被转义后仍保持属性完整');
});

test('renderRows：字段含 " 与 \' —— data-copy 属性不被截断（2026-09-23 起不再有内容 title）', () => {
  const html = PV.renderRows(
    [{ serverCoding: 'S', serviceName: 'a"b\'c' }],
    { pageNum: 1, pageSize: 20, checkSubscribe: () => 'unknown' },
  );
  assert.ok(html.includes('data-copy="a&quot;b&#39;c"'), '双/单引号应被转义，属性不被截断');
  assert.ok(!/title="a&quot;/.test(html), '被截断内容的全文不再走 title（memory.md §1）');
});

test('✗ renderRows：超长字段（~1000 字）不畸形 HTML，单行结构完整', () => {
  const longName = '服'.repeat(1000);
  const html = PV.renderRows(
    [{ serverCoding: 'S', serviceName: longName }],
    { pageNum: 1, pageSize: 20, checkSubscribe: () => 'unknown' },
  );
  assert.ok(html.includes(longName), '超长文本应原样落进单元格');
  assert.strictEqual(html.split('<tr').length - 1, 1, '应有且仅有一行 <tr>');
  assert.strictEqual(html.split('</tr>').length - 1, 1, '应有且仅有一行 </tr>');
});

test('✗ stateBadge：状态值含 XSS 标签/引号需转义，不产生裸标签', () => {
  const h = PV.stateBadge('<img src=x onerror=alert(1)>');
  assert.strictEqual(h.indexOf('<img'), -1, '状态文案不得出现裸 <img');
  assert.ok(h.includes('&lt;img'), '尖括号需转义');
  assert.ok(PV.stateBadge('a"b\'c').includes('&quot;'), '引号需转义');
});

test('✗ renderRows（无 Fmt 兜底 esc）：内置兜底也必须真转义，不得零转义', () => {
  const PV2 = winPublishViewNoFmt().PublishView;
  const html = PV2.renderRows(
    [{ serverCoding: '<b>x</b>' }],
    { pageNum: 1, pageSize: 20, checkSubscribe: () => 'unknown' },
  );
  assert.strictEqual(html.indexOf('<b>'), -1, '兜底 esc 不能零转义');
  assert.ok(html.includes('&lt;b&gt;'), '兜底 esc 需转义尖括号');
});

// ═══════════════════════════════════════════════════════════════════════
// subscription-model.js
// ═══════════════════════════════════════════════════════════════════════

const SM0 = winSubModel().SubscriptionModel;   // 无 Priority
const SMP = winSubModelPrio().SubscriptionModel; // 有 Priority

test('✗ slicePage：0 / 负数 / NaN / undefined 入参返回空数组且长度非负', () => {
  assert.deepStrictEqual(SM0.slicePage(null, 1, 10), []);
  assert.deepStrictEqual(SM0.slicePage([1, 2, 3], 0, 10), []);
  assert.deepStrictEqual(SM0.slicePage([1, 2, 3], -1, 10), []);
  assert.deepStrictEqual(SM0.slicePage([1, 2, 3], 1, NaN), []);
  assert.deepStrictEqual(SM0.slicePage([1, 2, 3], NaN, 10), []);
  const sl = SM0.slicePage([1, 2, 3], 1, 2);
  assert.ok(Array.isArray(sl) && sl.length >= 0 && !Number.isNaN(sl.length));
});

test('✗ overdueCount：rows=null / [] 不崩返回 0', () => {
  assert.strictEqual(SM0.overdueCount(null), 0);
  assert.strictEqual(SM0.overdueCount([]), 0);
  assert.strictEqual(SM0.overdueCount([{}, {}]), 0);
});

test('✓ overdueCount：含 null 元素的数组跳过脏行，不崩（2026-09-18 已修）', () => {
  assert.strictEqual(SM0.overdueCount([null, { _prio: { overdue: true } }]), 1);
  assert.strictEqual(SM0.overdueCount([null]), 0);
});

test('✗ decorateRows：rows=null / [] 不崩返回空数组', () => {
  assert.deepStrictEqual(SMP.decorateRows(null), []);
  assert.deepStrictEqual(SMP.decorateRows([]), []);
});

test('✓ decorateRows：含 null 元素的数组原样返回脏行，不崩（2026-09-18 已修）', () => {
  const out = SMP.decorateRows([null, { prodBatchList: '2608批次' }]);
  assert.strictEqual(out.length, 2, '脏行原样保留在结果里（不静默丢行，交由渲染层滤掉）');
  assert.strictEqual(out[0], null);
});

test('✓ Priority.decorate / decorateRow：row=null 原样返回，不抛（2026-09-18 已修）', () => {
  const P = winPriority().Priority;
  assert.strictEqual(SMP.decorateRow(null), null, '脏行原样返回，不写 _prio');
  assert.strictEqual(P.decorate(null, new Date(2026, 5, 1)), null);
  const row = P.decorate({ prodBatchList: '2608批次', status: '已订阅' }, new Date(2026, 5, 1));
  assert.ok(row._prio, '正常行仍要算出优先级');
});

test('✗ sortRows：非法方向不崩；无 Priority 保持原序，有 Priority 按 sortKey 升序', () => {
  const rA = [{ _prio: { sortKey: 5 } }, { _prio: { sortKey: 1 } }];
  // 无 Priority：任何方向都只复制（保持原序），不崩
  assert.deepStrictEqual(SM0.sortRows(rA, 'x').map((r) => r._prio.sortKey), [5, 1]);
  assert.deepStrictEqual(SM0.sortRows(null, 'asc'), []);
  assert.deepStrictEqual(SM0.sortRows([], 'desc'), []);
  // 有 Priority：'x' 非 desc → 按 sortKey 升序（不崩，但不保持原序）
  assert.deepStrictEqual(SMP.sortRows(rA, 'x').map((r) => r._prio.sortKey), [1, 5]);
  // 缺 _prio 的行按 9e6 沉底，不崩
  const sorted = SMP.sortRows([{}, { _prio: { sortKey: 0 } }], 'asc');
  assert.strictEqual(sorted.length, 2);
  assert.strictEqual(sorted[0]._prio.sortKey, 0, '有 _prio 的行排在前');
  assert.strictEqual(sorted[1]._prio, undefined, '缺 _prio 的行沉底但不崩');
});

// ═══════════════════════════════════════════════════════════════════════
// priority.js
// ═══════════════════════════════════════════════════════════════════════

const P = winPriority().Priority;
const NOW = new Date(2026, 5, 1); // 固定基准，避免随当天漂移

test('✗ Priority.evaluate：row=null / {} / 缺 prodBatchList / 缺 status 均降级 unknown，不崩', () => {
  assert.strictEqual(P.evaluate(null, NOW).level, 'unknown', 'null 行不崩');
  assert.strictEqual(P.evaluate({}, NOW).level, 'unknown', '空行不崩');
  const noBatch = P.evaluate({ status: '开发基线' }, NOW);
  assert.strictEqual(noBatch.level, 'unknown', '缺批次 → 解析不出年月');
  assert.strictEqual(noBatch.reason, '批次解析不出年月');
  const noStatus = P.evaluate({ prodBatchList: '2609批次' }, NOW);
  assert.strictEqual(noStatus.level, 'unknown', '缺状态 → 不在里程碑');
  assert.strictEqual(noStatus.reason, '基线状态不在里程碑里');
});

test('✗ Priority.setBatchTimes：传非对象 / 非法日期值不崩，且无效覆盖被忽略或降级', () => {
  assert.doesNotThrow(() => P.setBatchTimes(null), '非对象参数不崩');
  assert.doesNotThrow(() => P.setBatchTimes('2026-13-45'), '字符串参数不崩，退化为 {}');
  // 传非对象后等价于清空覆盖 → 走规则口径
  assert.strictEqual(P.evaluate({ prodBatchList: '2609批次', status: '开发基线' }, NOW).deadline, '2026-08-15');
  // 非法日期值（月份/日越界）不崩，parseYmd 宽松解析给出一个日期串
  assert.doesNotThrow(() => P.setBatchTimes({ '2609批次': { testDate: '2026-13-45' } }));
  const r = P.evaluate({ prodBatchList: '2609批次', status: '开发基线' }, NOW);
  assert.strictEqual(typeof r.deadline, 'string', '非法日期仍给出日期串（不崩）');
  P.setBatchTimes({}); // 复位，避免污染
});

test('✗ Priority.decorate：缺 prodBatchList/status 的行降级 unknown，不崩', () => {
  const d = P.decorate({ prodBatchList: '2609批次' }, NOW);
  assert.strictEqual(d._prio.level, 'unknown');
  assert.strictEqual(typeof d._prioText, 'string');
  const d2 = P.decorate({}, NOW);
  assert.strictEqual(d2._prio.level, 'unknown');
});

// ═══════════════════════════════════════════════════════════════════════
// subscription-view.js
// ═══════════════════════════════════════════════════════════════════════

const wsv = winSubView();
const SV = wsv.SubscriptionView;

test('✗ SubscriptionView.renderTable：XSS —— 字段含标签/引号，data-copy 不被截断', () => {
  const body = stubBody();
  SV.renderTable(body, [{ publishSubcriptionId: 'a', sysServeName: '<img src=x onerror=alert(1)>', serverCoding: 'A&B"x' }], {});
  const html = body.innerHTML;
  assert.strictEqual(html.indexOf('<img'), -1, '不允许裸 <img');
  assert.ok(html.includes('&lt;img'), '尖括号需转义');
  assert.ok(html.includes('data-copy="A&amp;B&quot;x"'), 'data-copy 引号需转义、属性不被截断');
});

test('✗ SubscriptionView.renderTable：字段值为 0 不被当成空值吞掉', () => {
  const body = stubBody();
  SV.renderTable(body, [{ publishSubcriptionId: 'a', sysNo: 0 }], {});
  assert.ok(body.innerHTML.includes('<span class="cell-clamp">0</span>'), '0 应显示，不能渲染成 —');
  assert.ok(body.innerHTML.includes('data-copy="0"'));
});

test('✗ SubscriptionView.renderTable：rows=[] / null 清空 tbody，不出现 undefined', () => {
  const body = stubBody();
  SV.renderTable(body, [], {});
  assert.strictEqual(body.innerHTML, '');
  SV.renderTable(body, null, {});
  assert.strictEqual(body.innerHTML, '');
  assert.strictEqual(body.innerHTML.includes('undefined'), false);
});

test('✗ SubscriptionView.renderTable：超长字段（~1000 字）不畸形 HTML', () => {
  const body = stubBody();
  const longV = '值'.repeat(1000);
  SV.renderTable(body, [{ publishSubcriptionId: 'a', sysServeName: longV }], {});
  assert.ok(body.innerHTML.includes(longV));
  assert.strictEqual(body.innerHTML.split('<tr').length - 1, 1, '应有且仅有一行 <tr>');
  assert.strictEqual(body.innerHTML.split('</tr>').length - 1, 1);
});

test('✓ SubscriptionView.renderTable：含 null 元素的数组滤掉脏行，整表照常渲染（2026-09-18 已修）', () => {
  const body = stubBody();
  SV.renderTable(body, [null, { serverCoding: 'A', status: '已订阅' }], {});
  assert.strictEqual(body.innerHTML.split('<tr').length - 1, 1, '脏行被滤掉，只剩 1 行');
  assert.ok(body.innerHTML.includes('A'), '正常行照常渲染');
  const empty = stubBody();
  SV.renderTable(empty, [null, null], {});
  assert.strictEqual(empty.innerHTML, '');
});

test('✗ SubscriptionView.renderPagination：total 为 NaN / 负数 / undefined 不崩且分页条隐藏', () => {
  [NaN, -5, undefined].forEach((total) => {
    const els = stubPaginationEls();
    assert.doesNotThrow(
      () => SV.renderPagination(els, { pageNum: 1, total, pages: Number.isNaN(total) ? NaN : 0, queried: true, onGoto: () => {} }),
      `total=${total} 不应抛`,
    );
    assert.strictEqual(els.bar.style.display, 'none', `非法 total=${total} 时整条隐藏`);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// table-utils.js
// ═══════════════════════════════════════════════════════════════════════

const wtu = winTableUtils();
const T = wtu.TableUtils;
const Tbody = wtu.__body;

test('✗ TableUtils.totalPages：0 / 负数 / NaN / undefined 入参均 ≥1 且有限', () => {
  assert.strictEqual(T.totalPages(0, 0), 1, '0 条不能是 0 页');
  assert.strictEqual(T.totalPages(-50, 10), 1, '负 total 被 clamp 到至少 1');
  assert.strictEqual(T.totalPages(NaN, 50), 1, 'NaN total 退化为 0 → 1 页');
  assert.strictEqual(T.totalPages(100, NaN), 100, 'NaN pageSize 退化为 1');
  assert.strictEqual(T.totalPages(undefined, undefined), 1);
  [0, -50, NaN, undefined, 100].forEach((t) => {
    const v = T.totalPages(t, 10);
    assert.ok(v >= 1 && Number.isFinite(v), 'totalPages 应 ≥1 且有限: ' + t);
  });
});

test('✗ TableUtils.renderEmpty：colspan 注入面（0 / -1 / 恶意串）不产生可利用属性', () => {
  T.renderEmpty('x', 0);
  assert.ok(Tbody.innerHTML.includes('colspan="1"'), 'colspan=0 退化为 1');
  T.renderEmpty('x', -1);
  assert.ok(Tbody.innerHTML.includes('colspan="-1"'), 'colspan=-1 保留为负整数（非注入）');
  assert.ok(!Tbody.innerHTML.includes('onmouseover'), '-1 不引入事件属性');
  T.renderEmpty('x', '3"onmouseover="alert(1)');
  assert.ok(!Tbody.innerHTML.includes('onmouseover'), '恶意 colspan 串不得注入事件属性');
  assert.ok(Tbody.innerHTML.includes('colspan="1"'), '恶意 colspan 串退化为 1');
});

test('✗ TableUtils.renderEmpty：文本经 esc 转义，防标签注入', () => {
  T.renderEmpty('<img src=x onerror=alert(1)>', 5);
  assert.ok(!Tbody.innerHTML.includes('<img'), '尖括号需转义');
  assert.ok(Tbody.innerHTML.includes('&lt;img'), '转义后应出现 &lt;img');
});

test('✗ TableUtils.syncEmptyOverlay / hideEmptyOverlay：无浮层时静默跳过，不崩', () => {
  assert.strictEqual(T.syncEmptyOverlay(), false, '无 .table-empty-overlay 返回 false');
  assert.doesNotThrow(() => T.hideEmptyOverlay());
});

test('✗ TableUtils.buildPageNumbers：pages=0 / 负数 / NaN 不崩且不出越界按钮', () => {
  assert.strictEqual(T.buildPageNumbers(0, 1), '');
  assert.strictEqual(T.buildPageNumbers(-3, 1), '');
  assert.strictEqual(T.buildPageNumbers(NaN, 1), '');
  assert.strictEqual(T.buildPageNumbers(10, 99).indexOf('data-page="99"'), -1, '越界页码不出现');
});

// ═══════════════════════════════════════════════════════════════════════
// format.js
// ═══════════════════════════════════════════════════════════════════════

const F = winFmt().Fmt;

test('✗ Fmt.esc：null / undefined / XSS / 引号 转义正确', () => {
  assert.strictEqual(F.esc(null), '');
  assert.strictEqual(F.esc(undefined), '');
  assert.strictEqual(F.esc('<img src=x onerror=alert(1)>').includes('<img'), false, '裸 <img 不得出现');
  assert.strictEqual(F.esc('a"b\'c'), 'a&quot;b&#39;c', '双/单引号需转义');
  assert.strictEqual(F.esc(0), '0', '数字 0 不被吞');
});

test('✗ Fmt.num：0 当有效值显示，null / undefined 兜底 —，千分位生效', () => {
  assert.strictEqual(F.num(0), '0', '0 不能渲染成 —');
  assert.strictEqual(F.num(null), '—');
  assert.strictEqual(F.num(undefined), '—');
  assert.ok(F.num(1234567).includes(','), '千分位分隔生效');
  assert.strictEqual(F.num('abc'), 'abc', '非数字原样输出');
});

// ═══════════════════════════════════════════════════════════════════════
// publish-response.js
// ═══════════════════════════════════════════════════════════════════════

const PR = winResponse().PublishResponse;

test('✗ PublishResponse.parse：data 为 null 时回退 rows=[] / total=0，不崩', async () => {
  const r = await PR.parse(resp({ json: { code: 200, data: null } }));
  assert.deepStrictEqual(r.rows, []);
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.loose, false);
});

test('✗ PublishResponse.parse：json 解析失败抛友好错误，不崩', async () => {
  const bad = { ok: true, status: 200, json: async () => { throw new Error('bad json'); }, headers: { get: () => null } };
  let err = null;
  try { await PR.parse(bad); } catch (e) { err = e; }
  assert.ok(err && /接口返回数据格式异常/.test(err.message || String(err)), '应抛出带友好文案的错误');
});

test('✓ PublishResponse.parse：resp=null / undefined 给出可读错误，不再是裸 TypeError（2026-09-18 已修）', async () => {
  for (const bad of [null, undefined]) {
    let err = null;
    try { await PR.parse(bad); } catch (e) { err = e; }
    assert.ok(err, 'resp 为空必须报错（不能假装成功返回空数据）');
    const msg = (err && err.message) || String(err);
    assert.ok(!/Cannot read|reading 'ok'|TypeError/.test(msg), '错误信息不能是裸 TypeError：' + msg);
    assert.ok(/接口未返回结果|网络|代理/.test(msg), '错误信息要对用户可读：' + msg);
  }
});
