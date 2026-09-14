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
  { name: '首页 index.html', file: 'index.html', globals: ['Fmt', 'toast', 'API', 'PublishResponse', 'TableUtils', 'DetailDialog', 'DictSelects', 'CsvExporter'] },
  { name: '任务单 task.html', file: 'task.html', globals: ['Fmt', 'toast', 'API', 'TableUtils', 'CsvExporter'] },
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
      const bootstrapErrs = errors.filter((e) => /依赖|缺失|未定义|not defined|missing/i.test(e));
      const realErrs = errors.filter((e) => !/Failed to load resource|404|加载失败|nf$/i.test(e));
      process.stdout.write(`  全局缺失: ${missing.length ? missing.join(', ') : '无'}\n`);
      process.stdout.write(`  pageerror(未捕获异常): ${pageErrors.length ? pageErrors.join(' | ') : '无'}\n`);
      process.stdout.write(`  console.error: 共 ${errors.length} 条（后端 404 等环境噪音 ${errors.length - realErrs.length} 条，真报错 ${realErrs.length} 条）\n`);
      realErrs.forEach((e) => process.stdout.write(`    [真报错] ${e}\n`));

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
          if (!ov) return { text: 'overlay 不存在' };
          const list = document.getElementById('batchTimeList');
          const rows = list ? list.children.length : 0;
          return {
            text: `display=${getComputedStyle(ov).display}, listRows=${rows},`
              + ` 日期控件=${ov.querySelectorAll('.dp-wrapper').length}`,
            rows,
            pickers: ov.querySelectorAll('.dp-wrapper').length,
          };
        });
        process.stdout.write(`  弹窗点击后: ${dialogState.text}\n`);
        process.stdout.write(`  弹窗点击后 pageerror: ${clickErr.length ? clickErr.join(' | ') : '无'}\n`);
        if (clickErr.length) anyFail = true;
        // 每行两个日期（功能测试时间 / 上线时间），都必须是统一日期控件
        if (dialogState.rows && dialogState.pickers !== dialogState.rows * 2) {
          process.stdout.write(`    [FAIL] 日期控件数 ${dialogState.pickers} ≠ 行数 × 2 = ${dialogState.rows * 2}\n`);
          anyFail = true;
        }
      }

      if (missing.length || pageErrors.length || bootstrapErrs.length || realErrs.length) anyFail = true;
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
