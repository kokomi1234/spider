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
  let currentMsg = null;            // 正在播的那条文本（重复的只累加次数）
  let currentHits = 0;              // 正在播的那条累计出现过几次
  /** 待播队列：[{ msg, duration, type, hits }]。上限 3 条，超出丢最旧的 */
  const QUEUE = [];
  // 2026-09-22 用户反馈：「很快的操作很多东西，那个提示要等好久才消失」——
  // 队列是顺序播放的，5 条 × 2.5 秒就是十几秒。三处一起改：
  // 默认时长 2500→1500、上限 5→3、内容相同的提示合并成一条（显示 ×N）。
  const MAX_QUEUE = 3;
  const GAP_MS = 80;                // 两条之间留一点淡出时间，别叠在一起看不清

  function showNext() {
    const el = document.getElementById('toast');
    if (!el) { QUEUE.length = 0; timer = null; return; }

    const next = QUEUE.shift();
    if (!next) { timer = null; currentMsg = null; currentHits = 0; return; }                  // 队列空了，停止播

    const style = TOAST_STYLE[next.type] || TOAST_STYLE.info;
    currentMsg = next.msg;
    currentHits = next.hits || 1;
    el.textContent = currentHits > 1 ? `${next.msg} ×${currentHits}` : next.msg;
    el.className = 'toast show';
    el.style.background = style.bg;
    el.style.color = style.fg;
    timer = setTimeout(() => {
      el.classList.remove('show');
      currentMsg = null;
      currentHits = 0;
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
  function toast(msg, duration = 1500, type = 'info') {
    // 同一条正在播 / 已经在队列里 → 不再排一条，只累加次数（显示成「… ×2」）。
    // 为什么：快速连点保存/删除时，逐条排队 = 用户要盯着十几秒的提示（2026-09-22 用户反馈）。
    if (currentMsg === msg) {
      // 正在播的就是这一条：只把次数加上去（显示成「… ×2」），不另排一条。
      // 连点保存/删除时用户看到的就是一个数字在涨，而不是一串提示排队。
      currentHits += 1;
      const cur = document.getElementById('toast');
      if (cur) cur.textContent = `${msg} ×${currentHits}`;
      return;
    }
    const same = QUEUE.find((q) => q.msg === msg && q.type === type);
    if (same) { same.hits = (same.hits || 1) + 1; return; }
    if (QUEUE.length >= MAX_QUEUE) QUEUE.shift();
    QUEUE.push({ msg, duration, type, hits: 1 });
    if (!timer) showNext();          // 没在播就立刻开始；否则排队等前一条走完
  }

  window.toast = toast;
})();
