/*
 * 页面启动器：集中维护入口依赖检查与启动顺序。
 *
 * ── 为什么需要它 ──────────────────────────────────────
 * 模块都是浏览器 IIFE，靠 window.X 互相取用。历史上模块在加载时就把 window.X
 * 取进闭包，脚本顺序错了**不会报错**，只会静默降级成空实现（典型案例：
 * dict-selects.js 排在 toast.js 之后，否则它的提示全是空操作）。
 *
 * 2026-09-16 起：会「静默降级」的那批依赖已统一改为**调用时才取 window.***
 * （覆盖 api/* 的请求器、各页的 toast / esc / num / QF / debugLog 等，
 * 回归用例见 tests/module-order.test.js）。本文件仍是第二道防线：
 * 把各页依赖集中声明，启动时显式报缺失，别再靠肉眼对顺序。
 *
 * 新增共享模块时，记得把它登记到对应页的 PRESETS 里。
 */
(() => {
  'use strict';

  const has = (obj, fn) => !!(obj && typeof obj[fn] === 'function');

  /** 各页需要的最小依赖（按页面分组；页面由路径推断） */
  const PRESETS = {
    // 首页：三个查询页入口 + 常用查询。它不依赖任何查询模块，
    // 少了谁都不能让它白屏，所以把 SavedQuery 点名在这里（渲染列表要用）。
    home: [
      ['SavedQuery', () => has(window.SavedQuery, 'list') && has(window.SavedQuery, 'save')
        && has(window.SavedQuery, 'listByDept') && has(window.SavedQuery, 'listForUser')
        && has(window.SavedQuery, 'mineFromServer')],
      ['CurrentUser', () => has(window.CurrentUser, 'get') && has(window.CurrentUser, 'lookup')],
      ['UserApi', () => has(window.UserApi, 'fetchUserList')],
      // 「当前用户」用可搜索下拉（js/ui/searchable-select.js）。少了它首页不会白屏，
      // 只是降级成原生下拉（home.js 的 initUserSelect 里那条 warn），所以这里是点名登记
      ['createSearchableSelect', () => typeof window.createSearchableSelect === 'function'],
      ['toast', () => typeof window.toast === 'function'],
      ['UserToken', () => has(window.UserToken, 'active') && has(window.UserToken, 'set')],
    ],
    // 服务发布数据查询页（publish.html，旧 index.html 迁过来的）
    publish: [
      ['API', () => has(window.API, 'call') && has(window.API, 'createRequester')],
      ['SubscribeManager', () => has(window.SubscribeManager, 'isSubscribed')],
      ['createSearchableSelect', () => typeof window.createSearchableSelect === 'function'],
      ['createMultiSelect', () => typeof window.createMultiSelect === 'function'],
      ['createDatePicker', () => typeof window.createDatePicker === 'function'],
      ['CsvExporter', () => has(window.CsvExporter, 'exportRows')],
      ['PublishResponse', () => has(window.PublishResponse, 'parse')],
      ['TableUtils', () => has(window.TableUtils, 'totalPages')],
      ['Fmt', () => has(window.Fmt, 'esc')],
      ['toast', () => typeof window.toast === 'function'],
      ['PopupPosition', () => has(window.PopupPosition, 'place')],
      ['PublishModel', () => has(window.PublishModel, 'normalizeRow')],
      ['PublishView', () => has(window.PublishView, 'renderRows')],
      ['PublishQuery', () => has(window.PublishQuery, 'doQuery')],
      // 结果行的两个弹窗（2026-09-21）。少了它们页面不会白屏 —— 点「接口明细」「操作记录」
      // 会**毫无反应**（publish.js 里的 `if (row && window.Xxx) open(row)` 静默跳过），
      // 所以必须点名登记，别让这种「点了没反应」只能靠人肉发现。
      ['PublishDialogModel', () => has(window.PublishDialogModel, 'parseIntfDetail')
        && has(window.PublishDialogModel, 'opTypeLabel') && has(window.PublishDialogModel, 'pageSlice')],
      ['IntfDetailDialog', () => has(window.IntfDetailDialog, 'open')],
      ['OpRecordDialog', () => has(window.OpRecordDialog, 'open')],
      ['SubscribeModel', () => has(window.SubscribeModel, 'displayBatch')],
      ['SubscribeDryRun', () => has(window.SubscribeDryRun, 'run')],
      ['DocPicker', () => has(window.DocPicker, 'open')],
      // SavedQuery 与 CurrentUser 成对：前者负责「⭐ 保存到首页」，后者提供归属人兜底。
      // 只引前者不引后者不会报错，但存出去的记录 owner 为空（2026-09-19 就是这么坏的）。
      ['SavedQuery', () => has(window.SavedQuery, 'save') && has(window.SavedQuery, 'listForUser')],
      ['CurrentUser', () => has(window.CurrentUser, 'get')],
      // 「🔑 Token」面板与 api-client 的 localToken() 都靠它（2026-09-22 复测 D-10）：
      // 之前四个页面都引了脚本，却没在这里点名 —— 掉脚本时**零报警**，
      // 查询照发、静默回落管理员 token、订阅等写操作无声禁用，只在控制台留两条 404。
      ['UserToken', () => has(window.UserToken, 'active') && has(window.UserToken, 'set')],
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
      ['PopupPosition', () => has(window.PopupPosition, 'place')],
      ['SubscriptionModel', () => has(window.SubscriptionModel, 'rowKey')],
      ['SavedQuery', () => has(window.SavedQuery, 'save') && has(window.SavedQuery, 'listForUser')],
      ['CurrentUser', () => has(window.CurrentUser, 'get')],
      // 「🔑 Token」面板与 api-client 的 localToken() 都靠它（2026-09-22 复测 D-10）：
      // 之前四个页面都引了脚本，却没在这里点名 —— 掉脚本时**零报警**，
      // 查询照发、静默回落管理员 token、订阅等写操作无声禁用，只在控制台留两条 404。
      ['UserToken', () => has(window.UserToken, 'active') && has(window.UserToken, 'set')],
    ],
    task: [
      ['TableUtils', () => has(window.TableUtils, 'totalPages')],
      ['CsvExporter', () => has(window.CsvExporter, 'downloadRows')],
      ['toast', () => typeof window.toast === 'function'],
      ['PopupPosition', () => has(window.PopupPosition, 'place')],
      ['SavedQuery', () => has(window.SavedQuery, 'save') && has(window.SavedQuery, 'listForUser')],
      ['CurrentUser', () => has(window.CurrentUser, 'get')],
      // 「🔑 Token」面板与 api-client 的 localToken() 都靠它（2026-09-22 复测 D-10）：
      // 之前四个页面都引了脚本，却没在这里点名 —— 掉脚本时**零报警**，
      // 查询照发、静默回落管理员 token、订阅等写操作无声禁用，只在控制台留两条 404。
      ['UserToken', () => has(window.UserToken, 'active') && has(window.UserToken, 'set')],
    ],
  };

  /**
   * 由路径推断当前页（干净路由：/home /publish /subscription /task；旧 /xxx.html 仍兼容）
   * 注意：/home 与 index.html 是**首页**（三个入口 + 常用查询），
   * 服务发布数据查询页已迁到 publish.html —— 判据写反会把首页的依赖清单套到查询页上，
   * 表现为「查询页报一堆缺失、首页反而什么都不报」。
   */
  function currentPage() {
    const path = (location.pathname || '').toLowerCase();
    if (path.includes('subscription')) return 'subscription';
    if (path.includes('task')) return 'task';
    if (path.includes('publish')) return 'publish';
    return 'home';
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
      window.toast('⚠️ 页面出现异常，请刷新重试', 4000, 'error');
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

  const INPUT_NO_SPELL_TYPES = ['text', 'search', 'url', 'email', 'tel', 'number'];

  /** 给一个输入框打上「业务串」的标记（想保留拼写检查就加 data-spellcheck） */
  function hygeneOne(el) {
    if (!el || !el.tagName) return;
    const tag = String(el.tagName).toUpperCase();
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') return;
    if (typeof el.hasAttribute === 'function' && el.hasAttribute('data-spellcheck')) return;
    if (tag === 'INPUT' && INPUT_NO_SPELL_TYPES.indexOf(String(el.type || 'text')) === -1) return;
    el.spellcheck = false;
    if (typeof el.setAttribute === 'function') {
      if (!el.getAttribute('autocomplete')) el.setAttribute('autocomplete', 'off');
      if (!el.getAttribute('autocapitalize')) el.setAttribute('autocapitalize', 'off');
    }
  }

  /**
   * 输入框统一卫生
   * ------------------------------------------------------------
   * 全站业务输入框填的是工号 / 编号 / 编码 / 批次号这类「机器串」，
   * 浏览器拼写检查会在下面画红波浪线 —— 用户会以为填错了。
   * 实测四个页面 40 多个文本输入没有一处关过，所以统一处理。
   *
   * 用 focusin **委托**而不是只在启动时扫一遍：弹窗、动态表格里的输入是后建的，
   * 一次性扫描覆盖不到（保存常用查询、评委搜索、文档选择都会现建输入框）。
   */
  function installInputHygiene() {
    if (window.__APP_INPUT_HYGIENE__) return;
    window.__APP_INPUT_HYGIENE__ = true;
    if (!document || typeof document.addEventListener !== 'function') return;
    document.addEventListener('focusin', (e) => hygeneOne(e.target), true);
  }

  /** DOM 就绪后扫一遍已存在的输入框（键盘还没聚焦过的也不该有波浪线） */
  function sweepInputHygiene() {
    try {
      document.querySelectorAll('input, textarea').forEach(hygeneOne);
    } catch (_) { /* 环境不支持（单测假 DOM）就只靠 focusin 那条 */ }
  }

  installErrorGuard();
  installInputHygiene();

  function start() {
    const page = currentPage();
    sweepInputHygiene();
    report(page);
    // 统一的服务注册表：模块从这里取跨模块回调（已移除旧的 window._xxx 私有桥）。
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
