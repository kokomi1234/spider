'use strict';
/**
 * 无头浏览器冒烟测试（抓「脚本加载顺序 / 模块接线」类回归）
 *
 * 用法：
 *   node tests/smoke-browser.js
 *   SMOKE_CHROME_PATH=/path/to/chrome node tests/smoke-browser.js
 *
 * 内网使用前提：
 *   - 有 node（>=18）即可，不依赖 npm install、不依赖联网、不下载浏览器。
 *   - 需要本机装了 Google Chrome（用其内核跑无头）。会自动探测常见安装位置，
 *     找不到时设置环境变量 SMOKE_CHROME_PATH 指到 chrome 可执行文件。
 *   - 不依赖后端 / 代理：接口 404 是环境噪音（页面已 catch），不算失败。
 *   - playwright-core 已 vendoring 在 publish/vendor/playwright-core（零依赖）。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('../vendor/playwright-core');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json' };

function findChrome() {
  if (process.env.SMOKE_CHROME_PATH) return process.env.SMOKE_CHROME_PATH;
  const cands = [];
  if (process.platform === 'darwin') {
    cands.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  } else if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    cands.push(path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'));
    cands.push(path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'));
  } else {
    cands.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome');
  }
  for (const c of cands) {
    try { fs.accessSync(c, fs.constants.X_OK); return c; } catch {}
  }
  return null;
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = path.join(ROOT, p);
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('nf'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const PAGES = [
  { name: '首页 index.html', file: 'index.html', globals: ['Fmt', 'toast', 'API', 'PublishResponse', 'TableUtils', 'DetailDialog', 'DictSelects', 'CsvExporter', 'SubscribeDialog', 'SubscribeManager', 'ServiceApi', 'UserApi', 'DialogUtils', 'PopupPosition'] },
  // 注：people-search.js 是自动初始化的页面内模块、不暴露任何全局；task.html 也没引 dialog-utils.js
  { name: '任务单 task.html', file: 'task.html', globals: ['Fmt', 'toast', 'API', 'TableUtils', 'CsvExporter', 'TaskApi', 'PopupPosition'] },
  { name: '订阅 subscription.html', file: 'subscription.html', globals: ['Fmt', 'toast', 'API', 'TableUtils', 'SubscriptionBatchTimes', 'Priority', 'CsvExporter', 'createDatePicker', 'PopupPosition'] },
];

(async () => {
  const chromePath = findChrome();
  if (!chromePath) {
    console.error('未找到 Google Chrome。请安装 Chrome，或用 SMOKE_CHROME_PATH 指定其可执行文件路径。');
    process.exit(2);
  }
  const server = await startServer();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/`;
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  let anyFail = false;

  for (const pg of PAGES) {
    const page = await browser.newPage();
    const errors = [];
    const pageErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => pageErrors.push(e.message));
    process.stdout.write(`\n=== ${pg.name} ===\n`);
    try {
      await page.goto(base + pg.file, { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(1200);
      const missing = await page.evaluate((names) =>
        names.filter((n) => typeof window[n] === 'undefined'), pg.globals);
      const uncaught = await page.evaluate(() =>
        (window.AppRuntime && typeof window.AppRuntime.uncaughtCount === 'function')
          ? window.AppRuntime.uncaughtCount() : 0);
      const bootstrapErrs = errors.filter((e) => /依赖|缺失|未定义|not defined|missing/i.test(e));
      // console 噪音（接口 404 等）只统计不判失败；判失败看 pageerror + bootstrap 兜底计数。
      // 原先这里用 /404|加载失败|nf$/ 过滤「真报错」，会把文案里带这些字样的真异常一起吞掉。
      const noise = errors.filter((e) => /Failed to load resource|\b404\b|net::ERR|加载失败/i.test(e));
      const realErrs = errors.filter((e) => !noise.includes(e));
      process.stdout.write(`  全局缺失: ${missing.length ? missing.join(', ') : '无'}\n`);
      process.stdout.write(`  pageerror(未捕获异常): ${pageErrors.length ? pageErrors.join(' | ') : '无'}\n`);
      process.stdout.write(`  console.error: 共 ${errors.length} 条（环境噪音 ${noise.length} 条，疑似真报错 ${realErrs.length} 条）\n`);
      process.stdout.write(`  bootstrap 兜住的未捕获异常: ${uncaught}\n`);

      // SMOKE_DUMP_CONSOLE=1 时逐条打印 console.error 明细，用于人工溯源「环境噪音」判定是否准确。
      // 默认不打印，避免日常跑测试时被无后端固有的接口失败日志刷屏。
      if (process.env.SMOKE_DUMP_CONSOLE) {
        errors.forEach((e, i) =>
          process.stdout.write(`    [console ${i + 1}/${errors.length}] ${e.replace(/\s+/g, ' ').slice(0, 220)}\n`));
      }
      realErrs.forEach((e) => process.stdout.write(`    [真报错] ${e}\n`));

      if (pg.file === 'index.html') {
        // 空态 colspan 必须等于表头列数，且模板占位符真的被求值过
        // （曾把 `${常量}` 写进单引号字符串里，页面会原样显示 "${RESULT_COL_COUNT}"）
        const emptyCell = await page.evaluate(() => {
          const td = document.querySelector('#resultBody td[colspan]');
          const ths = document.querySelectorAll('.result-table thead th').length;
          return td ? { colspan: Number(td.getAttribute('colspan')), ths } : { colspan: 0, ths };
        });
        process.stdout.write(`  结果表空态: colspan=${emptyCell.colspan} 表头列数=${emptyCell.ths}\n`);
        if (emptyCell.colspan !== emptyCell.ths) {
          process.stdout.write('    [FAIL] 空态 colspan 与表头列数不一致（或被写成了未求值的模板占位符）\n');
          anyFail = true;
        }

        // 日期面板「浮动」回归：面板落在滚动容器里时必须升到 body + fixed，
        // 否则会被容器的 overflow 裁掉（订阅页的批次时间弹窗已改成年月下拉，
        // 这里临时造一个滚动容器直接验组件行为）。
        const floatCheck = await page.evaluate(() => {
          if (typeof window.createDatePicker !== 'function') return { err: 'createDatePicker 缺失' };
          const box = document.createElement('div');
          box.style.cssText = 'position:fixed;left:24px;top:24px;width:200px;height:120px;'
            + 'overflow:auto;background:#fff;z-index:9999';
          const input = document.createElement('input');
          input.type = 'text';
          box.appendChild(input);
          document.body.appendChild(box);
          let panel = null;
          try {
            window.createDatePicker(input);
            input.click();
            panel = document.querySelector('.dp-panel:not([hidden])');
            if (!panel) return { err: '面板未打开' };
            const pr = panel.getBoundingClientRect();
            return {
              floating: panel.classList.contains('is-floating'),
              inBody: panel.parentElement === document.body,
              visible: pr.top >= -1 && pr.bottom <= window.innerHeight + 1 && pr.width > 0,
            };
          } finally {
            if (panel) panel.remove();
            box.remove();
          }
        });
        process.stdout.write(`  日期面板浮动: ${JSON.stringify(floatCheck)}\n`);
        if (!floatCheck.floating || !floatCheck.inBody || !floatCheck.visible) {
          process.stdout.write(`    [FAIL] 日期面板仍会被滚动容器裁剪：${JSON.stringify(floatCheck)}\n`);
          anyFail = true;
        }
      }

      if (pg.file === 'index.html') {
        // DialogUtils 的通用输入 / 确认弹窗（替代 window.prompt / confirm）：
        // 打开 → 有输入框 → 确认拿到 trim 后的值；确认框走取消返回 false。
        const dlgCheck = await page.evaluate(async () => {
          const out = {};
          if (!window.DialogUtils || typeof window.DialogUtils.promptText !== 'function') {
            return { err: 'DialogUtils 缺少 promptText / confirmBox' };
          }
          const p1 = window.DialogUtils.promptText({ title: '冒烟探针', label: '编码', value: '  E00301  ' });
          await new Promise((r) => setTimeout(r, 60));
          const overlay = document.querySelector('.dlg-util-overlay');
          out.opened = !!overlay;
          out.hasInput = !!(overlay && overlay.querySelector('input'));
          if (overlay) overlay.querySelector('.sub-foot .filled').click();
          out.promptValue = await p1;

          const p2 = window.DialogUtils.confirmBox({ title: '冒烟探针', message: '点取消' });
          await new Promise((r) => setTimeout(r, 60));
          const ov2 = document.querySelector('.dlg-util-overlay');
          out.confirmOpened = !!ov2;
          if (ov2) ov2.querySelector('.sub-foot .outlined').click();
          out.confirmValue = await p2;
          out.cleaned = document.querySelectorAll('.dlg-util-overlay').length === 0;
          return out;
        });
        process.stdout.write(`  DialogUtils 弹窗: ${JSON.stringify(dlgCheck)}\n`);
        if (dlgCheck.err || !dlgCheck.opened || !dlgCheck.hasInput
          || dlgCheck.promptValue !== 'E00301' || dlgCheck.confirmValue !== false || !dlgCheck.cleaned) {
          process.stdout.write(`    [FAIL] 自定义弹窗接线异常：${JSON.stringify(dlgCheck)}\n`);
          anyFail = true;
        }
      }

      if (pg.file === 'index.html') {
        // 下拉面板定位回归（searchable-select / multi-select 共用 js/ui/popup-position.js）：
        //   (a) 贴近视口底部 → 面板必须完整落在视口内（翻上，不被裁）；
        //   (b) 弹窗滚动容器内（.sub-body overflow:auto）→ 面板升到 body + fixed，不被容器裁掉；
        //   (c) 点面板内部不误关（onDocMouseDown 修复：浮动后面板在 body，container 已不含它）。
        const popupCheck = await page.evaluate(() => {
          const out = {};
          const opts = Array.from({ length: 30 }, (_, i) => ({ value: 'v' + i, label: '选项' + i }));

          // 造一个「贴近视口底部、可滚动」的固定容器，触发浮动 + 翻上
          function makeBox() {
            const box = document.createElement('div');
            box.style.cssText = 'position:fixed;left:20px;bottom:10px;width:220px;height:140px;'
              + 'overflow:auto;background:#fff;border:1px solid #ccc;z-index:9999';
            const inner = document.createElement('div');
            inner.style.cssText = 'height:600px;padding:4px';
            box.appendChild(inner);
            document.body.appendChild(box);
            return { box, inner };
          }

          // ── (a)+(c) searchable-select ──
          try {
            const { box, inner } = makeBox();
            const sel = document.createElement('select');
            inner.appendChild(sel);
            const inst = window.createSearchableSelect(sel, opts);
            const container = sel.nextElementSibling;     // .searchable-select
            inst.open();
            const panel = Array.prototype.slice.call(document.querySelectorAll('.searchable-select-dropdown'))
              .find((p) => p.classList.contains('is-floating') || getComputedStyle(p).display !== 'none');
            const pr = panel.getBoundingClientRect();
            out.searchable = {
              floating: panel.classList.contains('is-floating'),
              inViewport: pr.top >= 0 && pr.bottom <= window.innerHeight,
              hasOption: !!panel.querySelector('.searchable-select-option'),
              top: Math.round(pr.top), bottom: Math.round(pr.bottom),
            };
            // (c) 浮动模式下面板在 body，点面板内部选项不应误关
            const opt = panel.querySelector('.searchable-select-option');
            if (opt) opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            out.searchable.stillOpen = container.classList.contains('is-open');
            inst.destroy();
            box.remove();
          } catch (e) { out.searchable = { err: String(e && e.message || e) }; }

          // ── (a)+(c) multi-select（仅当本页加载了 multi-select.js；index 页不引入，改在 task.html 验证）──
          if (typeof window.createMultiSelect === 'function') {
            try {
              const { box, inner } = makeBox();
              const host = document.createElement('div');
              host.className = 'msel';
              inner.appendChild(host);
              window.createMultiSelect(host, opts, '全部');
              // createMultiSelect 没暴露 open()，用真实交互（点 display）触发，确保 place() 跑起来
              host.querySelector('.msel-display').click();
              const panelM = Array.prototype.slice.call(document.querySelectorAll('.msel-panel'))
                .find((p) => p.classList.contains('is-floating') || getComputedStyle(p).display !== 'none');
              const prM = panelM.getBoundingClientRect();
              out.multi = {
                floating: panelM.classList.contains('is-floating'),
                inViewport: prM.top >= 0 && prM.bottom <= window.innerHeight,
                hasOption: !!panelM.querySelector('.msel-item'),
                top: Math.round(prM.top), bottom: Math.round(prM.bottom),
              };
              const optM = panelM.querySelector('.msel-item');
              if (optM) optM.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
              out.multi.stillOpen = host.classList.contains('is-open');
              host.remove();
              box.remove();
            } catch (e) { out.multi = { err: String(e && e.message || e) }; }
          } else {
            out.multi = { skipped: '本页未加载 multi-select.js，改在 task.html 验证' };
          }

          // ── (b) 弹窗滚动容器内（.sub-body overflow:auto）──
          try {
            const overlay = document.getElementById('subscribeOverlay');
            overlay.classList.add('show');
            const dialog = overlay.querySelector('.sub-dialog');
            const beforeMax = dialog.style.maxHeight;
            dialog.style.maxHeight = (window.innerHeight - 24) + 'px';   // 让 .sub-body 底部贴近视口底部
            const subBody = overlay.querySelector('.sub-body');
            const selB = document.createElement('select');
            subBody.appendChild(selB);                 // 放到内容末尾，才能滚到容器可视区底部
            const instB = window.createSearchableSelect(selB, opts);
            const ctl = selB.nextElementSibling;
            subBody.scrollTop = subBody.scrollHeight;    // 滚到底 → 控件贴近容器可视区底部
            const sbRect = subBody.getBoundingClientRect();
            const cRect = ctl.getBoundingClientRect();
            instB.open();
            const panelB = Array.prototype.slice.call(document.querySelectorAll('.searchable-select-dropdown'))
              .find((p) => p.classList.contains('is-floating') || getComputedStyle(p).display !== 'none');
            const prB = panelB.getBoundingClientRect();
            const bodyRect = subBody.getBoundingClientRect();
            const vh = window.innerHeight;
            const visTop = Math.max(0, prB.top);
            const visBottom = Math.min(vh, prB.bottom);
            const ratio = prB.height > 0 ? (visBottom - visTop) / prB.height : 0;
            out.subBody = {
              floating: panelB.classList.contains('is-floating'),
              inBody: panelB.parentElement === document.body,
              panelBottom: Math.round(prB.bottom),
              bodyBottom: Math.round(bodyRect.bottom),
              ratio: Math.round(ratio * 100) / 100,
              // 浮动面板已脱离容器，不会被 .sub-body 的 overflow 裁掉；这里核对「面板底不超出视口」
              notClipped: prB.bottom <= vh + 1,
              ctrlTop: Math.round(cRect.top), ctrlBottom: Math.round(cRect.bottom),
            };
            instB.destroy();
            selB.remove();
            dialog.style.maxHeight = beforeMax;
            overlay.classList.remove('show');
          } catch (e) { out.subBody = { err: String(e && e.message || e) }; }

          return out;
        });
        process.stdout.write(`  下拉定位: ${JSON.stringify(popupCheck)}\n`);
        const fails = [];
        const s = popupCheck.searchable || {};
        const m = popupCheck.multi || {};
        const b = popupCheck.subBody || {};
        if (s.err || !s.floating || !s.inViewport || !s.hasOption) {
          fails.push('searchable 面板未浮动/未完整可见/无选项：' + JSON.stringify(s));
        }
        if (s.stillOpen !== true) fails.push('searchable 点面板内部被误关：' + JSON.stringify(s));
        if (m && !m.skipped) {
          if (m.err || !m.floating || !m.inViewport || !m.hasOption) {
            fails.push('multi 面板未浮动/未完整可见/无选项：' + JSON.stringify(m));
          }
          if (m.stillOpen !== true) fails.push('multi 点面板内部被误关：' + JSON.stringify(m));
        }
        if (b.err || !b.floating || b.inBody !== true || b.ratio < 0.9 || !b.notClipped) {
          fails.push('弹窗容器内下拉被裁/未浮动/可见比例不足：' + JSON.stringify(b));
        }
        fails.forEach((f) => process.stdout.write('    [FAIL] ' + f + '\n'));
        if (fails.length) anyFail = true;

        // ── 非浮动分支回归（无滚动祖先 → 留在 wrapper、翻上 is-dropup）──
        // 造一个固定、贴近视口底部、且没有可滚动祖先（无 overflow、无超高内部）的容器，
        // 面板必须留在 wrapper 内（floating=false）、且翻上（is-dropup）后完整落在视口里 ——
        // 这正是修复前「只剩 2% 可见」的那个场景，冒烟只验浮动分支会漏掉它。
        const nfCheck = await page.evaluate(() => {
          const out = {};
          const opts = Array.from({ length: 30 }, (_, i) => ({ value: 'v' + i, label: '选项' + i }));
          function makeBoxNF() {
            // 注意：没有 overflow、没有超高内部 → scrollParentOf 命中不了 → 非浮动
            const box = document.createElement('div');
            box.style.cssText = 'position:fixed;left:40px;bottom:10px;width:260px;'
              + 'background:#fff;border:1px solid #ccc;z-index:9999';
            document.body.appendChild(box);
            return box;
          }
          function ratioOf(pr) {
            const vh = window.innerHeight;
            const visTop = Math.max(0, pr.top);
            const visBottom = Math.min(vh, pr.bottom);
            return pr.height > 0 ? (visBottom - visTop) / pr.height : 0;
          }
          // searchable-select
          try {
            const box = makeBoxNF();
            const sel = document.createElement('select');
            box.appendChild(sel);
            const inst = window.createSearchableSelect(sel, opts);
            const container = sel.nextElementSibling;     // .searchable-select
            inst.open();
            const panel = box.querySelector('.searchable-select-dropdown');
            const pr = panel.getBoundingClientRect();
            out.searchable = {
              floating: panel.classList.contains('is-floating'),
              inBody: panel.parentElement === document.body,
              wrapperDropup: container.classList.contains('is-dropup'),
              inViewport: pr.top >= 0 && pr.bottom <= window.innerHeight,
              ratio: Math.round(ratioOf(pr) * 100) / 100,
              hasOption: !!panel.querySelector('.searchable-select-option'),
              top: Math.round(pr.top), bottom: Math.round(pr.bottom),
            };
            inst.destroy();
            box.remove();
          } catch (e) { out.searchable = { err: String(e && e.message || e) }; }
          // multi-select（index 页未加载 multi-select.js → skipped）
          if (typeof window.createMultiSelect === 'function') {
            try {
              const box = makeBoxNF();
              const host = document.createElement('div');
              host.className = 'msel';
              box.appendChild(host);
              window.createMultiSelect(host, opts, '全部');
              host.querySelector('.msel-display').click();
              const panelM = host.querySelector('.msel-panel');
              const prM = panelM.getBoundingClientRect();
              out.multi = {
                floating: panelM.classList.contains('is-floating'),
                inBody: panelM.parentElement === document.body,
                wrapperDropup: host.classList.contains('is-dropup'),
                inViewport: prM.top >= 0 && prM.bottom <= window.innerHeight,
                ratio: Math.round(ratioOf(prM) * 100) / 100,
                hasOption: !!panelM.querySelector('.msel-item'),
                top: Math.round(prM.top), bottom: Math.round(prM.bottom),
              };
              host.remove();
              box.remove();
            } catch (e) { out.multi = { err: String(e && e.message || e) }; }
          } else {
            out.multi = { skipped: '本页未加载 multi-select.js，改在 task.html / subscription.html 验证' };
          }
          return out;
        });
        process.stdout.write(`  下拉定位(非浮动): ${JSON.stringify(nfCheck)}\n`);
        {
          const nFails = [];
          const ns = nfCheck.searchable || {};
          const nm = nfCheck.multi || {};
          if (ns.err || ns.floating !== false || ns.inBody !== false || !ns.wrapperDropup
            || !ns.inViewport || ns.ratio < 0.9 || !ns.hasOption) {
            nFails.push('非浮动 searchable 未翻上/出视口/可见比例不足：' + JSON.stringify(ns));
          }
          if (nm && !nm.skipped) {
            if (nm.err || nm.floating !== false || nm.inBody !== false || !nm.wrapperDropup
              || !nm.inViewport || nm.ratio < 0.9 || !nm.hasOption) {
              nFails.push('非浮动 multi 未翻上/出视口/可见比例不足：' + JSON.stringify(nm));
            }
          }
          nFails.forEach((f) => process.stdout.write('    [FAIL] ' + f + '\n'));
          if (nFails.length) anyFail = true;
        }
      }

      if (pg.file === 'subscription.html') {
        const clickErr = [];
        page.on('pageerror', (e) => clickErr.push(e.message));

        // ── 非浮动分支回归（无滚动祖先 → 留在 wrapper、翻上 is-dropup）──
        // subscription.html 同样加载了 searchable-select 与 multi-select，两种都验非浮动翻上。
        const subNfCheck = await page.evaluate(() => {
          const out = {};
          const opts = Array.from({ length: 30 }, (_, i) => ({ value: 'v' + i, label: '选项' + i }));
          function makeBoxNF() {
            const box = document.createElement('div');
            box.style.cssText = 'position:fixed;left:40px;bottom:10px;width:260px;'
              + 'background:#fff;border:1px solid #ccc;z-index:9999';   // 无 overflow、无超高内部 → 非浮动
            document.body.appendChild(box);
            return box;
          }
          function ratioOf(pr) {
            const vh = window.innerHeight;
            const visTop = Math.max(0, pr.top);
            const visBottom = Math.min(vh, pr.bottom);
            return pr.height > 0 ? (visBottom - visTop) / pr.height : 0;
          }
          // searchable-select
          try {
            const box = makeBoxNF();
            const sel = document.createElement('select');
            box.appendChild(sel);
            const inst = window.createSearchableSelect(sel, opts);
            const container = sel.nextElementSibling;
            inst.open();
            const panel = box.querySelector('.searchable-select-dropdown');
            const pr = panel.getBoundingClientRect();
            out.searchable = {
              floating: panel.classList.contains('is-floating'),
              inBody: panel.parentElement === document.body,
              wrapperDropup: container.classList.contains('is-dropup'),
              inViewport: pr.top >= 0 && pr.bottom <= window.innerHeight,
              ratio: Math.round(ratioOf(pr) * 100) / 100,
              hasOption: !!panel.querySelector('.searchable-select-option'),
              top: Math.round(pr.top), bottom: Math.round(pr.bottom),
            };
            inst.destroy();
            box.remove();
          } catch (e) { out.searchable = { err: String(e && e.message || e) }; }
          // multi-select
          try {
            const box = makeBoxNF();
            const host = document.createElement('div');
            host.className = 'msel';
            box.appendChild(host);
            window.createMultiSelect(host, opts, '全部');
            host.querySelector('.msel-display').click();
            const panelM = host.querySelector('.msel-panel');
            const prM = panelM.getBoundingClientRect();
            out.multi = {
              floating: panelM.classList.contains('is-floating'),
              inBody: panelM.parentElement === document.body,
              wrapperDropup: host.classList.contains('is-dropup'),
              inViewport: prM.top >= 0 && prM.bottom <= window.innerHeight,
              ratio: Math.round(ratioOf(prM) * 100) / 100,
              hasOption: !!panelM.querySelector('.msel-item'),
              top: Math.round(prM.top), bottom: Math.round(prM.bottom),
            };
            host.remove();
            box.remove();
          } catch (e) { out.multi = { err: String(e && e.message || e) }; }
          return out;
        });
        process.stdout.write(`  下拉定位(subscription-非浮动): ${JSON.stringify(subNfCheck)}\n`);
        {
          const nFails = [];
          const ns = subNfCheck.searchable || {};
          const nm = subNfCheck.multi || {};
          if (ns.err || ns.floating !== false || ns.inBody !== false || !ns.wrapperDropup
            || !ns.inViewport || ns.ratio < 0.9 || !ns.hasOption) {
            nFails.push('非浮动 searchable 未翻上/出视口/可见比例不足：' + JSON.stringify(ns));
          }
          if (nm.err || nm.floating !== false || nm.inBody !== false || !nm.wrapperDropup
            || !nm.inViewport || nm.ratio < 0.9 || !nm.hasOption) {
            nFails.push('非浮动 multi 未翻上/出视口/可见比例不足：' + JSON.stringify(nm));
          }
          nFails.forEach((f) => process.stdout.write('    [FAIL] ' + f + '\n'));
          if (nFails.length) anyFail = true;
        }

        // 表格结构：colgroup 的 <col> 与 thead 的 <th> 个数必须一致，
        // 否则 js/ui/table-resize.js 会直接 return null（列宽拖拽静默失效）。
        const table = await page.evaluate(() => {
          const t = document.querySelector('.subq-table');
          const review = t.querySelector('thead th.col-review');
          return {
            cols: t.querySelectorAll('colgroup > col').length,
            ths: t.querySelectorAll('thead > tr > th').length,
            handles: t.querySelectorAll('thead .col-resizer').length,
            // 仍固定的「审核流程状态」列 sticky left 应等于前面两列宽之和（104 + 118 = 222px）
            reviewLeft: review ? getComputedStyle(review).left : 'n/a',
          };
        });
        process.stdout.write(`  表格结构: col=${table.cols} th=${table.ths} 拖拽把手=${table.handles} 审核列 left=${table.reviewLeft}\n`);
        if (table.cols !== table.ths) {
          process.stdout.write('    [FAIL] colgroup 与 thead 列数不一致，列宽拖拽会失效\n');
          anyFail = true;
        }
        if (!table.handles) {
          process.stdout.write('    [FAIL] 表头没有挂上列宽拖拽把手\n');
          anyFail = true;
        }
        if (table.reviewLeft !== '222px') {
          process.stdout.write(`    [FAIL] 审核流程状态列 sticky left 应为 222px，实际 ${table.reviewLeft}\n`);
          anyFail = true;
        }

        await page.click('#btnBatchTimeEdit', { timeout: 5000 }).catch((e) => clickErr.push('click failed: ' + e.message));
        await page.waitForTimeout(600);
        const dialogState = await page.evaluate(() => {
          const ov = document.getElementById('batchTimeOverlay');
          if (!ov) return { err: 'overlay 不存在' };
          const list = document.getElementById('batchTimeList');
          return {
            display: getComputedStyle(ov).display,
            rows: list ? list.children.length : 0,
            pickers: ov.querySelectorAll('.dp-wrapper').length,
            // 「选择栏」那套（批次/功测/上线三个下拉）应该已经拆掉
            legacyBar: ['btBatch', 'btTest', 'btRelease'].filter((id) => document.getElementById(id)).length,
          };
        });
        process.stdout.write(`  批次时间弹窗: ${JSON.stringify(dialogState)}\n`);
        // 表格版：一行一个批次，每行两个日期控件（功能测试时间 / 上线时间）
        if (!dialogState.rows || dialogState.pickers !== dialogState.rows * 2) {
          process.stdout.write(`    [FAIL] 日期控件数 ${dialogState.pickers} ≠ 行数 × 2 = ${(dialogState.rows || 0) * 2}\n`);
          anyFail = true;
        }
        if (dialogState.legacyBar) {
          process.stdout.write('    [FAIL] 旧的「选择栏」下拉仍在（btBatch/btTest/btRelease）\n');
          anyFail = true;
        }

        // 「临期(≤3天)仅优先级变红」：注入一个 is-near 的 tag，确认字色为红（整行不变红由 CSS 只作用于 .prio-tag 保证）
        const nearCss = await page.evaluate(() => {
          const el = document.createElement('span');
          el.className = 'prio-tag is-near';
          el.textContent = 'T';
          document.body.appendChild(el);
          const c = getComputedStyle(el).color;
          el.remove();
          return c;
        });
        process.stdout.write(`  临期优先级样式: color=${nearCss}\n`);
        const nm = /rgb\((\d+), (\d+), (\d+)\)/.exec(nearCss);
        const isRed = nm && Number(nm[1]) > 80 && Number(nm[2]) < 80 && Number(nm[3]) < 80;
        if (!isRed) {
          process.stdout.write(`    [FAIL] 临期优先级字色 ${nearCss} 不是红色\n`);
          anyFail = true;
        }

        // 批次时间的行来源 + 日历初始月份（2026-09-15 用户反馈的三个点一起守）：
        //   · 行 = 批次字典里落在近 12 个月窗口内的批次（月度 + 独立），
        //     不再有「查询结果里冒出来的历史批次」（2408批次 就是这么进来的）；
        //   · 「作废」批次、解析不出年月的批次不进弹窗；
        //   · 打开日历直接定位到批次对应月份：功测 = 批次月 −1、上线 = 批次月。
        const btRows = await page.evaluate(async () => {
          // 字典桩：真实字典要打接口，冒烟环境用固定样本覆盖（窗口 = 2607 ~ 2706）
          window.loadBatchList = async () => [
            { label: '2607批次', value: 'z' },
            { label: '2608批次', value: 'a' },
            { label: '26年8月独立', value: 'b' },       // 独立批次，窗口内 → 要有
            { label: '2408批次', value: 'c' },          // 窗口外的历史批次 → 不能有
            { label: '26年8月独立批次(作废)', value: 'd' }, // 作废 → 不能有
            { label: '技术支持类-2026年批次', value: 'e' }, // 解析不出年月 → 不能有
            { label: '2706批次', value: 'f' },
          ];
          await window.SubscriptionBatchTimes.load();
          await window.SubscriptionBatchTimes.open();
          const rows = [...document.querySelectorAll('#batchTimeList tr')]
            .map((tr) => (tr.children[0] ? tr.children[0].textContent.trim() : ''));
          return rows;
        });
        process.stdout.write(`  批次行: ${btRows.join('、')}\n`);
        const mustHave = ['2607批次', '2608批次', '26年8月独立', '2706批次'];
        mustHave.forEach((b) => {
          if (!btRows.includes(b)) {
            process.stdout.write(`    [FAIL] 批次行缺少 ${b}（字典窗口过滤 / 排序有问题）\n`);
            anyFail = true;
          }
        });
        ['2408批次', '26年8月独立批次(作废)', '技术支持类-2026年批次'].forEach((b) => {
          if (btRows.includes(b)) {
            process.stdout.write(`    [FAIL] 批次行不该出现 ${b}（窗口外/作废/解析不出年月）\n`);
            anyFail = true;
          }
        });

        // 打开 2608批次 的两个日历，初始月份应分别是 2026年7月（功测）/ 2026年8月（上线）
        const btMonth = await page.evaluate(() => {
          const row = [...document.querySelectorAll('#batchTimeList tr')]
            .find((r) => r.children[0].textContent.trim() === '2608批次');
          if (!row) return { err: '没有 2608批次 行' };
          const inputs = [...row.querySelectorAll('input.batch-time-date')];
          const read = (el) => {
            el.click();
            const panel = document.querySelector('.dp-panel:not([hidden])');
            const title = panel ? panel.querySelector('.dp-title') : null;
            return title ? title.textContent.trim() : '（面板没开）';
          };
          return { test: read(inputs[0]), release: read(inputs[1]) };
        });
        process.stdout.write(`  2608批次日历初始月份: 功测=${btMonth.test} 上线=${btMonth.release}\n`);
        if (btMonth.err || !/2026年\s*7月/.test(btMonth.test) || !/2026年\s*8月/.test(btMonth.release)) {
          process.stdout.write('    [FAIL] 日历初始月份应为 功测 2026年7月 / 上线 2026年8月\n');
          anyFail = true;
        }

        // 保存过的批次不能被「随包发的空 config/batch-times.json」盖掉：
        // 模拟「上次保存过（只落到了 localStorage），重开页面」——行和日期都必须还在。
        const persistCheck = await page.evaluate(async () => {
          const KEY = 'itamp.batchTimes';
          const before = localStorage.getItem(KEY);
          localStorage.setItem(KEY, JSON.stringify({
            '我的自定义批次2026': { testDate: '2026-07-15', releaseDate: '2026-08-15' },
          }));
          try {
            await window.SubscriptionBatchTimes.load();
            await window.SubscriptionBatchTimes.open();   // open 是异步的（要等字典），必须 await
            const tr = [...document.querySelectorAll('#batchTimeList tr')]
              .find((r) => r.children[0].textContent.trim() === '我的自定义批次2026');
            return {
              found: !!tr,
              vals: tr ? [...tr.querySelectorAll('input')].map((i) => i.value) : null,
            };
          } finally {
            if (before === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, before);
          }
        });
        process.stdout.write(`  保存过的批次重开还在: ${JSON.stringify(persistCheck)}\n`);
        if (!persistCheck.found || !persistCheck.vals || persistCheck.vals[0] !== '2026-07-15') {
          process.stdout.write('    [FAIL] 保存过的批次被空的 config/batch-times.json 盖掉了\n');
          anyFail = true;
        }

        // ── 弹窗两个问题的回归（2026-09-15 用户反馈）──────────────────────
        //  ① 表头吸顶：只在「表格自己的滚动区」(.batch-time-table-wrap) 顶部吸顶，
        //     不再被全局 thead th{sticky;top:0} 顶到弹窗顶部、跟内容一起滚不动。
        //  ② 下拉栏完整可见：日历面板展开超出可视范围时，自动向下滚动表格容器，
        //     让面板完整落在输入框下方 —— 不用用户手动调。
        // 用「12 个月度批次 + localStorage 里 20 个自定义批次」把表格撑长，制造真实滚动。
        const btScroll = await page.evaluate(async () => {
          const KEY = 'itamp.batchTimes';
          const before = localStorage.getItem(KEY);

          const months = [];
          for (let m = 7; m <= 12; m += 1) months.push('26' + String(m).padStart(2, '0') + '批次');
          for (let m = 1; m <= 6; m += 1) months.push('27' + String(m).padStart(2, '0') + '批次');
          window.loadBatchList = async () => months.map((label, i) => ({ label, value: 'm' + i }));

          const saved = {};
          for (let i = 1; i <= 20; i += 1) {
            saved['自定义批次' + String(i).padStart(2, '0')] = { testDate: '', releaseDate: '' };
          }
          localStorage.setItem(KEY, JSON.stringify(saved));

          const tick = () => new Promise((r) => setTimeout(r, 30));
          const out = {};
          try {
            await window.SubscriptionBatchTimes.load();
            await window.SubscriptionBatchTimes.open();

            const wrap = document.querySelector('.batch-time-table-wrap');
            const body = document.getElementById('batchTimeBody');
            const head = document.querySelector('#batchTimeDialog .sub-head');
            if (!wrap) { out.err = '缺少 .batch-time-table-wrap'; return out; }
            out.rows = document.querySelectorAll('#batchTimeList tr').length;

            // ── ① 表头吸顶 ──────────────────────────────────────────
            if (wrap.scrollHeight <= wrap.clientHeight) wrap.style.maxHeight = '160px';  // 视口太高时限高兜底
            wrap.scrollTop = wrap.scrollHeight;
            const th = document.querySelector('.batch-time-table thead th');
            const thRect = th.getBoundingClientRect();
            const wrapRect = wrap.getBoundingClientRect();
            const headRect = head.getBoundingClientRect();
            out.scrollable = wrap.scrollHeight > wrap.clientHeight;
            out.scrolled = wrap.scrollTop > 0;
            out.thPosition = getComputedStyle(th).position;
            // 批次表的吸顶由 subscription.html 内的 .batch-time-table thead th 负责（z-index:2 盖住数据行）。
            // theme.css 的表头规则只能命中 .tbl-scroll，若误把 .batch-time-table-wrap 也写进去，
            // 特指度更高会把这里压成 1 —— 这条断言就是拦这个回退的。
            out.thZIndex = getComputedStyle(th).zIndex;
            out.bodyOverflowY = getComputedStyle(body).overflowY;
            out.thOffset = Math.round(thRect.top - wrapRect.top);   // 吸在表格区顶部 ≈ 1px（外框边框）
            out.thBelowHead = thRect.top >= headRect.bottom - 1;    // 没有被顶到弹窗顶部

            // ── ② 下拉栏自动滚动 ─────────────────────────────────────
            wrap.style.maxHeight = '';                              // 还原限高
            wrap.scrollTop = Math.round((wrap.scrollHeight - wrap.clientHeight) / 2);
            await tick();

            const inputs = [...document.querySelectorAll('#batchTimeList input.batch-time-date')];
            const wr = wrap.getBoundingClientRect();
            let target = null;
            inputs.forEach((el) => {
              const r = el.getBoundingClientRect();
              if (r.top >= wr.top && r.bottom <= wr.bottom) target = el;   // 可视区里最靠下的那个
            });
            if (!target) { out.err = '没有可见的日期输入框'; return out; }

            const beforeScroll = wrap.scrollTop;
            out.scrollRoom = wrap.scrollHeight - wrap.clientHeight - beforeScroll;
            target.click();
            await tick();

            const panel = document.querySelector('.dp-panel:not([hidden])');
            if (!panel) { out.err = '面板未打开'; return out; }
            const pr = panel.getBoundingClientRect();
            const ir = target.getBoundingClientRect();
            const box = target.closest('.dp-input-wrapper') || target;
            const br = box.getBoundingClientRect();
            out.before = Math.round(beforeScroll);
            out.after = Math.round(wrap.scrollTop);
            out.autoScrolled = wrap.scrollTop > beforeScroll + 1;
            out.floating = panel.classList.contains('is-floating');
            out.visible = pr.top >= -1 && pr.bottom <= window.innerHeight + 1;
            out.below = pr.top >= ir.bottom - 1;                     // 优先保持在输入框下方
            out.inputVisible = ir.top >= -1 && ir.bottom <= window.innerHeight + 1;
            out.boxW = Math.round(br.width);
            out.panelW = Math.round(pr.width);
            out.dx = Math.round(pr.left - br.left);

            // ── ③ 容器已到底（最后一行）仍要完整可见（退化为翻到上方）────
            wrap.scrollTop = wrap.scrollHeight;
            await tick();
            inputs[inputs.length - 1].click();                       // auto-close 上一个面板
            await tick();
            const panel2 = document.querySelector('.dp-panel:not([hidden])');
            if (panel2) {
              const r2 = panel2.getBoundingClientRect();
              out.lastVisible = r2.top >= -1 && r2.bottom <= window.innerHeight + 1;
            }
            return out;
          } finally {
            if (before === null) localStorage.removeItem(KEY);
            else localStorage.setItem(KEY, before);
          }
        });
        process.stdout.write(`  弹窗表格滚动: ${JSON.stringify(btScroll)}\n`);
        if (btScroll.err) {
          process.stdout.write(`    [FAIL] 弹窗滚动场景无法验证：${btScroll.err}\n`);
          anyFail = true;
        } else {
          const fails = [];
          if (!btScroll.scrollable || !btScroll.scrolled) fails.push('表格区没有形成真实滚动');
          if (btScroll.thPosition !== 'sticky') fails.push('表头不是 sticky');
          if (btScroll.thZIndex !== '2') fails.push(`批次表表头 z-index 应为 2（盖住滚上来的数据行），实际 ${btScroll.thZIndex}`);
          if (btScroll.bodyOverflowY !== 'hidden') fails.push('弹窗主体仍在滚（应只有表格区一条滚动条）');
          if (Math.abs(btScroll.thOffset) > 2) fails.push(`表头没吸在表格区顶部（偏移 ${btScroll.thOffset}px）`);
          if (!btScroll.thBelowHead) fails.push('表头被顶到了弹窗顶部');
          if (!btScroll.autoScrolled) fails.push(`下拉栏未自动向下滚动（${btScroll.before} → ${btScroll.after}，余量 ${btScroll.scrollRoom}）`);
          if (!btScroll.floating || !btScroll.visible || !btScroll.below) fails.push('下拉栏未完整可见 / 没落在输入框下方');
          if (!btScroll.inputVisible) fails.push('自动滚动把输入框滚出了视口');
          if (Math.abs(btScroll.panelW - btScroll.boxW) > 1 || Math.abs(btScroll.dx) > 1) {
            fails.push(`下拉栏与输入框没对齐：${btScroll.panelW}px@${btScroll.dx} vs ${btScroll.boxW}px`);
          }
          if (btScroll.lastVisible !== true) fails.push('最后一行（容器已到底）的下拉栏不完整可见');
          if (fails.length) {
            fails.forEach((f) => process.stdout.write(`    [FAIL] ${f}\n`));
            anyFail = true;
          }
        }

        // 「精确到日」：给第一行填一个具体日期，保存后 POST 出去的配置必须就是这个日期
        //（曾经实现成「按当月 15 日取整」，这条断言就是防它回潮）
        await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
        page.on('dialog', (d) => d.accept());          // 保存前的基线转换确认框
        let posted = null;
        await page.route('**/local/batch-times**', (route) => {
          if (route.request().method() === 'POST') {
            try { posted = JSON.parse(route.request().postData() || '{}'); } catch (_) { posted = {}; }
          }
          return route.fulfill({ status: 200, contentType: 'application/json', body: '{"code":200}' });
        });
        await page.click('#btnBatchTimeEdit');
        await page.waitForTimeout(400);
        const exactDay = await page.evaluate(async () => {
          const input = document.querySelector('#batchTimeList input.batch-time-date[data-field="testDate"]');
          if (!input) return { err: '没有功能测试时间输入框' };
          const batch = document.querySelector('#batchTimeList tr .batch-label').textContent.trim();
          input.value = '2026-10-08';                  // 故意不用 15 号
          input.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 80));
          document.getElementById('btnBatchTimeSave').click();
          await new Promise((r) => setTimeout(r, 600));
          return { batch, value: input.value };
        });
        const savedDay = posted && posted.batchTimes && posted.batchTimes[exactDay.batch];
        process.stdout.write(`  精确到日保存: ${JSON.stringify({ 填的: exactDay.value, 落盘: savedDay })}\n`);
        if (!savedDay || savedDay.testDate !== '2026-10-08') {
          process.stdout.write('    [FAIL] 保存的日期不是所填日期（可能又被取整了）\n');
          anyFail = true;
        }
      }

      if (pg.file === 'task.html') {
        // 下拉面板定位回归（task.html 同时加载了 searchable-select 与 multi-select）：
        //   (a) 贴近视口底部 → 面板必须完整落在视口内（翻上，不被裁）；
        //   (c) 点面板内部不误关（浮动后面板在 body，container 已不含它）。
        const taskPopup = await page.evaluate(() => {
          const out = {};
          const opts = Array.from({ length: 30 }, (_, i) => ({ value: 'v' + i, label: '选项' + i }));
          function makeBox() {
            const box = document.createElement('div');
            box.style.cssText = 'position:fixed;left:20px;bottom:10px;width:220px;height:140px;'
              + 'overflow:auto;background:#fff;border:1px solid #ccc;z-index:9999';
            const inner = document.createElement('div');
            inner.style.cssText = 'height:600px;padding:4px';
            box.appendChild(inner);
            document.body.appendChild(box);
            return { box, inner };
          }
          // searchable-select
          try {
            const { box, inner } = makeBox();
            const sel = document.createElement('select');
            inner.appendChild(sel);
            const inst = window.createSearchableSelect(sel, opts);
            const container = sel.nextElementSibling;
            inst.open();
            const panel = Array.prototype.slice.call(document.querySelectorAll('.searchable-select-dropdown'))
              .find((p) => p.classList.contains('is-floating') || getComputedStyle(p).display !== 'none');
            const pr = panel.getBoundingClientRect();
            out.searchable = {
              floating: panel.classList.contains('is-floating'),
              inViewport: pr.top >= 0 && pr.bottom <= window.innerHeight,
              hasOption: !!panel.querySelector('.searchable-select-option'),
            };
            const opt = panel.querySelector('.searchable-select-option');
            if (opt) opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            out.searchable.stillOpen = container.classList.contains('is-open');
            inst.destroy();
            box.remove();
          } catch (e) { out.searchable = { err: String(e && e.message || e) }; }
          // multi-select
          try {
            const { box, inner } = makeBox();
            const host = document.createElement('div');
            host.className = 'msel';
            inner.appendChild(host);
            window.createMultiSelect(host, opts, '全部');
            host.querySelector('.msel-display').click();
            const panelM = Array.prototype.slice.call(document.querySelectorAll('.msel-panel'))
              .find((p) => p.classList.contains('is-floating') || getComputedStyle(p).display !== 'none');
            const prM = panelM.getBoundingClientRect();
            out.multi = {
              floating: panelM.classList.contains('is-floating'),
              inViewport: prM.top >= 0 && prM.bottom <= window.innerHeight,
              hasOption: !!panelM.querySelector('.msel-item'),
            };
            const optM = panelM.querySelector('.msel-item');
            if (optM) optM.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            out.multi.stillOpen = host.classList.contains('is-open');
            host.remove();
            box.remove();
          } catch (e) { out.multi = { err: String(e && e.message || e) }; }
          return out;
        });
        process.stdout.write(`  下拉定位(task): ${JSON.stringify(taskPopup)}\n`);
        const fails = [];
        const s2 = taskPopup.searchable || {};
        const m2 = taskPopup.multi || {};
        if (s2.err || !s2.floating || !s2.inViewport || !s2.hasOption) fails.push('searchable 面板未浮动/未完整可见/无选项：' + JSON.stringify(s2));
        if (s2.stillOpen !== true) fails.push('searchable 点面板内部被误关：' + JSON.stringify(s2));
        if (m2.err || !m2.floating || !m2.inViewport || !m2.hasOption) fails.push('multi 面板未浮动/未完整可见/无选项：' + JSON.stringify(m2));
        if (m2.stillOpen !== true) fails.push('multi 点面板内部被误关：' + JSON.stringify(m2));
        fails.forEach((f) => process.stdout.write('    [FAIL] ' + f + '\n'));
        if (fails.length) anyFail = true;

        // ── 非浮动分支回归（无滚动祖先 → 留在 wrapper、翻上 is-dropup）──
        // task.html 同时加载了 searchable-select 与 multi-select，两种都验非浮动翻上。
        const taskNfCheck = await page.evaluate(() => {
          const out = {};
          const opts = Array.from({ length: 30 }, (_, i) => ({ value: 'v' + i, label: '选项' + i }));
          function makeBoxNF() {
            const box = document.createElement('div');
            box.style.cssText = 'position:fixed;left:40px;bottom:10px;width:260px;'
              + 'background:#fff;border:1px solid #ccc;z-index:9999';   // 无 overflow、无超高内部 → 非浮动
            document.body.appendChild(box);
            return box;
          }
          function ratioOf(pr) {
            const vh = window.innerHeight;
            const visTop = Math.max(0, pr.top);
            const visBottom = Math.min(vh, pr.bottom);
            return pr.height > 0 ? (visBottom - visTop) / pr.height : 0;
          }
          // searchable-select
          try {
            const box = makeBoxNF();
            const sel = document.createElement('select');
            box.appendChild(sel);
            const inst = window.createSearchableSelect(sel, opts);
            const container = sel.nextElementSibling;
            inst.open();
            const panel = box.querySelector('.searchable-select-dropdown');
            const pr = panel.getBoundingClientRect();
            out.searchable = {
              floating: panel.classList.contains('is-floating'),
              inBody: panel.parentElement === document.body,
              wrapperDropup: container.classList.contains('is-dropup'),
              inViewport: pr.top >= 0 && pr.bottom <= window.innerHeight,
              ratio: Math.round(ratioOf(pr) * 100) / 100,
              hasOption: !!panel.querySelector('.searchable-select-option'),
              top: Math.round(pr.top), bottom: Math.round(pr.bottom),
            };
            inst.destroy();
            box.remove();
          } catch (e) { out.searchable = { err: String(e && e.message || e) }; }
          // multi-select
          try {
            const box = makeBoxNF();
            const host = document.createElement('div');
            host.className = 'msel';
            box.appendChild(host);
            window.createMultiSelect(host, opts, '全部');
            host.querySelector('.msel-display').click();
            const panelM = host.querySelector('.msel-panel');
            const prM = panelM.getBoundingClientRect();
            out.multi = {
              floating: panelM.classList.contains('is-floating'),
              inBody: panelM.parentElement === document.body,
              wrapperDropup: host.classList.contains('is-dropup'),
              inViewport: prM.top >= 0 && prM.bottom <= window.innerHeight,
              ratio: Math.round(ratioOf(prM) * 100) / 100,
              hasOption: !!panelM.querySelector('.msel-item'),
              top: Math.round(prM.top), bottom: Math.round(prM.bottom),
            };
            host.remove();
            box.remove();
          } catch (e) { out.multi = { err: String(e && e.message || e) }; }
          return out;
        });
        process.stdout.write(`  下拉定位(task-非浮动): ${JSON.stringify(taskNfCheck)}\n`);
        {
          const nFails = [];
          const ns = taskNfCheck.searchable || {};
          const nm = taskNfCheck.multi || {};
          if (ns.err || ns.floating !== false || ns.inBody !== false || !ns.wrapperDropup
            || !ns.inViewport || ns.ratio < 0.9 || !ns.hasOption) {
            nFails.push('非浮动 searchable 未翻上/出视口/可见比例不足：' + JSON.stringify(ns));
          }
          if (nm.err || nm.floating !== false || nm.inBody !== false || !nm.wrapperDropup
            || !nm.inViewport || nm.ratio < 0.9 || !nm.hasOption) {
            nFails.push('非浮动 multi 未翻上/出视口/可见比例不足：' + JSON.stringify(nm));
          }
          nFails.forEach((f) => process.stdout.write('    [FAIL] ' + f + '\n'));
          if (nFails.length) anyFail = true;
        }
      }

      if (missing.length || pageErrors.length || bootstrapErrs.length || realErrs.length || uncaught) anyFail = true;
    } catch (e) {
      process.stdout.write(`  !! 加载失败: ${e.message}\n`);
      anyFail = true;
    }
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // destroy() 回收浮动面板（2026-09-15 修复的回归保护）
  // ═══════════════════════════════════════════════════════════════
  // 浮动模式下面板被移到 document.body，destroy() 若不先 reset 就会在 body 留下孤立面板。
  // 该路径生产可达：订阅弹窗的评委行在 .sub-body 内创建 createSearchableSelect，
  // 重置评委表时逐个 destroy()（subscribe-dialog.js 的 resetJudges() 等）。
  // 注：非浮动分支的断言已按页写在上面的三页块里（各含 makeBoxNF 那段），此处不重复。
  {
    const POPUP_PROBE = `
      window.__vp = {
        opts: Array.from({ length: 30 }, (_, i) => ({ value: 'v' + i, label: '选项' + i })),
        async destroyOrphans() {
          const ov = document.getElementById('subscribeOverlay');
          ov.classList.add('show');
          await new Promise((r) => setTimeout(r, 200));
          const subBody = ov.querySelector('.sub-body');
          const sel = document.createElement('select');
          subBody.appendChild(sel);
          const inst = window.createSearchableSelect(sel, window.__vp.opts);
          const ctl = sel.nextElementSibling;
          subBody.scrollTop = subBody.scrollHeight;
          inst.open();                       // .sub-body 是 overflow:auto → 走浮动分支
          await new Promise((r) => setTimeout(r, 180));
          const whileOpen = document.body.querySelectorAll(':scope > .searchable-select-dropdown').length;
          inst.destroy();
          await new Promise((r) => setTimeout(r, 100));
          const after = document.body.querySelectorAll(':scope > .searchable-select-dropdown').length;
          const ctlGone = !document.body.contains(ctl);
          ov.classList.remove('show');
          return { whileOpen, after, ctlGone };
        },
      };
    `;

    // 只在 index.html 上跑（订阅弹窗在首页；多选销毁在 task.js 里是长生命周期、不销毁）
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const fails = [];
      try {
        await page.goto(base + 'index.html', { waitUntil: 'load', timeout: 15000 });
        await page.waitForTimeout(1000);
        await page.evaluate(POPUP_PROBE);
        const dz = await page.evaluate(() => window.__vp.destroyOrphans());
        process.stdout.write(`  destroy 回收(浮动面板): ${JSON.stringify(dz)}\n`);
        if (dz.whileOpen !== 1) fails.push(`浮动打开时 body 内应有 1 个面板，实际 ${dz.whileOpen}`);
        if (dz.after !== 0) fails.push(`destroy 后 body 内残留 ${dz.after} 个孤立面板`);
        if (!dz.ctlGone) fails.push('destroy 后组件容器没有被移除');

        // toast 的队列行为（U-07）**不在这里断言**：本页无后端时会持续异步弹提示，
        // 队列排空时间不可控，靠真实定时器断言极易偶发失败。
        // 改为在 tests/toast-queue.test.js 里用假 DOM + 假时钟做确定性单测。
      } catch (e) {
        fails.push(`destroy 回收段异常：${e.message}`);
      }
      fails.forEach((f) => process.stdout.write(`    [FAIL] ${f}\n`));
      if (fails.length) anyFail = true;
      await page.close();
    }
  }

  await browser.close();
  server.close();
  process.stdout.write(`\n==== 结果: ${anyFail ? '有 FAIL' : 'ALL PASS (静态加载/接线无报错)'} ====\n`);
  process.exit(anyFail ? 1 : 0);
})();
