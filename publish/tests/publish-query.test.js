/**
 * publish-query.js 单测：覆盖从 index.js 拆出的查询编排层。
 *
 * 重点守住「看不见但改一处就会坏」的行为：
 *   · fetchPages 的 worker 池并发上限、按页码有序合并、失败页收集、中止
 *   · doQuery 的首页 total → 剩余页扇出、页数封顶、去重、前端兜底过滤、空态
 *   · 竞态：旧查询晚归不得覆盖新查询写下的状态
 *   · 失败分页重试：补齐 + 页码夹取（不把用户弹回第一页）
 *
 * 页面侧（DOM / 控件）用 stub ctx 注入 —— 与浏览器里的 init(ctx) 同一入口。
 */
'use strict';

const { loadScript, test } = require('./harness');
const assert = require('assert');

const TOTAL = 450;          // 后端 total
const FETCH = 200;          // 后端单页上限（与 publish-query.js 的 FETCH_SIZE 一致）

/** 第 p 页的数据（每页 200 条，最后一段不足） */
function pageData(p, total) {
  const start = (p - 1) * FETCH + 1;
  const end = Math.min(total, p * FETCH);
  const records = [];
  for (let i = start; i <= end; i++) {
    records.push({ id: i, serverCoding: 'S' + i, serviceName: 'svc' + i, offerServerState: '运行中' });
  }
  return { records, total };
}

function okResp(records, total) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ code: 0, data: { records, total } }),
  };
}
function errResp(status) {
  return { ok: false, status, headers: { get: () => null }, json: async () => ({}) };
}

/** 每次测试都重新加载一份模块，避免模块级 queryState / querySeq 串味 */
function setup() {
  const win = loadScript('js/page/publish-model.js');
  win.fetch = () => {};                       // 兼容性检查里的 fetch 探测
  win.JSON = JSON;
  loadScript('js/core/publish-response.js', {}, win);
  loadScript('js/ui/table-utils.js', {}, win);   // retryFailedPages 的页码夹取要用 totalPages
  loadScript('js/page/publish-query.js', {}, win);

  const rec = {
    toasts: [], stats: [], retryBars: [], replay: [], errors: [], empty: [],
    loading: [], focused: [], deptRows: [], requests: [],
    retryBtn: { disabled: false, textContent: '重试失败分页' },
  };
  win.PublishView = {
    updateStats: (d) => rec.stats.push(d),
    updateRetryBar: (pages) => rec.retryBars.push((pages || []).slice()),
    updateCacheReplayBar: (loose) => rec.replay.push(!!loose),
    // 真实现会重建 filteredRows 并把页码归 1；这里保留这两条可观测语义
    applySubscribeFilter: (s) => { s.pageNum = 1; s.filteredRows = s.rawRows.slice(); },
    renderCurrentPage: () => {},
    updatePagination: () => {},
    renderEmptyResult: (hint) => rec.empty.push(hint),
    renderQueryError: (err) => rec.errors.push(err),
  };

  const state = {
    currentFilter: 'all', displayedRows: [], filteredRows: [],
    pageNum: 1, pageSize: 10, totalItems: 0, rawRows: [],
  };
  const ctx = {
    state,
    retryBtn: rec.retryBtn,
    checkSubscribeStatus: () => 'unknown',
    collectApiBody: () => ({ compNum: 'E001', batch: '2609批次' }),
    collectLocalFilters: () => [],
    resolveBatchLabel: () => ({ value: '2609pc', label: '2609批次', ok: true }),
    getDeptValue: () => '',
    getProviderValue: () => 'E001',
    getBatchValue: () => '2609pc',
    focusProvider: () => rec.focused.push('provider'),
    focusBatch: () => rec.focused.push('batch'),
    fillDeptListFromRows: (rows) => rec.deptRows.push(rows.length),
    showToast: (msg, ms, type) => rec.toasts.push({ msg, ms, type }),
    showLoading: () => rec.loading.push(true),
    hideLoading: () => rec.loading.push(false),
    debugLog: () => {},
  };

  win.ToolApi = { fetchPublishDataList: async () => okResp([], 0) };

  const Q = win.PublishQuery;
  Q.init(ctx);
  return { win, Q, ctx, state, rec };
}

