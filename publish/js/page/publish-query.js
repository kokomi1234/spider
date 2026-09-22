/* ============================================================
  服务发布数据查询 — 查询编排层
  ------------------------------------------------------------
  从 index.js 拆出的「取数编排」：分页并发拉取、竞态防护、去重、
  前端兜底过滤、失败分页重试、导出 CSV。

  本模块**不碰 DOM 元素与筛选控件**：页面相关的一切（怎么收集请求体、
  怎么聚焦、怎么渲染、怎么 toast）都用 init(ctx) 注入，ctx 见文件末尾注释。
  纯逻辑走 window.PublishModel，渲染走 window.PublishView。

  本模块**独占**这些可变状态（index.js 不再持有）：
    · querySeq / activeQueryController —— 竞态防护（resetForm 通过 abort() 作废在途查询）
    · queryState                      —— 失败分页重试上下文（重试条读它）

  约定（与项目其它模块一致）：浏览器 IIFE，挂 window.PublishQuery。
  依赖：js/core/publish-response.js、js/page/publish-model.js、js/page/publish-view.js
        （均先于本文件加载）。
============================================================ */

(function () {
  'use strict';

  /** 后端单次最多返回 200 条（已确认） */
  const FETCH_SIZE = 200;
  /**
   * 全量拉取的页数上限（200 条/页 × 20 = 4000 条）。
   * 原先按后端 total 无上限扇出：一条宽条件查询可能拉几十页、几十 MB，
   * 页面会长时间无响应。超限时只取前 N 页并明确告知用户。
   */
  const MAX_FETCH_PAGES = 20;

  /** 页面注入的上下文（init 时赋值），全部由 index.js 提供 */
  let ctx = null;

  // 查询并发控制：新查询开始后，旧查询不得再覆盖页面状态。
  let querySeq = 0;
  let activeQueryController = null;

  // ── 失败分页重试上下文 ──────────────────────────────
  // 查询完成后若部分后端分页拉取失败，保留可重试所需的上下文。
  // 用户点「重试失败分页」时只重拉失败的那几页，再合并回已拉到的全量。
  let queryState = null; // {
  //   baseBody, FETCH_SIZE, localConds, firstData,
  //   pageCount, fetchedRaw: Map<pageNo, rows>, failedPages: number[]
  // }

  const M = () => window.PublishModel;
  const V = () => window.PublishView;
  const R = () => window.PublishResponse || {};

  /** 失败分页重试条（读 index.js 的 queryState） */
  function refreshRetryBar() {
    V().updateRetryBar(queryState ? queryState.failedPages : []);
  }

  /**
   * 并发分页拉取（worker 池 + 按页码有序合并）。
   * 原先 doQuery 与 retryFailedPages 各写一份同样的池/合并/失败收集，改一处漏一处。
   * @param {{baseBody:object, pages:number[], concurrency?:number, signal?:AbortSignal,
   *          isCurrent:Function, onPage?:Function}} args
   * @returns {Promise<{byPage:Map<number,Array>, failed:number[], aborted:boolean}>}
   */
  async function fetchPages({ baseBody, pages, concurrency = 3, signal, isCurrent, onPage }) {
    const byPage = new Map();
    const failed = [];
    const pending = pages.slice();
    let aborted = false;

    const worker = async () => {
      while (pending.length) {
        if (aborted || !isCurrent()) { aborted = true; return; }
        const p = pending.shift();
        try {
          const resp = await window.ToolApi.fetchPublishDataList(
            { ...baseBody, pageNum: p, pageSize: FETCH_SIZE },
            { signal },
          );
          const parsed = await R().parse(resp);
          if (!isCurrent()) { aborted = true; return; }
          byPage.set(p, parsed.rows || []);
          if (typeof onPage === 'function') onPage(p, parsed);
        } catch (err) {
          if (err?.name === 'AbortError' || (signal && signal.aborted) || !isCurrent()) { aborted = true; return; }
          failed.push(p);
          console.warn(`⚠️ 第 ${p} 页获取失败:`, err);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
    return { byPage, failed, aborted };
  }

  // 按页码顺序把各页行拼成一条数组（逻辑见 PublishModel.flattenPages）。

  // ── 失败分页重试：只重拉失败页，合并回全量 ──────────
  async function retryFailedPages() {
    if (!queryState || !queryState.failedPages.length) return;
    const { baseBody, localConds, firstData, pageCount, fetchedRaw } = queryState;

    // 作废任何在途查询，避免重试与「查询」互相覆盖
    const currentQuery = ++querySeq;
    if (activeQueryController) activeQueryController.abort();
    const controller = new AbortController();
    activeQueryController = controller;
    const isCurrent = () => currentQuery === querySeq && !controller.signal.aborted;

    const retryPages = [...queryState.failedPages];
    const retryBtn = ctx.retryBtn;
    const prevLabel = retryBtn.textContent;
    retryBtn.disabled = true;
    retryBtn.textContent = '重试中…';
    ctx.showToast('正在重试失败的分页…', 1800, 'info');

    // 与首屏共用同一套取数骨架（worker 池 + 有序合并 + 失败收集）
    let result = { byPage: new Map(), failed: retryPages };
    try {
      result = await fetchPages({
        baseBody,
        pages: retryPages,
        signal: controller.signal,
        isCurrent,
      });
    } catch (_) { /* 失败已在 fetchPages 内逐页吞掉，不向上抛 */ }

    result.byPage.forEach((rows, p) => {
      fetchedRaw.set(p, rows);
      const idx = queryState.failedPages.indexOf(p);
      if (idx >= 0) queryState.failedPages.splice(idx, 1);
    });

    if (!isCurrent()) {
      // 被新查询取消时，避免旧重试把按钮永久留在「重试中」状态。
      retryBtn.disabled = false;
      retryBtn.textContent = prevLabel;
      return;
    }

    // 用 fetchedRaw（成功页 + 刚重试成功的页）按页码顺序重建全量
    const all = M().flattenPages(M().pageNumbers(pageCount), fetchedRaw);

    // 去重 + 前端兜底过滤（与 doQuery 保持一致）
    const deduped = M().dedupeByKey(all, M().rowKey);
    const records = M().applyLocalFilters(deduped, localConds);

    // 写回全局状态，保留用户当前的订阅筛选与页码
    const state = ctx.state;
    state.rawRows = records;
    state.displayedRows = records;
    state.totalItems = records.length;

    V().updateStats({ ...firstData, rows: records, total: records.length }, ctx.checkSubscribeStatus);

    const savedPage = state.pageNum;
    V().applySubscribeFilter(state, ctx.checkSubscribeStatus);   // 重建 filteredRows 并渲染（内部会把 pageNum 归 1）
    // 恢复到重试前的页码（夹到合法范围），避免用户被弹回第一页
    const totalPages = window.TableUtils.totalPages(state.filteredRows.length, state.pageSize);
    state.pageNum = Math.min(Math.max(1, savedPage), totalPages);
    V().renderCurrentPage(state, ctx.checkSubscribeStatus);
    V().updatePagination(state);

    retryBtn.disabled = false;
    retryBtn.textContent = prevLabel;
    refreshRetryBar();

    if (queryState.failedPages.length) {
      ctx.showToast(`⚠️ 仍有第 ${queryState.failedPages.join('、')} 页获取失败`, 4000, 'warn');
    } else {
      ctx.showToast(`✅ 已补齐失败分页，共 ${state.totalItems} 条`, 2500, 'success');
    }
  }

  // ── 导出 CSV（feature 已拆到 csv-export.js）────────────
  function exportCsv() {
    if (!window.CsvExporter) {
      ctx.showToast('⚠️ 导出模块未加载', 2500, 'error');
      return;
    }
    window.CsvExporter.exportRows(ctx.state.filteredRows, ctx.checkSubscribeStatus, ctx.showToast);
  }

  // ── 核心：发起查询 ──────────────────────────────────
  async function doQuery() {
    const state = ctx.state;
    const apiBody    = ctx.collectApiBody();
    const localConds = ctx.collectLocalFilters();

    ctx.debugLog('🔍 [DEBUG] 请求体:', apiBody);
    ctx.debugLog('🔍 [DEBUG] 前端过滤条件:', localConds);
    ctx.debugLog('🔍 [DEBUG] 选中的部门 value:', ctx.getDeptValue());

    // 0. 浏览器兼容性检查（仅首次）
    if (!doQuery._compatChecked) {
      doQuery._compatChecked = true;
      const compatIssues = R().checkBrowserCompatibility();
      if (compatIssues.length > 0) {
        console.warn('浏览器兼容性问题:', compatIssues);
        compatIssues.forEach(issue => ctx.showToast(issue, 5000, 'warn'));
      }
    }

    // 1. 基础验证 —— 「提供方系统」「批次」自 2026-09-21 起都**非必选**（用户拍板）：
    //    只选了系统、或什么条件都没选，也允许查 —— 但这种查询没有批次这个强筛选，
    //    后端会跨批次回数据、结果集可能很大，所以**先让用户确认一次**再发请求。
    //    用户点「取消」就停在这一步，可以回去继续加条件；点「继续查询」才真的查。
    //    唯一直接拦下（不给确认机会）的是「选了批次却解析不出 label」（批次字典还没加载完）：
    //    放行会让请求体与前端过滤双双丢掉批次条件，静默返回全批次数据，比明确报错更坏。
    const fBatch = ctx.getBatchValue();

    if (!fBatch) {
      const goOn = ctx.confirm
        ? await ctx.confirm({
          title: '数据量可能过大',
          message: '当前查询结果数据量可能过大，请增加更多筛选条件以缩小查询范围。\n\n仍要继续查询吗？',
          okText: '继续查询',
        })
        : true;   // 页面没注入确认框时保守放行（由测试守住「必须注入」）
      if (!goOn) {
        ctx.debugLog('用户取消了「未限定批次」的查询');
        return;
      }
    }
    // 选了批次但解析不出 label（批次列表没加载完成）时必须拦下来。
    if (fBatch && !ctx.resolveBatchLabel().ok) {
      ctx.showToast('⚠️ 批次列表尚未加载完成，无法解析所选批次。请刷新页面后重试', 4000, 'warn');
      return;
    }

    // 2. 筛选条件格式校验
    const validationErrors = R().validateFilters(apiBody);
    if (validationErrors.length > 0) {
      ctx.showToast('❌ ' + validationErrors[0], 3000, 'error');
      return;
    }

    ctx.showLoading();

    // 新查询开始：清掉上一次可能残留的失败分页重试上下文
    queryState = null;
    refreshRetryBar();
    // 同时收起上一次的失败常驻条 —— 否则成功后它还挂着，看着像这次也失败了
    if (ctx.hideFail) ctx.hideFail();

    const currentQuery = ++querySeq;
    if (activeQueryController) activeQueryController.abort();
    const controller = new AbortController();
    activeQueryController = controller;
    const isCurrentQuery = () => currentQuery === querySeq && !controller.signal.aborted;

    try {
      const baseBody = { ...apiBody };   // FETCH_SIZE / 页数上限见文件上方的常量
      delete baseBody.pageNum;
      delete baseBody.pageSize;

      const requestPayload = { ...baseBody, pageNum: 1, pageSize: FETCH_SIZE };
      ctx.debugLog('📤 [查询请求] 最终发给后端的 body:', requestPayload);

      // 第一页（同时拿到后端 total，决定还要拉几页）
      const t0 = performance.now();
      const first = await R().parse(await window.ToolApi.fetchPublishDataList(requestPayload, {
        signal: controller.signal,
      }));
      if (!isCurrentQuery()) return;

      // 本次结果是否来自本地代理的宽松回放（旧录制数据，未必属于当前查询条件）
      const replayLoose = !!first.loose;

      let all = first.rows;
      const backendTotal = first.total;
      const failedPages = [];

      // 拉取剩余页：共用 fetchPages（worker 池 + 按页码有序合并，不会再边拉边 concat）。
      // 页数封顶 MAX_FETCH_PAGES：宽条件下一味按 total 扇出会把页面拖死。
      if (all.length > 0 && backendTotal > all.length) {
        const pageCount = M().pageCount(backendTotal, FETCH_SIZE, MAX_FETCH_PAGES);
        const pageCountTotal = Math.ceil(backendTotal / FETCH_SIZE);
        if (pageCountTotal > pageCount) {
          ctx.showToast(`⚠️ 结果较多，只取了前 ${pageCount} 页（约 ${pageCount * FETCH_SIZE} 条）用于排序与筛选；`
            + `需要完整数据请把条件再收窄一些`, 6000, 'warn');
        }

        const pages = M().pageNumbers(pageCount, 2);

        const { byPage, failed } = await fetchPages({
          baseBody,
          pages,
          signal: controller.signal,
          isCurrent: isCurrentQuery,
        });
        if (!isCurrentQuery()) return;
        failedPages.push(...failed);
        failedPages.sort((a, b) => a - b);   // 失败页码按升序，提示语顺序稳定

        // 按页码顺序拼接（第 1 页在前面），去重前的完整原始行
        const fetchedRaw = new Map();
        fetchedRaw.set(1, first.rows);
        byPage.forEach((rows, p) => fetchedRaw.set(p, rows));
        all = M().flattenPages(M().pageNumbers(pageCount), fetchedRaw);

        // 记录可重试上下文：失败时只需重拉 failedPages 这几页，再按页码顺序拼回全量。
        queryState = {
          baseBody,
          FETCH_SIZE,
          localConds,
          firstData: first.data,
          pageCount,
          fetchedRaw,
          failedPages: [...failedPages],
        };
      }

      const elapsed = Math.round(performance.now() - t0);
      if (!isCurrentQuery()) return;

      // 去重（个别后端忽略 pageNum 时会重复返回同一批）
      const deduped = M().dedupeByKey(all, M().rowKey);
      const droppedDup = all.length - deduped.length;

      // 前端兜底过滤：后端不认的字段在这里补一刀
      ctx.debugLog(`🔍 [DEBUG] 后端返回总行数: ${all.length}（去重后 ${deduped.length}）`);
      const records = M().applyLocalFilters(deduped, localConds);
      const dropped = deduped.length - records.length;
      ctx.debugLog('🔍 [DEBUG] 过滤后行数:', records.length, '过滤掉:', dropped);

      // 空数据处理
      if (!records.length) {
        // 宽松回放时数据来自旧录制，跟当前筛选对不上是必然结果，
        // 这时提示「不满足筛选条件」会误导用户去调筛选条件，要单独说明。
        const hint = M().emptyHint({ replayLoose, dropped, droppedDup });
        const incompleteHint = failedPages.length
          ? `（第 ${failedPages.join('、')} 页获取失败，结果不完整）`
          : '';
        ctx.showToast('📭 ' + hint + incompleteHint, 3000, failedPages.length ? 'warn' : 'info');
        V().renderEmptyResult(hint);
        state.totalItems = 0;
        state.rawRows = [];
        state.displayedRows = [];
        state.filteredRows = [];
        refreshRetryBar();          // 结果集为空但仍有分页失败 → 仍给出重试入口
        V().updateCacheReplayBar(false);
        ctx.hideLoading();
        return;
      }

      // 全量数据存盘：订阅筛选 / 翻页都在本地对全量进行
      state.totalItems = records.length;
      state.rawRows = records;
      state.displayedRows = records;

      ctx.debugLog(`查询完成: 全量 ${records.length} 条 (${elapsed}ms, 去重 ${droppedDup})`);

      // 顺手用结果里的 deptId + deptName 兜底填充部门下拉
      ctx.fillDeptListFromRows(records);

      V().updateStats({ ...first.data, rows: records, total: records.length }, ctx.checkSubscribeStatus);
      V().updateCacheReplayBar(replayLoose);

      state.pageNum = 1;
      V().applySubscribeFilter(state, ctx.checkSubscribeStatus);   // 内部按 currentFilter 过滤全量并渲染当前页 + 分页

      if (dropped > 0) {
        ctx.showToast(M().droppedFilterHint(localConds, dropped), 4000, 'info');
      }

      // 成功提示（仅在数据量较大时显示）
      if (failedPages.length) {
        ctx.showToast(`⚠️ 查询完成但结果不完整：第 ${failedPages.join('、')} 页获取失败，当前 ${state.totalItems} 条`, 5000, 'warn');
      } else if (state.totalItems > 100) {
        ctx.showToast(`✅ 查询成功: 共 ${state.totalItems} 条数据`, 2000, 'success');
      }

      refreshRetryBar();   // 有失败分页则展示重试入口；无则隐藏

    } catch (err) {
      if (err?.name === 'AbortError' || controller.signal.aborted || !isCurrentQuery()) return;
      console.error('查询失败:', err);
      const errorMsg = R().parseApiError(
        err.response || { status: 0, headers: {} },
        err
      );
      ctx.showToast(`❌ ${errorMsg}`, 5000, 'error');
      // 失败时表格、分页条、统计面板、结果计数要一起复位：
      // 只清表格的话，屏幕上会是「错误提示 + 上一次的统计数字」，看起来像数据没变。
      V().renderQueryError(err);
      // 常驻失败条：toast 5 秒就没了，原因必须留在页面上（另两页早就有，本页 2026-09-21 补）。
      // 传 errorMsg（parseApiError 已翻译的话）而不是原始 err：发布页这条链路抛出的
      // 对象里没有后端 msg，shortError 只能压出「HTTP 500」这种没人看得懂的东西。
      if (ctx.showQueryFail) ctx.showQueryFail(errorMsg);
    } finally {
      if (currentQuery === querySeq) {
        activeQueryController = null;
        ctx.hideLoading();
      }
    }
  }

  /**
   * 作废在途查询 + 清掉重试上下文（重置表单用）。
   * 页面的 hideLoading / 结果区复位由调用方随后自己处理。
   */
  function cancel() {
    querySeq++;
    if (activeQueryController) {
      activeQueryController.abort();
      activeQueryController = null;
    }
    queryState = null;
  }

  /**
   * init(ctx) —— 页面注入的上下文：
   *   state                  可变页面状态对象
   *                          { currentFilter, displayedRows, filteredRows,
   *                            pageNum, pageSize, totalItems, rawRows }
   *   retryBtn               「重试失败分页」按钮元素（读/写 disabled + textContent）
   *   checkSubscribeStatus   (code) => 'subscribed' | 'unsubscribed' | 'unknown'
   *   collectApiBody()       收集要发给后端的请求体
   *   collectLocalFilters()  收集前端兜底过滤条件
   *   resolveBatchLabel()    {value,label,ok} —— 解析不出 label 时阻断查询
   *   getDeptValue()         当前选中的部门值（仅调试日志用）
   *   getProviderValue()     提供方系统当前值（instance 或原生 input）
   *   getBatchValue()        批次当前值（instance 或原生 select）
   *   confirm({title,message,okText}) => Promise<boolean>
   *                          「没限定批次」时的二次确认（页面用 DialogUtils.confirmBox 注入）；
   *                          返回 false 则这次查询直接放弃（2026-09-21 起系统/批次都非必选）
   *   fillDeptListFromRows(rows)       用结果兜底填充部门下拉
   *   showToast(msg, ms, type) / showLoading() / hideLoading() / debugLog(...)
   */
  function init(c) {
    ctx = c;
  }

  window.PublishQuery = Object.freeze({
    init,
    fetchPages,
    doQuery,
    retryFailedPages,
    exportCsv,
    /** 作废在途查询 + 清重试上下文（重置表单） */
    cancel,
    /** 当前是否存在失败分页（重试条是否可见） */
    hasFailedPages: () => !!(queryState && queryState.failedPages.length),
  });
})();
