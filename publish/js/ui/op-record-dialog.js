/**
 * 操作记录弹窗（发布查询页结果行的「操作记录」）
 *
 * ── 它做什么 ──────────────────────────────────────────────
 * 列出这条发布记录的操作流水：谁、什么时候、做了什么类型的操作、
 * 调用方组件/应用系统名称、调用方应用系统服务编号。
 * 接口 POST /itamp-tool/operation/getOperationRecordList
 *   body { operationType, pageNum, pageSize, publishId }（**服务端分页**）
 * 走 js/api/tool-api.js 的 fetchOperationRecordList（早就配好了，本轮只是接上界面）。
 *
 * ── 两个口径（用户 2026-09-21 拍板）──────────────────────
 * · publishId = 发布行的 publishId（缺失时退到 id）
 * · operationType 是**数字编码**：50 条映射写在 publish-dialog-model.js 的 OP_TYPES 里
 *   （唯一来源）—— 37 条出自用户抓包实证的编码表，13 条按名称总表的位置反推
 *   （表里逐条带 `// 推断` 注释，不是实证）；没覆盖的编码**原样显示数字**，不猜中文
 *   （筛选下拉同理，只列编码表里的项 —— 编码填错会让筛选静默查错数据）。
 *
 * ── 对外 ──────────────────────────────────────────────────
 *   window.OpRecordDialog.open(row)   // row = 发布数据行
 *   window.OpRecordDialog.close()
 *   window.OpRecordDialog.isOpen()
 */
