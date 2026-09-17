'use strict';
/**
 * 回归测试：提供方批次（f_providerBatch）筛选条件必须进入请求体 putBatch，并走单批次精确查询。
 *
 * 背景：用户反馈「选了提供方批次查询却返回全部（全量查询）」。本测试用 jsdom 加载真实的
 * subscription.js / subscription-model.js / searchable-select.js，模拟用户选中「提供方批次」
 * 后点「查询」，断言发出的请求体里 putBatch 等于所选批次（label 格式），而不是空串。
 *
 * 排查结论（已验证并修复）：用户「选了提供方批次却查出全部」的真实根因是
 * searchable-select 在手输批次文本但未从下拉正式选中（如手输后直接点查询）时，
 * 文本只落在 freeText 里，而 subscription.js 的 selValue 只读 getValue，导致
 * putBatch 被静默置空、误走全量查询。本测试覆盖两条路径：
 *   · 路径 A（从下拉正式选中）→ putBatch = 所选批次；
 *   · 路径 B（手输未选中，直接点查询）→ 修复后回退读取 freeText，putBatch = 手输文本。
 * 两条路径都守护「提供方批次真正进入请求体」，防止后续回归。
 *
 * 运行：
 *   NODE_PATH=/Users/a1/.workbuddy/binaries/node/workspace/node_modules \
 *     /Users/a1/.workbuddy/binaries/node/versions/22.22.2-3/bin/node \
 *     tests/repro_provider_batch_e2e.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

const html = `<!DOCTYPE html><html><body>
  <div class="card" id="filterCard"><div class="card-head"></div>
    <div id="filterBody">
      <select id="f_callerCompNum"></select>
      <select id="f_callerBatch"></select>
      <select id="f_providerBatch"></select>
      <select id="f_providerCompNum"></select>
      <input id="f_providerServiceNameAndId">
      <select id="f_isSendOutside"></select>
      <select id="f_status"></select>
      <select id="f_deptId"></select>
      <select id="f_prodDeptId"></select>
      <input id="f_subscriberName">
      <div id="msel_sysServeNo"></div>
      <div id="msel_serverCoding"></div>
      <div id="msel_prodSysServeNo"></div>
      <div id="advancedFields"></div>
    </div>
  </div>
  <div id="callerQuick"><button class="filter-quick-btn" data-caller="X">X</button></div>
  <button id="btnQuery">查询</button>
  <button id="btnReset">重置</button>
  <button id="btnRefresh">刷新</button>
  <button id="btnSortPrio">排序</button>
  <button id="btnPrev">上</button><button id="btnNext">下</button>
  <select id="pageSizeSelect"></select><input id="pageJumpInput">
  <div id="pagination"><span id="pageTotal"></span><span id="pageNumbers"></span></div>
  <span id="resultCount"></span><span id="overdueCount"></span>
  <button id="btnToggleAdvanced">更多</button>
  <button id="filterToggle">折叠</button>
  <table class="subq-table"></table>
  <div id="batchTimeDialog"><div class="sub-head"></div></div>
  <div id="batchTimeOverlay"></div>
  <button id="btnBatchTimeEdit"></button><button id="btnBatchTimeClose"></button>
  <button id="btnBatchTimeCancel"></button><button id="btnBatchTimeSave"></button>
</body></html>`;

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const { document } = window;

let capturedBody = null;
let fetchCount = 0;
window.ToolApi = {
  fetchSubscriptionPublishHistory(p) {
    fetchCount++;
    capturedBody = p;
    console.log('  · fetch #' + fetchCount + ' putBatch=' + JSON.stringify(p.putBatch) + ' compNum=' + JSON.stringify(p.compNum));
    return Promise.resolve({ ok: true, local: false, total: 0, rows: [] });
  },
};
window.toast = () => {};
window.Fmt = { num: (x) => String(x), businessToday: () => new Date(), esc: (x) => String(x ?? '') };
window.QueryFeedback = { setLoading() {}, showQueryFail() {}, showFailText() {}, hideFail() {}, shortError: String };
window.TableUtils = { syncEmptyOverlay() {}, renderEmpty() {}, renderCount() {}, buildPageNumbers: () => '', EMPTY_TEXT: {}, totalPages: () => 1 };
window.DialogUtils = { makeDraggable() {} };
window.SubscriptionBatchTimes = { init() {}, open() {}, close() {}, save() {}, load() {}, applyToPriority() {} };
// 下拉数据源（真实 loadBatchList 返回 {label,value}，toBatchOptions 用 label 当 value）
window.loadBatchList = () => Promise.resolve([
  { label: '2606批次', value: '2606' }, { label: '2607批次', value: '2607' }, { label: '2608批次', value: '2608' },
]);
window.loadProviderList = () => Promise.resolve([{ label: 'E00406', value: 'E00406' }]);
window.loadDepartmentList = () => Promise.resolve([]);
window.createMultiSelect = () => ({ getValues: () => [], setOptions() {} });
window.renderEmpty = () => {};
window.renderCount = () => {};

// 加载真实脚本：控件 → 装实例捕获器 → 模型/视图/页级
window.eval(read('js/ui/searchable-select.js'));
window.eval(read('js/ui/multi-select.js'));
const captured = {};
window.createSearchableSelect = (function (orig) {
  return function (el, opts, o) {
    const inst = orig(el, opts, o);
    if (el && el.id) captured[el.id] = inst;
    return inst;
  };
})(window.createSearchableSelect);
window.eval(read('js/page/subscription-model.js'));
window.eval(read('js/page/subscription-view.js'));
window.eval(read('js/page/subscription.js'));

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('  ✓', msg);
  else { console.log('  ✗', msg); failures++; }
}

(async () => {
  await new Promise((r) => setTimeout(r, 80)); // 等 loadDicts 异步回填

  console.log('— 提供方批次筛选：前端取值与路由回归 —');
  assert(Object.keys(captured).includes('f_providerBatch'), 'f_providerBatch 已注册为 searchable-select 实例');

  // 模拟用户「选中」提供方批次 + 提供一个提供方系统（满足 validateQuery 二选一）
  captured['f_providerBatch'].setValue('2607批次');
  captured['f_providerCompNum'].setValue('E00406');

  document.getElementById('btnQuery').click();
  await new Promise((r) => setTimeout(r, 80));

  assert(capturedBody !== null, '点击查询确实发起了一次查询请求');
  assert(capturedBody && capturedBody.putBatch === '2607批次',
    `请求体 putBatch 等于所选批次（实得 ${JSON.stringify(capturedBody && capturedBody.putBatch)}）`);
  assert(capturedBody && capturedBody.prodBatch === '', '未选调用方批次时 prodBatch 应为空');
  assert(capturedBody && capturedBody.compNum === 'E00406', '提供方系统 compNum 一并送达');

  // 二次校验：清空批次后，下拉实例的取值必须为空（不会产生残留的 putBatch）。
  // （清空后若只保留提供方系统，查询会正确地退回「近 12 月窗口」扇出，属正常设计，
  //  而非把上一次选中的批次偷偷带进请求。）
  captured['f_providerBatch'].clear();
  assert(captured['f_providerBatch'].getValue() === '', '清空批次后下拉取值回退为空（无残留）');

  // ── 路径 B：手输批次但未从下拉正式选中，直接点查询 ──────────────────
  // 模拟真实交互：用户在 f_providerBatch 里敲入「2608批次」但没按回车 / 没点选项，
  // 直接点「查询」按钮。失焦时控件把文本存进 freeText，但 selValue 只读 getValue
  // （旧逻辑）—— 这正是「选了批次却查出全部」的根因。修复后 selBatchValue 回退读 freeText。
  // searchable-select 把 .searchable-select 容器插到原 <select> 的下一个兄弟节点，
  // input 在容器里、不在 #f_providerBatch 内部，故从 nextElementSibling 取。
  const pSel = document.getElementById('f_providerBatch');
  const pContainer = pSel && pSel.nextElementSibling;
  const pInput = pContainer && pContainer.querySelector('input.searchable-select-input');
  assert(!!pInput, 'f_providerBatch 控件内含可输入的 input 元素');
  if (pInput) {
    // 真实交互：先聚焦打开下拉（paintOpen 会清空 input，等待用户键入），再填值、发 input 事件。
    pInput.focus();
    pInput.value = '2608批次';
    pInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    // 模拟点查询按钮导致的失焦（真实浏览器点按钮会先 blur 输入框）
    pInput.dispatchEvent(new window.Event('blur', { bubbles: true }));
    assert(captured['f_providerBatch'].getValue() === '', '手输未选中时 getValue 仍为空（未走正式选中）');
    assert(captured['f_providerBatch'].getFreeText() === '2608批次', '手输文本已进入 freeText（控件侧）');

    capturedBody = null;
    document.getElementById('btnQuery').click();
    await new Promise((r) => setTimeout(r, 80));

    assert(capturedBody !== null, '路径 B：点击查询确实发起了一次查询请求');
    assert(capturedBody && capturedBody.putBatch === '2608批次',
      `路径 B：请求体 putBatch 回退到手输文本（实得 ${JSON.stringify(capturedBody && capturedBody.putBatch)}）`);
    assert(capturedBody && capturedBody.prodBatch === '', '路径 B：未选调用方批次时 prodBatch 应为空');
  }

  console.log(failures === 0
    ? '\n结果：PASS —— 提供方批次（正式选中 / 手输未选中）两条路径都把批次送进 putBatch。'
    : `\n结果：FAIL —— ${failures} 项断言未通过。`);
  process.exit(failures === 0 ? 0 : 1);
})();
