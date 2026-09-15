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
  /** 待播队列：[{ msg, duration, type }]。上限 5 条，超出丢最旧的（防异常风暴堆成长龙） */
  const QUEUE = [];
  const MAX_QUEUE = 5;
  const GAP_MS = 120;               // 两条之间留一点淡出时间，别叠在一起看不清

  function showNext() {
    const el = document.getElementById('toast');
    if (!el) { QUEUE.length = 0; timer = null; return; }

    const next = QUEUE.shift();
    if (!next) { timer = null; return; }                  // 队列空了，停止播

    const style = TOAST_STYLE[next.type] || TOAST_STYLE.info;
    el.textContent = next.msg;
    el.className = 'toast show';
    el.style.background = style.bg;
    el.style.color = style.fg;
    timer = setTimeout(() => {
      el.classList.remove('show');
      timer = setTimeout(showNext, GAP_MS);
    }, next.duration);
  }

  /**
   * 提示队列：后一条**不再掐掉**前一条。
   *
   * 此前共用一个定时器 + clearTimeout：连续调用时后一条会直接覆盖前一条的文本并重置计时，
   * 于是「查询失败的 error toast」刚冒头就被随后的「查询完成」顶掉 —— 用户根本没看到失败原因
   * （这也是评估报告 U-07 记录的问题）。现在改为顺序播放。
   *
   * @param {string} msg
   * @param {number} [duration=2500] 毫秒
   * @param {'info'|'success'|'warn'|'error'} [type='info']
   */
  function toast(msg, duration = 2500, type = 'info') {
    if (QUEUE.length >= MAX_QUEUE) QUEUE.shift();
    QUEUE.push({ msg, duration, type });
    if (!timer) showNext();          // 没在播就立刻开始；否则排队等前一条走完
  }

  window.toast = toast;
})();
