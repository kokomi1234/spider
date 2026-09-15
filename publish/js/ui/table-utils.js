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
   */
  function renderEmpty(text, colspan) {
    const esc = (window.Fmt && window.Fmt.esc) || ((s) => String(s ?? ''));
    const body = document.querySelector('#resultBody');
    const bar = document.querySelector('#pagination');
    if (body) {
      body.innerHTML = `<tr><td colspan="${Number(colspan) || 1}" class="empty-hint">${esc(text)}</td></tr>`;
    }
    if (bar) bar.style.display = 'none';
  }

  window.TableUtils = Object.freeze({ totalPages, renderEmpty, EMPTY_TEXT });
})();
