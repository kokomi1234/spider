/**
 * 接口明细弹窗（发布查询页结果行的「接口明细」）
 *
 * ── 它做什么 ──────────────────────────────────────────────
 * 一次请求拿回 5 张表，用 5 个 tab 呈现：
 *   请求报文 / 响应报文 / 文档级修订记录 / 接口级修订记录 / 应用系统服务部署
 * 接口 POST /itamp-tool/intfcMgmt/serviceChildList（body { dataId, sysServeNo }），
 * 走 js/api/tool-api.js 的 fetchServiceChildList；表结构 / 列定义 / 排序 / 分页
 * 全在 js/ui/publish-dialog-model.js（纯逻辑，可单测），本文件只管 DOM。
 *
 * ── 两个取值口径（用户 2026-09-21 拍板）──────────────────
 * · dataId   = 发布行的 publishId（抓包里它与另一次请求的 publishId 是同一个 UUID）
 * · sysServeNo = 发布行的 sysServeNo 原值
 *
 * ⚠️ **sysServeNo 的形态未证实** —— 抓包里收到的是 `E00306MG0001-queryPreviousTransaction`
 *   （带短横线 + 方法名），而发布列表 35 行真实数据的 sysServeNo 全是纯编号（`E00301TO1200`）。
 *   两边形态不一致，且那份 HAR 里没有发布列表请求、无法对照 → 详见
 *   `js/api/tool-api.js` 的 `fetchServiceChildList` 注释（含怎么一次抓包定案）。
 *   形态若错，表现是**整表为空或拿到别的服务的数据，且不报错**。
 *
 * ── 与页面状态的关系 ──────────────────────────────────────
 * 只读入参：open(row) 拿到的发布行。**不碰查询 / 筛选 / 分页 / 订阅的任何状态**，
 * 关掉弹窗页面上的一切都还在原地（与 detail-dialog.js 同一约定）。
 *
 * ── 对外 ──────────────────────────────────────────────────
 *   window.IntfDetailDialog.open(row)   // row = 发布数据行
 *   window.IntfDetailDialog.close()
 *   window.IntfDetailDialog.isOpen()
 */
