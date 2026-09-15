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
      ['API', () => has(window.API, 'call') && has(window.API, 'createRequester')],
      ['SubscribeManager', () => has(window.SubscribeManager, 'isSubscribed')],
      ['createSearchableSelect', () => typeof window.createSearchableSelect === 'function'],
      ['CsvExporter', () => has(window.CsvExporter, 'exportRows')],
      ['PublishResponse', () => has(window.PublishResponse, 'parse')],
      ['TableUtils', () => has(window.TableUtils, 'totalPages')],
      ['Fmt', () => has(window.Fmt, 'esc')],
      ['toast', () => typeof window.toast === 'function'],
    ],
    subscription: [
      ['API', () => has(window.API, 'call') && has(window.API, 'createRequester')],
      ['Priority', () => has(window.Priority, 'evaluate')],
      ['TableUtils', () => has(window.TableUtils, 'totalPages')],
      ['SubscriptionBatchTimes', () => has(window.SubscriptionBatchTimes, 'load')],
      ['CsvExporter', () => has(window.CsvExporter, 'downloadRows')],
      ['createSearchableSelect', () => typeof window.createSearchableSelect === 'function'],
      ['createDatePicker', () => typeof window.createDatePicker === 'function'],
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

  // ══════════════════════════════════════════════════════════════
  // 全局异常兜底
  // ══════════════════════════════════════════════════════════════
  // 为什么必须有：此前全项目 0 处 window.onerror / unhandledrejection，
  // 未捕获的 Promise rejection 会**静默失败**——用户看到的就是"点了没反应"，
  // 和"缓存没命中"的表现一模一样，极难自查（这是本项目踩过的坑）。
  //
  // 三条设计约束：
  //   1) 同步安装：不能等 DOMContentLoaded，否则兜不住脚本加载期的错误。
  //   2) 控制台必记：排障靠它，任何情况都写。
  //   3) toast 只给"真异常"且限流：避免把无害噪音弹成骚扰、避免异常风暴刷屏。

  /** 已知无害噪音：只记控制台，不弹 toast */
  const ERROR_NOISE = /ResizeObserver|Script error\.?|Loading chunk \d+ failed|Non-Error promise rejection/i;

  const TOAST_COOLDOWN_MS = 3000;
  let lastErrorToastAt = 0;
  let uncaughtCount = 0;

  /** 把任意 reason 变成可打印文本（Error 取 stack，对象尝试 JSON） */
  function describeReason(reason) {
    if (reason instanceof Error) return reason.stack || `${reason.name}: ${reason.message}`;
    if (typeof reason === 'string') return reason;
    try {
      return JSON.stringify(reason);
    } catch (_) {
      return String(reason);
    }
  }

  function onUncaught(kind, reason) {
    uncaughtCount += 1;
    const detail = describeReason(reason);
    const brief = (reason && reason.message) ? reason.message : String(reason);
    // 控制台必记（排障唯一线索）
    console.error(`[bootstrap] 未捕获${kind}：${brief}`, reason);

    if (ERROR_NOISE.test(brief) || ERROR_NOISE.test(detail)) return; // 噪音：只记不弹

    const now = Date.now();
    if (now - lastErrorToastAt < TOAST_COOLDOWN_MS) return; // 限流：风暴时只弹一次
    lastErrorToastAt = now;

    if (typeof window.toast === 'function') {
      window.toast('⚠️ 页面发生错误，详情见控制台（F12）', 4000, 'error');
    }
  }

  function installErrorGuard() {
    if (window.__APP_ERROR_GUARD__) return; // 防重复安装
    window.__APP_ERROR_GUARD__ = true;

    // 捕获阶段：资源加载失败（img/script 404）也会冒泡 error，但它没有 e.error、
    // 且 target 是元素而非 window —— 那不是 JS 异常，跳过，避免误报。
    window.addEventListener('error', (e) => {
      if (e.target && e.target !== window && e.target.nodeName) return;
      onUncaught('异常', e.error || e.message);
    }, true);

    window.addEventListener('unhandledrejection', (e) => {
      onUncaught('Promise 拒绝', e.reason);
    });
  }

  installErrorGuard();

  function start() {
    const page = currentPage();
    report(page);
    // 统一的服务注册表：模块优先从这里取跨模块回调，旧 window._xxx 仅作为兼容回退。
    window.AppServices = window.AppServices || {};
    // 各页保持自启动兼容；bootstrap 只负责统一检查，不重复调用业务初始化。
    window.AppRuntime = Object.freeze({
      version: '1.2.0',
      page,
      missingServices: () => missingFor(page),
      /** 本次会话已兜住的未捕获异常数（排障/冒烟可断言） */
      uncaughtCount: () => uncaughtCount,
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
