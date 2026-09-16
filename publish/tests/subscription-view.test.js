/**
 * subscription-view.js 单测：覆盖从 subscription.js 抽出的 HTML 字符串生成与渲染接线。
 *
 * 复用同一个 window 依次加载 format.js（转义）→ subscription-model.js（常量/映射）
 * → subscription-view.js，与浏览器里脚本加载顺序一致。
 *
 * renderTable / renderPagination 会写 DOM，但只用到入参元素上的 innerHTML /
 * textContent / style / disabled / max / value / querySelectorAll / addEventListener，
 * 这里用最小替身对象承接，从而验证「渲染结果 + 事件回传」而不是真实布局。
 */
'use strict';

const { loadScript, test } = require('./harness');
const assert = require('assert');

const win = loadScript('js/core/format.js');
loadScript('js/page/subscription-model.js', {}, win);
loadScript('js/page/subscription-view.js', {}, win);
const V = win.SubscriptionView;
const M = win.SubscriptionModel;

/** tbody 替身：记录 innerHTML，并按选择器交出预置的假元素 */
function stubBody(jumps = [], copies = []) {
  return {
    innerHTML: '',
    _jumps: jumps,
    _copies: copies,
    querySelectorAll(sel) {
      if (sel === 'button[data-jump]') return this._jumps;
      if (sel === 'td.copy-cell') return this._copies;
      return [];
    },
  };
}

/** 假元素：捕获 addEventListener 的回调，方便手动触发 */
function stubEl(dataset) {
  const handlers = {};
  return {
    dataset,
    addEventListener(type, fn) { handlers[type] = fn; },
    fire(type, ev) { if (handlers[type]) handlers[type](ev); },
  };
}

/** 分页条元素替身 */
function stubPaginationEls(btns = []) {
  return {
    bar: { style: {} },
    pageTotal: { textContent: '' },
    pageNumbers: { innerHTML: '', querySelectorAll: (sel) => (sel === 'button[data-page]' ? btns : []) },
    btnPrev: { disabled: false },
    btnNext: { disabled: false },
    pageJumpInput: { max: '', value: '' },
  };
}

test('SubscriptionView：暴露预期接口且冻结', () => {
  ['statusTag', 'reviewStatusTag', 'prioCell', 'renderTable', 'renderPagination'].forEach((k) =>
    assert.strictEqual(typeof V[k], 'function', '缺少 ' + k));
  assert.strictEqual(Object.isFrozen(V), true);
});

test('statusTag：值→色块，空值/未知值都兜底 is-offline', () => {
  assert.strictEqual(V.statusTag('开发基线'), '<span class="st-tag is-dev">开发基线</span>');
  assert.strictEqual(V.statusTag('功能测试基线'), '<span class="st-tag is-test">功能测试基线</span>');
  assert.strictEqual(V.statusTag('正式版基线'), '<span class="st-tag is-official">正式版基线</span>');
  assert.strictEqual(V.statusTag('下线'), '<span class="st-tag is-offline">下线</span>');
  // 空值三态统一显示占位
  const dash = '<span class="st-tag is-offline">—</span>';
  assert.strictEqual(V.statusTag(''), dash);
  assert.strictEqual(V.statusTag(null), dash);
  assert.strictEqual(V.statusTag(undefined), dash);
  assert.strictEqual(V.statusTag('   '), dash);
  // 未收录的值：原样显示但按离线配色，不能被吞成占位
  assert.strictEqual(V.statusTag('未知状态'), '<span class="st-tag is-offline">未知状态</span>');
  // 两端空白先 trim，否则 '正式版基线 ' 会掉到未知分支
  assert.strictEqual(V.statusTag(' 正式版基线 '), '<span class="st-tag is-official">正式版基线</span>');
  // 插进 innerHTML 的内容必须转义
  assert.strictEqual(V.statusTag('<img>'), '<span class="st-tag is-offline">&lt;img&gt;</span>');
});