/** 装一个按页码返回数据的假后端，记录每次请求 */
function installBackend(t, getPage, opts = {}) {
  t.win.ToolApi = {
    fetchPublishDataList: async (body, o) => {
      t.rec.requests.push({ ...body, __signal: !!(o && o.signal) });
      const r = getPage(body.pageNum);
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

const toastOf = (t, needle) => t.rec.toasts.find((x) => x.msg.includes(needle));

// ── fetchPages ────────────────────────────────────────

test('fetchPages：worker 池并发受限，按页码有序合并，失败页收集不中断其余页', async () => {
  const t = setup();
  let inflight = 0, maxInflight = 0;
  t.win.ToolApi = {
    fetchPublishDataList: async (body) => {
      inflight++; maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 1));
      inflight--;
      if (body.pageNum === 3) throw new Error('boom');
      return okResp([{ id: body.pageNum }], 5);
    },
  };

  const { byPage, failed, aborted } = await t.Q.fetchPages({
    baseBody: { compNum: 'E001' },
    pages: [1, 2, 3, 4, 5],
    concurrency: 2,
    isCurrent: () => true,
  });

  assert.strictEqual(aborted, false);
  assert.deepStrictEqual([...byPage.keys()].sort((a, b) => a - b), [1, 2, 4, 5]);
  assert.deepStrictEqual(failed, [3]);
  assert.strictEqual(maxInflight <= 2, true, '并发超过 concurrency 上限: ' + maxInflight);
  assert.strictEqual(byPage.get(4)[0].id, 4);
});

test('fetchPages：isCurrent 失效 → 立即中止，已成空的 pending 不再发请求', async () => {
  const t = setup();
  let calls = 0;
  t.win.ToolApi = {
    fetchPublishDataList: async () => {
      calls++;
      return okResp([{ id: 1 }], 5);
    },
  };

  const { aborted } = await t.Q.fetchPages({
    baseBody: {},
    pages: [1, 2, 3, 4, 5, 6, 7, 8],
    concurrency: 1,
    isCurrent: () => false,     // 新查询已经开始
  });

  assert.strictEqual(aborted, true);
  assert.strictEqual(calls, 0, '已失效的查询不应继续发请求');
});

test('fetchPages：AbortError 视为中止，不记成失败页', async () => {
  const t = setup();
  t.win.ToolApi = {
    fetchPublishDataList: async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    },
  };

  const { byPage, failed, aborted } = await t.Q.fetchPages({
    baseBody: {}, pages: [1], concurrency: 1, isCurrent: () => true,
  });

  assert.strictEqual(aborted, true);
  assert.deepStrictEqual([...byPage.keys()], []);
  assert.deepStrictEqual(failed, []);
});

// ── doQuery：正常路径 ─────────────────────────────────

test('doQuery：首页 total 决定扇出页数，按页码序拼全量并写回 state', async () => {
  const t = setup();
  installBackend(t, (p) => okResp(pageData(p, TOTAL).records, TOTAL));

  await t.Q.doQuery({ focusMissing: false });

  // 首页 + 第 2、3 页
  assert.deepStrictEqual(t.rec.requests.map((r) => r.pageNum), [1, 2, 3]);
  t.rec.requests.forEach((r) => {
    assert.strictEqual(r.pageSize, FETCH);
    assert.strictEqual(r.compNum, 'E001');
    assert.strictEqual(r.batch, '2609批次');
  });
  assert.strictEqual(t.state.rawRows.length, TOTAL);
  assert.strictEqual(t.state.totalItems, TOTAL);
  assert.strictEqual(t.state.pageNum, 1);
  assert.deepStrictEqual(t.state.filteredRows, t.state.rawRows);
  assert.strictEqual(t.rec.stats[t.rec.stats.length - 1].total, TOTAL);
  assert.deepStrictEqual(t.rec.retryBars[t.rec.retryBars.length - 1], []);
  assert.strictEqual(t.rec.replay[t.rec.replay.length - 1], false);
  assert.ok(toastOf(t, '✅ 查询成功'), '>100 条应提示查询成功');
  assert.deepStrictEqual(t.rec.loading, [true, false]);
});

test('doQuery：去重（后端忽略 pageNum 重复返回同一批）', async () => {
  const t = setup();
  // 每页都返回第 1 页那 200 条 → 去重后只剩 200
  installBackend(t, () => okResp(pageData(1, TOTAL).records, TOTAL));

  await t.Q.doQuery({ focusMissing: false });

  assert.strictEqual(t.state.rawRows.length, FETCH);
  assert.strictEqual(
    t.rec.requests.length, 3,
    '拉取页数由 total 决定，去重发生在拉完之后',
  );
});

