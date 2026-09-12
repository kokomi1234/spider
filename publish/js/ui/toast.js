/**
 * 全站唯一 Toast（三页共用）。
 *
 * 以前三份实现：
 *   · index.js  showToast(msg, duration, type) —— 带 info/success/warn/error 配色
 *   · task.js   toast(msg, duration)          —— 但错用了 loadingTimer 做定时器，
 *                                               会和「加载中」的定时器互相顶掉
 *   · subscription.js toast(msg, duration)
 * 这里统一成一个：type 省略时走 info（配色与 theme.css 的 .toast 默认一致，观感不变）。
 */
(function () {
  'use strict';

  const TOAST_STYLE = {
    info:    { bg: 'var(--on-surface)', fg: 'var(--surface)' },
    success: { bg: 'var(--green-c)',    fg: 'var(--on-green-c)' },
    error:   { bg: 'var(--red-c)',      fg: 'var(--on-red-c)' },
    warn:    { bg: 'var(--amber-c)',    fg: 'var(--on-amber-c)' },
  };

  let timer = null;

  /**
   * @param {string} msg
   * @param {number} [duration=2500] 毫秒
   * @param {'info'|'success'|'warn'|'error'} [type='info']
   */
  function toast(msg, duration = 2500, type = 'info') {
    const el = document.getElementById('toast');
    if (!el) return;
    const style = TOAST_STYLE[type] || TOAST_STYLE.info;
    el.textContent = msg;
    el.className = 'toast show';
    el.style.background = style.bg;
    el.style.color = style.fg;
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove('show'), duration);
  }

  window.toast = toast;
})();
