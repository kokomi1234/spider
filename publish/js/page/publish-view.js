/* ============================================================
  服务发布数据查询 — 视图层
  ------------------------------------------------------------
  两层职责，都是「把数据搬到屏幕上」，不含业务编排（查询 / 去重 / 筛选规则）：

    1) HTML 字符串生成：输入数据 → HTML string 的纯函数
       （stateBadge / emptyRow / renderRows）
    2) DOM 更新：按 id 自己取元素，把 state + 数据写成页面状态
       （表格 / 分页 / 统计面板 / 提示条 / 空态）

  元素引用一律在**调用时**再 document.querySelector，不在 IIFE 顶部定死：
  本文件在 index.html 里先于 index.js 加载，DOM 那时还没解析完。

  约定（与项目其它模块一致）：浏览器 IIFE，挂 window.PublishView。
  依赖 window.PublishModel（同目录 publish-model.js，先于本文件加载）。
============================================================ */

(function () {
  'use strict';

  // 延迟取用转义函数：优先用 js/core/format.js 的 Fmt.esc，缺失时用下面的内置兜底。
  // 用函数包一层（而非在加载时定死），避免本文件早于 format.js 加载时报错。
  // 兜底**必须真转义**：原来写成 String(x ?? '')，等于零转义 ——
  // format.js 一旦没加载，全站 innerHTML 的 XSS 防护就静默失效了。字符集与 Fmt.esc 一致。
  const esc = (v) => ((window.Fmt && window.Fmt.esc) || ((x) => String(x ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')))(v);

  /** 结果表列数：thead 列数与空态 colspan 共用这一处口径 */
  const RESULT_COL_COUNT = 10;

  const $ = (sel) => document.querySelector(sel);
  /** 空态文案模板（js/ui/table-utils.js 的 EMPTY_TEXT），延迟取用 */
  const emptyText = () => (window.TableUtils && window.TableUtils.EMPTY_TEXT) || {};
  /** 总页数口径（js/ui/table-utils.js），延迟取用 */
  const totalPages = (total, size) => window.TableUtils.totalPages(total, size);

  // ── 1) HTML 字符串生成 ──────────────────────────────

  /** 状态徽章 HTML（状态→{cls,text} 映射在 PublishModel.stateBadgeInfo） */
  function stateBadge(val) {
    const m = window.PublishModel.stateBadgeInfo(val);
    return `<span class="badge ${m.cls}">${esc(m.text)}</span>`;
  }

  /**
   * 空态单行：<tr><td colspan=colCount class="empty-hint">text</td></tr>
   * text 由调用方决定是否转义（空态文案无用户数据，通常直接给文本）。
   * @param {number} colCount 列数（thead 列数与空态 colspan 共用口径）
   * @param {string} text 已处理好的展示文本
   */
  function emptyRow(colCount, text) {
    return `<tr><td colspan="${colCount}" class="empty-hint">${text}</td></tr>`;
  }

  /**
   * 渲染表格正文行（HTML 字符串，不写 DOM）。
   * @param {Array} rows 当前页行数据
   * @param {object} ctx { pageNum, pageSize, checkSubscribe }
   *        checkSubscribe(code) → 'subscribed' | 'unsubscribed' | 'unknown'
   */
  function renderRows(rows, ctx) {
    const pageNum = ctx.pageNum;
    const pageSize = ctx.pageSize;
    const checkSubscribe = ctx.checkSubscribe;
    const M = window.PublishModel;
    // 本次是不是"回落用管理员 token"（只有查询权限）。取一次给整轮渲染用 ——
    // 每行都去问一次既不必要，也可能在同一轮渲染里拿到不一致的值。
    // ⚠️ 只认 'fallback'：管理员本人也是用管理员 token，但他有全套权限，不能一起禁掉。
    const readOnlyToken = !!(window.API && typeof window.API.tokenSource === 'function'
      && window.API.tokenSource() === 'fallback');

    return (rows || []).map((r, i) => {
      const idx = (pageNum - 1) * pageSize + i + 1;

      const n = M.normalizeRow(r);
      const serverCoding  = n.serverCoding;
      const serviceName   = n.serviceName;
      const interfaceCode = n.interfaceCode;
      const compNum       = n.compNum;
      const codeAndInterface = n.codeAndInterface;
      const batch         = n.batch;
      const serviceStatus = n.serviceStatus;
      const deptName      = n.deptName;

      // 是否已核对
      const isChecked = M.isCheckedVal(r)
        ? '<span class="badge b-run">是</span>'
        : '<span class="badge b-off">否</span>';

      // 订阅标记列
      let subscribeMark = '—';
      let rowClass = '';
      if (serverCoding !== '—') {
        const status = checkSubscribe ? checkSubscribe(serverCoding) : 'unknown';
        if (status === 'subscribed') {
          subscribeMark = '<span class="badge b-run">✓ 已订阅</span>';
        } else {
          subscribeMark = '<span class="badge b-exp">✗ 未订阅</span>';
          rowClass = ' unsubscribed-row';
        }
      }

      // 详情取的是 filteredRows 里的下标，必须是「全量偏移 + 页内偏移」，
      // 用页内 i 会导致从第 2 页开始点详情看到的是别人家的数据
      const absIdx = M.absIndex(pageNum, pageSize, i);

      return `<tr class="${rowClass}" data-code="${esc(serverCoding)}">
        <td class="cell-index">${idx}</td>
        <td class="cell-code cell-wrap copy-cell" data-copy="${esc(codeAndInterface)}">
          <span class="cell-primary-code cell-clamp">${esc(serverCoding)}</span>
          ${interfaceCode && interfaceCode !== serverCoding
            // 两段编码各自都要 clamp：不套的话一个 709px 长的接口编码能折成七八行，把整行撑高
            ? `<span class="cell-secondary-code cell-clamp">接口：${esc(interfaceCode)}</span>`
            : ''}
        </td>
        <td class="cell-name cell-wrap copy-cell" data-copy="${esc(serviceName)}"><span class="cell-clamp">${esc(serviceName)}</span></td>
        <td class="cell-comp cell-wrap copy-cell" data-copy="${esc(compNum)}"><span class="cell-clamp">${esc(compNum)}</span></td>
        <td class="cell-batch cell-wrap copy-cell" data-copy="${esc(batch)}"><span class="cell-clamp">${esc(batch)}</span></td>
        <td class="cell-status">${stateBadge(serviceStatus)}</td>
        <td class="cell-check">${isChecked}</td>
        <td class="cell-dept cell-wrap copy-cell" data-copy="${esc(deptName)}"><span class="cell-clamp">${esc(deptName)}</span></td>
        <td class="cell-sub">${subscribeMark}</td>
        <td class="col-op">
          <div class="action-row">
            <button class="text-btn btn-xs" data-detail="${absIdx}">详情</button>
            <button class="text-btn btn-xs" data-intf="${absIdx}">接口明细</button>
            <button class="text-btn btn-xs" data-oprecord="${absIdx}">操作记录</button>
            ${checkSubscribe && checkSubscribe(serverCoding) === 'unsubscribed'
              // 订阅是写内网的操作；用管理员 token 时内网只给查询权限（2026-09-22 用户拍板），
              // 所以这里直接置灰并说明原因 —— 点击拦截在 publish.js 里还有一道（双保险）。
              ? (readOnlyToken
                ? `<button class="text-btn btn-xs btn-subscribe" data-sub="${absIdx}" disabled title="当前用的是管理员 token（只有查询权限）。在「🔑 Token」里录入你自己的 token 后可订阅">订阅</button>`
                : `<button class="text-btn btn-xs btn-subscribe" data-sub="${absIdx}">订阅</button>`)
              : ''}
          </div>
        </td>
      </tr>`;
    }).join('');
  }

  // ── 2) DOM 更新 ─────────────────────────────────────
  //
  // 约定：state = index.js 持有的可变状态对象
  //   { currentFilter, displayedRows, filteredRows, pageNum, pageSize, totalItems, rawRows }
  // checkSubscribe(code) → 'subscribed' | 'unsubscribed' | 'unknown'

  /** 统计面板 + 订阅统计（空列表时两条面板一起隐藏） */
  function updateStats(data, checkSubscribe) {
    const list = (data && data.rows) || [];
    const statsRow = $('#statsRow');
    const subscribeStats = $('#subscribeStats');
    if (!list.length) {
      statsRow.style.display = 'none';
      subscribeStats.style.display = 'none';
      return;
    }
    statsRow.style.display = '';
    $('#statTotal').textContent    = data.total ?? list.length;
    $('#statCompNum').textContent  = list[0]?.provideSystemNumber || list[0]?.assemblyName || '—';

    // 按状态分类计数（逻辑见 PublishModel.countByStatus）
    const c = window.PublishModel.countByStatus(list);
    $('#statPublished').textContent = c.published;
    $('#statPending').textContent   = c.pending;
    $('#statFailed').textContent    = c.failed;

    updateSubscribeStats(list, checkSubscribe);
  }

  function updateSubscribeStats(rows, checkSubscribe) {
    const subscribeStats = $('#subscribeStats');
    if (!rows.length) {
      subscribeStats.style.display = 'none';
      return;
    }

    const s = window.PublishModel.subscribeStats(rows, (code) => checkSubscribe(code) === 'subscribed');
    $('#subCountSubscribed').textContent = s.subscribed;
    $('#subCountUnsubscribed').textContent = s.unsubscribed;
    $('#subRate').textContent = s.rate + '%';

    subscribeStats.style.display = '';
  }

  /**
   * 只按 currentFilter 重建 filteredRows（导出 / 计数 / 分页都读它），
   * 不动 pageNum。订阅状态变化但筛选维度没变时用它：当前页仍在就留在原地，
   * 别把用户从正在看的那一页弹回第一页。
   */
  function rebuildFilteredRows(state, checkSubscribe) {
    if (state.currentFilter === 'all') {
      state.filteredRows = [...state.rawRows];
      return;
    }
    state.filteredRows = state.rawRows.filter((r) => {
      const status = checkSubscribe(r.serverCoding || r.sysServeNo);
      return state.currentFilter === 'subscribed'
        ? status === 'subscribed'
        : status === 'unsubscribed';
    });
  }

  /** 应用订阅筛选（作用在全量 rawRows 上，而非单页）：切筛选后回到第一页 */
  function applySubscribeFilter(state, checkSubscribe) {
    rebuildFilteredRows(state, checkSubscribe);
    state.pageNum = 1;
    renderCurrentPage(state, checkSubscribe);
  }

  /** 渲染当前页（对筛选后全量做客户端分页切分） */
  function renderCurrentPage(state, checkSubscribe) {
    const isFiltered = state.currentFilter !== 'all';
    const start = (state.pageNum - 1) * state.pageSize;
    const slice = state.filteredRows.slice(start, start + state.pageSize);
    renderTable(state, slice, isFiltered, checkSubscribe);
    updatePagination(state);
  }

  /** 渲染表格（含空态早退：计数 / 分页 / 统计要一起复位） */
  function renderTable(state, rows, isFiltered, checkSubscribe) {
    const resultBody = $('#resultBody');
    const resultCount = $('#resultCount');
    const pagination = $('#pagination');
    const statsRow = $('#statsRow');
    const subscribeStats = $('#subscribeStats');

    if (!rows.length) {
      // 文案走全站模板（js/ui/table-utils.js 的 EMPTY_TEXT），别再就地写字符串
      const et = emptyText();
      const hint = isFiltered
        ? (et.filtered ? et.filtered('服务') : '没有匹配的服务')
        : (et.none ? et.none('服务') : '暂无数据');
      resultBody.innerHTML = emptyRow(RESULT_COL_COUNT, hint);
      // 早退前必须把计数 / 分页 / 统计一起复位。
      // 否则从「全部 129 条」切到「已订阅（0 条）」时，计数仍显示旧值、
      // 分页器仍停在「第 1 / 3 页」，用户会以为筛选没生效。
      resultCount.textContent = isFiltered
        ? `筛选后 0 条（共 ${state.rawRows.length} 条）`
        : '';
      pagination.style.display = 'none';
      if (!isFiltered) {
        statsRow.style.display = 'none';
        subscribeStats.style.display = 'none';
      }
      return;
    }

    if (!isFiltered) {
      resultCount.textContent = `共 ${state.rawRows.length} 条`;
      pagination.style.display = '';
    } else {
      resultCount.textContent = `筛选后 ${state.filteredRows.length} 条（共 ${state.rawRows.length} 条）`;
    }

    resultBody.innerHTML = renderRows(rows, {
      pageNum: state.pageNum, pageSize: state.pageSize, checkSubscribe,
    });
    // 数据格「点击复制 + 键盘漫游」：与订阅页共用 js/ui/copy-cells.js。
    // 原来这几格靠 title 悬停才看得到全文（22 处之一），现在改成折行 + 可复制（2026-09-23）。
    if (window.CopyCells) window.CopyCells.bind(resultBody);
  }

  /** 分页控制（基于筛选后的全量，纯客户端切分） */
  /**
   * 分页条：页码按钮 + 首页/末页 + 跳页（与订阅页同款）。
   * 首页原来只有「上一页 / 下一页 / 第 X / Y 页」，翻到第 20 页要点 19 次（清单 A5）。
   *
   * 这里只负责**渲染**：点击交给 index.js 用事件委托接管 ——
   * 页码条每页都整体重建，逐个绑事件会重复绑定，也会把导航逻辑耦合进视图层。
   */
  function updatePagination(state) {
    const tp = totalPages(state.filteredRows.length, state.pageSize);
    $('#pageInfo').textContent = `第 ${state.pageNum} / ${tp} 页`;
    const atFirst = state.pageNum <= 1;
    const atLast = state.pageNum >= tp;
    const setDisabled = (sel, v) => { const el = $(sel); if (el) el.disabled = v; };
    setDisabled('#btnPrev', atFirst);
    setDisabled('#btnNext', atLast);
    setDisabled('#btnFirst', atFirst);
    setDisabled('#btnLast', atLast);

    // 页码条整体重建 —— 被点的那颗按钮会随 DOM 一起销毁。若焦点原本落在页码条里，
    // 重建后要主动还给新的当前页按钮，否则会掉回 <body>，键盘用户得从头 Tab（清单 A9）。
    const nums = $('#pageNumbers');
    if (nums && window.TableUtils && window.TableUtils.buildPageNumbers) {
      const active = (typeof document !== 'undefined' && document) ? document.activeElement : null;
      const hadFocus = !!(active && nums.contains && nums.contains(active));
      nums.innerHTML = window.TableUtils.buildPageNumbers(tp, state.pageNum);
      if (hadFocus) {
        const cur = nums.querySelector ? nums.querySelector('button.is-current') : null;
        if (cur && cur.focus) cur.focus();
      }
    }

    const jump = $('#pageJump');
    if (jump) {
      jump.max = String(tp);
      jump.value = String(state.pageNum);
    }
  }

  /** 失败分页重试条显隐 */
  function updateRetryBar(failedPages) {
    const bar = $('#retryBar');
    const pages = failedPages || [];
    if (!pages.length) {
      bar.style.display = 'none';
      return;
    }
    $('#retryText').textContent = `第 ${pages.join('、')} 页获取失败，当前结果不完整`;
    bar.style.display = '';
  }

  // ── 缓存回放告警条显隐 ──────────────────────────────
  // 本地代理精确匹配失败时会「宽松匹配」到同接口的旧录制数据。
  // 不提示的话，用户会以为查到的就是当前条件下的真实数据。
  function updateCacheReplayBar(loose) {
    const bar = $('#cacheReplayBar');
    if (!loose) {
      bar.style.display = 'none';
      return;
    }
    $('#cacheReplayText').textContent =
      '⚠️ 当前展示的是本地代理回放的旧录制数据（请求参数与录制时不一致），' +
      '仅供界面调试，数据不反映当前查询条件的真实结果。连内网重新请求一次即可刷新缓存。';
    bar.style.display = '';
  }

  /** 结果区：空结果（查询成功但 0 条，提示文案由调用方决定） */
  function renderEmptyResult(hint) {
    $('#resultBody').innerHTML = emptyRow(RESULT_COL_COUNT, hint);
    $('#statsRow').style.display = 'none';
    $('#subscribeStats').style.display = 'none';
    $('#pagination').style.display = 'none';
    $('#resultCount').textContent = '';
  }

  /** 结果区：查询失败 —— 表格 / 分页 / 统计 / 计数必须一起复位 */
  function renderQueryError(err) {
    const etFail = emptyText();
    // 原来把 err.message 原样以等宽字体追加在第二行，屏幕上是
    // `HTTP 404 {"code":404,...}` 或 `请求超时（20000ms 未响应）：/itamp-tool/...`，
    // 业务用户读不懂、也不知道下一步做什么。
    // 改成压缩过的后端 msg（走全站唯一实现，缺失时退化为不加技术细节）。
    const Q = window.QueryFeedback;
    const detail = (Q && typeof Q.shortError === 'function') ? Q.shortError(err && err.message) : '';
    $('#resultBody').innerHTML = `<tr><td colspan="${RESULT_COL_COUNT}" class="empty-hint">`
      + `${esc(etFail.fail || '查询失败，请检查网络或稍后重试')}`
      + (detail ? `<br><small style="color:var(--muted);">${esc(detail)}</small>` : '')
      + '</td></tr>';
    $('#pagination').style.display = 'none';
    $('#statsRow').style.display = 'none';
    $('#subscribeStats').style.display = 'none';
    $('#resultCount').textContent = '';
  }

  /** 结果区：初始态（还没查过 / 重置后）—— 统计面板一起复位 */
  function renderInitialResult() {
    const etInit = emptyText();
    $('#resultBody').innerHTML = `<tr><td colspan="${RESULT_COL_COUNT}" class="empty-hint">`
      + `${esc(etInit.initial || '请输入条件后点击「查询」')}</td></tr>`;
    $('#pagination').style.display = 'none';
    $('#resultCount').textContent = '';
    $('#statsRow').style.display = 'none';
    $('#subscribeStats').style.display = 'none';
  }

  /** 折叠面板：改成 <button> 后天然可 Tab 聚焦、回车/空格触发；这里同步 aria-expanded */
  function syncFilterToggle() {
    $('#filterToggle').setAttribute(
      'aria-expanded',
      String(!$('#filterCard').classList.contains('collapsed')),
    );
  }

  /** 更新已订阅面板按钮计数 */
  function updateSubscribePanelCount() {
    const count = window.SubscribeManager ? window.SubscribeManager.count() : 0;
    const btn = $('#btnSubscribePanel');
    if (btn) btn.textContent = `已订阅 (${count})`;
  }

  window.PublishView = Object.freeze({
    // HTML 字符串生成
    RESULT_COL_COUNT,
    stateBadge,
    emptyRow,
    renderRows,
    // DOM 更新
    updateStats,
    updateSubscribeStats,
    rebuildFilteredRows,
    applySubscribeFilter,
    renderCurrentPage,
    renderTable,
    updatePagination,
    updateRetryBar,
    updateCacheReplayBar,
    renderEmptyResult,
    renderQueryError,
    renderInitialResult,
    syncFilterToggle,
    updateSubscribePanelCount,
  });
})();
