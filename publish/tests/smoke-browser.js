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
  { name: '首页 index.html', file: 'index.html', globals: ['Fmt', 'toast', 'API', 'PublishResponse', 'TableUtils', 'DetailDialog', 'DictSelects', 'CsvExporter', 'SubscribeDialog', 'SubscribeManager', 'ServiceApi', 'UserApi', 'DialogUtils'] },
  // 注：people-search.js 是自动初始化的页面内模块、不暴露任何全局；task.html 也没引 dialog-utils.js
  { name: '任务单 task.html', file: 'task.html', globals: ['Fmt', 'toast', 'API', 'TableUtils', 'CsvExporter', 'TaskApi'] },
  { name: '订阅 subscription.html', file: 'subscription.html', globals: ['Fmt', 'toast', 'API', 'TableUtils', 'SubscriptionBatchTimes', 'Priority', 'CsvExporter', 'createDatePicker'] },
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

      if (pg.file === 'subscription.html') {
        const clickErr = [];
        page.on('pageerror', (e) => clickErr.push(e.message));

        // 表格结构：colgroup 的 <col> 与 thead 的 <th> 个数必须一致，
        // 否则 js/ui/table-resize.js 会直接 return null（列宽拖拽静默失效）。
        const table = await page.evaluate(() => {
          const t = document.querySelector('.subq-table');
          const coding = t.querySelector('thead th.col-coding');
          return {
            cols: t.querySelectorAll('colgroup > col').length,
            ths: t.querySelectorAll('thead > tr > th').length,
            handles: t.querySelectorAll('thead .col-resizer').length,
            codingLeft: coding ? getComputedStyle(coding).left : 'n/a',
          };
        });
        process.stdout.write(`  表格结构: col=${table.cols} th=${table.ths} 拖拽把手=${table.handles} 接口编码列 left=${table.codingLeft}\n`);
        if (table.cols !== table.ths) {
          process.stdout.write('    [FAIL] colgroup 与 thead 列数不一致，列宽拖拽会失效\n');
          anyFail = true;
        }
        if (!table.handles) {
          process.stdout.write('    [FAIL] 表头没有挂上列宽拖拽把手\n');
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

        // 日期面板不能被弹窗主体的 overflow 裁掉：滚到底点最后一行，
        // 面板应脱离容器（浮动）并抬到输入框上方、完整落在视口内。
        const datePanel = await page.evaluate(() => {
          const body = document.getElementById('batchTimeBody');
          if (body) body.scrollTop = body.scrollHeight;
          const inputs = document.querySelectorAll('#batchTimeList input.batch-time-date');
          if (!inputs.length) return { err: '没有日期控件' };
          const lastInput = inputs[inputs.length - 1];
          lastInput.click();
          const panel = document.querySelector('.dp-panel:not([hidden])');
          if (!panel) return { err: '面板未打开' };
          const pr = panel.getBoundingClientRect();
          const ir = lastInput.getBoundingClientRect();
          return {
            floating: panel.classList.contains('is-floating'),
            visible: pr.top >= -1 && pr.bottom <= window.innerHeight + 1,
            above: pr.bottom <= ir.top + 1,
          };
        });
        process.stdout.write(`  日期面板（最后一行）: ${JSON.stringify(datePanel)}\n`);
        if (!datePanel.floating || !datePanel.visible || !datePanel.above) {
          process.stdout.write('    [FAIL] 日历面板仍被弹窗滚动容器裁剪\n');
          anyFail = true;
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

      if (missing.length || pageErrors.length || bootstrapErrs.length || realErrs.length || uncaught) anyFail = true;
    } catch (e) {
      process.stdout.write(`  !! 加载失败: ${e.message}\n`);
      anyFail = true;
    }
    await page.close();
  }

  await browser.close();
  server.close();
  process.stdout.write(`\n==== 结果: ${anyFail ? '有 FAIL' : 'ALL PASS (静态加载/接线无报错)'} ====\n`);
  process.exit(anyFail ? 1 : 0);
})();