(function () {
  'use strict';

  /** 每页条数：与接口默认一致（抓包请求体里就是 pageSize:10） */
  const PAGE_SIZE = 10;

  const $ = (sel) => document.querySelector(sel);

  const esc = (v) => ((window.Fmt && window.Fmt.esc) || ((x) => String(x ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')))(v);

  const mdl = () => window.PublishDialogModel;
  const tableUtils = () => window.TableUtils;

  let publishId = '';          // 本次打开查的是哪条发布记录
  let pageNum = 1;
  let total = 0;
  let rows = [];               // 当前页行（后端分页，前端只存这一页）
  let phase = 'idle';          // idle / loading / ok / fail
  let seq = 0;                 // 丢弃过期响应
  let returnFocus = null;
  let dragHandle = null;
  let typeSel = null;          // 操作类型下拉的 searchable-select 实例（挂一次，之后复用）
  let inited = false;

  const overlay = () => $('#opRecordOverlay');
  const dialog = () => $('#opRecordDialog');

  function setStatus(state, msg) {
    const el = $('#opRecordStatus');
    if (!el) return;
    el.className = 'detail-status' + (state ? ' is-' + state : '');
    el.textContent = msg || '';
    el.hidden = !state;
  }

  /**
   * 挂上操作类型下拉。选项来自模型的 OP_TYPES —— 只有一处定义。
   *
   * 为什么走 createSearchableSelect 而不是原生 <select>：
   * 「弹窗下拉看起来像原生」只能换组件、不能改样式 —— 展开后的面板是系统原生渲染、
   * CSS 碰不到（本项目 2026-09-08 定的规矩）。宿主 <select> 会被组件隐藏并接管，
   * 所以这里读值一律走 typeSel.getValue()，别再读 sel.value。
   *
   * ⚠️ createSearchableSelect **不幂等**（每调一次就往父节点插一套容器），
   * 所以只在第一次打开时挂一次；后续开窗只 setValue/clear，绝不重复调用。
   * 没有该组件时（脚本顺序坏了）静默降级成原生下拉，功能仍可用。
   */
  function mountTypeFilter() {
    const sel = $('#opTypeFilter');
    const m = mdl();
    if (!sel || !m) return;
    if (!typeSel && typeof window.createSearchableSelect === 'function') {
      typeSel = window.createSearchableSelect(sel, m.opTypeOptions(), { label: '操作类型' });
    }
    if (!typeSel) {
      // 降级路径：原生下拉也要有选项，否则用户看到一个空的框
      sel.innerHTML = m.opTypeOptions().map((o) =>
        `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
    }
  }

  /** 当前选中的操作类型编码（没选中 = 空串 = 「全部」） */
  function currentOperationType() {
    const sel = $('#opTypeFilter');
    return (typeSel ? typeSel.getValue() : (sel ? sel.value : '')) || '';
  }

  /** 把筛选置回「全部」：组件上是 clear()（**静默**，不会触发 change 再查一次） */
  function clearTypeFilter() {
    const sel = $('#opTypeFilter');
    if (typeSel) typeSel.clear();
    else if (sel) sel.value = '';
  }

  /** 渲染表头（列定义在模型里，与操作记录响应字段一一对应） */
  function renderHead() {
    const m = mdl();
    const colsEl = $('#opRecordCols');
    const thead = $('#opRecordThead');
    if (!m || !colsEl || !thead) return;
    const cols = m.OP_COLS;
    colsEl.innerHTML = `<col class="c-idx">`
      + cols.map((c) => `<col class="${esc(c.cls || '')}">`).join('');
    thead.innerHTML = `<tr><th scope="col" class="c-idx">序号</th>`
      + cols.map((c) => `<th scope="col" class="${esc(c.cls || '')}">${esc(c.label)}</th>`).join('')
      + '</tr>';
  }

  function renderBody() {
    const m = mdl();
    const tbody = $('#opRecordTbody');
    if (!m || !tbody) return;
    const cols = m.OP_COLS;

    if (!rows.length) {
      const et = (tableUtils() && tableUtils().EMPTY_TEXT) || {};
      let hint;
      if (phase === 'loading') hint = '正在加载操作记录…';
      else if (phase === 'ok') hint = et.none ? et.none('操作记录') : '没有匹配的操作记录';
      else hint = et.fail || '查询失败，请检查网络或稍后重试';
      tbody.innerHTML = `<tr><td colspan="${cols.length + 1}" class="empty-hint">${esc(hint)}</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map((r, i) => {
      const idx = (pageNum - 1) * PAGE_SIZE + i + 1;
      return `<tr><td class="c-idx">${idx}</td>`
        + cols.map((c) => {
          const raw = r ? r[c.key] : '';
          const val = c.fmt ? c.fmt(raw) : raw;
          const text = m.blank(val);
          const title = c.cls && c.cls.indexOf('c-long') >= 0 ? ` title="${esc(text)}"` : '';
          return `<td class="${esc(c.cls || '')}"${title}>${esc(text)}</td>`;
        }).join('')
        + '</tr>';
    }).join('');
  }

  function updateCount() {
    const el = $('#opRecordCount');
    if (!el) return;
    el.textContent = phase === 'ok' ? `共 ${total} 条` : '';
  }

  function updatePager() {
    const m = mdl();
    const nav = $('#opRecordPager');
    if (!m || !nav) return;
    const tp = m.totalPages(total, PAGE_SIZE);
    // 只有一页时不显示分页条（弹窗里一条「第 1 / 1 页」纯属噪音）
    if (phase !== 'ok' || !total || tp <= 1) {
      nav.style.display = 'none';
      return;
    }
    nav.style.display = '';

    const info = $('#opRecordPageInfo');
    if (info) info.textContent = `第 ${pageNum} / ${tp} 页`;
    const atFirst = pageNum <= 1;
    const atLast = pageNum >= tp;
    const dis = (sel, v) => { const el = $(sel); if (el) el.disabled = v; };
    dis('#opBtnFirst', atFirst);
    dis('#opBtnPrev', atFirst);
    dis('#opBtnNext', atLast);
    dis('#opBtnLast', atLast);

    const nums = $('#opRecordPageNumbers');
    const tu = tableUtils();
    if (nums && tu && tu.buildPageNumbers) {
      const active = document.activeElement;
      const hadFocus = !!(active && nums.contains && nums.contains(active));
      nums.innerHTML = tu.buildPageNumbers(tp, pageNum);
      if (hadFocus) {
        const cur = nums.querySelector ? nums.querySelector('button.is-current') : null;
        if (cur && cur.focus) cur.focus();
      }
    }

    const jump = $('#opRecordPageJump');
    if (jump) {
      jump.max = String(tp);
      jump.value = String(pageNum);
    }
  }

  function renderAll() {
    renderBody();
    updateCount();
    updatePager();
  }

  // ── 取数 ─────────────────────────────────────────────
  /**
   * 拉一页数据。
   * @param {number} page 目标页码（服务端分页：pageNum/pageSize 变化时重新请求）
   */
  async function load(page) {
    const api = window.ToolApi;
    const mySeq = ++seq;
    pageNum = Math.max(1, Number(page) || 1);
    phase = 'loading';
    rows = [];
    setStatus('loading', '正在加载操作记录…');
    renderAll();

    const operationType = currentOperationType();
    const res = api && typeof api.fetchOperationRecordList === 'function'
      ? await api.fetchOperationRecordList({
        operationType: operationType,
        pageNum: pageNum,
        pageSize: PAGE_SIZE,
        publishId: publishId,
      })
      : { ok: false, error: '接口层未就绪' };

    if (mySeq !== seq) return;    // 期间用户换了条件 / 翻了页，丢弃这次结果

    if (!res || !res.ok) {
      const Q = window.QueryFeedback;
      const detail = (Q && typeof Q.shortError === 'function')
        ? Q.shortError((res && res.error) || '') : '';
      phase = 'fail';
      setStatus('error', '操作记录加载失败：' + (detail || (res && res.error) || '请稍后重试'));
      renderAll();
      return;
    }

    phase = 'ok';
    rows = res.rows || [];
    total = Number(res.total) || rows.length;
    setStatus('');
    renderAll();
  }

  // ── 打开 / 关闭 ──────────────────────────────────────
  function open(sourceRow) {
    const ov = overlay();
    if (!sourceRow || !ov) return;
    ensureInit();

    publishId = sourceRow.publishId || sourceRow.id || '';
    returnFocus = document.activeElement;

    mountTypeFilter();
    clearTypeFilter();            // 打开时按「全部」查（与原始页面的初始行为一致）
    renderHead();

    ov.classList.add('show');
    if (window.DialogUtils) {
      window.DialogUtils.lockScroll();
      if (!dragHandle && dialog()) {
        const head = $('#opRecordHead');
        if (head) dragHandle = window.DialogUtils.makeDraggable(dialog(), head);
      }
    }
    const closeBtn = $('#btnOpRecordCloseX');
    if (closeBtn) closeBtn.focus();

    load(1);
  }

  function close() {
    const ov = overlay();
    if (!ov) return;
    ov.classList.remove('show');
    // 顶层弹窗、里面不会再开子层 → 直接一次性解锁（与 js/ui/detail-dialog.js 同口径）。
    // 不要用 unlockScroll()：配对计数锁在重复 open() 时会漂，漏减就整页滚不动。
    if (window.DialogUtils) window.DialogUtils.forceUnlockAll();
    if (dragHandle && dragHandle.reset) dragHandle.reset();
    setStatus('');
    seq += 1;                    // 作废在途请求，回来也不再写 DOM
    rows = [];
    total = 0;
    phase = 'idle';
    publishId = '';
    if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
    returnFocus = null;
  }

  function isOpen() {
    const ov = overlay();
    return !!(ov && ov.classList.contains('show'));
  }

  // ── 事件（只绑一次）───────────────────────────────────
  function ensureInit() {
    if (inited) return;
    const ov = overlay();
    if (!ov) return;             // DOM 还没就绪：下次再试
    inited = true;

    document.addEventListener('click', (e) => {
      const id = e.target && e.target.id;
      if (id === 'btnOpRecordClose' || id === 'btnOpRecordCloseX') close();
    });
    // 点遮罩空白处关闭（统一实现见 dialog-utils.js：它还会挡掉
    // 「在弹窗里按下、把指针滑到遮罩上松开」被误判成点遮罩的情况）
    if (window.DialogUtils) window.DialogUtils.bindBackdropDismiss(ov, close);

    // 查询 / 重置：都回到第 1 页重新请求（重置 = 清空操作类型）
    const q = $('#btnOpQuery');
    if (q) q.addEventListener('click', () => load(1));
    const r = $('#btnOpReset');
    if (r) r.addEventListener('click', () => {
      clearTypeFilter();
      load(1);
    });

    // 选了操作类型 → **立刻按新条件查一次**。
    //
    // 2026-09-21 改：原先是「只清掉旧结果，等用户再点『查 询』」，注释的理由是
    // 「这一栏有查询按钮，自动查会重复」。但实测的用户体验是反的 ——
    // 选完条件后界面变成「共 0 条 / 没有匹配的操作记录」，用户以为筛选坏了
    // （原话：「怎么选都是 0 条」），根本不会想到还要再点一次按钮。
    // 这一栏只有一个筛选字段，「选中即查」更符合直觉；「查 询」按钮保留，
    // 重复点最多多发一次同样的请求，无副作用。
    // searchable-select 在「选中」时会向宿主 <select> 派发冒泡 change，这条接得住；
    // clear() / setValue() 是静默的，所以程序化复位（打开弹窗、重置）不会误触发重查。
    const sel = $('#opTypeFilter');
    if (sel) sel.addEventListener('change', () => load(1));

    const nums = $('#opRecordPageNumbers');
    if (nums) nums.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-page]');
      if (b) load(Number(b.dataset.page));
    });
    const bind = (id, fn) => { const el = $('#' + id); if (el) el.addEventListener('click', fn); };
    bind('opBtnFirst', () => load(1));
    bind('opBtnPrev', () => load(pageNum - 1));
    bind('opBtnNext', () => load(pageNum + 1));
    bind('opBtnLast', () => load(mdl() ? mdl().totalPages(total, PAGE_SIZE) : 1));
    const jump = $('#opRecordPageJump');
    if (jump) jump.addEventListener('change', (e) => {
      const n = Number(e.target.value);
      const tp = mdl() ? mdl().totalPages(total, PAGE_SIZE) : 1;
      if (n >= 1 && n <= tp) load(n);
      else e.target.value = String(pageNum);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) close();
    });
  }

  window.OpRecordDialog = { open, close, isOpen };
})();