test('reviewStatusTag：裸值 00~04 → 中文 + 色块', () => {
  assert.strictEqual(V.reviewStatusTag('00'), '<span class="st-tag ">未审核</span>');
  assert.strictEqual(V.reviewStatusTag('01'), '<span class="st-tag is-soon">审核中</span>');
  assert.strictEqual(V.reviewStatusTag('02'), '<span class="st-tag is-soon">审核中</span>');
  assert.strictEqual(V.reviewStatusTag('03'), '<span class="st-tag is-official">审核完成</span>');
  assert.strictEqual(V.reviewStatusTag('04'), '<span class="st-tag is-offline">关闭</span>');
  // 空值 → 占位（不是「未审核」，未知才原样显示）
  const dash = '<span class="st-tag is-offline">—</span>';
  assert.strictEqual(V.reviewStatusTag(''), dash);
  assert.strictEqual(V.reviewStatusTag(null), dash);
  assert.strictEqual(V.reviewStatusTag(undefined), dash);
  // 未收录的裸值原样显示，不能假装成「审核中」
  assert.strictEqual(V.reviewStatusTag('99'), '<span class="st-tag is-offline">99</span>');
  assert.strictEqual(V.reviewStatusTag(' 03 '), '<span class="st-tag is-official">审核完成</span>');
  assert.strictEqual(V.reviewStatusTag('<b>'), '<span class="st-tag is-offline">&lt;b&gt;</span>');
});

test('prioCell：优先级单元格 = 色块 + 天数 + title 说明', () => {
  const html = V.prioCell({
    prodBatch: '2609批次',
    _prio: { level: 'critical', days: 2, text: '剩 2 天', next: '正式版基线', deadline: '2026-09-15' },
  });
  assert.strictEqual(html.indexOf('<td class="col-prio"'), 0);
  assert.ok(html.indexOf('class="prio-tag is-critical is-near"') > -1);   // 临期 → 加 is-near
  assert.ok(html.indexOf('>剩 2 天</span>') > -1);
  assert.ok(html.indexOf('title="2609批次：应于 2026-09-15 前转为正式版基线"') > -1);

  // 非临期（4 天）不加 is-near；已完成状态 = done 色块
  const far = V.prioCell({ prodBatch: 'B', _prio: { level: 'normal', days: 4, text: '剩 4 天', next: '正式版基线', deadline: '2026-09-15' } });
  assert.strictEqual(far.indexOf('is-near'), -1);
  assert.ok(far.indexOf('class="prio-tag is-normal"') > -1);

  // 未 decorate：退化占位分支仍然渲染出一格
  const none = V.prioCell({});
  assert.ok(none.indexOf('class="prio-tag is-unknown"') > -1);
  assert.ok(none.indexOf('>—</span>') > -1);

  // title 里的引号必须转义，否则会截断属性
  const risky = V.prioCell({ prodBatch: 'A"B', _prio: { level: 'x', days: 1, text: 't', next: '正式版基线', deadline: '2026-09-15' } });
  assert.ok(risky.indexOf('A&quot;B：应于') > -1);
});

test('renderTable：每行渲染 COLUMNS + 操作列，逾期整行标红', () => {
  const rows = [
    {
      publishSubcriptionId: 'a1', status: '正式版基线', prodReviewStatus: '03',
      serverCoding: 'S1', sysServeName: '服务名', prodBatch: '2609批次',
      _prio: { level: 'done', days: null, text: '已完成', next: '', deadline: '' },
    },
  ];
  const body = stubBody();
  V.renderTable(body, rows, {});

  const html = body.innerHTML;
  // 每行 = 数据列 + 1 个操作列
  assert.strictEqual(html.split('<td').length - 1, M.COLUMNS.length + 1);
  assert.ok(html.indexOf('<tr class="" data-index="0">') > -1);
  assert.ok(html.indexOf('data-jump="0"') > -1);
  assert.ok(html.indexOf('查 看') > -1);
  // 状态列与审核列走标签渲染，并带复制属性
  assert.ok(html.indexOf('<td class="col-st copy-cell" data-copy="正式版基线" title="点击复制">') > -1);
  assert.ok(html.indexOf('<span class="st-tag is-official">正式版基线</span>') > -1);
  assert.ok(html.indexOf('<td class="col-review copy-cell" data-copy="03" title="点击复制">') > -1);
  assert.ok(html.indexOf('<span class="st-tag is-official">审核完成</span>') > -1);
  // 优先级列自带 col-prio（不能被包装成普通数据格）
  assert.strictEqual(html.indexOf('<td class=" col-prio">'), -1);
  assert.ok(html.indexOf('<td class="col-prio" title=') > -1);
  // 等宽列（接口编码）加 cell-code
  assert.ok(html.indexOf('cell-wrap cell-code copy-cell') > -1);
  assert.ok(html.indexOf('data-copy="S1"') > -1);

  // 逾期 → tr 加 is-overdue
  const overdueBody = stubBody();
  V.renderTable(overdueBody, [{ publishSubcriptionId: 'a2', _prio: { level: 'overdue', days: -2, text: '逾期 2 天', next: '正式版基线', deadline: '2026-09-15', overdue: true } }], {});
  assert.ok(overdueBody.innerHTML.indexOf('<tr class="is-overdue" data-index="0">') > -1);
});

