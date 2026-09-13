/*
 * 页面启动器：集中维护入口依赖检查与启动顺序。
 *
 * ── 为什么需要它 ──────────────────────────────────────
 * 模块都是浏览器 IIFE，加载时就把 window.X 取进闭包。脚本顺序错了**不会报错**，
 * 只会静默降级成空实现（典型案例：dict-selects.js 必须排在 toast.js 之后，
 * 否则它的提示全是空操作）。这里把各页依赖集中声明，启动时显式报缺失，
 * 别再靠肉眼对顺序。
 *
 * 新增共享模块时，记得把它登记到对应页的 PRESETS 里。
 */
(() => {
  'use strict';

  const has = (obj, fn) => !!(obj && typeof obj[fn] === 'function');

  /** 各页需要的最小依赖（按页面分组；页面由路径推断） */
  const PRESETS = {
    index: [
      ['API', () => has(window.API, 'call')],
      ['SubscribeManager', () => has(window.SubscribeManager, 'isSubscribed')],
      ['createSearchableSelect', () => typeof window.createSearchableSelect === 'function'],
      ['CsvExporter', () => has(window.CsvExporter, 'exportRows')],
      ['PublishResponse', () => has(window.PublishResponse, 'parse')],
      ['TableUtils', () => has(window.TableUtils, 'totalPages')],
      ['Fmt', () => has(window.Fmt, 'esc')],
      ['toast', () => typeof window.toast === 'function'],
    ],
    subscription: [
      ['API', () => has(window.API, 'call')],
      ['Priority', () => has(window.Priority, 'evaluate')],
      ['TableUtils', () => has(window.TableUtils, 'totalPages')],
      ['SubscriptionBatchTimes', () => has(window.SubscriptionBatchTimes, 'load')],
      ['CsvExporter', () => has(window.CsvExporter, 'downloadRows')],
      ['createSearchableSelect', () => typeof window.createSearchableSelect === 'function'],
      ['toast', () => typeof window.toast === 'function'],
    ],
    task: [
      ['TableUtils', () => has(window.TableUtils, 'totalPages')],
      ['CsvExporter', () => has(window.CsvExporter, 'downloadRows')],
      ['toast', () => typeof window.toast === 'function'],
    ],
  };

  /** 由路径推断当前页（约定：subscription.html / task.html / 其余当首页） */
  function currentPage() {
    const path = (location.pathname || '').toLowerCase();
    if (path.includes('subscription')) return 'subscription';
    if (path.includes('task')) return 'task';
    return 'index';
  }

  function missingFor(page) {
    const list = PRESETS[page];
    if (!list) return [];
    return list.filter(([, check]) => !check()).map(([name]) => name);
  }

  function report(page) {
    const missing = missingFor(page);
    if (missing.length) {
      console.error(
        `[bootstrap] ${page}.html 缺少运行时依赖：${missing.join('、')}。` +
        '请检查该页 script 的加载顺序（模块在加载时就取 window.*，顺序错会静默降级）。',
      );
    }
    return missing;
  }

  function start() {
    const page = currentPage();
    report(page);
    // 统一的服务注册表：模块优先从这里取跨模块回调，旧 window._xxx 仅作为兼容回退。
    window.AppServices = window.AppServices || {};
    // 各页保持自启动兼容；bootstrap 只负责统一检查，不重复调用业务初始化。
    window.AppRuntime = Object.freeze({
      version: '1.1.0',
      page,
      missingServices: () => missingFor(page),
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