test('doQuery：前端兜底过滤生效并提示被丢掉的条数', async () => {
  const t = setup();
  t.ctx.collectLocalFilters = () => [
    { label: '服务状态', keys: ['offerServerState'], value: '运行中', exact: false, date: false },
  ];
  // 只留偶数 id：把 serverCoding 改成不匹配的字符串
  installBackend(t, (p) => {
    const { records } = pageData(p, TOTAL);
    records.forEach((r) => { if (r.id % 2) r.offerServerState = '已下线'; });
    return okResp(records, TOTAL);
  });

  await t.Q.doQuery({ focusMissing: false });

  assert.strictEqual(t.state.rawRows.length, 225);
  assert.ok(toastOf(t, '本页过滤掉 225 条'), '应提示兜底过滤丢了多少条');
});

test('doQuery：空结果 → 空态渲染 + state 复位 + 关掉 loading', async () => {
  const t = setup();
  installBackend(t, () => okResp([], 0));

  await t.Q.doQuery({ focusMissing: false });

  assert.strictEqual(t.rec.empty.length, 1);
  assert.strictEqual(t.state.rawRows.length, 0);
  assert.strictEqual(t.state.totalItems, 0);
  assert.strictEqual(t.rec.loading[t.rec.loading.length - 1], false);
  assert.ok(toastOf(t, '📭'));
});

test('doQuery：必填缺失 / 批次 label 解析不出 → 拦在本前端，一个请求都不发', async () => {
  const t1 = setup();
  t1.ctx.getProviderValue = () => '';
  await t1.Q.doQuery({ focusMissing: true });
  assert.strictEqual(t1.rec.requests.length, 0);
  assert.deepStrictEqual(t1.rec.focused, ['provider']);
  assert.ok(toastOf(t1, '请输入提供方系统'));

  const t2 = setup();
  t2.ctx.getBatchValue = () => '';
  await t2.Q.doQuery({ focusMissing: true });
  assert.strictEqual(t2.rec.requests.length, 0);
  assert.deepStrictEqual(t2.rec.focused, ['batch']);

  const t3 = setup();
  t3.ctx.resolveBatchLabel = () => ({ value: '2609pc', label: '', ok: false });
  await t3.Q.doQuery({ focusMissing: true });
  assert.strictEqual(t3.rec.requests.length, 0, '解析不出 label 必须阻断查询');
  assert.ok(toastOf(t3, '批次列表尚未加载完成'));

  const t4 = setup();
  t4.ctx.collectApiBody = () => ({ compNum: '非法编号!' });
  await t4.Q.doQuery({ focusMissing: false });
  assert.strictEqual(t4.rec.requests.length, 0, '格式校验不通过不得发请求');
  assert.ok(toastOf(t4, '提供方系统编号格式不正确'));
});

// ── doQuery：竞态 / 错误 ──────────────────────────────

test('doQuery：旧查询晚归不得覆盖新查询的结果（querySeq 竞态防护）', async () => {
  const t = setup();
  const deferred = [];
  t.win.ToolApi = {
    fetchPublishDataList: (body) => {
      t.rec.requests.push({ ...body });
      return new Promise((resolve) => deferred.push(() => resolve(okResp([{ id: body.__seq }], 1))));
    },
  };

  // 两次查询：第一次是「旧」，第二次是「新」
  const oldRun = t.Q.doQuery({ focusMissing: false });
  t.ctx.collectApiBody = () => ({ compNum: 'E002', batch: '2611批次' });
  const newRun = t.Q.doQuery({ focusMissing: false });
  assert.strictEqual(deferred.length, 2);

  // 新查询先落地
  deferred[1]();
  await newRun;
  assert.strictEqual(t.state.rawRows.length, 1);
  assert.strictEqual(t.state.totalItems, 1);

  // 旧查询后到：必须整体作废，不写 state、不改 loading
  const loadingBefore = t.rec.loading.length;
  deferred[0]();
  await oldRun;
  assert.strictEqual(t.state.totalItems, 1);
  assert.strictEqual(t.rec.loading.length, loadingBefore, '被作废的查询不该再动 loading');
});

test('doQuery：后端报错 → 错误文案 toast + 结果区复位，loading 收回', async () => {
  const t = setup();
  installBackend(t, () => errResp(500));

  await t.Q.doQuery({ focusMissing: false });

  assert.strictEqual(t.rec.errors.length, 1);
  assert.ok(toastOf(t, '❌ 服务器内部错误，请稍后重试'));
  assert.strictEqual(t.rec.loading[t.rec.loading.length - 1], false);
});

