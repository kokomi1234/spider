/**
 * 通用格式化（三页共用）。
 *
 * 以前 index.js / task.js / subscription.js 各有一份 esc，
 * task.js / subscription.js 各有一份 num —— 同一段代码三份，改一处要改三次。
 * 这里收敛成唯一实现，页面脚本用别名引用（调用点不用动）。
 */
(function () {
  'use strict';

  /** HTML 转义：任何要插值进 innerHTML 的字符串都先过一遍 */
  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 数字千分位；非数字原样输出（null / undefined → —） */
  function num(n) {
    return typeof n === 'number' ? n.toLocaleString('zh-CN') : String(n ?? '—');
  }

  window.Fmt = { esc, num };
})();
