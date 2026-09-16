/* ============================================================
  服务订阅关系查询页 — 视图层（HTML 字符串生成 + 表格渲染）
  ------------------------------------------------------------
  纯渲染函数（输入数据 → HTML string）走 window.SubscriptionModel 取常量与映射；
  需要转义时用延迟取用写法，避免模块加载顺序问题。

  带 DOM 写入的 renderTable / renderPagination 也放这里（它们只读入参、写 DOM），
  通过 opts / ctx 回调把「查 看跳转」「复制」「翻页」交回 subscription.js，
  本文件不持有任何页面状态（state / 事件绑定留在主文件）。

  约定（与项目其它模块一致）：浏览器 IIFE，挂 window.SubscriptionView。
  依赖 window.SubscriptionModel（同目录 subscription-model.js，先于本文件加载）。
============================================================ */

(function () {
  'use strict';

  // 延迟取用转义函数：优先用 js/core/format.js 的 Fmt.esc，缺失时退化到内置实现。
  // 用函数包一层（而非在加载时定死），避免本文件早于 format.js 加载时报错。
  const esc = (v) => ((window.Fmt && window.Fmt.esc) || ((x) => String(x ?? '')))(v);

  // 数字千分位 / 兜底（与订阅页内部 num 同口径）
  const num = (v) => ((window.Fmt && window.Fmt.num) || ((n) => String(n ?? '—')))(v);

  // ── 复制单元格的键盘漫游（清单 B9）────────────────────
  // 22 列 × 每页 10 行 = 220 个格子。若给每个 .copy-cell 都加 tabindex="0"，
  // 光穿过这张表就要按 220 次 Tab，比不能用还糟。所以用「漫游焦点」：
  // 整张表只占 1 个 Tab 停靠点，进去后方向键在格子间移动、Enter / 空格复制。
  // 状态存在模块里（同一时刻只有一张结果表），每次重建表格归零。

  /** 当前漫游到的格子下标 */
  let copyRoi = 0;

  function copyCells(bodyEl) {
    return Array.prototype.slice.call(bodyEl.querySelectorAll('td.copy-cell'));
  }

  /** 把 tabindex 与焦点样式只留给当前格，其余移出 Tab 顺序 */
  function paintCopyRoi(bodyEl, idx) {
    const list = copyCells(bodyEl);
    if (!list.length) return;
    copyRoi = Math.min(Math.max(0, idx), list.length - 1);
    list.forEach((td, i) => {
      const on = i === copyRoi;
      td.tabIndex = on ? 0 : -1;
      td.classList.toggle('is-copy-focus', on);
    });
  }

  /**
   * 装键盘漫游（只装一次；靠 dataset 标记防每次重渲染叠监听）。
   * 单元格每次都是新 DOM，所以「当前下标」与复制回调都从 tbody 上现取，
   * 不能在闭包里捕获旧的一批节点。
   * @param {HTMLElement} bodyEl tbody#resultBody
   */
  function bindCopyGridKeys(bodyEl) {
    if (!bodyEl || typeof bodyEl.addEventListener !== 'function') return;   // 不是真元素，跳过
    if (!bodyEl.dataset) bodyEl.dataset = {};
    if (bodyEl.dataset.copyKeysBound === '1') return;
    bodyEl.dataset.copyKeysBound = '1';
    bodyEl.addEventListener('keydown', (e) => {
      const cells = copyCells(bodyEl);
      if (!cells.length) return;
      const tgt = (e.target && e.target.closest) ? e.target.closest('td.copy-cell') : null;
      const cur = cells.indexOf(tgt);
      if (cur < 0) return;                       // 焦点不在可复制格里，交给别人处理

      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();                     // 别被外层的「回车即查询」接手
        const text = cells[cur].dataset.copy;
        if (text && typeof bodyEl.__copyHandler === 'function') bodyEl.__copyHandler(text);
        return;
      }
      const row = cells[cur].parentElement;
      const perRow = (row && row.querySelectorAll) ? row.querySelectorAll('td.copy-cell').length : 0;
      const stepMap = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: perRow, ArrowUp: -perRow };
      const step = stepMap[e.key];
      if (!step || !perRow) return;
      e.preventDefault();
      e.stopPropagation();

      const rowStart = Math.floor(cur / perRow) * perRow;
      const next = cur + step;
      // 左右不跨行（横向滚动位置不该被方向键打乱）、上下不越出整表
      if (step === 1 || step === -1) {
        if (next < rowStart || next >= rowStart + perRow) return;
      } else if (next < 0 || next >= cells.length) {
        return;
      }
      paintCopyRoi(bodyEl, next);
      if (typeof cells[next].focus === 'function') cells[next].focus();
    });
  }

  /** 基线状态标签：值 → 中文 + 色块 */
  function statusTag(v) {
    const s = String(v ?? '').trim();
    if (!s) return '<span class="st-tag is-offline">—</span>';
    const cls = (window.SubscriptionModel.STATUS_CLASS[s]) || 'is-offline';
    return `<span class="st-tag ${cls}">${esc(s)}</span>`;
  }

  /** 审核流程状态标签：裸值 → 中文 + 色块 */
  function reviewStatusTag(v) {
    const code = String(v ?? '').trim();
    if (!code) return '<span class="st-tag is-offline">—</span>';
    const info = window.SubscriptionModel.REVIEW_STATUS_MAP[code];
    if (!info) return `<span class="st-tag is-offline">${esc(code)}</span>`;
    return `<span class="st-tag ${info.cls}">${esc(info.text)}</span>`;
  }

  /** 优先级单元格：色块 + 天数，title 里写清「为什么」 */
  function prioCell(r) {
    const pp = window.SubscriptionModel.prioParts(r);
    const tagCls = `prio-tag is-${esc(pp.level)}${pp.near ? ' is-near' : ''}`;
    return `<td class="col-prio" title="${esc(pp.hint)}">
      <span class="${tagCls}">${esc(pp.text)}</span>
    </td>`;
  }

  /**
   * 渲染表格正文（写 DOM）。空态由调用方在调用前判断（空态 colspan 与 TableUtils 共用口径）。
   * @param {HTMLElement} bodyEl tbody 容器（#resultBody）
   * @param {Array} rows 当前页行数据（已按排序切好）
   * @param {object} opts { onJump(row), onCopy(text) }
   *        onJump(row)  → 结果行「查 看」跳转
   *        onCopy(text) → 单元格点击复制
   */
  function renderTable(bodyEl, rows, opts) {
    const M = window.SubscriptionModel;
    const onJump = opts && opts.onJump;
    const onCopy = opts && opts.onCopy;
    const COLUMNS = M.COLUMNS;
    const FIXED_COL_CLASS = M.FIXED_COL_CLASS;

    bodyEl.innerHTML = (rows || []).map((r, i) => {
      const overdue = r._prio && r._prio.overdue ? ' is-overdue' : '';
      const cells = COLUMNS.map(([k, , mono]) => {
        const raw = r[k];
        const text = (raw === null || raw === undefined || raw === '') ? '—' : String(raw);
        const copyAttr = `data-copy="${esc(String(raw ?? ''))}"`;
        const fixed = FIXED_COL_CLASS[k] ? FIXED_COL_CLASS[k] + ' ' : '';
        if (k === '_prioText') return prioCell(r);          // 自己带 col-prio
        if (k === 'status' || k === 'prodReviewStatus') {
          const tag = k === 'status' ? statusTag(raw) : reviewStatusTag(raw);
          return `<td class="${fixed}copy-cell" ${copyAttr} title="点击复制">${tag}</td>`;
        }
        // 数据格统一套一层 .cell-clamp：列宽不够时折到 2 行再省略，而不是一上来就截断。
        // 用内层 span 而不是给 td 加类，是因为 -webkit-line-clamp 会改 display，加在 td 上会毁掉表格布局。
        return `<td class="${fixed}cell-wrap ${mono ? 'cell-code ' : ''}copy-cell" ${copyAttr}`
          + ` title="点击复制: ${esc(text)}"><span class="cell-clamp">${esc(text)}</span></td>`;
      }).join('');
      return `<tr class="${overdue.trim()}" data-index="${i}">
        ${cells}
        <td class="col-op"><button class="text-btn" type="button" data-jump="${i}"
                title="在 ITAMP 服务搜索中查看该订阅关系（新窗口）">查 看</button></td>
      </tr>`;
    }).join('');

    // 结果行「查 看」：跳转 ITAMP 服务搜索（新窗口），直接拿这一行对象，不依赖数组下标
    bodyEl.querySelectorAll('button[data-jump]').forEach((b) => {
      b.addEventListener('click', () => { if (onJump) onJump(rows[Number(b.dataset.jump)]); });
    });
    // 表格数据单元格：点击复制到剪贴板
    bodyEl.querySelectorAll('td.copy-cell').forEach((td) => {
      td.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = td.dataset.copy;
        if (text && onCopy) onCopy(text);
      });
    });

    // 同一批单元格的键盘入口（清单 B9）：漫游焦点 + 方向键移动 + Enter 复制。
    // 回调每次渲染都可能换（onCopy 是页面传进来的），所以挂在 tbody 上现取。
    bodyEl.__copyHandler = onCopy;
    bindCopyGridKeys(bodyEl);
    paintCopyRoi(bodyEl, 0);
  }

  /**
   * 渲染分页条（写 DOM）。条数未超最小每页条数时隐藏整条（切页/切每页条数都无意义）。
   * @param {object} els { bar, pageTotal, pageNumbers, btnPrev, btnNext, pageJumpInput }
   * @param {object} ctx { pageNum, total, pages, queried, onGoto }
   */
  function renderPagination(els, ctx) {
    const { bar, pageTotal, pageNumbers, btnPrev, btnNext, pageJumpInput } = els;
    const { pageNum, total, pages, queried, onGoto } = ctx;

    // 条数文案始终同步，避免分页条被隐藏后还留着上一轮的旧数字
    pageTotal.textContent = `共 ${num(total)} 条`;
    // 总数还没超过最小每页条数时，分页条没有意义（切每页条数也切不动），直接不显示。
    // 条数信息在结果卡片头的「共 X 条 · 本页 Y 条」里已经有了。
    if (!queried || !total || total <= window.SubscriptionModel.MIN_PAGE_SIZE) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = '';
    // 页码条是整体重建的（innerHTML 一把换掉），被点的那颗按钮会随 DOM 一起销毁 →
    // 焦点掉回 <body>，键盘用户翻完页得从文档头重新 Tab 一遍（清单 A9）。
    // 重建前记住焦点是否在页码条里，重建后把焦点交给新的当前页按钮。
    const doc = (typeof document !== 'undefined') ? document : null;
    const hadFocusInNumbers = !!(doc && pageNumbers && pageNumbers.contains
      && pageNumbers.contains(doc.activeElement));

    pageNumbers.innerHTML = window.SubscriptionModel.buildPageNumbers(pages, pageNum);
    btnPrev.disabled = pageNum <= 1;
    btnNext.disabled = pageNum >= pages;
    pageJumpInput.max = String(pages);
    pageJumpInput.value = String(pageNum);
    pageNumbers.querySelectorAll('button[data-page]').forEach((b) => {
      b.addEventListener('click', () => { if (onGoto) onGoto(Number(b.dataset.page)); });
    });

    if (hadFocusInNumbers && typeof pageNumbers.querySelector === 'function') {
      const curBtn = pageNumbers.querySelector('button.is-current');
      if (curBtn && typeof curBtn.focus === 'function') curBtn.focus();
    }
  }

  window.SubscriptionView = Object.freeze({
    statusTag,
    reviewStatusTag,
    prioCell,
    renderTable,
    renderPagination,
  });
})();