// ── 分页封顶 / 失败重试 ───────────────────────────────

test('doQuery：页数封顶 MAX_FETCH_PAGES=20，并明确告知只取了前 20 页', async () => {
  const t = setup();
  const HUGE = 100000;   // ceil(100000/200) = 500 页
  installBackend(t, (p) => okResp(p === 1 ? pageData(1, HUGE).records : [{ id: 1000 + p }], HUGE));

  await t.Q.doQuery({ focusMissing: false });

  assert.strictEqual(t.rec.requests.length, 20, '首页 + 2~20 页，共 20 次请求');
  assert.strictEqual(t.rec.requests[t.rec.requests.length - 1].pageNum, 20);
  assert.ok(toastOf(t, '只取了前 20 页'));
  assert.strictEqual(t.state.rawRows.length, FETCH + 19);
});

test('doQuery：部分分页失败 → 重试条给页码、结果不完整提示，重试后补齐且页码不被弹回', async () => {
  const t = setup();
  let failPage2 = true;
  installBackend(t, (p) => {
    if (p === 2 && failPage2) return errResp(500);
    return okResp(pageData(p, TOTAL).records, TOTAL);
  });

  await t.Q.doQuery({ focusMissing: false });

  assert.deepStrictEqual(t.rec.retryBars[t.rec.retryBars.length - 1], [2]);
  assert.strictEqual(t.Q.hasFailedPages(), true);
  assert.ok(toastOf(t, '查询完成但结果不完整：第 2 页获取失败'));
  assert.strictEqual(t.state.rawRows.length, FETCH + 50, '第 3 页成功、第 2 页缺失');

  // 用户翻到第 3 页再点重试：补齐后应留在第 3 页，不许弹回第 1 页
  t.state.pageNum = 3;
  failPage2 = false;
  await t.Q.retryFailedPages();

  assert.strictEqual(t.state.rawRows.length, TOTAL);
  assert.strictEqual(t.state.totalItems, TOTAL);
  assert.deepStrictEqual(t.rec.retryBars[t.rec.retryBars.length - 1], []);
  assert.strictEqual(t.Q.hasFailedPages(), false);
  assert.strictEqual(t.state.pageNum, 3, '重试后应恢复原页码（夹到合法范围）');
  assert.strictEqual(t.rec.retryBtn.disabled, false);
  assert.strictEqual(t.rec.retryBtn.textContent, '重试失败分页');
  assert.ok(toastOf(t, '✅ 已补齐失败分页，共 ' + TOTAL + ' 条'));
});

test('retryFailedPages：没有失败分页时直接返回，不发请求', async () => {
  const t = setup();
  installBackend(t, () => okResp([], 0));

  await t.Q.retryFailedPages();

  assert.strictEqual(t.rec.requests.length, 0);
  assert.strictEqual(t.rec.retryBtn.disabled, false);
});

test('cancel：作废在途查询并丢掉重试上下文', async () => {
  const t = setup();
  let failPage2 = true;
  installBackend(t, (p) => (p === 2 && failPage2 ? errResp(500) : okResp(pageData(p, TOTAL).records, TOTAL)));
  await t.Q.doQuery({ focusMissing: false });
  assert.strictEqual(t.Q.hasFailedPages(), true);

  t.Q.cancel();
  assert.strictEqual(t.Q.hasFailedPages(), false, 'cancel 应清掉重试上下文');

  failPage2 = false;
  await t.Q.retryFailedPages();
  assert.strictEqual(t.rec.requests.length, 3, 'cancel 之后重试不应再发请求');
});

// ── exportCsv ─────────────────────────────────────────

test('exportCsv：导出的是 filteredRows（订阅筛选后的口径），模块缺失则提示', () => {
  const t = setup();
  t.state.filteredRows = [{ id: 1 }];

  let got = null;
  t.win.CsvExporter = { exportRows: (rows, isSub, toast) => { got = { rows, isSub, toast }; } };
  t.Q.exportCsv();
  assert.strictEqual(got.rows, t.state.filteredRows);
  assert.strictEqual(typeof got.isSub, 'function');
  assert.strictEqual(typeof got.toast, 'function');

  const t2 = setup();
  t2.Q.exportCsv();
  assert.ok(toastOf(t2, '⚠️ 导出模块未加载'));
});
