/**
 * 查询状态反馈共用模块（js/ui/query-feedback.js，评估报告 P1）
 *
 * 收敛前：task / subscription 各写一套 setLoading / showQueryFail / hideQueryFail，
 * index 又有一对 showLoading / hideLoading，文案与 aria 处理各写各的。
 * 收敛后：唯一实现 + 页面薄别名。这里用假 DOM 做**确定性**用例（同 toast-queue.test.js 的思路：
 * 不碰真实定时器与布局，避免冒烟环境异步弹提示导致的偶发失败）。
 */
'use strict';

const { test, loadScript } = require('./harness');

/** 假元素：支持 classList.toggle / setAttribute / style / textContent */
function fakeEl() {
  const classes = new Set();
  return {
    textContent: '',
    style: {},
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    classList: {
      toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); },
      contains: (c) => classes.has(c),
    },
  };
}

/** 用 selector → 元素 的映射造一个最小 document */
function loadQF(map) {
  return loadScript('js/ui/query-feedback.js', {
    document: { querySelector: (sel) => map[sel] || null },
  }, {});
}

test('query-feedback：setLoading 切换 .show 并同步 aria-busy', () => {
  const mask = fakeEl();
  const win = loadQF({ '#loadingMask': mask });

  win.QueryFeedback.setLoading(true);
  if (!mask.classList.contains('show')) throw new Error('setLoading(true) 应加 .show');
  if (mask.attrs['aria-busy'] !== 'true') throw new Error(`aria-busy 应为 true，实际 ${mask.attrs['aria-busy']}`);

  win.QueryFeedback.setLoading(false);
  if (mask.classList.contains('show')) throw new Error('setLoading(false) 应移除 .show');
  if (mask.attrs['aria-busy'] !== 'false') throw new Error(`aria-busy 应为 false，实际 ${mask.attrs['aria-busy']}`);
});

test('query-feedback：首次失败与「保留上次结果」两种文案语义不同', () => {
  const bar = fakeEl();
  const txt = fakeEl();
  bar.style.display = 'none';
  const win = loadQF({ '#failBar': bar, '#failText': txt });

  win.QueryFeedback.showQueryFail('网络超时', false);
  if (bar.style.display === 'none') throw new Error('失败后常驻条应显示');
  if (txt.textContent !== '⚠️ 查询失败：网络超时') {
    throw new Error(`首次失败文案不对：${txt.textContent}`);
  }
  if (/上一次成功/.test(txt.textContent)) throw new Error('首次失败不应出现「上一次成功」字样');

  win.QueryFeedback.showQueryFail('网络超时', true);
  if (!/上一次成功查询的结果/.test(txt.textContent)) {
    throw new Error(`有上次结果时文案必须明说：${txt.textContent}`);
  }
});

test('query-feedback：HTTP JSON 错误串压缩为 msg 字段（shortError）', () => {
  const bar = fakeEl();
  const txt = fakeEl();
  const win = loadQF({ '#failBar': bar, '#failText': txt });

  win.QueryFeedback.showQueryFail('HTTP 404 {"code":404,"msg":"批次不存在","key":"x"}', false);
  if (txt.textContent !== '⚠️ 查询失败：批次不存在') {
    throw new Error(`应抽出 msg 字段，实际：${txt.textContent}`);
  }

  const long = 'x'.repeat(120);
  if (win.QueryFeedback.shortError(long).length > 91) throw new Error('超长错误串应截断到 90 字 + …');
  if (win.QueryFeedback.shortError(null) !== '未知错误') throw new Error('空错误应回退「未知错误」');
});

test('query-feedback：showFailText 原样放文本（部分批次失败清单），hideFail 收起', () => {
  const bar = fakeEl();
  const txt = fakeEl();
  bar.style.display = 'none';
  const win = loadQF({ '#failBar': bar, '#failText': txt });

  win.QueryFeedback.showFailText('⚠️ 窗口内有 2 个批次查询失败（2608、2609），当前结果不完整');
  if (bar.style.display === 'none') throw new Error('showFailText 应显示常驻条');
  if (!/2608、2609/.test(txt.textContent)) throw new Error(`清单应完整保留：${txt.textContent}`);

  win.QueryFeedback.hideFail();
  if (bar.style.display !== 'none') throw new Error('hideFail 应收起常驻条');
});

test('query-feedback：元素缺失时静默返回，不抛异常', () => {
  const win = loadQF({});   // 页面没有任何相关节点
  win.QueryFeedback.setLoading(true);
  win.QueryFeedback.showQueryFail('x', false);
  win.QueryFeedback.showFailText('x');
  win.QueryFeedback.hideFail();
});

test('query-feedback：401 只给文案指路，**不自动弹 Token 弹窗**（2026-09-22 用户拍板：回落管理员 token 是设计）', () => {
  const bar = fakeEl();
  const txt = fakeEl();
  let opened = 0;
  const win = { TokenManager: { openDialog() { opened += 1; } } };
  loadScript('js/ui/query-feedback.js', {
    document: { querySelector: (sel) => ({ '#failBar': bar, '#failText': txt }[sel] || null) },
  }, win);

  win.QueryFeedback.showQueryFail('认证失败', false);
  if (opened !== 0) throw new Error(`没录入自己的 token 时回落管理员 token 是设计，不该弹模态框打断查询，实际弹了 ${opened} 次`);
  if (!/🔑 Token/.test(txt.textContent)) throw new Error(`认证失败要给出去哪修的指路，实际：${txt.textContent}`);
  if (bar.style.display === 'none') throw new Error('401 的常驻失败条要显示');

  // 上游文案已经提到 Token 就不重复追加，免得同一句话说两遍
  win.QueryFeedback.showQueryFail('认证失败，请检查 Token 是否有效', false);
  if (/请点右上角/.test(txt.textContent)) throw new Error(`不该重复指路，实际：${txt.textContent}`);

  // 非认证类失败不该带 Token 指路
  win.QueryFeedback.showQueryFail('服务器内部错误', false);
  if (/🔑 Token/.test(txt.textContent)) throw new Error(`500 不该出现 Token 指路，实际：${txt.textContent}`);
});
