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

  // 延迟取用转义函数：优先用 js/core/format.js 的 Fmt.esc，缺失时用下面的内置兜底。
  // 用函数包一层（而非在加载时定死），避免本文件早于 format.js 加载时报错。
  // 兜底**必须真转义**：原来写成 String(x ?? '')，等于零转义 ——
  // format.js 一旦没加载，全站 innerHTML 的 XSS 防护就静默失效了。字符集与 Fmt.esc 一致。
  const esc = (v) => ((window.Fmt && window.Fmt.esc) || ((x) => String(x ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')))(v);

  // 数字千分位 / 兜底（与订阅页内部 num 同口径）
  const num = (v) => ((window.Fmt && window.Fmt.num) || ((n) => String(n ?? '—')))(v);

  // 「点击复制 + 键盘漫游」的本体已抽到 js/ui/copy-cells.js（三页共用一份实现，
  // 见该文件头注释）。这里只在渲染末尾调一次 CopyCells.bind()。

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

    // 脏行（null / 非对象）先滤掉再渲染：r[k] / r._prio 会当场抛 TypeError，
    // 而 renderTable 是整屏渲染的入口，一行脏数据不该让整张表消失。
    bodyEl.innerHTML = (rows || []).filter((r) => r && typeof r === 'object').map((r, i) => {
      const overdue = r._prio && r._prio.overdue ? ' is-overdue' : '';
      const cells = COLUMNS.map(([k, , mono]) => {
        const raw = r[k];
        const text = (raw === null || raw === undefined || raw === '') ? '—' : String(raw);
        const copyAttr = `data-copy="${esc(String(raw ?? ''))}"`;
        const fixed = FIXED_COL_CLASS[k] ? FIXED_COL_CLASS[k] + ' ' : '';
        if (k === '_prioText') return prioCell(r);          // 自己带 col-prio
        if (k === 'status' || k === 'prodReviewStatus') {
          const tag = k === 'status' ? statusTag(raw) : reviewStatusTag(raw);
          return `<td class="${fixed}copy-cell" ${copyAttr}>${tag}</td>`;
        }
        // 数据格统一套一层 .cell-clamp：列宽不够时折到 2 行再省略，而不是一上来就截断。
        // 用内层 span 而不是给 td 加类，是因为 -webkit-line-clamp 会改 display，加在 td 上会毁掉表格布局。
        return `<td class="${fixed}cell-wrap ${mono ? 'cell-code ' : ''}copy-cell" ${copyAttr}`
          + `><span class="cell-clamp">${esc(text)}</span></td>`;
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
    // 点击复制 + 键盘漫游（清单 B9）：三页共用 js/ui/copy-cells.js。
    // 没有它（单测只加载本文件）时安静跳过 —— 渲染出来的 data-copy 还在，不影响其他断言。
    if (window.CopyCells) window.CopyCells.bind(bodyEl, { onCopy });
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

    pageNumbers.innerHTML = window.TableUtils.buildPageNumbers(pages, pageNum);
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
