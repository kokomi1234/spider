'use strict';

const assert = require('assert');
const { loadScript, test } = require('./harness');

/**
 * 加载 bootstrap.js 并返回可操控的测试环境。
 * 注意：bootstrap 在**脚本加载时就同步**安装兜底（不等 DOMContentLoaded），
 * 所以 loadScript 执行完，监听器就已经注册好了。
 */
function boot() {
  const handlers = {};
  const toasts = [];
  const win = {
    addEventListener: (type, fn) => { (handlers[type] = handlers[type] || []).push(fn); },
  };
  const doc = { readyState: 'complete', addEventListener: () => {} };
  // location 是脚本里的自由变量，走 node 全局
  global.location = { pathname: '/index.html' };

  const orig = console.error;
  const silence = () => { console.error = () => {}; };
  const capture = (bucket) => { console.error = (...a) => bucket.push(a.map(String).join(' ')); };

  silence();
  try {
    loadScript('js/core/bootstrap.js', { document: doc }, win);
  } finally {
    console.error = orig;
  }

  // toast 是调用时才取的（延迟取 window.toast），加载后再注入
  win.toast = (msg, duration, type) => toasts.push({ msg, duration, type });

  const fire = (type, ev) => {
    const logs = [];
    capture(logs);
    try {
      (handlers[type] || []).forEach((f) => f(ev));
    } finally {
      console.error = orig;
    }
    return logs;
  };

  return { win, handlers, toasts, fire };
}

test('bootstrap：注册 error 与 unhandledrejection 两个兜底监听', () => {
  const { handlers } = boot();
  assert.strictEqual((handlers.error || []).length, 1, '应注册 1 个 error 监听');
  assert.strictEqual((handlers.unhandledrejection || []).length, 1, '应注册 1 个 unhandledrejection 监听');
});

test('bootstrap：未捕获 Promise 拒绝 → 控制台必记 + 弹一次 error toast', () => {
  const { win, toasts, fire } = boot();
  const logs = fire('unhandledrejection', { reason: new Error('接口炸了') });

  assert.ok(
    logs.some((l) => l.includes('未捕获') && l.includes('接口炸了')),
    '控制台必须留下排障线索',
  );
  assert.strictEqual(toasts.length, 1, '应弹一次 toast');
  assert.strictEqual(toasts[0].type, 'error', 'toast 类型应为 error');
  assert.strictEqual(win.AppRuntime.uncaughtCount(), 1, 'AppRuntime 应记录到 1 次');
});

test('bootstrap：window.onerror 捕获到的 JS 异常同样兜住', () => {
  const { toasts, fire } = boot();
  const logs = fire('error', { error: new Error('渲染时炸了'), message: '渲染时炸了', target: null });

  assert.ok(logs.some((l) => l.includes('渲染时炸了')));
  assert.strictEqual(toasts.length, 1);
});

test('bootstrap：资源加载失败（img 404，无 e.error）不误报为 JS 异常', () => {
  const { toasts, fire } = boot();
  // 资源型 error：target 是元素、没有 e.error —— 不是 JS 异常
  const logs = fire('error', { target: { nodeName: 'IMG' }, message: '' });

  assert.ok(!logs.some((l) => l.includes('未捕获')), '不应记为未捕获异常');
  assert.strictEqual(toasts.length, 0, '不应弹 toast');
});

test('bootstrap：ResizeObserver 等已知噪音只记控制台、不弹 toast', () => {
  const { toasts, fire } = boot();
  const logs = fire('unhandledrejection', { reason: new Error('ResizeObserver loop completed') });

  assert.ok(logs.some((l) => l.includes('未捕获')), '控制台仍要留痕');
  assert.strictEqual(toasts.length, 0, '噪音不该骚扰用户');
});

test('bootstrap：异常风暴时限流，冷却期内只弹一次（不刷屏）', () => {
  const { toasts, fire } = boot();
  fire('unhandledrejection', { reason: new Error('第一个') });
  fire('unhandledrejection', { reason: new Error('第二个') });
  fire('unhandledrejection', { reason: new Error('第三个') });

  assert.strictEqual(toasts.length, 1, '冷却期内应只弹一次');
});

test('bootstrap：重复加载幂等，不会重复注册监听', () => {
  const { win, handlers } = boot();
  const before = handlers.error.length;

  const orig = console.error;
  console.error = () => {};
  try {
    loadScript('js/core/bootstrap.js', { document: { readyState: 'complete', addEventListener: () => {} } }, win);
  } finally {
    console.error = orig;
  }

  assert.strictEqual(handlers.error.length, before, '重复加载不应重复注册');
  assert.strictEqual(win.__APP_ERROR_GUARD__, true);
});
