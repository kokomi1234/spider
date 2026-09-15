/**
 * 查询状态反馈：加载遮罩 + 查询失败常驻条（三页共用）。
 *
 * 背景（评估报告 P1）：task / subscription 两页各写了一套 setLoading / showQueryFail /
 * hideQueryFail，index 页又有一对 showLoading / hideLoading，文案与 aria 处理各写各的。
 * 这里收敛为唯一实现；页面侧只留「把 state.queried 传进来」的薄别名。
 *
 * DOM 契约（三页 markup 已统一）：
 *   #loadingMask  .loading-mask，靠 .show 显隐（它是 flex，hidden 属性盖不住）
 *   #failBar      .retry-bar.fail-bar，常驻条，style.display 控制
 *   #failText     条内文案 span
 * index 页另有 #retryBar/#retryText/#btnRetryFailed —— 语义是「分页拉取失败重试」，
 * 与查询失败条不是一回事，不在本模块范围内。
 */
(function () {
  'use strict';

  const DEFAULTS = { mask: '#loadingMask', bar: '#failBar', text: '#failText' };

  function $(sel) { return document.querySelector(sel); }

  /** 加载遮罩开关：.show 控制显隐，同步 aria-busy 供读屏 */
  function setLoading(on, maskSel) {
    const el = $(maskSel || DEFAULTS.mask);
    if (!el) return;
    el.classList.toggle('show', !!on);
    el.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  /**
   * 把接口层的错误串压成一句话。
   * tool-api 抛出来的是 `HTTP 404 {"code":404,"msg":"...","key":"..."}` 这种，
   * 整段塞进提示条会把真正有用的说明挤没，所以优先抽 msg 字段；超长截断。
   */
  function shortError(err) {
    const s = String(err == null ? '未知错误' : err);
    const m = /"msg"\s*:\s*"([^"]+)"/.exec(s);
    if (m) return m[1];
    return s.length > 90 ? s.slice(0, 90) + '…' : s;
  }

  /**
   * 查询失败的常驻提示（toast 几秒就消失，常驻条不会）。
   * hasPrev=true 表示页面上还留着上一次成功结果 —— 文案必须明说，
   * 否则用户会把「查询失败」误读成「点了没反应」或「确实没有数据」。
   */
  function showQueryFail(reason, hasPrev, sels) {
    const o = Object.assign({}, DEFAULTS, sels);
    const bar = $(o.bar);
    if (!bar) return;
    const msg = shortError(reason);
    const txt = $(o.text);
    if (txt) {
      txt.textContent = hasPrev
        ? `⚠️ 本次查询失败，下面仍是上一次成功查询的结果（${msg}）`
        : `⚠️ 查询失败：${msg}`;
    }
    bar.style.display = '';
  }

  /** 常驻条显示任意文本（如「部分批次查询失败」的完整清单） */
  function showFailText(text, sels) {
    const o = Object.assign({}, DEFAULTS, sels);
    const bar = $(o.bar);
    if (!bar) return;
    const txt = $(o.text);
    if (txt) txt.textContent = String(text || '');
    bar.style.display = '';
  }

  function hideFail(barSel) {
    const bar = $(barSel || DEFAULTS.bar);
    if (bar) bar.style.display = 'none';
  }

  window.QueryFeedback = Object.freeze({ setLoading, showQueryFail, showFailText, hideFail, shortError });
})();
