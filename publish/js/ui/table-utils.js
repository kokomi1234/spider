/**
 * 表格渲染小工具（订阅页 / 任务单页共用）
 *
 * 跨页同名函数里只有这两处是**真重复**，其余（rowKey / renderPagination /
 * resetForm / loadDicts / collectCond / exportCsv / boot / bindEvents）都是页面专属，
 * 逐个比对过实现，不合并。
 *
 * 注意：esc 延迟到调用时再取 window.Fmt，不放在 IIFE 顶部 —— 避免又多一处
 * 「脚本加载顺序敏感」的坑（见记忆：模块在 IIFE 里立即取 window.* 会静默降级）。
 */
(function () {
  'use strict';

  /** 总页数（至少 1 页） */
  function totalPages(total, pageSize) {
    return Math.max(1, Math.ceil(Number(total || 0) / (Number(pageSize) || 1)));
  }

  /**
   * 空态文案模板（全站唯一来源）。
   *
   * 为什么集中：此前散在 6 个文件里 8 种说法 ——「暂无数据」「当前筛选条件下无数据」
   * 「没有匹配的任务单」「没有匹配的订阅关系」「没有匹配的文档」「没有匹配项」
   * 「无匹配结果：xx」「暂无可选项」，同一产品两种语感。
   * 更要紧的是「查询失败」也被当成空态写，用户分不清「失败」与「确实没有数据」。
   *
   * 四种语义，别再各写各的：
   *   initial → 还没查过
   *   none    → 查过、确实没有命中
   *   filtered→ 查过、没命中，但用户加了筛选（提示可以放宽）
   *   fail    → 请求失败（**不是**没有数据）
   */
  const EMPTY_TEXT = Object.freeze({
    initial: '请输入条件后点击「查询」',
    none: (what) => `没有匹配的${what}`,
    filtered: (what) => `没有匹配的${what}（可放宽筛选条件再试）`,
    fail: '查询失败，请检查网络或稍后重试',
  });

  /**
   * 空状态：占满 colspan 列，并隐藏分页条。
   * 注意：class 仍是 empty-hint（页面/表格级）。弹窗内的紧凑空态用 .sub-empty、
   * 面板内的用 .msel-empty —— 那两处 padding 更小是**刻意的**（上下文不同），
   * 别为了"统一"把它们合并掉；要统一的是**文案**，文案走上面的 EMPTY_TEXT。
   *
   * 宽表（min-width 远大于视口）里 <td colspan> 无法真正居中，页面会另放一个
   * .table-empty-overlay 浮层（见 theme.css）；这里顺带把浮层文案同步、并显示出来。
   * 页面没放浮层时下面这步自动跳过，不影响原有行为。
   */
  function renderEmpty(text, colspan) {
    // 兜底**必须真转义**：原来写成 String(s ?? '')，等于零转义 ——
    // format.js 一旦没加载，innerHTML 的 XSS 防护就静默失效了。字符集与 Fmt.esc 一致。
    const esc = (window.Fmt && window.Fmt.esc) || ((s) => String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
    const body = document.querySelector('#resultBody');
    const bar = document.querySelector('#pagination');
    if (body) {
      body.innerHTML = `<tr><td colspan="${Number(colspan) || 1}" class="empty-hint">${esc(text)}</td></tr>`;
    }
    if (bar) bar.style.display = 'none';
    const txt = document.querySelector('.table-empty-overlay-text');
    if (txt) txt.textContent = text;
    syncEmptyOverlay();
  }

  /** 页面里那个宽表空态浮层；没放就返回 null（功能整体跳过） */
  function emptyOverlay() {
    return document.querySelector('.table-empty-overlay');
  }

  /**
   * 显示空态浮层，并把它的上沿对齐到表头下沿。
   * 表头文字会随宽度折行、高度不固定，所以在运行时实测 —— 写死像素值迟早会对不上。
   * @returns {boolean} 页面上是否有浮层（没有则 false，调用方无需关心）
   */
  function syncEmptyOverlay() {
    const ov = emptyOverlay();
    if (!ov) return false;
    const scroll = ov.closest('.tbl-scroll');
    const thead = (scroll || document).querySelector('thead');
    if (thead) ov.style.top = Math.round(thead.getBoundingClientRect().height) + 'px';
    ov.hidden = false;
    return true;
  }

  /** 渲染出数据行后收起空态浮层 */
  function hideEmptyOverlay() {
    const ov = emptyOverlay();
    if (ov) ov.hidden = true;
  }

  // 窗口变窄/变宽时表头可能折成不同行数，浮层上沿要跟着重算（只在浮层可见时动）
  if (window.addEventListener) {
    window.addEventListener('resize', () => {
      const ov = emptyOverlay();
      if (ov && !ov.hidden) syncEmptyOverlay();
    }, { passive: true });
  }

  /**
   * 翻页后把结果表格的纵向滚动复位（**保留**横向位置）。
   *
   * 为什么需要：表格在 .tbl-scroll 里自成滚动容器（首页还带 max-height），
   * 用户往下滚了半屏再点「下一页」，tbody 换了但 scrollTop 保留 ——
   * 新页直接停在表格中下部，前几行根本看不到，只能自己再滚回去。
   * 横向位置保留是因为宽表（订阅页 3046px）翻页后还想看同一批列。
   */
  function resetTableScroll() {
    document.querySelectorAll('.tbl-scroll').forEach((sc) => {
      if (sc.scrollTop) sc.scrollTop = 0;
    });
  }

  window.TableUtils = Object.freeze({
    totalPages, renderEmpty, EMPTY_TEXT, resetTableScroll,
    syncEmptyOverlay, hideEmptyOverlay,
  });
})();