test('renderTable：字段兜底为 —、空值复制串为空；空数组清空 tbody', () => {
  const body = stubBody();
  V.renderTable(body, [{ publishSubcriptionId: 'a3', isBackup: null }], {});
  const html = body.innerHTML;
  assert.ok(html.indexOf('<span class="cell-clamp">—</span>') > -1);   // 缺字段占位
  assert.ok(html.indexOf('data-copy=""') > -1);                        // null → 空复制串
  // 数值 0 是有效值：显示 0，不能渲染成占位
  const zeroBody = stubBody();
  V.renderTable(zeroBody, [{ publishSubcriptionId: 'a4', sysNo: 0 }], {});
  assert.ok(zeroBody.innerHTML.indexOf('<span class="cell-clamp">0</span>') > -1);
  assert.ok(zeroBody.innerHTML.indexOf('data-copy="0"') > -1);

  // 空结果 → tbody 清空（空态由调用方判断）
  const emptyBody = stubBody();
  V.renderTable(emptyBody, [], {});
  assert.strictEqual(emptyBody.innerHTML, '');
  V.renderTable(emptyBody, null, {});
  assert.strictEqual(emptyBody.innerHTML, '');
});

test('renderTable：特殊字符转义（防 HTML 注入）', () => {
  const body = stubBody();
  V.renderTable(body, [{ publishSubcriptionId: 'a5', sysServeName: '<img src=x onerror=1>', serverCoding: 'A&B' }], {});
  const html = body.innerHTML;
  assert.strictEqual(html.indexOf('<img'), -1);
  assert.ok(html.indexOf('&lt;img src=x onerror=1&gt;') > -1);
  assert.ok(html.indexOf('data-copy="A&amp;B"') > -1);
});

test('renderTable：查 看 / 复制 的事件回传到 opts 回调', () => {
  const rows = [
    { publishSubcriptionId: 'r0', serverCoding: 'S0' },
    { publishSubcriptionId: 'r1', serverCoding: 'S1' },
  ];
  const jumpEls = rows.map((_, i) => stubEl({ jump: String(i) }));
  const copyEls = [stubEl({ copy: 'S0' })];
  const body = stubBody(jumpEls, copyEls);
  const jumped = [];
  const copied = [];
  V.renderTable(body, rows, { onJump: (r) => jumped.push(r), onCopy: (t) => copied.push(t) });

  jumpEls[1].fire('click');
  assert.deepStrictEqual(jumped.map((r) => r.publishSubcriptionId), ['r1']);   // 按行对象回传，不靠下标找

  let stopped = false;
  copyEls[0].fire('click', { stopPropagation: () => { stopped = true; } });
  assert.deepStrictEqual(copied, ['S0']);
  assert.strictEqual(stopped, true);        // 复制要阻止冒泡，否则会触发整行的其它行为

  // 没给回调时不抛
  const silent = stubBody([stubEl({ jump: '0' })], [stubEl({ copy: 'x' })]);
  V.renderTable(silent, [{ publishSubcriptionId: 'r2' }], {});
  silent._jumps[0].fire('click');
  silent._copies[0].fire('click', { stopPropagation() {} });
});

