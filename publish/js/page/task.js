/**
 * 任务单查询子页面
 *
 * ── 数据来源 ────────────────────────────────────────────────
 * 全部接口来自抓包 `任务单查询.har`（见 task-api.js 头注释）。
 * 本文件只做三件事：收集筛选条件 → 调 TaskApi → 渲染表格 / 分页 / 详情。
 *
 * ── 关于枚举值 ──────────────────────────────────────────────
 * 任务类型 taskApplicationTaskType、任务状态 taskStateId、执行状态
 * taskPerformStatue 这三个字段在抓包里只有裸值（如 "3" / "1" / "11"），
 * 没有抓到对应字典接口，所以按项目铁律**不做映射、原样展示**，
 * 避免臆造出错误的中文含义。等拿到字典接口后在 DICT 里补一下即可。
 */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  /**
   * 错误串 → 一句人能读的话。
   * 接口层抛的是 `HTTP 500 {"code":500,"msg":"..."}` 这种，直接上屏用户既读不懂、
   * 也不知道下一步做什么；统一走全站唯一的 QueryFeedback.shortError（抽 msg / 截断），
   * 该模块缺失时退回朴素截断，不静默吞掉错误。
   */
  function errText(e) {
    const Q = window.QueryFeedback;
    if (Q && typeof Q.shortError === 'function') return Q.shortError(e);
    const s = String(e == null || e === '' ? '未知错误' : e);
    return s.length > 90 ? s.slice(0, 90) + '…' : s;
  }

  // ═══════════════════════════════════════════════════
  // 常量
  // ═══════════════════════════════════════════════════

  /** 详情弹窗字段顺序 + 中文名（key 与报文字段完全一致） */
  const DETAIL_FIELDS = [
    ['taskApplicationTaskNo',        '任务单编号'],
    ['taskApplicationTaskName',      '任务单名称'],
    ['taskSort',                     '任务序号'],
    ['taskApplicationTaskType',      '任务类型（原值）'],
    ['leadDept',                     '牵头部门'],
    ['softCenterDemandNo',           '软需编号'],
    ['demandName',                   '需求名称'],
    ['leadProduct',                  '牵头产品'],
    ['relationProducts',             '关联产品'],
    ['schedulingAgreeBatch',         '排期批次'],
    ['taskStateId',                  '任务状态（原值）'],
    ['taskPerformStatue',            '执行状态（原值）'],
    ['schAgreedTestVerDate',         '排期承诺测试版本日期'],
    ['schAgreedSubFormalVerDate',    '排期承诺投产后正式版本日期'],
    ['upSchAgreedSubFormalVerDate',  '更新后排期承诺投产后正式版本日期'],
    ['upUpSchAgreedPutProdDate',     '更新后排期承诺投产日期'],
    ['taskClassification',           '任务分类'],
    ['projectNum',                   '项目编号'],
    ['allWorkload',                  '总工作量'],
    ['lastUpdateDate',               '最后更新时间'],
    ['taskApplicationId',            '任务申请 ID'],
    ['subTaskApplicationId',         '子任务申请 ID'],
  ];


  const PAGE_SIZE = 10;   // 与抓包里的 pageSize 默认值一致
  const EXPORT_PAGE_SIZE = 500;
  const EXPORT_MAX = 5000;
  const EXPORT_BTN_TITLE = '导出当前筛选结果（全部，不限当前页）';
  // 进行中的导出：ctl 让「再点一次」能取消，progress 给 #resultCount 报数
  // （5000 条要串行拉 10 页，是页面里最长的一个动作，不能只有一个「导出中…」）
  let exportCtl = null;
  let exportProgress = null;

  // ═══════════════════════════════════════════════════
  // 状态
  // ═══════════════════════════════════════════════════

  let state = {
    pageNum: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    rows: [],
    cond: null,
    queried: false,
    reqSeq: 0,        // 请求序号：连点时旧响应直接丢弃（见 query()）
  };

  let lastOkPageNum = 1;        // 最近一次成功查询的页码：失败时把 state.pageNum 退回它，避免旧表格配新页码
  let currentUser = null;
  let defaultDept = '';         // 牵头部门默认值（当前用户所在团队）
  let deptSelect = null;        // 牵头部门 searchable-select 实例
  let projectTypeSelect = null; // 项目分类 searchable-select 实例
  let reviewerRoleSelect = null;// 评委角色 searchable-select 实例（禁用，仅保持统一外观）
  let datePickers = {};         // id -> date-picker 实例
  let multiSelects = {};        // key -> multi-select 实例

  // ═══════════════════════════════════════════════════
  // 小工具
  // ═══════════════════════════════════════════════════

  // 公共实现见 js/ui/toast.js（三页共用）。
  // 以下别名一律**调用时才取** window.*：顶层捕获会让本页「顺序敏感」——依赖的模块
  // 一旦排到本文件之后，提示 / 转义 / 数字格式化会永久退化成兜底实现，且不报错。
  const toast = (...a) => (window.toast || (() => {}))(...a);
  // 公共实现见 js/core/format.js（三页共用，本地只留同名别名，调用点不用改）。
  // 兜底**必须真转义**：原来写成 String(x ?? '')，等于零转义 ——
  // format.js 一旦没加载，全站 innerHTML 的 XSS 防护就静默失效了。字符集与 Fmt.esc 一致。
  const esc = (v) => ((window.Fmt && window.Fmt.esc) || ((x) => String(x ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')))(v);
  const num = (v) => ((window.Fmt && window.Fmt.num) || ((x) => String(x ?? '—')))(v);

  // ── 加载态 / 查询失败提示：实现统一在 js/ui/query-feedback.js（三页共用）──
  // 本页原先查询期间只把按钮文字改成「查询中…」，长查询时看起来像卡死、容易被反复点击；
  // 失败也只有 3.5s 就消失的 toast，用户错过之后会把「查询失败」误读成「确实没有数据」。
  // 本地只留薄别名，把 state.queried 传进去；调用点不用改。
  const QF = () => window.QueryFeedback || { setLoading() {}, showQueryFail() {}, showFailText() {}, hideFail() {}, shortError: String };
  const setLoading = (on) => QF().setLoading(on);
  const showQueryFail = (reason) => QF().showQueryFail(reason, state.queried);
  const hideQueryFail = () => QF().hideFail();

  /** 去掉时间戳尾部的 00:00:00，只留日期 */
  function shortDate(v) {
    const s = String(v ?? '').trim();
    if (!s) return '—';
    return s.length > 10 ? s.slice(0, 10) : s;
  }

  // ═══════════════════════════════════════════════════
  // 多选控件（排期批次 / 任务分类）
  // searchable-select.js 只支持单选，报文里这两个字段是数组，
  // 所以走 js/ui/multi-select.js 的 .msel 轻量多选（样式在 theme.css）。
  // ═══════════════════════════════════════════════════

  function createMultiSelect(host, options, placeholder) {
    if (typeof window.createMultiSelect === 'function') {
      return window.createMultiSelect(host, options, placeholder);
    }
    // 组件没加载时退化成「什么都不选」，不让页面白屏
    console.warn('[task] multi-select.js 未加载，多选筛选不可用');
    return { setOptions() {}, getValues() { return []; }, clear() {} };
  }

  // ═══════════════════════════════════════════════════
  // 筛选条件
  // ═══════════════════════════════════════════════════

  function collectCond() {
    const val = (id) => { const el = $(id); return el ? String(el.value || '').trim() : ''; };
    return {
      taskApplicationTaskNo:   val('#t_taskNo'),
      taskApplicationTaskName: val('#t_taskName'),
      softCenterDemandNo:      val('#t_demandNo'),
      leadDept:                deptSelect ? String(deptSelect.getValue() || '').trim() : val('#t_leadDept'),
      leadProduct:             val('#t_leadProduct'),
      relationProducts:        val('#t_relationProducts'),
      schedulingAgreeBatchList: multiSelects.batch ? multiSelects.batch.getValues() : [],
      taskClassifyList:         multiSelects.classify ? multiSelects.classify.getValues() : [],
      projectType:             projectTypeSelect ? String(projectTypeSelect.getValue() || '').trim() : val('#t_projectType'),
      funcTestDateStart:       datePickers.funcTestStart ? datePickers.funcTestStart.getValue() : '',
      funcTestDateEnd:         datePickers.funcTestEnd ? datePickers.funcTestEnd.getValue() : '',
      startArchiveDate:        datePickers.archiveStart ? datePickers.archiveStart.getValue() : '',
      endArchiveDate:          datePickers.archiveEnd ? datePickers.archiveEnd.getValue() : '',
      taskApplicationTaskType: val('#t_taskType'),
      taskPerformStatue:       val('#t_taskPerformStatue'),
      tieVersion:              val('#t_tieVersion'),
      belongYear:              val('#t_belongYear'),
      projectNo:               val('#t_projectNo'),
      projectName:             val('#t_projectName'),
      projLeadDept:            val('#t_projLeadDept'),
      prodPracDeptName:        val('#t_prodPracDeptName'),
      reviewerRole:            reviewerRoleSelect ? String(reviewerRoleSelect.getValue() || '').trim() : val('#t_reviewerRole'),
    };
  }

  /**
   * 重置：清空筛选 + 结果回到初始空态 + 提示。
   *
   * 原来只清控件、**结果原样留着**，也没有任何提示 —— 与首页「重置」的表现完全不同：
   * 首页会清空结果、回到初始空态并 toast，这里按了像「没反应」，用户会把上一轮结果
   * 当成本次查询的结果读。三页统一为「清空筛选 + 初始空态 + toast」（清单 C7）。
   */
  function resetForm() {
    state.reqSeq += 1;                 // 作废在途查询：回来时不再往已清空的界面回写
    setLoading(false);
    ['#t_taskNo', '#t_taskName', '#t_demandNo', '#t_leadProduct', '#t_relationProducts',
     '#t_taskType', '#t_taskPerformStatue', '#t_tieVersion', '#t_belongYear',
     '#t_projectNo', '#t_projectName', '#t_projLeadDept', '#t_prodPracDeptName']
      .forEach((id) => { const el = $(id); if (el) el.value = ''; });
    if (reviewerRoleSelect) reviewerRoleSelect.clear();
    else { const role = $('#t_reviewerRole'); if (role) role.value = ''; }
    if (projectTypeSelect) projectTypeSelect.clear();
    else { const ptype = $('#t_projectType'); if (ptype) ptype.value = ''; }
    if (deptSelect) deptSelect.clear();
    Object.values(multiSelects).forEach((m) => m.clear());
    Object.values(datePickers).forEach((p) => { if (p && p.clear) p.clear(); });
    // 牵头部门恢复成当前用户所在团队，跟抓包里的默认筛选一致
    if (deptSelect && defaultDept) deptSelect.setValue(defaultDept);

    // 结果 / 统计 / 分页一并回到初始空态
    hideQueryFail();
    state.queried = false;
    state.pageNum = 1;
    lastOkPageNum = 1;
    state.total = 0;
    state.rows = [];
    state.cond = null;
    renderEmpty(emptyText('initial', null, '请输入条件后点击「查询」'));
    renderPagination();                // queried=false → 隐藏分页条
    renderStats();                     // queried=false → 隐藏统计行
    const rc = $('#resultCount'); if (rc) rc.textContent = '';
    toast('筛选条件已重置', 1500, 'info');
  }

  // ═══════════════════════════════════════════════════
  // 查询 & 渲染
  // ═══════════════════════════════════════════════════

  async function query(pageNum) {
    if (!window.TaskApi) { toast('⚠️ 接口层未加载', 2500); return; }
    state.pageNum = pageNum || state.pageNum || 1;
    state.cond = collectCond();

    // 请求序号：快速连点查询 / 翻页时，先发的慢响应不能让它在后到之后覆盖新结果，
    // 否则屏幕上是「A 条件的数据 + B 条件的页码」。（与 subscription 页同一套写法）
    const seq = ++state.reqSeq;

    const btn = $('#btnQuery');
    if (btn) { btn.disabled = true; btn.textContent = '查询中…'; }
    setLoading(true);

    try {
      const res = await window.TaskApi.fetchTaskList(state.cond, state.pageNum, state.pageSize);
      if (seq !== state.reqSeq) return;          // 已被更新的请求取代，整段丢弃
      if (!res.ok) {
        toast(`⚠️ 查询失败：${errText(res.error)}，请稍后重试`, 4000);
        showQueryFail(res.error || '未知错误');    // toast 会消失，常驻条不会
        // 失败不清空已有结果，方便对照 / 重试；但所有「页码 / 条数」显示都要退回上一次成功的状态，
        // 否则旧表格会配着一个已经前进过的页码，看起来像「查到了但没变化」。
        if (state.queried) {
          state.pageNum = lastOkPageNum;
          renderPagination();
          renderStats();
        } else {
          renderEmpty(emptyText('fail', null, '查询失败，请检查网络或稍后重试'));
        }
        return;
      }
      state.total = res.total;
      state.rows = res.rows;
      state.queried = true;
      lastOkPageNum = state.pageNum;
      hideQueryFail();
      render();
      if (!res.rows.length) toast('查询完成，没有匹配的任务单', 2200);
    } catch (e) {
      if (seq !== state.reqSeq) return;
      toast(`⚠️ 查询异常：${errText(e)}，请稍后重试`, 4000);
      showQueryFail(e && e.message ? e.message : e);
      console.error('[task] query 异常', e);
    } finally {
      // 只有最新那次请求有权恢复按钮状态，否则连点时按钮会提前解禁
      if (seq === state.reqSeq) {
        setLoading(false);
        if (btn) { btn.disabled = false; btn.textContent = '查 询'; }
      }
    }
  }

    function totalPages() {
      return window.TableUtils.totalPages(state.total, state.pageSize);
    }

  function render() {
    renderTable();
    renderPagination();
    renderStats();
    // 任务单页是服务端分页：翻页靠重新 query，表格在 .tbl-scroll 里。
    // 不复位纵向滚动的话，从表格中下部点「下一页」，新页会停在中下部、前几行看不到。
    if (window.TableUtils && window.TableUtils.resetTableScroll) window.TableUtils.resetTableScroll();
  }

    // colspan 13 = 任务单表格列数；空状态与分页条显隐统一走 TableUtils
    function renderEmpty(text) {
      window.TableUtils.renderEmpty(text, 13);
    }

    /**
     * 空态文案统一走 js/ui/table-utils.js 的 EMPTY_TEXT（延迟取，避免脚本顺序敏感）。
     * 本页此前自己写「没有匹配的任务单」等字面量，虽与模板一致，但两处各写会慢慢分叉。
     */
    function emptyText(kind, what, fallback) {
      const et = (window.TableUtils && window.TableUtils.EMPTY_TEXT) || null;
      const v = et ? et[kind] : null;
      if (v == null) return fallback || '';
      return typeof v === 'function' ? v(what) : v;
    }

  function renderTable() {
    // 空结果走 renderEmpty（会隐藏 #pagination），与上面 renderEmpty 的声明意图一致
    if (!state.rows.length) {
      renderEmpty(emptyText('none', '任务单', '没有匹配的任务单'));
      return;
    }
    const body = $('#resultBody');
    // 有数据了：收起宽表空态浮层，否则它会盖在数据行上
    window.TableUtils.hideEmptyOverlay();
    const start = (state.pageNum - 1) * state.pageSize;
    body.innerHTML = state.rows.map((r, i) => {
      const no = r.taskApplicationTaskNo || '';
      return `<tr data-index="${i}">
        <td class="col-index">${start + i + 1}</td>
        <td class="cell-no" title="${esc(no)}">${esc(no || '—')}</td>
        <td class="cell-name" title="${esc(r.taskApplicationTaskName || '')}">${esc(r.taskApplicationTaskName || '—')}</td>
        <td title="${esc(r.taskApplicationTaskType ?? '')}">${esc(r.taskApplicationTaskType ?? '—')}</td>
        <td title="${esc(r.leadDept || '')}">${esc(r.leadDept || '—')}</td>
        <td class="cell-demand" title="${esc(r.softCenterDemandNo || '')}">${esc(r.softCenterDemandNo || '—')}</td>
        <td class="cell-prod" title="${esc(r.leadProduct || '')}">${esc(r.leadProduct || '—')}</td>
        <td class="cell-rel" title="${esc(r.relationProducts || '')}">${esc(r.relationProducts || '—')}</td>
        <td title="${esc(r.schedulingAgreeBatch || '')}">${esc(r.schedulingAgreeBatch || '—')}</td>
        <td title="${esc(r.taskStateId ?? '')}">${esc(r.taskStateId ?? '—')}</td>
        <td title="${esc(r.taskPerformStatue ?? '')}">${esc(r.taskPerformStatue ?? '—')}</td>
        <td title="${esc(shortDate(r.upUpSchAgreedPutProdDate))}">${esc(shortDate(r.upUpSchAgreedPutProdDate))}</td>
        <td><button class="text-btn" data-detail="${i}" type="button">详情</button></td>
      </tr>`;
    }).join('');

    body.querySelectorAll('button[data-detail]').forEach((b) => {
      b.addEventListener('click', () => openDetail(Number(b.dataset.detail)));
    });
  }

  function renderPagination() {
    const pages = totalPages();
    const bar = $('#pagination');
    if (!state.queried || !state.total) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    $('#pageInfo').textContent = `第 ${state.pageNum} / ${pages} 页`;
    const jump = $('#pageJump');
    jump.max = String(pages);
    jump.value = String(state.pageNum);
    $('#btnFirst').disabled = state.pageNum <= 1;
    $('#btnPrev').disabled = state.pageNum <= 1;
    $('#btnNext').disabled = state.pageNum >= pages;
    $('#btnLast').disabled = state.pageNum >= pages;
  }

  function renderStats() {
    const row = $('#statsRow');
    if (!state.queried) { row.style.display = 'none'; return; }
    row.style.display = '';
    $('#statTotal').textContent = num(state.total);
    $('#statPage').textContent = `${state.pageNum} / ${totalPages()}`;
    const workload = state.rows.reduce((s, r) => s + (Number(r.allWorkload) || 0), 0);
    $('#statWorkload').textContent = num(Math.round(workload * 100) / 100);
    $('#statUser').textContent = currentUser
      ? `${currentUser.userName || '—'}${currentUser.teamName ? ' · ' + currentUser.teamName : ''}`
      : '—';
    $('#resultCount').textContent =
      `共 ${num(state.total)} 条 · 本页 ${state.rows.length} 条`
      + (exportProgress ? ` · 导出中 ${exportProgress.done}/${exportProgress.want} 条` : '');
  }

  // ═══════════════════════════════════════════════════
  // 详情弹窗
  // ═══════════════════════════════════════════════════

  function openDetail(index) {
    const row = state.rows[index];
    if (!row) return;
    $('#taskDetailTitle').textContent = row.taskApplicationTaskNo || '任务单详情';
    $('#taskDetailBody').innerHTML = DETAIL_FIELDS.map(([key, label]) => {
      const raw = row[key];
      const text = (key === 'allWorkload') ? num(raw) : (raw ?? '');
      return `<dt>${esc(label)}</dt><dd>${esc(text === '' ? '—' : text)}</dd>`;
    }).join('');
    const ov = $('#taskDetailOverlay');
    ov.classList.add('show');
    $('#taskDetailDialog').focus();
  }

  function closeDetail() {
    $('#taskDetailOverlay').classList.remove('show');
  }

  // 导出的两件工具都在 js/ui/csv-export.js：fetchAllPages（按页拉全 + 进度 + 取消）、download（写文件）

  /**
   * 导出当前筛选条件的结果。
   * 服务端分页，所以按页循环拉取；上限 EXPORT_MAX 条，避免误导出 9 万条。
   *
   * 5000 条 = 串行 10 次请求，是本页最长的一个动作，所以：
   *   · 进展写在 #resultCount 上（按钮文案换着显示会让按钮宽度跳，见 C 组文案那条教训）；
   *   · 按钮不置灰 —— 再点一次就是取消（AbortController 中断在途请求，不生成文件）。
   */
  async function exportCsv() {
    if (exportCtl) { exportCtl.abort(); return; }
    if (!state.queried || !state.total) { toast('⚠️ 请先查询再导出', 2200); return; }
    const E = window.CsvExporter;
    if (!E || typeof E.fetchAllPages !== 'function') { toast('⚠️ 导出模块未加载', 2600, 'error'); return; }
    if (!window.TaskApi || typeof window.TaskApi.fetchTaskList !== 'function') {
      toast('⚠️ 接口层未就绪，无法导出', 2600, 'error');
      return;
    }

    const btn = $('#btnExportCsv');
    // 初始文案从 HTML 取一次存下来：原来复位写死成「导 出」，与初始的「导出 CSV」不一致，
    // 导出过一次后按钮标签就永久变了（宽度也跳）
    if (btn) {
      if (!btn.dataset.label) btn.dataset.label = btn.textContent.trim();
      btn.textContent = '取消导出';
      btn.title = '点击取消本次导出（不会生成文件）';
    }
    exportCtl = (typeof window.AbortController === 'function') ? new window.AbortController() : null;
    const signal = exportCtl ? exportCtl.signal : null;
    // 进展写 #resultCount（本统计函数是 renderStats；订阅页那个同名函数是它自己的私有实现）
    const setProgress = (p) => { exportProgress = p; renderStats(); };

    try {
      setProgress({ done: 0, want: Math.min(state.total, EXPORT_MAX) });
      const r = await E.fetchAllPages(
        (p, size) => window.TaskApi.fetchTaskList(state.cond, p, size, { signal }),
        {
          total: state.total, pageSize: EXPORT_PAGE_SIZE, max: EXPORT_MAX,
          signal, onProgress: (pp) => setProgress({ done: pp.done, want: pp.want }),
        },
      );
      if (!r.ok) {
        if (r.aborted) toast('已取消导出，没有生成文件', 2400, 'warn');
        else toast(`⚠️ 导出失败：${r.error || '未知错误'}`, 3000, 'error');
        return;
      }
      // 文件名时间戳按业务时区取：toISOString() 是 UTC，北京时间 00:00~08:00 会落成前一天
      const stamp = (window.Fmt && typeof window.Fmt.stamp === 'function')
        ? window.Fmt.stamp()
        : new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      E.download(r.rows, DETAIL_FIELDS, `任务单查询_${stamp}.csv`);
      toast(
        r.rows.length >= state.total
          ? `✅ 已导出 ${r.rows.length} 条`
          : `✅ 已导出前 ${r.rows.length} 条（共 ${state.total} 条，超出上限 ${EXPORT_MAX}）`,
        2600, 'success'
      );
    } catch (e) {
      toast(`⚠️ 导出失败：${errText(e)}`, 3000, 'error');
    } finally {
      exportCtl = null;
      setProgress(null);
      if (btn) {
        btn.textContent = btn.dataset.label || '导出 CSV';
        btn.title = EXPORT_BTN_TITLE;
      }
    }
  }

  // ═══════════════════════════════════════════════════
  // 初始化
  // ═══════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════
  // 常用查询（保存到首页 / 从首页一键直达回填）
  // 存储层 window.SavedQuery 已在 saved-query.js 实现，本页只做「收集条件 → 存」和
  // 「启动读 ?saved= → 回填 → 自动查询」的胶水。所有 window.* 都在函数体内取，
  // 避免顶层捕获随脚本顺序变化静默降级（项目铁律 1）。
  // ═══════════════════════════════════════════════════

  // 筛选字段 id → 中文名（仅用于生成人类可读摘要；key 即表单元素 id，回填时按 id 找控件）
  const SAVED_LABELS = {
    t_taskNo: '任务单编号', t_taskName: '任务单名称', t_demandNo: '软需编号',
    t_leadDept: '牵头部门', t_leadProduct: '牵头产品', t_relationProducts: '关联产品',
    msel_batch: '排期批次', msel_classify: '任务分类', t_projectType: '项目分类',
    t_taskType: '任务类型', t_taskPerformStatue: '执行状态', t_tieVersion: '投产版本',
    t_belongYear: '所属年份', t_projectNo: '项目编号', t_projectName: '项目名称',
    t_projLeadDept: '项目牵头部门', t_prodPracDeptName: '生产实施部门', t_reviewerRole: '评委角色',
    t_funcTestStart: '功能测试日期', t_funcTestEnd: '功能测试日期',
    t_archiveStart: '归档日期', t_archiveEnd: '归档日期',
  };
  // 收集顺序：决定摘要里字段出现的先后
  const SAVED_ORDER = ['t_taskNo', 't_taskName', 't_demandNo', 't_leadDept', 't_leadProduct',
    't_relationProducts', 'msel_batch', 'msel_classify', 't_projectType', 't_taskType',
    't_taskPerformStatue', 't_tieVersion', 't_belongYear', 't_projectNo', 't_projectName',
    't_projLeadDept', 't_prodPracDeptName', 't_reviewerRole'];

  // 收集当前筛选条件（只收有值的，空值不存）。fields 用「表单元素 id」做 key，
  // 值与 SavedQuery 契约一致：string / string[]（多选）。控件分四类分别取值。
  function collectSavedFields() {
    const fields = {};
    // 1) 原生文本输入
    ['t_taskNo', 't_taskName', 't_demandNo', 't_leadProduct', 't_relationProducts',
      't_taskType', 't_taskPerformStatue', 't_tieVersion', 't_belongYear', 't_projectNo',
      't_projectName', 't_projLeadDept', 't_prodPracDeptName'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && String(el.value || '').trim() !== '') fields[id] = String(el.value).trim();
    });
    // 2) searchable-select 实例（牵头部门 / 项目分类 / 评委角色）
    const ss = { t_leadDept: deptSelect, t_projectType: projectTypeSelect, t_reviewerRole: reviewerRoleSelect };
    Object.keys(ss).forEach((id) => {
      const v = ss[id] ? String(ss[id].getValue() || '').trim() : '';
      if (v) fields[id] = v;
    });
    // 3) 多选控件（排期批次 / 任务分类）
    const ms = { msel_batch: multiSelects.batch, msel_classify: multiSelects.classify };
    Object.keys(ms).forEach((id) => {
      const arr = ms[id] && ms[id].getValues ? ms[id].getValues() : [];
      if (arr && arr.length) fields[id] = arr;
    });
    // 4) 日期选择器（功能测试日期 / 归档日期区间）
    const dp = { t_funcTestStart: datePickers.funcTestStart, t_funcTestEnd: datePickers.funcTestEnd,
      t_archiveStart: datePickers.archiveStart, t_archiveEnd: datePickers.archiveEnd };
    Object.keys(dp).forEach((id) => {
      const v = dp[id] && dp[id].getValue ? dp[id].getValue() : '';
      if (v) fields[id] = v;
    });
    return fields;
  }

  /**
   * 字段 id → **人类可读文本**：下拉取 label、多选取 labels。
   * 摘要是给首页卡片上的人看的，写「2611批次 / 需求」而不是内部编码；
   * 只有拿不到 label 时才回落到编号本身。
   */
  function collectSavedLabels(fields) {
    const labels = {};
    const ss = { t_leadDept: deptSelect, t_projectType: projectTypeSelect, t_reviewerRole: reviewerRoleSelect };
    Object.keys(ss).forEach((id) => {
      if (!fields[id]) return;
      const t = (ss[id] && typeof ss[id].getLabel === 'function')
        ? String(ss[id].getLabel() || '').trim() : '';
      if (t) labels[id] = t;
    });
    const ms = { msel_batch: multiSelects.batch, msel_classify: multiSelects.classify };
    Object.keys(ms).forEach((id) => {
      if (!fields[id]) return;
      const arr = (ms[id] && typeof ms[id].getLabels === 'function')
        ? ms[id].getLabels().filter(Boolean) : [];
      if (arr.length) labels[id] = arr.join('、');
    });
    return labels;
  }

  // 把 fields + labels 拼成一句人能读的摘要，例：「排期批次：2611批次 · 任务分类：需求」
  function buildSavedSummary(fields, labels) {
    const L = labels || {};
    const parts = [];
    // 日期区间合并成「起~止」一条，避免拆成起、止两条
    const range = (startKey, endKey, label) => {
      if (fields[startKey] || fields[endKey]) {
        parts.push(`${label}：${fields[startKey] || '*'}~${fields[endKey] || '*'}`);
      }
    };
    range('t_funcTestStart', 't_funcTestEnd', '功能测试日期');
    range('t_archiveStart', 't_archiveEnd', '归档日期');
    SAVED_ORDER.forEach((id) => {
      // 已合并的区间字段跳过
      if (id === 't_funcTestStart' || id === 't_funcTestEnd' || id === 't_archiveStart' || id === 't_archiveEnd') return;
      if (!fields[id]) return;
      const raw = Array.isArray(fields[id]) ? fields[id].join('、') : fields[id];
      parts.push(`${SAVED_LABELS[id]}：${L[id] || raw}`);
    });
    return parts.join(' · ');
  }

  // 点「⭐ 保存到首页」：收集 → 命名 → 存 → toast
  async function onSaveQuery() {
    const SQ = window.SavedQuery;
    if (!SQ) { toast('⚠️ 存储模块未加载', 2500); return; }
    const fields = collectSavedFields();
    if (!Object.keys(fields).length) {
      toast('⚠️ 请先填写至少一个筛选条件', 2500);
      return;
    }
    const summary = buildSavedSummary(fields, collectSavedLabels(fields));
    // 优先用统一的 DialogUtils.promptText（与全站弹窗同款）；缺失再退回原生 prompt
    let name = null;
    if (window.DialogUtils && typeof window.DialogUtils.promptText === 'function') {
      name = await window.DialogUtils.promptText({
        title: '保存到首页',
        label: '查询名称',
        placeholder: '给这组筛选条件起个名字',
        value: summary ? summary.slice(0, 30) : '',
        message: summary ? `将保存：${summary}` : '',
      });
    } else {
      name = window.prompt('给这组筛选条件起个名字（将保存到首页）：', summary ? summary.slice(0, 30) : '');
    }
    if (name == null) return;                 // 用户取消
    name = String(name).trim();
    if (!name) { toast('⚠️ 名称不能为空', 2000); return; }
    // 2026-09-20 架构改版：save 是 async 的（服务端优先）。这里必须 await——
    // 否则读到的是 Promise，res.ok 恒为 undefined → 弹「保存失败」但东西其实存进去了。
    const res = await SQ.save({ page: 'task', name, fields, summary, labels: collectSavedLabels(fields) });
    if (!res.ok) { toast('⚠️ 保存失败：' + (res.error || '未知错误'), 3000); return; }
    toast('已保存到首页' + (res.localOnly ? '（仅本机，连上共享库后会自动补上去）' : '')
      + (typeof SQ.syncSuffix === 'function' ? SQ.syncSuffix() : '')
      + (typeof SQ.ownerSuffix === 'function' ? SQ.ownerSuffix(res) : ''), 3200);
  }

  /**
   * 旧记录（2026-09-18 前保存）的摘要写的是编号。从首页打开时字典已加载，
   * 这里把 labels + 摘要重算回写一次，用户不必手动重新保存。
   */
  function upgradeSavedSummary(item, fields) {
    const SQ = window.SavedQuery;
    if (!SQ || !item || !fields) return;
    if ((item.v || 1) >= 2 && item.labels && Object.keys(item.labels).length) return;
    const labels = collectSavedLabels(fields);
    const summary = buildSavedSummary(fields, labels);
    if (!summary) return;
    SQ.update(item.id, { labels, summary, v: SQ.SCHEMA_VERSION || 2 });
  }

  // 启动恢复：仅当 URL 带 ?saved=<id> 时回填并自动查询。
  // 必须挂在 loadDicts() 之后：下拉/多选的选项要等接口返回建好，否则 setValue 选中的项
  // 不在选项里会静默失效（searchable-select 找不到该 value 的 opt，multi-select 同理）。
  async function restoreSavedQuery() {
    const SQ = window.SavedQuery;
    if (!SQ) return;
    const id = new URLSearchParams(location.search).get('saved');
    if (!id) return;
    // 2026-09-21：getAsync —— 镜像（只含「我的」）没命中就去服务端按 id 捞。
    // 部门常用查询的卡片多半是**同事**存的，不在本机镜像里：同步 SQ.get(id)
    // 会静默拿不到 → 不回填 → 页面照常跑默认查询（有概率 = 点到自己的查询则成功）。
    const item = await SQ.getAsync(id);
    if (!item || !item.fields) return;
    const f = item.fields;
    // 1) 原生文本输入
    ['t_taskNo', 't_taskName', 't_demandNo', 't_leadProduct', 't_relationProducts',
      't_taskType', 't_taskPerformStatue', 't_tieVersion', 't_belongYear', 't_projectNo',
      't_projectName', 't_projLeadDept', 't_prodPracDeptName'].forEach((idp) => {
      if (f[idp] != null) { const el = document.getElementById(idp); if (el) el.value = String(f[idp]); }
    });
    // 2) searchable-select 实例：直接 setValue
    const ss = { t_leadDept: deptSelect, t_projectType: projectTypeSelect, t_reviewerRole: reviewerRoleSelect };
    Object.keys(ss).forEach((idp) => {
      if (f[idp] != null && ss[idp]) ss[idp].setValue(String(f[idp]));
    });
    // 3) 多选控件：setValue(string[])（multi-select 已支持，会自动把缺失值补进选项）
    const ms = { msel_batch: multiSelects.batch, msel_classify: multiSelects.classify };
    Object.keys(ms).forEach((idp) => {
      if (f[idp] != null && ms[idp] && Array.isArray(f[idp])) ms[idp].setValue(f[idp]);
    });
    // 4) 日期选择器：setValue(字符串)
    const dp = { t_funcTestStart: datePickers.funcTestStart, t_funcTestEnd: datePickers.funcTestEnd,
      t_archiveStart: datePickers.archiveStart, t_archiveEnd: datePickers.archiveEnd };
    Object.keys(dp).forEach((idp) => {
      if (f[idp] != null && dp[idp]) dp[idp].setValue(String(f[idp]));
    });
    // 旧记录（摘要里是编号）趁字典已加载重算回写一次，点一次卡片就自动修好
    upgradeSavedSummary(item, f);
    toast(`已载入常用查询：${item.name}`, 2000);
    // 回填完成后复用页面查询入口，自动执行一次查询
    await query(1);
  }

  function bindEvents() {
    $('#btnQuery').addEventListener('click', () => query(1));
    $('#btnReset').addEventListener('click', resetForm);
    $('#btnExportCsv').addEventListener('click', exportCsv);
    // 常用查询：把当前筛选条件保存到首页
    const saveBtn = $('#btnSaveQuery');
    if (saveBtn) saveBtn.addEventListener('click', onSaveQuery);
    // 失败常驻条上的「重试」：重跑当前页码（首次失败时 pageNum 仍为 1）
    const retryBtn = $('#btnRetryQuery');
    if (retryBtn) retryBtn.addEventListener('click', () => query(state.pageNum || 1));

    // 筛选区里按回车直接查询（与首页 / 订阅页同一套手感）。
    // 原来 task 页完全没有这条处理：数据录入型用户填完条件按回车只会空等。
    // 自带键盘行为的控件必须先排除 —— 它们的 Enter 是「展开面板 / 选中选项」，
    // 而且只 preventDefault、不 stopPropagation，不排除就会在展开面板的同时顺带查一次。
    const filterCard = $('#filterCard');
    if (filterCard) {
      filterCard.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
        const el = e.target;
        if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'SELECT')) return;
        if (el.type === 'checkbox' || el.type === 'number' || el.type === 'radio') return;
        if (el.closest('.dp-wrapper, .searchable-select, .msel')) return;
        e.preventDefault();
        query(1);
      });
    }

    // 筛选卡片折叠
    const card = $('#filterCard');
    $('#filterToggle').addEventListener('click', () => {
      card.classList.toggle('collapsed');
    });

    // 更多筛选项
    $('#moreToggle').addEventListener('click', () => {
      const body = $('#moreBody');
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      $('#moreToggle').style.transform = open ? 'rotate(-90deg)' : '';
    });

    // 分页
    $('#btnFirst').addEventListener('click', () => query(1));
    $('#btnPrev').addEventListener('click', () => query(Math.max(1, state.pageNum - 1)));
    $('#btnNext').addEventListener('click', () => query(Math.min(totalPages(), state.pageNum + 1)));
    $('#btnLast').addEventListener('click', () => query(totalPages()));
    $('#pageJump').addEventListener('change', (e) => {
      const n = Number(e.target.value);
      if (n >= 1 && n <= totalPages()) query(n);
      else e.target.value = String(state.pageNum);
    });

    // 详情弹窗
    $('#btnTaskDetailClose').addEventListener('click', closeDetail);
    // 右上角 ✕（与订阅页详情弹窗同款），关的是同一个弹窗
    const taskDetailCloseX = $('#btnTaskDetailCloseX');
    if (taskDetailCloseX) taskDetailCloseX.addEventListener('click', closeDetail);
    $('#taskDetailOverlay').addEventListener('click', (e) => {
      if (e.target === $('#taskDetailOverlay')) closeDetail();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('#taskDetailOverlay').classList.contains('show')) closeDetail();
    });
  }

  function buildDatePickers() {
    const ids = ['#t_funcTestStart', '#t_funcTestEnd', '#t_archiveStart', '#t_archiveEnd'];
    const keys = ['funcTestStart', 'funcTestEnd', 'archiveStart', 'archiveEnd'];
    if (typeof window.createDatePicker !== 'function') {
      // 组件没加载就退化成手写输入，保证可用
      ids.forEach((id) => { const el = $(id); if (el) { el.readOnly = false; el.placeholder = 'YYYY-MM-DD'; } });
      return;
    }
    ids.forEach((id, i) => {
      const el = $(id);
      if (el) datePickers[keys[i]] = window.createDatePicker(el, {});
    });
  }

  async function loadDicts() {
    const api = window.TaskApi;
    if (!api) return;

    // 五个字典互不依赖，并发拉取
    const [u, d, b, c, p] = await Promise.all([
      api.fetchUserInfo(),
      api.fetchDeptList(),
      api.fetchBatchNameList(),
      api.fetchTaskCategoryList(),
      api.fetchParamList('项目分类', '', 20),
    ]);

    // ── 牵头部门 ──
    // 抓包里的 taskFormSelectList 使用 getUserInfo.teamName（完整名称），
    // 而 selectDeptList 的对应项是简称。查询请求必须保留抓包里的完整 teamName。
    let deptList = d.ok ? d.list : [];
    if (d.error) console.warn('[task] 部门列表加载失败:', d.error);

    if (u.ok && u.user) {
      currentUser = u.user;
      defaultDept = currentUser.teamName || '';
      // 完整 teamName 不在部门接口简称列表时，作为额外选项加入搜索下拉。
      if (defaultDept && !deptList.some((x) => x.deptName === defaultDept)) {
        deptList = [{ deptId: currentUser.teamId || '', deptName: defaultDept, deptNo: currentUser.teamId || '' }, ...deptList];
      }
    } else if (u.error) {
      console.warn('[task] 获取用户信息失败:', u.error);
    }

    if (deptSelect) {
      deptSelect.updateOptions(deptList.map((x) => ({ value: x.deptName, label: x.deptName })));
      if (defaultDept) deptSelect.setValue(defaultDept);
    } else {
      const sel = $('#t_leadDept');
      if (sel) {
        sel.innerHTML = '<option value="">全部</option>' +
          deptList.map((x) => `<option value="${esc(x.deptName)}">${esc(x.deptName)}</option>`).join('');
      }
    }

    // ── 排期批次 ──
    if (b.ok) {
      multiSelects.batch.setOptions(b.list.map((v) => ({ value: v, label: v })));
    } else if (b.error) {
      console.warn('[task] 批次列表加载失败:', b.error);
    }

    // ── 任务分类 ──
    if (c.ok) {
      multiSelects.classify.setOptions(c.list);
    } else if (c.error) {
      console.warn('[task] 任务分类加载失败:', c.error);
    }

    // ── 项目分类（系统参数）──
    const sel = $('#t_projectType');
    const projectOptions = p.ok
      ? [{ value: '', label: '全部' }, ...p.list.map((x) => ({ value: x.value, label: x.paramName }))]
      : [{ value: '', label: '全部' }];
    if (projectTypeSelect) {
      projectTypeSelect.updateOptions(projectOptions);
    } else if (sel) {
      sel.innerHTML = projectOptions
        .map((x) => `<option value="${esc(x.value)}">${esc(x.label)}</option>`).join('');
    }
    if (p.error) console.warn('[task] 项目分类加载失败:', p.error);

    renderStats();
  }

  async function boot() {
    bindEvents();
    buildDatePickers();

    // 多选控件先建好（选项异步回填）
    multiSelects.batch = createMultiSelect($('#msel_batch'), [], '全部批次');
    multiSelects.classify = createMultiSelect($('#msel_classify'), [], '全部分类');

    // 牵头部门、项目分类、评委角色统一走 searchable-select；
    // 后两者即使是小字典也不留原生 popup，保持和服务发布页一致。
    if (typeof window.createSearchableSelect === 'function') {
      deptSelect = window.createSearchableSelect($('#t_leadDept'), [], {});
      projectTypeSelect = window.createSearchableSelect($('#t_projectType'), [], {});
      reviewerRoleSelect = window.createSearchableSelect(
        $('#t_reviewerRole'),
        [
          { value: '', label: '全部' },
          { value: '产品负责人', label: '产品负责人' },
          { value: '服务方产品负责人', label: '服务方产品负责人' },
        ],
        { disabled: true }
      );
      reviewerRoleSelect.setValue('');
    }

    await loadDicts();

    // 常用查询恢复：必须等 loadDicts() 之后，下拉/多选选项才建好，setValue 才不丢值
    await restoreSavedQuery();

    // 首屏就是空态：显示宽表空态浮层并对齐到表头下沿。
    // （静态 HTML 里浮层是 hidden 的 —— 表头高度要等布局完成才测得准，先不显示。）
    if (window.TableUtils && window.TableUtils.syncEmptyOverlay) window.TableUtils.syncEmptyOverlay();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
