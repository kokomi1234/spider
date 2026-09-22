/**
 * 弹窗「标题栏可拖动」的接线守卫（2026-09-23）
 *
 * 起因：用户报「有的弹窗没法拖动」。查下来是 `DialogUtils.makeDraggable` 只在 5 个弹窗
 * （订阅 / 接口明细 / 操作记录 / 文档选择 / 批次时间）接了，另外 4 处没接：
 *   ① openUtilDialog —— 确认框、命名框、Token 面板、promptText 全走它，影响面最大；
 *   ② 发布页「服务详情」；③ 任务单「详情」；④「已订阅服务管理」面板。
 * 这类漏接在页面上表现为"能开能关就是挪不动"，没有报错，人肉走查才会发现 ——
 * 所以钉一条纯文本的成套性守卫：哪个弹窗又没接，这里立刻红。
 *
 * 拖动手感本身（跟随指针、夹在视口内、复位居中）要真鼠标，由 tests/smoke-browser.js 守；
 * 这里只管「有没有接」与「缺能力时不许把弹窗搞崩」。
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ROOT, test, loadScript } = require('./harness');

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 凡是有标题栏 / 标题的弹窗，都必须接 makeDraggable（含旧结构用 h2 当把手的那些） */
const DIALOGS = [
  ['js/ui/dialog-utils.js', '通用弹窗骨架（确认框 / 命名框 / Token 面板 / promptText）'],
  ['js/ui/detail-dialog.js', '发布页：服务详情'],
  ['js/page/task.js', '任务单：详情'],
  ['js/ui/subscribe-ui.js', '已订阅服务管理面板'],
  ['js/ui/intf-detail-dialog.js', '接口明细'],
  ['js/ui/op-record-dialog.js', '操作记录'],
  ['js/ui/subscribe-dialog.js', '订阅'],
  ['js/ui/doc-picker.js', '关联文档选择'],
  ['js/page/subscription.js', '批量修改批次时间'],
];

test('每个弹窗都接了 makeDraggable（漏一个就是「能开能关但挪不动」）', () => {
  const missing = DIALOGS.filter(([rel]) => !/makeDraggable\s*\(/.test(read(rel)))
    .map(([, name]) => name);
  assert.deepStrictEqual(missing, [], `这些弹窗没接拖动：${missing.join('、')}`);
});

test('openUtilDialog：拖动的把手是标题栏 .sub-head（不能拿整个 dialog 当把手）', () => {
  const src = read('js/ui/dialog-utils.js');
  assert.match(src, /makeDraggable\(dialog,\s*head\)/,
    '通用弹窗应把 head（.sub-head）当把手 —— 用整个 dialog 会把内容区的文本选择也吃掉');
});

test('每次打开都要复位：拖过的弹窗再打开不能沿用上次的位置', () => {
  // 这四个是复用同一份 DOM 的弹窗（不是每次新建），不 reset 就会越开越偏
  const reusable = [
    ['js/ui/detail-dialog.js', 'dragHandle'],
    ['js/page/task.js', 'detailDrag'],
    ['js/ui/subscribe-ui.js', 'dragHandle'],
  ];
  const bad = reusable.filter(([rel, varName]) => {
    const src = read(rel);
    return !(new RegExp(`${varName}\\s*&&\\s*${varName}\\.reset`).test(src));
  }).map(([rel]) => rel);
  assert.deepStrictEqual(bad, [], `这些弹窗打开时没有复位拖动位置：${bad.join('、')}`);
});

test('makeDraggable：环境没有 window.addEventListener 时返回 null、不抛', () => {
  // 单测的假 DOM 没有 window.addEventListener。通用弹窗也走 makeDraggable 之后，
  // 不判这道会在 openUtilDialog 里同步抛、把弹出来的框一起搞崩（实测挂掉 token-manager 那条）。
  const win = {};                       // 故意不给 addEventListener
  const doc = { createElement: () => ({ style: {}, classList: { add() {} }, appendChild() {}, append() {}, setAttribute() {} }) };
  const DU = loadScript('js/ui/dialog-utils.js', { document: doc }, win).DialogUtils;
  const fakeEl = { style: {}, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }) };
  assert.strictEqual(DU.makeDraggable(fakeEl, fakeEl), null, '缺能力就安静跳过，绝不能抛');
  assert.strictEqual(DU.makeDraggable(null, fakeEl), null, 'dialog 为空也不抛');
  assert.strictEqual(DU.makeDraggable(fakeEl, null), null, 'handle 为空也不抛');
});

test('任务单详情弹窗：点遮罩走统一实现，不再自己判 e.target === overlay', () => {
  // 2026-09-23：上一轮统一遮罩口径时漏了这个弹窗，旧写法会把
  // 「在弹窗里按下、滑到遮罩上松开」误判成点遮罩。
  const src = read('js/page/task.js');
  assert.ok(!/e\.target\s*===\s*\$\('#taskDetailOverlay'\)/.test(src),
    '任务单详情不该再自己判 e.target === overlay（统一走 DialogUtils.bindBackdropDismiss）');
  assert.match(src, /bindBackdropDismiss\(\$\('#taskDetailOverlay'\)/,
    '任务单详情的遮罩应走 bindBackdropDismiss');
});