test('renderPagination：条数未超下限 / 未查询过 → 整条隐藏', () => {
  const els = stubPaginationEls();
  V.renderPagination(els, { pageNum: 1, total: 0, pages: 0, queried: false, onGoto: () => {} });
  assert.strictEqual(els.bar.style.display, 'none');
  // 条数文案仍要同步（避免隐藏后留着上一轮旧数字）
  assert.ok(els.pageTotal.textContent.indexOf('共 0 条') > -1);

  // 正好等于 MIN_PAGE_SIZE 也不显示；超过一条才显示
  const els2 = stubPaginationEls();
  V.renderPagination(els2, { pageNum: 1, total: M.MIN_PAGE_SIZE, pages: 1, queried: true, onGoto: () => {} });
  assert.strictEqual(els2.bar.style.display, 'none');

  const els3 = stubPaginationEls();
  V.renderPagination(els3, { pageNum: 1, total: M.MIN_PAGE_SIZE + 1, pages: 2, queried: true, onGoto: () => {} });
  assert.strictEqual(els3.bar.style.display, '');

  // total 有值但从未查询过 → 仍然隐藏
  const els4 = stubPaginationEls();
  V.renderPagination(els4, { pageNum: 1, total: 100, pages: 10, queried: false, onGoto: () => {} });
  assert.strictEqual(els4.bar.style.display, 'none');
});

test('renderPagination：页码条 / 上下页禁用 / 跳页框同步', () => {
  const btns = [{ dataset: { page: '3' }, addEventListener: () => {} }];
  const els = stubPaginationEls(btns);
  V.renderPagination(els, { pageNum: 2, total: 25, pages: 3, queried: true, onGoto: () => {} });

  assert.ok(els.pageTotal.textContent.indexOf('共') > -1);
  assert.ok(els.pageTotal.textContent.indexOf('25') > -1);
  assert.strictEqual(els.bar.style.display, '');
  assert.ok(els.pageNumbers.innerHTML.indexOf('data-page="1"') > -1);
  assert.ok(els.pageNumbers.innerHTML.indexOf('data-page="3"') > -1);
  assert.ok(els.pageNumbers.innerHTML.indexOf('data-page="2" class="is-current">2') > -1);
  // 第 2 页：上一页可点、下一页可点
  assert.strictEqual(els.btnPrev.disabled, false);
  assert.strictEqual(els.btnNext.disabled, false);
  assert.strictEqual(els.pageJumpInput.max, '3');
  assert.strictEqual(els.pageJumpInput.value, '2');

  // 首页 → 上一页禁用；末页 → 下一页禁用
  const first = stubPaginationEls();
  V.renderPagination(first, { pageNum: 1, total: 25, pages: 3, queried: true, onGoto: () => {} });
  assert.strictEqual(first.btnPrev.disabled, true);
  assert.strictEqual(first.btnNext.disabled, false);

  const last = stubPaginationEls();
  V.renderPagination(last, { pageNum: 3, total: 25, pages: 3, queried: true, onGoto: () => {} });
  assert.strictEqual(last.btnPrev.disabled, false);
  assert.strictEqual(last.btnNext.disabled, true);

  // pages 传 0（无数据）时不能把上一页/下一页都放开
  const zero = stubPaginationEls();
  V.renderPagination(zero, { pageNum: 1, total: 11, pages: 0, queried: true, onGoto: () => {} });
  assert.strictEqual(zero.btnPrev.disabled, true);
  assert.strictEqual(zero.btnNext.disabled, true);
});

test('renderPagination：页码按钮点击回传数字页码', () => {
  const el = stubEl({ page: '3' });
  const els = stubPaginationEls([el]);
  const goto = [];
  V.renderPagination(els, { pageNum: 1, total: 100, pages: 10, queried: true, onGoto: (n) => goto.push(n) });
  el.fire('click');
  assert.deepStrictEqual(goto, [3]);          // 字符串 dataset → Number

  // 没给 onGoto 时点击不抛
  const el2 = stubEl({ page: '2' });
  const els2 = stubPaginationEls([el2]);
  V.renderPagination(els2, { pageNum: 1, total: 100, pages: 10, queried: true });
  el2.fire('click');
  assert.deepStrictEqual(goto, [3]);
});
