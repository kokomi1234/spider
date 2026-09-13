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
  };

  let currentUser = null;
  let defaultDept = '';         // 牵头部门默认值（当前用户所在团队）
  let deptSelect = null;        // 牵头部门 searchable-select 实例
  let projectTypeSelect = null; // 项目分类 searchable-select 实例
  let reviewerRoleSelect = null;// 评委角色 searchable-select 实例（禁用，仅保持统一外观）
  let datePickers = {};         // id -> date-picker 实例
  let multiSelects = {};        // key -> multi-select 实例
  let loadingTimer = null;

  // ═══════════════════════════════════════════════════
  // 小工具
  // ═══════════════════════════════════════════════════

  // 公共实现见 js/ui/toast.js（三页共用）。
  // 注意：以前这里复用 loadingTimer 做 toast 定时器，会把「加载中」的定时器顶掉，已随统一实现修掉。
  const toast = window.toast || (() => {});
  // 公共实现见 js/core/format.js（三页共用，本地只留同名别名，调用点不用改）
  const esc = (window.Fmt && window.Fmt.esc) || ((v) => String(v ?? ''));
  const num = (window.Fmt && window.Fmt.num) || ((n) => String(n ?? '—'));

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

  function resetForm() {
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
  }

  // ═══════════════════════════════════════════════════
  // 查询 & 渲染
  // ═══════════════════════════════════════════════════

  async function query(pageNum) {
    if (!window.TaskApi) { toast('⚠️ 接口层未加载', 2500); return; }
    state.pageNum = pageNum || state.pageNum || 1;
    state.cond = collectCond();

    const btn = $('#btnQuery');
    if (btn) { btn.disabled = true; btn.textContent = '查询中…'; }

    try {
      const res = await window.TaskApi.fetchTaskList(state.cond, state.pageNum, state.pageSize);
      if (!res.ok) {
        toast(`⚠️ 查询失败：${res.error || '未知错误'}`, 3500);
        // 失败不清空已有结果，方便对照 / 重试
        if (!state.queried) renderEmpty('查询失败，请检查代理或网络');
        return;
      }
      state.total = res.total;
      state.rows = res.rows;
      state.queried = true;
      render();
      if (!res.rows.length) toast('查询完成，没有匹配的任务单', 2200);
    } catch (e) {
      toast('⚠️ 查询异常：' + (e && e.message ? e.message : e), 3500);
      console.error('[task] query 异常', e);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '查 询'; }
    }
  }

  function totalPages() {
    return Math.max(1, Math.ceil(state.total / state.pageSize));
  }

  function render() {
    renderTable();
    renderPagination();
    renderStats();
  }

  function renderEmpty(text) {
    $('#resultBody').innerHTML =
      `<tr><td colspan="13" class="empty-hint">${esc(text)}</td></tr>`;
    $('#pagination').style.display = 'none';
  }

  function renderTable() {
    const body = $('#resultBody');
    if (!state.rows.length) {
      body.innerHTML = '<tr><td colspan="13" class="empty-hint">没有匹配的任务单</td></tr>';
      return;
    }
    const start = (state.pageNum - 1) * state.pageSize;
    body.innerHTML = state.rows.map((r, i) => {
      const no = r.taskApplicationTaskNo || '';
      return `<tr data-index="${i}">
        <td class="col-index">${start + i + 1}</td>
        <td class="cell-no" title="${esc(no)}">${esc(no || '—')}</td>
        <td class="cell-name" title="${esc(r.taskApplicationTaskName || '')}">${esc(r.taskApplicationTaskName || '—')}</td>
        <td>${esc(r.taskApplicationTaskType ?? '—')}</td>
        <td title="${esc(r.leadDept || '')}">${esc(r.leadDept || '—')}</td>
        <td class="cell-demand" title="${esc(r.softCenterDemandNo || '')}">${esc(r.softCenterDemandNo || '—')}</td>
        <td class="cell-prod" title="${esc(r.leadProduct || '')}">${esc(r.leadProduct || '—')}</td>
        <td class="cell-rel" title="${esc(r.relationProducts || '')}">${esc(r.relationProducts || '—')}</td>
        <td>${esc(r.schedulingAgreeBatch || '—')}</td>
        <td>${esc(r.taskStateId ?? '—')}</td>
        <td>${esc(r.taskPerformStatue ?? '—')}</td>
        <td>${esc(shortDate(r.upUpSchAgreedPutProdDate))}</td>
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
      `共 ${num(state.total)} 条 · 本页 ${state.rows.length} 条`;
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

  // CSV 导出走 js/ui/csv-export.js 的 CsvExporter.downloadRows（含模块缺失保护）

  /**
   * 导出当前筛选条件的结果。
   * 服务端分页，所以按页循环拉取；上限 EXPORT_MAX 条，避免误导出 9 万条。
   */
  async function exportCsv() {
    if (!state.queried || !state.total) { toast('⚠️ 请先查询再导出', 2200); return; }
    const btn = $('#btnExportCsv');
    if (btn) { btn.disabled = true; btn.textContent = '导出中…'; }

    try {
      const want = Math.min(state.total, EXPORT_MAX);
      const out = [];
      for (let p = 1; out.length < want; p++) {
        const res = await window.TaskApi.fetchTaskList(state.cond, p, EXPORT_PAGE_SIZE);
        if (!res.ok) throw new Error(res.error || '未知错误');
        if (!res.rows.length) break;
        out.push(...res.rows);
      }
      const rows = out.slice(0, want);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      window.CsvExporter.downloadRows(rows, DETAIL_FIELDS, `任务单查询_${stamp}.csv`);
      toast(
        rows.length >= state.total
          ? `✅ 已导出 ${rows.length} 条`
          : `✅ 已导出前 ${rows.length} 条（共 ${state.total} 条，超出上限 ${EXPORT_MAX}）`,
        2600
      );
    } catch (e) {
      toast(`⚠️ 导出失败：${e.message || String(e)}`, 3000);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '导 出'; }
    }
  }

  // ═══════════════════════════════════════════════════
  // 初始化
  // ═══════════════════════════════════════════════════

  function bindEvents() {
    $('#btnQuery').addEventListener('click', () => query(1));
    $('#btnReset').addEventListener('click', resetForm);
    $('#btnExportCsv').addEventListener('click', exportCsv);

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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
