/*
 * 页面启动器：集中维护入口依赖检查与启动顺序。
 * 业务代码仍由 index.js 持有，后续拆分时只需逐项把 feature 初始化迁到这里。
 */
(() => {
  'use strict';

  const REQUIRED_SERVICES = [
    ['API', () => window.API && typeof window.API.call === 'function'],
    ['SubscribeManager', () => window.SubscribeManager && typeof window.SubscribeManager.isSubscribed === 'function'],
    ['createSearchableSelect', () => typeof window.createSearchableSelect === 'function'],
    ['CsvExporter', () => window.CsvExporter && typeof window.CsvExporter.exportRows === 'function'],
  ];

  function checkRuntimeServices() {
    return REQUIRED_SERVICES
      .filter(([, check]) => !check())
      .map(([name]) => name);
  }

  function reportMissingServices() {
    const missing = checkRuntimeServices();
    if (missing.length) {
      console.error(`[bootstrap] 缺少运行时依赖：${missing.join('、')}。请检查 index.html 的 script 加载顺序。`);
    }
    return missing;
  }

  function start() {
    reportMissingServices();
    // 统一的服务注册表：模块优先从这里取跨模块回调，旧 window._xxx 仅作为兼容回退。
    window.AppServices = window.AppServices || {};
    // index.js 保持自启动兼容；bootstrap 只负责统一检查，不重复调用业务初始化。
    window.AppRuntime = Object.freeze({
      version: '1.0.0',
      missingServices: checkRuntimeServices,
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
