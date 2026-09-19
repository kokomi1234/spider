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

// ── 2026-09-20「面板展开时 ✕ 被藏」修复相关的取名口径 ──────────────
// 那次改的是「✕ 什么时候可见」和 theme.css 的图标槽位，**没有**动取名。
// 下面两条钉住「改名规则没被顺手带跑」；DOM 级的那半（输入框仍叫字段名、
// ✕ 仍叫「清除选择」，展开态和清除后都不变）在 boundary-ui.test.js 的
// 「可访问名称不串味」一条里 —— 那个文件才有能建组件的假 DOM。

test('选项不参与取名：宿主里已有 value==="" 的「全部/不限」option 时，名字仍只取 label/aria-label', () => {
  const nameOf = load();
  // 真实形态：静态 <select> 自带 <option value="">全部</option>，字典灌进来的是别的项。
  // 有人想把「当前显示的那项」当名字（读屏会念成「全部」，用户不知道这栏是什么），这里钉死。
  const el = fakeEl({
    id: 'f_serviceStatus',
    labels: [{ textContent: '服务状态' }],
    options: [{ textContent: '全部', value: '' }, { textContent: '在用', value: '1' }],
    attrs: { placeholder: '请输入或选择' },
  });
  assert.strictEqual(nameOf(el, {}), '服务状态');
  // 反过来：显式传的字段名仍然最大，选项文案与 placeholder 都插不进来
  assert.strictEqual(nameOf(el, { label: '服务状态（多选）' }), '服务状态（多选）');
});

test('.msel 多选共用口径不变：label 是兄弟（无 for）时仍取同组 label，不被 title 抢先', () => {
  const nameOf = load();
  // multi-select.js 只 factory.accessibleNameOf(host) 这一处用到本文件，
  // 宿主是 <div class="msel">、旁边一个没写 for 的 label —— 走「同组 label」那一条。
  const mselHost = fakeEl({
    labels: [], id: '',
    attrs: { title: '每页条数', 'aria-placeholder': '全部批次' },
    closest: {
      'label': null,
      '.form-group,.sub-row,.doc-filter-item,.field,.filter-item': {
        querySelector: () => ({ textContent: ' 排期批次（可多选） ' }),
      },
    },
  });
  assert.strictEqual(nameOf(mselHost, {}), '排期批次（可多选）',
    '同组 label 优先于 title；换成 title 就说明多选那侧的读屏名字会集体变样');
});
