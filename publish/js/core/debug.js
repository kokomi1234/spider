/**
 * 统一调试日志（三页 / 各模块共用）。
 *
 * 默认不输出 —— 查询路径原本会无条件打印完整请求体与过滤条件，
 * 既吵，又把接口字段细节摊在控制台里。需要排障时二选一：
 *   ① 地址栏加 ?debug=1
 *   ② 控制台执行 window.__APP_DEBUG__ = true
 */
(function () {
  'use strict';

  function debugEnabled() {
    try {
      const flag = window.__APP_DEBUG__;
      if (flag != null) return !!flag;
      return new URLSearchParams(location.search).has('debug');
    } catch (_) {
      return false;
    }
  }

  function debugLog(...args) {
    if (debugEnabled()) console.log(...args);
  }

  window.debugLog = debugLog;
  window.debugEnabled = debugEnabled;
})();