(function () {
  'use strict';

  /** 明细表格每页条数（客户端分页；后端一次返回全部 5 张表）。 */
  const PAGE_SIZE = 10;

  const $ = (sel) => document.querySelector(sel);

  // esc 调用时才取 window.Fmt（顶层捕获会在 format.js 排后时永久退化）。
  // 兜底必须真转义，字符集与 Fmt.esc 一致。
  const esc = (v) => ((window.Fmt && window.Fmt.esc) || ((x) => String(x ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')))(v);

  // 依赖一律延迟取（module-order.test.js 钉的就是这件事）
  const mdl = () => window.PublishDialogModel;
  const tableUtils = () => window.TableUtils;

  let row = null;              // 本次打开的服务行
  let tabKey = 'req';          // 当前 tab（默认「请求报文」）
  let rowsByTab = {};          // 解析好的 5 张表 { req: [], resp: [], ... }
  let pageByTab = {};          // 每个 tab 各自的页码（切回来还停在原页）
  // 取数阶段：空态文案要跟着它走 —— 加载中显示「失败」文案就是在骗用户
  // （idle 打开前 / loading 加载中 / ok 已拿到 / fail 失败 / unconfigured 接口未配置）
  let phase = 'idle';
  let seq = 0;                 // 丢弃过期响应（上一次的明细比下一次慢返回）
  let returnFocus = null;      // 关闭后焦点还给谁
  let dragHandle = null;       // dialog-utils 的拖拽句柄（含 reset）
  let inited = false;

  // ── DOM ──────────────────────────────────────────────
  const overlay = () => $('#intfDetailOverlay');
  const dialog = () => $('#intfDetailDialog');

  function setStatus(state, msg) {
    const el = $('#intfDetailStatus');
    if (!el) return;
    el.className = 'detail-status' + (state ? ' is-' + state : '');
    el.textContent = msg || '';
    el.hidden = !state;
  }

  // ── 渲染：tab 条 ──────────────────────────────────────
  function renderTabs() {
    const wrap = $('#intfDetailTabs');
    const m = mdl();
    if (!wrap || !m) return;
    wrap.innerHTML = m.INTF_TABS.map((t) => {
      const on = t.key === tabKey;
      return `<button type="button" class="dlg-tab${on ? ' is-active' : ''}"`
        + ` role="tab" id="intfTab_${esc(t.key)}" data-tab="${esc(t.key)}"`
        + ` aria-selected="${on ? 'true' : 'false'}" aria-controls="intfDetailPanel"`
        + ` tabindex="${on ? '0' : '-1'}">${esc(t.label)}</button>`;
    }).join('');
    // 面板的可访问名跟着当前 tab 走（读屏念「请求报文，选项卡面板」）
    const panel = $('#intfDetailPanel');
    if (panel) panel.setAttribute('aria-labelledby', 'intfTab_' + tabKey);
  }

  // ── 渲染：表格 ────────────────────────────────────────
  function renderTable() {
    const m = mdl();
    const colsEl = $('#intfDetailCols');
    const thead = $('#intfDetailThead');
    const tbody = $('#intfDetailTbody');
    if (!m || !colsEl || !thead || !tbody) return;

    const tab = m.INTF_TABS.filter((t) => t.key === tabKey)[0];
    const cols = (tab && tab.cols) || [];
    const all = rowsByTab[tabKey] || [];
    const size = PAGE_SIZE;
    const tp = m.totalPages(all.length, size);
    const page = Math.min(pageByTab[tabKey] || 1, tp);
    pageByTab[tabKey] = page;
    const slice = m.pageSlice(all, page, size);

    // 列数与 th 数必须一致（项目踩过：数不对会静默挂不上拖拽把手、colspan 也错位）
    colsEl.innerHTML = `<col class="c-idx">`
      + cols.map((c) => `<col class="${esc(c.cls || '')}">`).join('');
    thead.innerHTML = `<tr><th scope="col" class="c-idx">序号</th>`
      + cols.map((c) => `<th scope="col" class="${esc(c.cls || '')}">${esc(c.label)}</th>`).join('')
      + '</tr>';

    if (!slice.length) {
      const et = (tableUtils() && tableUtils().EMPTY_TEXT) || {};
      const what = (tab && tab.label) || '数据';
      let hint;
      if (phase === 'loading') hint = '正在加载接口明细…';
      else if (phase === 'ok') hint = et.none ? et.none(what) : `没有匹配的${what}`;
      else hint = et.fail || '查询失败，请检查网络或稍后重试';
      tbody.innerHTML = `<tr><td colspan="${cols.length + 1}" class="empty-hint">${esc(hint)}</td></tr>`;
      updatePager();
      return;
    }

    tbody.innerHTML = slice.map((r, i) => {
      const idx = (page - 1) * size + i + 1;
      return `<tr><td class="c-idx">${idx}</td>`
        + cols.map((c) => {
          const raw = c.get ? c.get(r) : (r ? r[c.key] : '');
          const val = c.fmt ? c.fmt(raw) : raw;
          const text = m.blank(val);
          const title = c.cls && c.cls.indexOf('c-long') >= 0 ? ` title="${esc(text)}"` : '';
          return `<td class="${esc(c.cls || '')}"${title}>${esc(text)}</td>`;
        }).join('')
        + '</tr>';
    }).join('');

    updatePager();
  }

  // ── 渲染：分页条 ──────────────────────────────────────
  function updatePager() {
    const m = mdl();
    const nav = $('#intfDetailPager');
    if (!m || !nav) return;
    const all = rowsByTab[tabKey] || [];
    const tp = m.totalPages(all.length, PAGE_SIZE);
    const page = Math.min(pageByTab[tabKey] || 1, tp);
    // 只有一页时不显示分页条：弹窗里一条「第 1 / 1 页」纯属噪音
    if (!all.length || tp <= 1) {
      nav.style.display = 'none';
      return;
    }
    nav.style.display = '';

    const info = $('#intfPageInfo');
    if (info) info.textContent = `第 ${page} / ${tp} 页`;
    const atFirst = page <= 1;
    const atLast = page >= tp;
    const dis = (sel, v) => { const el = $(sel); if (el) el.disabled = v; };
    dis('#intfBtnFirst', atFirst);
    dis('#intfBtnPrev', atFirst);
    dis('#intfBtnNext', atLast);
    dis('#intfBtnLast', atLast);

    const nums = $('#intfPageNumbers');
    const tu = tableUtils();
    if (nums && tu && tu.buildPageNumbers) {
      // 页码按钮整体重建 —— 焦点若原本在页码条里，重建后要还给新的当前页按钮
      const active = document.activeElement;
      const hadFocus = !!(active && nums.contains && nums.contains(active));
      nums.innerHTML = tu.buildPageNumbers(tp, page);
      if (hadFocus) {
        const cur = nums.querySelector ? nums.querySelector('button.is-current') : null;
        if (cur && cur.focus) cur.focus();
      }
    }

    const jump = $('#intfPageJump');
    if (jump) {
      jump.max = String(tp);
      jump.value = String(page);
    }
  }

  function gotoPage(n) {
    const m = mdl();
    if (!m) return;
    const all = rowsByTab[tabKey] || [];
    const tp = m.totalPages(all.length, PAGE_SIZE);
    const p = Number(n);
    if (!(p >= 1 && p <= tp)) return;
    pageByTab[tabKey] = p;
    renderTable();
  }

  function switchTab(key) {
    if (!key || key === tabKey) return;
    tabKey = key;
    renderTabs();
    renderTable();
  }

  // ── 打开 / 关闭 ───────────────────────────────────────
  async function open(sourceRow) {
    const ov = overlay();
    if (!sourceRow || !ov) return;
    // 连点同一行的「接口明细」不该每次都重发请求（实测连点 3 次 = 3 条 serviceChildList，
    // 2026-09-22 复测 D-14）。弹窗已经开着、且是同一行 → 什么都不做（换行仍然重取）。
    if (ov.classList.contains('show') && row === sourceRow && phase !== 'fail') return;
    ensureInit();

    row = sourceRow;
    const mySeq = ++seq;
    phase = 'loading';
    rowsByTab = {};
    pageByTab = {};
    tabKey = 'req';

    returnFocus = document.activeElement;
    renderTabs();

    // 先摆出空表头 + 加载态，弹窗立刻可见（不要让用户对着白屏等接口）
    if (mdl()) {
      mdl().INTF_TABS.forEach((t) => { rowsByTab[t.key] = []; });
    }
    renderTable();
    setStatus('loading', '正在加载接口明细…');

    ov.classList.add('show');
    if (window.DialogUtils) {
      window.DialogUtils.lockScroll();
      if (!dragHandle && dialog()) {
        const head = $('#intfDetailHead');
        if (head) dragHandle = window.DialogUtils.makeDraggable(dialog(), head);
      }
    }
    const closeBtn = $('#btnIntfDetailCloseX');
    if (closeBtn) closeBtn.focus();

    // ── 取数 ──
    const dataId = row.publishId || row.id || '';
    const sysServeNo = row.sysServeNo || row.serviceNumber || '';
    const api = window.ToolApi;
    const res = api && typeof api.fetchServiceChildList === 'function'
      ? await api.fetchServiceChildList({ dataId, sysServeNo })
      : { ok: false, error: '接口层未就绪' };

    if (mySeq !== seq) return;   // 期间用户又点开了别的行，丢弃这次结果

    if (!res || !res.ok) {
      const Q = window.QueryFeedback;
      const detail = (Q && typeof Q.shortError === 'function')
        ? Q.shortError((res && res.error) || '') : '';
      phase = 'fail';
      setStatus('error', '接口明细加载失败：' + (detail || (res && res.error) || '请稍后重试'));
      renderTable();          // 表格转为「失败」空态
      return;
    }
    if (!res.lists) {
      // 接口未配置（缺抓包时不发请求）——如实说明，别显示成「没有数据」
      phase = 'unconfigured';
      setStatus('error', '接口明细接口未配置，暂时无法查看');
      renderTable();
      return;
    }

    phase = 'ok';
    rowsByTab = mdl().parseIntfDetail(res.lists);
    setStatus('');
    renderTabs();
    renderTable();
  }

  function close() {
    const ov = overlay();
    if (!ov) return;
    ov.classList.remove('show');
    // 顶层弹窗、里面不会再开子层 → 直接一次性解锁（与 js/ui/detail-dialog.js 同口径）。
    // 不要用 unlockScroll()：那是配对计数锁，重复 open()（连点两行）时计数会漂，
    // 漏减一次就整页滚不动 —— 表现为「关掉弹窗后页面卡死」。
    if (window.DialogUtils) window.DialogUtils.forceUnlockAll();
    if (dragHandle && dragHandle.reset) dragHandle.reset();
    setStatus('');
    // 作废在途请求：关窗后回来的响应不许再写 DOM（与操作记录弹窗同口径）
    seq += 1;
    row = null;
    phase = 'idle';
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
    const tabsEl = $('#intfDetailTabs');
    if (!ov) return;          // DOM 还没就绪：下次再试
    inited = true;

    // 关闭入口：底部「关 闭」、右上角 ✕
    document.addEventListener('click', (e) => {
      const id = e.target && e.target.id;
      if (id === 'btnIntfDetailClose' || id === 'btnIntfDetailCloseX') close();
    });
    // 点遮罩空白处关闭（统一实现见 dialog-utils.js：它还会挡掉
    // 「在弹窗里按下、把指针滑到遮罩上松开」被误判成点遮罩的情况）
    if (window.DialogUtils) window.DialogUtils.bindBackdropDismiss(ov, close);

    // tab 切换：整体重建 → 事件委托
    if (tabsEl) {
      tabsEl.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-tab]');
        if (b) switchTab(b.dataset.tab);
      });
      // 键盘：← → 切页签，Home/End 跳首尾（WAI-ARIA tablist 的标准交互），
      // 焦点跟着选中项走，读屏才读得出「哪个页签被选中了」
      tabsEl.addEventListener('keydown', (e) => {
        const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
        if (keys.indexOf(e.key) < 0) return;
        const m = mdl();
        if (!m) return;
        const list = m.INTF_TABS;
        const cur = list.findIndex((t) => t.key === tabKey);
        let next = cur;
        if (e.key === 'ArrowLeft') next = (cur - 1 + list.length) % list.length;
        if (e.key === 'ArrowRight') next = (cur + 1) % list.length;
        if (e.key === 'Home') next = 0;
        if (e.key === 'End') next = list.length - 1;
        if (next === cur) return;
        e.preventDefault();
        switchTab(list[next].key);
        const btn = $('#intfTab_' + list[next].key);
        if (btn) btn.focus();
      });
    }

    // 分页：页码条每次重建 → 委托；其余按钮固定
    const nums = $('#intfPageNumbers');
    if (nums) nums.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-page]');
      if (b) gotoPage(Number(b.dataset.page));
    });
    const bind = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };
    bind('#intfBtnFirst', () => gotoPage(1));
    bind('#intfBtnPrev', () => gotoPage((pageByTab[tabKey] || 1) - 1));
    bind('#intfBtnNext', () => gotoPage((pageByTab[tabKey] || 1) + 1));
    bind('#intfBtnLast', () => {
      const all = rowsByTab[tabKey] || [];
      if (mdl()) gotoPage(mdl().totalPages(all.length, PAGE_SIZE));
    });
    const jump = $('#intfPageJump');
    if (jump) jump.addEventListener('change', (e) => {
      const n = Number(e.target.value);
      const all = rowsByTab[tabKey] || [];
      const tp = mdl() ? mdl().totalPages(all.length, PAGE_SIZE) : 1;
      if (n >= 1 && n <= tp) gotoPage(n);
      else e.target.value = String(pageByTab[tabKey] || 1);
    });

    // Esc 关闭（页面里其它弹窗同款；只在打开时接管）
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) close();
    });
  }

  window.IntfDetailDialog = { open, close, isOpen };
})();
