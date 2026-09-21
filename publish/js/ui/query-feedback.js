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
    if (err == null) return '未知错误';
    // 2026-09-21：发布页 catch 到的是 { response, ... } 这类**普通对象**，
    // 直接 String(err) 会得到 "[object Object]"，常驻条上一句有用的话都没有。
    // 这里按「人能读的字段」优先取值，再退回原来的做法。
    const pick = (v) => (typeof v === 'string' && v.trim()) ? v.trim() : '';
    let s = typeof err === 'string' ? err
      : (pick(err.message) || pick(err.msg) || pick(err.error) || pick(err.statusText) || '');
    if (!s && err && typeof err === 'object' && err.response) {
      const r = err.response;
      s = pick(r.statusText) || pick(r.msg) || pick(r.message) || (r.status ? `HTTP ${r.status}` : '');
    }
    if (!s) s = String(err);
    const m = /"msg"\s*:\s*"([^"]+)"/.exec(s);
    if (m) return m[1];
    if (/^\[object\s+\w+\]$/.test(s)) return '未知错误';
    return s.length > 90 ? s.slice(0, 90) + '…' : s;
  }

  /** 是不是「认证失败/未授权」—— 401 要额外给一句「去点 Token」的引导 */
  function isAuthError(reason, msg) {
    const code = reason && (reason.status ?? reason.statusCode ?? (reason.response && reason.response.status));
    if (Number(code) === 401) return true;
    const s = String(reason == null ? '' : reason);
    if (/(^|[^0-9])401([^0-9]|$)/.test(s)) return true;
    return /认证失败|未授权|未登录|unauthorized/i.test(String(msg || ''));
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
      // 401 单独加一句引导：后端 token 约 12 小时过期，过期后每个接口都返回 401。
      // 不加这句的话用户只看到「认证失败」，不知道该去点右上角的「🔑 Token」。
      // 这属于「操作失败必须说清楚怎么办」的例外，不是冗余提示。
      // 文案里已经提到 Token 的（如 publish-response 的「认证失败，请检查 Token 是否有效」）
      // 就不重复追加，免得同一句话说两遍。
      const tail = (isAuthError(reason, msg) && !/Token|令牌/i.test(msg))
        ? '（Token 可能已过期，请点右上角「🔑 Token」更新）'
        : '';
      txt.textContent = hasPrev
        ? `⚠️ 本次查询失败，下面仍是上一次成功查询的结果（${msg}${tail}）`
        : `⚠️ 查询失败：${msg}${tail}`;
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

  window.QueryFeedback = Object.freeze({ setLoading, showQueryFail, showFailText, hideFail, shortError, isAuthError });
})();
