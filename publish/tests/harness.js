/**
 * 极简测试脚手架（零依赖，纯 node）
 *
 * 页面脚本都是浏览器 IIFE，靠 window.X 暴露接口。这里用 new Function 注入 window
 * 执行它们 —— 刻意不用 vm.runInNewContext：新 realm 的 Date 与外层的 Date 不
 * 同源，assert 比较日期会踩 instanceof / 引用不相等的坑。
 *
 * 用法：node tests/run.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/**
 * 执行一个浏览器脚本，返回它挂到 window 上的对象。
 * @param {string} relPath 相对 publish/ 的路径
 * @param {object} [globals] 需要 stub 的浏览器全局（document / Blob / URL / setTimeout）
 * @param {object} [win] 复用同一个 window，让多个脚本能互相看到对方挂上去的东西
 *                       （如先加载 format.js，再让 table-utils.js 用到真正的 Fmt.esc）
 */
function loadScript(relPath, globals = {}, win = {}) {
  const file = path.join(ROOT, relPath);
  const code = fs.readFileSync(file, 'utf8');
  const fn = new Function(
    'window', 'document', 'Blob', 'URL', 'setTimeout',
    '"use strict";' + code,
  );
  fn(win, globals.document, globals.Blob, globals.URL, globals.setTimeout);
  return win;
}

const registry = [];

/** 注册一条用例；由各 *.test.js 在 require 时调用 */
function test(name, fn) {
  registry.push({ name, fn });
}

/** 跑全部已注册用例；有失败则设置 exitCode = 1 */
function runAll() {
  let pass = 0;
  const failures = [];

  for (const t of registry) {
    try {
      t.fn();
      pass += 1;
      console.log('  ✓ ' + t.name);
    } catch (e) {
      failures.push({ name: t.name, err: e });
      console.log('  ✗ ' + t.name);
    }
  }

  console.log(`\n${pass}/${registry.length} 通过`);
  if (failures.length) {
    for (const f of failures) {
      console.log(`\n✗ ${f.name}`);
      console.log('  ' + ((f.err && f.err.message) || f.err));
    }
    process.exitCode = 1;
  }
}

module.exports = { ROOT, loadScript, test, runAll };
