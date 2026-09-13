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

  /** 空状态：占满 colspan 列，并隐藏分页条 */
  function renderEmpty(text, colspan) {
    const esc = (window.Fmt && window.Fmt.esc) || ((s) => String(s ?? ''));
    const body = document.querySelector('#resultBody');
    const bar = document.querySelector('#pagination');
    if (body) {
      body.innerHTML = `<tr><td colspan="${Number(colspan) || 1}" class="empty-hint">${esc(text)}</td></tr>`;
    }
    if (bar) bar.style.display = 'none';
  }

  window.TableUtils = Object.freeze({ totalPages, renderEmpty });
})();
