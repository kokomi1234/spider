/**
 * searchable-select.js 的 accessibleNameOf —— 全站「可访问名称」口径的唯一来源。
 * 可搜索下拉与多选都用它，所以取名顺序一旦写错，三页的读屏体验会一起坏掉。
 * 假 DOM 只提供这个函数用到的那几件事：getAttribute / labels / id / closest / textContent。
 */
'use strict';

const assert = require('assert');
const { loadScript, test } = require('./harness');

function fakeEl(opts = {}) {
  const attrs = Object.assign({}, opts.attrs);
  const el = {
    id: opts.id || '',
    textContent: opts.text || '',
    attrs,
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    labels: opts.labels,
    closest(sel) {
      // 只需要区分「包裹式 label」与「表单组容器」两类，按调用方给的映射返回
      const m = opts.closest || {};
      return m[sel] || null;
    },
  };
  return el;
}

function load(extraDoc = {}) {
  const doc = Object.assign({ querySelector: () => null }, extraDoc);
  const win = loadScript('js/ui/searchable-select.js', { document: doc });
  return win.createSearchableSelect.accessibleNameOf;
}

test('取名优先级 1：调用方显式传的 label 最大（评委行那种没有 label 的控件靠它）', () => {
  const nameOf = load();
  const el = fakeEl({ text: '页面文案', labels: [{ textContent: '关联标签' }] });
  assert.strictEqual(nameOf(el, { label: '评委工号' }), '评委工号');
  assert.strictEqual(nameOf(el, { label: '  评委工号  ' }), '评委工号', '要 trim');
});

test('取名优先级 2：宿主自己已有的 aria-label 直接用，不必再去捞 label', () => {
  const nameOf = load();
  const el = fakeEl({ attrs: { 'aria-label': '每页条数' }, labels: [{ textContent: '别的名' }] });
  assert.strictEqual(nameOf(el, {}), '每页条数');
});

test('取名优先级 3：.labels 覆盖 for 型与包裹式；取不到才按 id 查', () => {
  const nameOf = load();
  const el = fakeEl({ labels: [{ textContent: '牵头部门 ' }] });
  assert.strictEqual(nameOf(el, {}), '牵头部门');
  // 老浏览器/假 DOM 没有 .labels：退到按 id 找 label[for]
  const byId = fakeEl({ id: 'f_deptName', labels: [], attrs: {} });
  const nameOf2 = load({
    querySelector: (sel) => (sel === 'label[for="f_deptName"]' ? { textContent: '部门名称' } : null),
  });
  assert.strictEqual(nameOf2(byId, {}), '部门名称');
});

test('取名优先级 4/5：都没有时退到同组 label，再退到 title', () => {
  const nameOf = load();
  const group = fakeEl({
    labels: [], id: 'x',
    closest: { 'label': null, '.form-group,.sub-row,.doc-filter-item,.field,.filter-item': { querySelector: () => ({ textContent: '调用方系统' }) } },
  });
  assert.strictEqual(nameOf(group, {}), '调用方系统');
  const titled = fakeEl({ labels: [], id: '', attrs: { title: '每页条数' }, closest: { 'label': null } });
  assert.strictEqual(nameOf(titled, {}), '每页条数');
});

test('取不到名字就返回空串（宁可不写 aria-label，也不写一个空的）', () => {
  const nameOf = load();
  const bare = fakeEl({ labels: [], attrs: {}, closest: { 'label': null } });
  assert.strictEqual(nameOf(bare, {}), '');
  assert.strictEqual(nameOf(null, {}), '', '宿主都不该要求调用方先判空');
  assert.strictEqual(nameOf({}, {}), '', '假元素缺方法也不能抛');
});

test('文案里的换行与连续空白要压成一个空格（label 常写成多行）', () => {
  const nameOf = load();
  const el = fakeEl({ labels: [{ textContent: '  提供方\n  最新变更批次  ' }] });
  assert.strictEqual(nameOf(el, {}), '提供方 最新变更批次');
});
