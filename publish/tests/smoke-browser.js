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
  // 2026-09-18：index.html 改成「首页」（三页入口 + 常用查询），
  // 服务发布数据查询页迁到 publish.html —— 两个页面都要冒烟，别只盯着一个。
  { name: '首页 index.html', file: 'index.html', globals: ['Fmt', 'toast', 'API', 'SavedQuery', 'CurrentUser', 'UserApi', 'HomePage', 'DialogUtils', 'PopupPosition', 'createSearchableSelect', 'UserToken'] },
  { name: '服务发布数据查询 publish.html', file: 'publish.html', globals: ['Fmt', 'toast', 'API', 'PublishResponse', 'TableUtils', 'DetailDialog', 'DictSelects', 'CsvExporter', 'SubscribeDialog', 'SubscribeModel', 'SubscribeManager', 'ServiceApi', 'UserApi', 'DialogUtils', 'PopupPosition', 'SubscribeDryRun', 'SavedQuery', 'CurrentUser', 'PublishDialogModel', 'IntfDetailDialog', 'OpRecordDialog', 'CopyCells'] },
  // 注：people-search.js 是自动初始化的页面内模块、不暴露任何全局；task.html 也没引 dialog-utils.js
  { name: '任务单 task.html', file: 'task.html', globals: ['Fmt', 'toast', 'API', 'TableUtils', 'CsvExporter', 'TaskApi', 'PopupPosition', 'SavedQuery', 'CurrentUser', 'UserToken', 'CopyCells'] },
  { name: '订阅 subscription.html', file: 'subscription.html', globals: ['Fmt', 'toast', 'API', 'TableUtils', 'SubscriptionBatchTimes', 'Priority', 'CsvExporter', 'createDatePicker', 'PopupPosition', 'SavedQuery', 'CurrentUser', 'UserToken', 'CopyCells'] },
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
        // 首页（2026-09-18 新增）：三个入口 + 常用查询的端到端往返。
        // 只断言「模块加载成功」拦不住接线掉了，所以这里真的存一条、渲染、点开、删掉。
        const homeCheck = await page.evaluate(async () => {
          const out = {};
          const ids = ['entryPublish', 'entryTask', 'entrySubscription'];
          out.entries = ids.map((id) => {
            const el = document.getElementById(id);
            return el ? el.getAttribute('href') : null;
          });

          // ① 空态：还没存过常用查询
          out.emptyShown = !document.getElementById('savedEmpty').hidden;
          out.emptyHintNoUser = document.getElementById('savedEmpty').textContent;
          out.items0 = document.querySelectorAll('#savedList .saved-item').length;

          // ② 存一条（走真实模块，不直接改 DOM），再渲染
          const S = window.SavedQuery;
          if (!S) return Object.assign(out, { err: 'SavedQuery 未加载' });
          // 列表自 2026-09-19 起按当前用户过滤：没有身份时**故意什么都不显示**，
          // 所以这一段要先立身份，才能验「存 → 渲染 → 删除」这条往返。
          const CU = window.CurrentUser;
          if (!CU) return Object.assign(out, { err: 'CurrentUser 未加载' });
          CU.set({ userId: '9001', userName: '冒烟甲', teamId: 'T9', teamName: '开发九部' });
          const r = await S.save({
            page: 'publish',
            name: '冒烟常用查询',
            fields: { f_prodBatch: '2611pc', f_serviceName: '全球汇划' },
            summary: '变更批次：2611pc · 服务名称：全球汇划',
          });
          out.saved = r.ok;
          window.HomePage.render();
          // 标题要跟着身份走（渲染之后才有名字）
          out.titleAfterRender = document.getElementById('savedTitle').textContent;
          const card = document.querySelector('#savedList .saved-item');
          out.items1 = document.querySelectorAll('#savedList .saved-item').length;
          out.cardText = card ? card.textContent : '';
          out.badge = card ? card.querySelector('.saved-badge').textContent : '';
          const mainLink = card ? card.querySelector('a.saved-main') : null;
          out.href = mainLink ? mainLink.getAttribute('href') : '';
          out.opsButtons = card
            ? Array.from(card.querySelectorAll('.saved-ops button')).map((b) => b.textContent.trim())
            : [];
          out.emptyShownAfter = !document.getElementById('savedEmpty').hidden;
          out.countText = document.getElementById('savedCount').textContent;

          // ③ 删除（确认弹窗走 DialogUtils，点「确 认」）
          if (!card) return Object.assign(out, { err: '存了但列表没渲染出卡片（按人过滤把身份弄丢了？）' });
          card.querySelector('.saved-ops button.danger').click();
          await new Promise((res) => setTimeout(res, 80));
          const ov = document.querySelector('.dlg-util-overlay');
          out.confirmShown = !!ov;
          if (ov) ov.querySelector('.sub-foot .filled').click();
          await new Promise((res) => setTimeout(res, 120));
          out.items2 = document.querySelectorAll('#savedList .saved-item').length;
          out.storageCleared = window.SavedQuery.list().length;
          CU.clear();   // 后面几段各自会立自己的身份，这里别留残留
          return out;
        });

        process.stdout.write(`  首页入口: ${JSON.stringify(homeCheck.entries)}\n`);
        process.stdout.write(`  常用查询往返: 存=${homeCheck.saved} 渲染=${homeCheck.items1} 删除后=${homeCheck.items2} 存储剩余=${homeCheck.storageCleared}\n`);
        const homeOk = !homeCheck.err
          && JSON.stringify(homeCheck.entries) === JSON.stringify(['/publish', '/task', '/subscription'])
          && homeCheck.emptyShown === true && homeCheck.items0 === 0
          // 空列表要给「怎么开始」的指引。2026-09-22 起：没设身份也能保存、也能在首页看到
          // （本机匿名记录会列出来），所以"先去设置当前用户"不再是必要步骤，
          // 只要告诉用户去哪保存即可；别人的记录依然一条都不会露出来。
          && /保存到首页/.test(homeCheck.emptyHintNoUser || '')
          && homeCheck.saved === true && homeCheck.items1 === 1
          && /冒烟甲/.test(homeCheck.titleAfterRender || '')
          && homeCheck.badge === '服务发布数据查询'
          && /\/publish\?saved=/.test(homeCheck.href || '')
          && JSON.stringify(homeCheck.opsButtons) === JSON.stringify(['重命名', '删除'])
          && homeCheck.cardText.includes('冒烟常用查询')
          && homeCheck.emptyShownAfter === false && /共 1 条/.test(homeCheck.countText || '')
          && homeCheck.items2 === 0 && homeCheck.storageCleared === 0;
        if (!homeOk) {
          process.stdout.write(`    [FAIL] 首页入口 / 常用查询往返异常：${JSON.stringify(homeCheck)}\n`);
          anyFail = true;
        }
      }

      if (pg.file === 'publish.html') {
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

      if (pg.file === 'publish.html') {
        // 常用查询摘要要写「人类可读文本」而不是编号：下拉给 getLabel()、多选给 getLabels()。
        // 这条回归钉住「选项里查得到就用 label，查不到才回落 value」——
        // 少了它，首页卡片又会显示成「2611pc」这种只有机器认的编码。
        const labelCheck = await page.evaluate(() => {
          const out = {};
          if (typeof window.createSearchableSelect !== 'function') return { err: 'createSearchableSelect 缺失' };
          const host = document.createElement('div');
          host.style.cssText = 'position:fixed;left:8px;top:8px;width:220px;background:#fff;z-index:9999';
          document.body.appendChild(host);
          const sel = document.createElement('select');
          host.appendChild(sel);
          try {
            const inst = window.createSearchableSelect(sel, [
              { value: '2611pc', label: '2611批次' },
              { value: 'E00301', label: 'BOCNET-G-IFS' },
            ], {});
            inst.setValue('2611pc');
            out.labelOfCode = inst.getLabel();
            out.valueOfCode = inst.getValue();
            inst.setValue('E00301');
            out.labelOfSystem = inst.getLabel();
            // 选项里没有的值：setValue 会拒绝（getValue 为空），这是组件既有行为，一并钉住
            inst.setValue('9999xx');
            out.valueOfUnknown = inst.getValue();
            // 选项列表后来被清空（字典接口没回来）：value 还在，此时只能显示编号本身
            inst.setValue('2611pc');
            if (typeof inst.updateOptions === 'function') inst.updateOptions([]);
            out.labelFallback = inst.getLabel();
          } finally { host.remove(); }

          if (typeof window.createMultiSelect === 'function') {
            const host2 = document.createElement('div');
            host2.style.cssText = 'position:fixed;left:8px;top:200px;width:220px;background:#fff;z-index:9999';
            document.body.appendChild(host2);
            try {
              const ms = window.createMultiSelect(host2, [
                { value: '2611pc', label: '2611批次' },
                { value: '2608pc', label: '2608批次' },
              ], {});
              ms.setValue(['2611pc', '2608pc']);
              out.multiLabels = ms.getLabels();
            } finally { host2.remove(); }
          }
          return out;
        });
        process.stdout.write(`  下拉/多选 label: ${JSON.stringify(labelCheck)}\n`);
        const labelOk = !labelCheck.err
          && labelCheck.labelOfCode === '2611批次' && labelCheck.valueOfCode === '2611pc'
          && labelCheck.labelOfSystem === 'BOCNET-G-IFS'
          && labelCheck.valueOfUnknown === ''
          && labelCheck.labelFallback === '2611pc'
          && (!labelCheck.multiLabels
            || JSON.stringify(labelCheck.multiLabels) === JSON.stringify(['2611批次', '2608批次']));
        if (!labelOk) {
          process.stdout.write(`    [FAIL] 下拉/多选取人类可读文本异常：${JSON.stringify(labelCheck)}\n`);
          anyFail = true;
        }
      }

      // 无障碍：组件内部那个真正能聚焦的框，必须能被读屏念出字段名。
      // 页面上的 label[for] 指的是被隐藏的宿主，名字传不过来（2026-09-19 普查的结论），
      // 所以组件把宿主那侧的文案写成 aria-label —— 这条守住「别退回静默无名」。
      // 注：这里弹窗还没打开、评委行还不存在，弹窗内那部分另见「空态/防重复提交」段的 ④。
      if (pg.file !== 'index.html') {
        const a11yCheck = await page.evaluate(() => {
          const boxes = Array.from(document.querySelectorAll('.searchable-select-input, .msel-display'));
          const nameless = boxes.filter((el) => !(el.getAttribute('aria-label') || '').trim()).map((el) => {
            const g = el.closest('.form-group,.sub-row,.doc-filter-item,.field,.filter-item');
            const l = g && g.querySelector ? g.querySelector('label') : null;
            const host = el.parentElement && el.parentElement.querySelector('select,input[type=hidden]');
            return (l ? l.textContent.replace(/\s+/g, ' ').trim() : '')
              || (host && host.id) || el.className;
          });
          return { total: boxes.length, nameless };
        });
        process.stdout.write(`  可访问名称: ${a11yCheck.total - a11yCheck.nameless.length}/${a11yCheck.total} 个控件有名，无名=${JSON.stringify(a11yCheck.nameless)}\n`);
        if (a11yCheck.total && a11yCheck.nameless.length) {
          process.stdout.write(`    [FAIL] 这些可聚焦框读屏念不出字段名：${JSON.stringify(a11yCheck.nameless)}\n`);
          anyFail = true;
        }
      }

      if (pg.file === 'index.html') {
        // 同步状态角标：同步本来是静默的，用户必须能看出当前看的是团队库还是只有本机。
        // 冒烟不连真代理，直接把存储层的状态换掉，验「状态 → 文案 / 类名 / title」这条 DOM 契约。
        const syncCheck = await page.evaluate(async () => {
          const el = document.querySelector('#savedSync');
          if (!el) return { err: '缺少 #savedSync' };
          if (!window.HomePage || typeof window.HomePage.renderSync !== 'function') return { err: 'HomePage.renderSync 缺失' };
          const real = window.SavedQuery.lastSyncState;
          const snap = {};
          const probe = (state) => {
            window.SavedQuery.lastSyncState = () => ({
              state, total: 7, file: '/srv/shared/saved-queries.db', storage: 'sqlite', people: 2,
              error: state === 'fail' ? '同步失败：HTTP 500' : '', at: Date.now(),
            });
            window.HomePage.renderSync();
            snap[state] = { text: el.textContent, cls: el.className, title: el.title || '' };
          };
          try {
            ['shared', 'local', 'fail'].forEach(probe);
            window.SavedQuery.lastSyncState = () => ({ state: 'pending', at: 0 });
            window.HomePage.renderSync();
            snap.pendingHidden = !!el.hidden;
          } finally {
            window.SavedQuery.lastSyncState = real;
            window.HomePage.renderSync();
          }
          // 上面三条只验「翻译层」。这里再走**真接线**：真调一次代理端点
          // （冒烟的静态服务器没有这个端点 → 404 → 应落成「仅本机」），
          // 少了这一步，把 onSyncStateChange 改名也照样全绿。
          try {
            const r = await window.SavedQuery.pushToServer();
            snap.wired = {
              ok: !!(r && r.ok), state: window.SavedQuery.lastSyncState().state,
              hidden: !!el.hidden, text: el.textContent, cls: el.className,
            };
          } catch (e) {
            snap.wired = { err: String(e && e.message || e) };
          }
          return snap;
        });
        process.stdout.write(`  同步角标: ${JSON.stringify(syncCheck)}\n`);
        const syncOk = !syncCheck.err
          && syncCheck.shared.text === '已同步' && /is-shared/.test(syncCheck.shared.cls)
          && syncCheck.shared.title === ''                       // 2026-09-21：提示文字全删
          && /仅本机/.test(syncCheck.local.text) && /is-local/.test(syncCheck.local.cls)
          && /同步失败/.test(syncCheck.fail.text)
          && syncCheck.pendingHidden === true
          && syncCheck.wired && syncCheck.wired.ok === false
          && syncCheck.wired.state === 'local'
          && syncCheck.wired.hidden === false && /仅本机/.test(syncCheck.wired.text);
        if (!syncOk) {
          process.stdout.write(`    [FAIL] 同步状态角标异常：${JSON.stringify(syncCheck)}\n`);
          anyFail = true;
        }

        // 「输入即出候选下拉」（2026-09-20）：光输入就出候选，不必再点「查 询」。
        // 现在用的是项目统一组件 js/ui/searchable-select.js（与评委栏同一套），
        // 所以断言打在组件真实的 DOM 上：.searchable-select-input / .searchable-select-option
        // —— 单测量不到这些（假 DOM 没有布局与真实键盘事件），只能在这里钉。
        // 先清场 —— **必须在打字之前**：让「当前用户」回到未设置，并顶上一个假的 UserApi。
        // ⚠️ HomePage.render() 会把「当前用户」的输入与候选一起重置（renderUser → resetUserSearch），
        //    所以这一步绝不能放在输入之后：那样刚敲的字会被清掉，看起来就像「输入即搜不工作」。
        //    2026-09-20 我在这上面绕了好几轮。
        await page.evaluate(() => {
          const A = { userId: '1001', userName: '张三', orgId: 'O1', orgName: '软件中心', teamId: 'K1', teamName: '开发一部' };
          const B = { userId: '1002', userName: '张三四', orgId: 'O1', orgName: '软件中心', teamId: 'K1', teamName: '开发一部' };
          window.UserApi = {
            fetchUserList: async () => ({ ok: true, list: [A, B] }),
            fetchUserDetail: async () => ({ ok: true, user: A }),
          };
          window.CurrentUser.clear();
          window.HomePage.render();
          // 数「输入即搜」有没有真的打到 lookup 上（同样要在打字之前装上）
          window.__probeLookups = 0;
          const origLookup = window.CurrentUser.lookup.bind(window.CurrentUser);
          window.CurrentUser.lookup = async (k) => {
            window.__probeLookups += 1;
            return origLookup(k);
          };
        });

        // ① 用**真实键盘**敲进组件内部那个输入框。
        // 为什么不在 evaluate 里 dispatchEvent('input')：组件内部对输入的处理依赖真实事件路径，
        // 程序化派发到不了它那儿（实测：面板会被打开，但候选永远为空）。
        const userBoxSel = '#userKeyword ~ .searchable-select .searchable-select-input';
        await page.click(userBoxSel);
        await page.type(userBoxSel, '张三', { delay: 40 });
        await page.waitForTimeout(600);   // 防抖 250ms + 一次搜索

        const candCheck = await page.evaluate(async () => {
          const out = {};
          const CU = window.CurrentUser;
          const HP = window.HomePage;
          if (!CU || !HP) return { err: 'CurrentUser / HomePage 未加载' };

          // 清场、假 UserApi、lookup 计数都在外面那步做完了（都必须早于打字）
          const host = document.getElementById('userKeyword');
          const box = host.parentElement.querySelector('.searchable-select .searchable-select-input');
          if (!box) return { err: '组件没建出输入框（index.html 没引 searchable-select.js？）' };
          const panel = () => document.getElementById(box.getAttribute('aria-controls') || '')
            || host.parentElement.querySelector('.searchable-select-dropdown');
          const options = () => (panel() ? [...panel().querySelectorAll('.searchable-select-option')] : []);

          // ① 键盘输入已经在外面的 page.type 里做完了，这里只读结果：
          // 候选该自己出来（不必点「查 询」），而且「输入 → 防抖 → 查接口」这条线必须真走过
          out.count = options().length;
          out.lookupsByInput = window.__probeLookups;   // ≥1 才算「输入 → 防抖 → 查接口」真走过
          out.openAfterInput = HP.candsOpen();
          out.labels = options().map((o) => o.textContent.trim()).slice(0, 2);
          // 诊断用：实例在不在、组件眼里的"输入内容"是什么（候选为 0 时靠它定位）
          out.instExists = !!HP.userSelect();

          // ② 组件语义：输入框 role=combobox、面板 role=listbox
          out.boxRole = box.getAttribute('role');
          out.panelRole = panel() ? panel().getAttribute('role') : null;

          // ③ 键盘 ↓ 高亮第一项 → Enter 选中 → 身份落到那个人身上
          box.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
          box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          await new Promise((r) => setTimeout(r, 150));
          out.pickedUserId = (CU.get() || {}).userId;

          // ④ 回到未设置、再出一次候选：Esc 只收下拉，不该动身份。
          // 这一步用 searchUserAuto 直接驱动 —— 这里验的是 Esc 的行为，不是输入事件那条线。
          CU.clear();
          window.HomePage.render();
          await HP.searchUserAuto('张三');
          await new Promise((r) => setTimeout(r, 150));
          const openedAgain = HP.candsOpen();
          box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          out.reopened = openedAgain;
          out.escClosed = openedAgain && !HP.candsOpen();
          out.userStillEmpty = !CU.get();

          // ⑤ 清干净，别把状态留给后面那段（它会自己 CU.clear + render）
          CU.clear();
          window.HomePage.render();
          return out;
        });

        process.stdout.write(`  当前用户候选下拉(组件/输入即出/键盘): ${JSON.stringify(candCheck)}\n`);
        const candOk = candCheck && !candCheck.err
          && candCheck.openAfterInput === true          // 不点查询也出候选
          && candCheck.lookupsByInput >= 1              // 且「输入 → 防抖 → 查接口」这条线真走过
          && candCheck.count === 2
          && candCheck.boxRole === 'combobox'
          && candCheck.panelRole === 'listbox'
          && candCheck.pickedUserId === '1001'          // ↑↓ + Enter 选中了第一项
          && candCheck.reopened === true && candCheck.escClosed === true
          && candCheck.userStillEmpty === true;         // Esc 只收下拉、不改身份
        if (!candOk) {
          process.stdout.write(`    [FAIL] 输入即出的候选下拉异常：${JSON.stringify(candCheck)}\n`);
          anyFail = true;
        }

        // 当前用户 + 部门常用查询（本机口径）。
        // 用一个假的 UserApi 顶掉真接口（冒烟没有后端），验完整链路：
        // 填姓名 → 查到人 → 落到 localStorage → 保存的查询带上归属 → 部门区出现排行。
        const deptCheck = await page.evaluate(async () => {
          const out = {};
          const S = window.SavedQuery;
          const CU = window.CurrentUser;
          if (!S || !CU) return { err: 'SavedQuery / CurrentUser 未加载' };

          const ME = {
            userId: '4711510', userName: '张三',
            orgId: '1645A', orgName: '中国银行软件中心（深圳）',
            teamId: 'K4229', teamName: '中国银行软件中心（深圳）开发三部',
          };
          window.UserApi = {
            fetchUserList: async () => ({ ok: true, list: [ME] }),
            fetchUserDetail: async () => ({ ok: true, user: ME }),
          };

          S.clear(); CU.clear(); window.HomePage.render();

          // ① 未设置用户：部门区要给引导，不能显示成「本部门暂无」
          out.emptyHintHasGuide = /当前用户/.test(document.getElementById('deptEmpty').textContent);
          out.deptCountBefore = document.querySelectorAll('#deptList .saved-item').length;

          // ② 走「手动查询」那条路：查到唯一一人 → 自动成为当前用户，且被记住
          //（「当前用户」现在是组件接管的 <select>，直接写它的 value 没用 —— 用 HomePage 的入口驱动）
          await window.HomePage.searchUser('张三');
          await new Promise((r) => setTimeout(r, 250));
          out.userLabel = document.getElementById('userLabel').textContent;
          // 2026-09-19 版式改版：身份条拆成「姓名（工号）」+ 部门两行 + 头像圈首字
          out.userDept = document.getElementById('userDept').textContent;
          out.userAvatar = document.getElementById('userAvatar').textContent;
          out.userPersisted = !!(CU.get() && CU.get().teamId === 'K4229');
          out.formHidden = document.getElementById('userForm').hidden;

          // ②b 「清空输入」的 ✕ 现在归组件管（不再有自己的按钮）：
          //     这里只确认组件挂在那个 <select> 上，具体交互由上面那段「候选下拉」覆盖
          out.userSelectMounted = !!window.HomePage.userSelect();

          // ③ 保存一条（走真实保存链路，owner 自动取当前用户；save 已 async 化）
          const s = await S.save({
            page: 'publish', name: '部门冒烟查询',
            fields: { f_prodBatch: '2706pc' }, labels: { f_prodBatch: '2706批次' },
            summary: '变更批次：2706批次',
          });
          out.saved = s.ok;
          window.HomePage.render();

          out.deptTitle = document.getElementById('deptTitle').textContent;
          out.deptCount = document.querySelectorAll('#deptList .saved-item').length;
          const meta = document.querySelector('#deptList .saved-item .saved-meta');
          out.deptMeta = meta ? meta.textContent : '';
          out.deptHasOps = document.querySelectorAll('#deptList .saved-ops').length; // 只读视图，应为 0
          out.deptHref = (document.querySelector('#deptList a.saved-main') || {}).getAttribute
            ? document.querySelector('#deptList a.saved-main').getAttribute('href') : '';

          // ④ 条数切换要记住在 localStorage
          const sel = document.getElementById('deptTopN');
          sel.value = '5';
          sel.dispatchEvent(new Event('change'));
          out.topNSaved = localStorage.getItem('spider.deptTopN.v1');
          out.topNSelected = document.getElementById('deptTopN').value;

          S.clear(); CU.clear();
          return out;
        });

        // 导出 / 导入：搬运与备份用（主存是共享库；本机 localStorage 只是「我的」离线镜像）
        const ioCheck = await page.evaluate(async () => {
          const out = {};
          const S = window.SavedQuery;
          if (!S) return { err: 'SavedQuery 未加载' };
          S.clear();
          // 主列表自 2026-09-19 起**按当前用户过滤**（以前显示本机全集，换人列表纹丝不动），
          // 所以这里先立一个身份。下面「同事发来的文件」那条归属是 1001，不该出现在我的列表里。
          const CU = window.CurrentUser;
          if (!CU) return { err: 'CurrentUser 未加载（本页没引 current-user.js？）' };
          CU.set({ userId: '9001', userName: '冒烟甲', teamId: 'T9', teamName: '开发九部' });
          out.hasButtons = !!document.getElementById('btnExportQueries')
            && !!document.getElementById('btnImportQueries');
          if (!S.importJson || !S.exportJson) return { err: '缺少 exportJson / importJson' };

          (await S.save({ page: 'publish', name: '本机查询', fields: {} }));
          // 存的时候自动带上归属人（current-user.js 在场），且不再报 ownerMissing
          out.mineOwnerSaved = !!(S.list()[0] && S.list()[0].owner);
          out.ownerMissingFlag = (await S.save({ page: 'publish', name: '第二条', fields: {} })).ownerMissing === false;
          // 2026-09-21 改口径：exportJsonAsync 只导**当前用户自己的**（此前误取团队库全集）；
          // 冒烟环境没有 /local/saved-queries 端点，会退回本机镜像 —— 两条路都该出合法 JSON，
          // 而且都只含「我的」（镜像是按人维护的，不会混进别人的记录）。
          const text = await S.exportJsonAsync();
          out.exportHasApp = /"app":\s*"spider-saved-queries"/.test(text);
          out.exportCount = (JSON.parse(text).items || []).length;

          // 模拟「同事发来的文件」：导入后应新增
          const incoming = JSON.stringify({
            app: 'spider-saved-queries',
            items: [{
              id: 'from-peer', page: 'task', name: '同事的查询', fields: {},
              owner: { userId: '1001', userName: '李四', orgId: '1645A', orgName: '中国银行软件中心（深圳）', teamId: 'M2534', teamName: '中国银行软件中心（深圳）开发一部' },
              hits: 4, saves: 2,
            }],
          });
          const r1 = await S.importJson(incoming);
          out.firstImport = { ok: r1.ok, added: r1.added, total: r1.total };
          const r2 = await S.importJson(incoming);   // 重复导入应幂等
          out.secondImport = { added: r2.added, merged: r2.merged, total: r2.total };
          const rendered = () => document.querySelectorAll('#savedList .saved-item').length;
          const renderedNames = () => [...document.querySelectorAll('#savedList .saved-name')].map((e) => e.textContent);
          window.HomePage.render();
          out.renderedCount = rendered();
          out.renderedNames = renderedNames();
          out.titleSaysMine = /我的常用查询/.test(document.getElementById('savedTitle').textContent);

          // 换成那位同事 → 列表必须跟着换成人家的（这条是"按人过滤"的反向证据）
          CU.set({ userId: '1001', userName: '李四', teamId: 'M2534', teamName: '中国银行软件中心（深圳）开发一部' });
          window.HomePage.render();
          out.afterSwitchCount = rendered();
          out.afterSwitchNames = renderedNames();

          // 没身份 → 空列表 + 指引文案，**不能**退回显示全部
          CU.clear();
          window.HomePage.render();
          out.noUserCount = rendered();
          out.noUserHint = document.getElementById('savedEmpty').textContent;

          // 共享同步：冒烟用的是自带静态服务器，没有 /local/saved-queries 端点，
          // 所以这里只验「能力就位 + 失败时安静降级」，真实共享由联调脚本验。
          out.hasSyncApi = typeof S.pushToServer === 'function' && typeof S.syncFromServer === 'function';
          const pushed = await S.pushToServer();
          out.pushWithoutEndpoint = pushed.ok === false;
          out.localKept = S.list().length;

          S.clear();
          return out;
        });
        process.stdout.write(`  导出/导入 + 按人过滤: ${JSON.stringify(ioCheck)}\n`);
        const ioOk = !ioCheck.err && ioCheck.hasButtons && ioCheck.exportHasApp
          && ioCheck.mineOwnerSaved === true && ioCheck.ownerMissingFlag === true
          && ioCheck.exportCount === 2
          && ioCheck.firstImport && ioCheck.firstImport.ok && ioCheck.firstImport.added === 1
          && ioCheck.firstImport.total === 3
          && ioCheck.secondImport.added === 0 && ioCheck.secondImport.total === 3
          // 2026-09-21 用户拍板：导入进来的记录**归当前用户** —— 所以「同事发来的那条」
          // 现在也出现在冒烟甲的列表里（以前保留原 owner，它归 1001、在自己列表里看不见）
          && ioCheck.renderedCount === 3
          && ioCheck.renderedNames && ioCheck.renderedNames.some((n) => /同事的查询/.test(n))
          && ioCheck.titleSaysMine === true
          // 换人之后同事名下什么都没有：那条已经归冒烟甲了（旧口径下这里会是 1 条）
          && ioCheck.afterSwitchCount === 0
          && ioCheck.afterSwitchNames && !ioCheck.afterSwitchNames.some((n) => /同事的查询/.test(n))
          // 没身份 → 0 条 + 指引（关键防线：不许静默退回"显示全部"）
          && ioCheck.noUserCount === 0 && /当前用户/.test(ioCheck.noUserHint || '')
          && ioCheck.hasSyncApi === true && ioCheck.pushWithoutEndpoint === true;
        if (!ioOk) {
          process.stdout.write(`    [FAIL] 导出/导入 / 按人过滤异常：${JSON.stringify(ioCheck)}\n`);
          anyFail = true;
        }

        // 导出按钮整条链路（2026-09-21 补）：以前只验了 S.exportJsonAsync() 出的 JSON 合法，
        // **从没点过这个按钮** —— 于是 toast 里那行 `${items.length}`（`items` 是别的函数里的局部
        // 变量，这一层取不到）一直没被发现：文件照常下载，随后抛 ReferenceError，
        // 成功提示永不出现，反被全局兜底弹一句「⚠️ 页面出现异常」，用户看着像导出失败。
        // 这里用「未捕获异常计数不涨 + 提示文案对」钉住它；不真落文件（下载链路换桩）。
        // 不读 #toast 的文本：toast 是**串行队列**（js/ui/toast.js 的 QUEUE），
        // 此时前面还压着几条没播完，固定 sleep 只会读到旧文案，把断言变成假警报。
        // 直接给 window.toast 挂探针 —— home.js 的 showToast 是**调用时**才取 window.toast。
        const exportBtn = await page.evaluate(async () => {
          const o = { toasts: [] };
          const c0 = window.AppRuntime.uncaughtCount();
          const origCreate = URL.createObjectURL;
          const origRevoke = URL.revokeObjectURL;
          const origClick = HTMLAnchorElement.prototype.click;
          const origToast = window.toast;
          URL.createObjectURL = () => 'blob:smoke-stub';   // 不真落文件
          URL.revokeObjectURL = () => {};
          HTMLAnchorElement.prototype.click = function () {};
          window.toast = (msg) => { o.toasts.push(String(msg)); };
          try {
            // 上一段结尾有 S.clear()（清理现场），镜像此时是空的 → 先存一条，
            // 条数才是确定的 1（也顺便验「导出的确实是刚存进去的那份」）。
            const saved = await window.SavedQuery.save({ page: 'publish', name: '导出探针', fields: {} });
            o.savedOk = !!(saved && saved.ok);
            document.getElementById('btnExportQueries').click();
            const t0 = Date.now();
            while (Date.now() - t0 < 5000 && !o.toasts.length) {
              await new Promise((r) => setTimeout(r, 100));
            }
            o.uncaught = window.AppRuntime.uncaughtCount() - c0;
          } finally {
            URL.createObjectURL = origCreate;
            URL.revokeObjectURL = origRevoke;
            HTMLAnchorElement.prototype.click = origClick;
            window.toast = origToast;
            // 复原上一段留下的「镜像为空」这个现场，别影响后面 task / subscription 两页的断言
            window.SavedQuery.clear();
          }
          return o;
        });
        process.stdout.write(`  导出按钮: ${JSON.stringify(exportBtn)}\n`);
        {
          const hit = (exportBtn.toasts || []).some((m) => /^已导出你的\s*1\s*条/.test(m));
          if (!hit || exportBtn.uncaught !== 0 || exportBtn.savedOk !== true) {
            process.stdout.write('    [FAIL] 点「导 出」没给出带条数的成功提示 / 抛了未捕获异常：'
              + JSON.stringify(exportBtn) + '\n');
            anyFail = true;
          }
        }

        process.stdout.write(`  当前用户/部门排行: ${JSON.stringify(deptCheck)}\n`);
        const deptOk = !deptCheck.err
          && deptCheck.emptyHintHasGuide === true && deptCheck.deptCountBefore === 0
          && /张三/.test(deptCheck.userLabel || '') && /4711510/.test(deptCheck.userLabel || '')
          && /开发三部/.test(deptCheck.userDept || '')      // 部门单独一行（原来挤在同一行）
          && deptCheck.userAvatar === '张'                  // 头像圈用姓名首字
          && deptCheck.userSelectMounted === true           // 「当前用户」的可搜索下拉挂上了
          && deptCheck.userPersisted === true && deptCheck.formHidden === true
          && deptCheck.saved === true && deptCheck.deptCount === 1
          && /开发三部/.test(deptCheck.deptTitle || '')
          // 口径（2026-09-19 改）：这行显示的是「这份条件被几个人保存过」，
          // 不再显示某人的打开/保存次数 —— 一个人刚存的一条就是「1 人保存」。
          && /张三/.test(deptCheck.deptMeta || '') && /1 人保存/.test(deptCheck.deptMeta || '')
          && deptCheck.deptHasOps === 0
          && /\/publish\?saved=/.test(deptCheck.deptHref || '')
          && deptCheck.topNSaved === '5' && deptCheck.topNSelected === '5';
        if (!deptOk) {
          process.stdout.write(`    [FAIL] 当前用户 / 部门常用查询异常：${JSON.stringify(deptCheck)}\n`);
          anyFail = true;
        }
      }

      if (pg.file === 'publish.html') {
        // 变更时间改成「起始 / 结束」两个框后，日历里要把中间那段用虚线连起来。
        // 这条只能真机验：要真的点开面板、点两天的日期、再看格子上的 is-in-range。
        const rangeCheck = await page.evaluate(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const out = {};
          const startEl = document.getElementById('f_changeTimeStart');
          const endEl = document.getElementById('f_changeTimeEnd');
          if (!startEl || !endEl) return { err: '两个日期框不存在' };

          // 只点**当前可见**面板里的格子：隐藏面板仍在 DOM 里，
          // 用 document.querySelectorAll 会先命中隐藏的那个（踩过：日期写进了起始框）。
          const visiblePanel = () => document.querySelector('.dp-panel:not([hidden])');
          const pickDay = async (n) => {
            const panel = visiblePanel();
            if (!panel) return false;
            const cells = Array.from(panel.querySelectorAll('.dp-grid .dp-cell'))
              .filter((c) => !c.classList.contains('dp-blank'));
            const target = cells.find((c) => c.textContent === String(n));
            if (!target) return false;
            target.click();
            await sleep(120);
            return true;
          };

          startEl.click();                       // 先选起始
          await sleep(150);
          out.opened = !!document.querySelector('.dp-panel:not([hidden])');
          out.pickedStart = await pickDay(10);

          endEl.click();                         // 再选结束
          await sleep(150);
          out.pickedEnd = await pickDay(20);

          startEl.click();                       // 重新打开任一面板，看区间高亮
          await sleep(150);
          out.startVal = startEl.value;
          out.endVal = endEl.value;
          const panel = visiblePanel();
          if (panel) {
            out.inRange = Array.from(panel.querySelectorAll('.dp-grid .dp-cell.is-in-range'))
              .map((c) => c.textContent);
            // 端点本身是实心选中，不该同时算「区间内」
            out.selected = Array.from(panel.querySelectorAll('.dp-grid .dp-cell.is-selected'))
              .map((c) => c.textContent);
          } else {
            out.inRange = [];
            out.selected = [];
          }
          // 关掉面板，别影响后续断言
          document.body.click();
          await sleep(100);
          return out;
        });

        process.stdout.write(`  变更时间区间: ${JSON.stringify(rangeCheck)}\n`);
        const rangeOk = !rangeCheck.err && rangeCheck.opened === true
          && rangeCheck.pickedStart === true && rangeCheck.pickedEnd === true
          && rangeCheck.startVal && rangeCheck.endVal
          && rangeCheck.inRange.length > 0
          && rangeCheck.inRange.includes('15')
          && !rangeCheck.inRange.includes('10') && !rangeCheck.inRange.includes('20');
        if (!rangeOk) {
          process.stdout.write(`    [FAIL] 变更时间区间高亮异常：${JSON.stringify(rangeCheck)}\n`);
          anyFail = true;
        }
      }

      if (pg.file === 'publish.html') {
        // 提供方应用系统服务编号：已从手输单值改成多选，宿主是 div（值在实例里）。
        const multiCheck = await page.evaluate(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const host = document.getElementById('msel_sysServeNo');
          if (!host) return { err: '多选宿主不存在' };
          host.click();
          await sleep(150);
          const display = host.querySelector('.msel-display');
          return {
            hasDisplay: !!display,
            expanded: display ? display.getAttribute('aria-expanded') : null,
            disabled: host.querySelector('input[disabled]') ? true : false,
          };
        });
        process.stdout.write(`  服务编号多选: ${JSON.stringify(multiCheck)}\n`);
        if (multiCheck.err || !multiCheck.hasDisplay) {
          process.stdout.write(`    [FAIL] 服务编号多选未接线：${JSON.stringify(multiCheck)}\n`);
          anyFail = true;
        }
      }

      if (pg.file === 'publish.html') {
        // 旧记录自动升级：2026-09-18 前保存的卡片，摘要里写的是编号（2611pc / E00301），
        // 改代码修不了已落盘的文本。现在的做法是「从首页打开时重算回写」——
        // 这里真的造一条 v1 旧记录，带 ?saved= 打开，再验它已经被升级成 v2。
        const oldId = await page.evaluate(async () => {
          const S = window.SavedQuery;
          if (!S) return null;
          await S.clear();
          const r = await S.save({
            page: 'publish', name: '旧格式卡片',
            fields: { f_prodBatch: '2611pc', f_serviceName: '全球汇划' },
            summary: '变更批次：2611pc · 服务名称：全球汇划',
          });
          if (!r.ok) return null;
          // 手工降级成旧格式（去掉 labels / 版本号），等价于升级前保存下来的数据
          const raw = JSON.parse(localStorage.getItem(S.STORAGE_KEY) || '[]');
          raw.forEach((it) => { delete it.labels; it.v = 1; });
          localStorage.setItem(S.STORAGE_KEY, JSON.stringify(raw));
          return r.item.id;
        });

        if (oldId) {
          await page.goto(`${base}publish.html?saved=${oldId}`, { waitUntil: 'load', timeout: 15000 });
          await page.waitForTimeout(2500);   // 等字典初始化 → 回填 → 升级回写
          const upgraded = await page.evaluate((id) => {
            const S = window.SavedQuery;
            const it = S ? S.get(id) : null;
            return it ? { v: it.v, hasLabels: Object.keys(it.labels || {}).length > 0, summary: it.summary } : null;
          }, oldId);
          process.stdout.write(`  旧记录升级: ${JSON.stringify(upgraded)}\n`);
          if (!upgraded || upgraded.v !== 2 || !upgraded.hasLabels) {
            process.stdout.write(`    [FAIL] 旧记录点开后未自动升级：${JSON.stringify(upgraded)}\n`);
            anyFail = true;
          }
          await page.evaluate(() => window.SavedQuery && window.SavedQuery.clear());
          await page.goto(base + pg.file, { waitUntil: 'load', timeout: 15000 });
          await page.waitForTimeout(600);
        } else {
          process.stdout.write('    [FAIL] 无法构造旧记录（SavedQuery 未加载？）\n');
          anyFail = true;
        }
      }

      if (pg.file === 'publish.html') {
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

      if (pg.file === 'publish.html') {
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

      if (pg.file === 'publish.html') {
        // 结果行两个弹窗（2026-09-21）：接口明细（5 个 tab，一次请求拿全）+ 操作记录（服务端分页）。
        // 冒烟不依赖后端：只把 window.ToolApi 的两个取数函数换成桩（形态照抄
        // `操作记录和接口明细.har`，字段名一个不差），弹窗与页面脚本仍走真实代码路径 ——
        // 这样「模块没引 / 事件没接」这种点了没反应的毛病才拦得住。
        const rowDlg = await page.evaluate(async () => {
          const out = {};
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          const api = window.ToolApi;
          if (!api) return { err: 'ToolApi 未加载' };
          if (typeof window.IntfDetailDialog !== 'object' || typeof window.IntfDetailDialog.open !== 'function'
            || typeof window.OpRecordDialog !== 'object' || typeof window.OpRecordDialog.open !== 'function') {
            return { err: '两个弹窗模块未加载（PublishDialogModel / intf-detail-dialog / op-record-dialog）' };
          }
          const origChild = api.fetchServiceChildList;
          const origOp = api.fetchOperationRecordList;
          const opCalls = [];
          // 抓包里 operationType 出现过的编码：12/17/18/43/45/47/50/52（现已全部有显示名）。
          // 桩里三种都覆盖到：13（**反推**出来的，别只验实证那批）、
          // 999（映射表里根本没有的编码）—— 守「反推的能显示、未覆盖的原样显示数字、
          // 两种都不猜中文」。
          const TYPE_CYCLE = ['12', '43', '52', '13', '50', '999'];
          const mkParam = (i, messageType) => ({
            parameter: 'p' + i, parameterName: '参数' + i, dictNo: 'D' + i, length: '16',
            type: 'String', isMust: i % 2 ? '是' : '否', remark1: '', remark2: '', remark3: '',
            messageType: messageType, sort: i,
          });
          try {
            api.fetchServiceChildList = async () => ({
              ok: true,
              local: false,
              lists: {
                childReqList: [mkParam(0, '1'), mkParam(1, '1')],
                childRespList: [mkParam(0, '2'), mkParam(1, '2'), mkParam(2, '2')],
                revisionList: [],
                interfaceModifyList: [{
                  vsn: 'V1.0', modifyDetail: '新增接口', modifyDate: '2026-07-17',
                  modifier: '崔丹', remark: '', prodBatch: null, serverNo: null, sort: null,
                }],
                deployList: [{ gatewayCode: 'E00306GWG001', context: 'E00306CTX', sort: 0 }],
              },
            });
            api.fetchOperationRecordList = async (p) => {
              opCalls.push({ pageNum: p.pageNum, pageSize: p.pageSize, operationType: p.operationType, publishId: p.publishId });
              const all = [];
              for (let i = 0; i < 21; i++) {
                all.push({
                  operationerName: '操作人' + i,
                  createTime: '2026-09-09 16:29:0' + (i % 10),
                  operationType: TYPE_CYCLE[i % TYPE_CYCLE.length],
                  subscribeName: 'E00301-互联网金融服务平台-BOCNET-G-IFS',
                  prodSysServeNo: 'E00301TPC' + i,
                });
              }
              const start = (p.pageNum - 1) * p.pageSize;
              return { ok: true, total: 21, rows: all.slice(start, start + p.pageSize) };
            };

            const ROW = {
              publishId: '70e1f913-8450-4fed-9977-930cd849f6c0',
              sysServeNo: 'E00306MG0001-queryPreviousTransaction',
            };
            const txt = (sel) => { const el = document.querySelector(sel); return el ? el.textContent.trim() : null; };
            const clickTab = (key) => {
              const b = document.querySelector('#intfDetailTabs [data-tab="' + key + '"]');
              if (b) b.click();
            };

            // ══ 接口明细 ══
            window.IntfDetailDialog.open(ROW);
            await wait(100);
            const tabs = Array.from(document.querySelectorAll('#intfDetailTabs .dlg-tab'));
            out.intfTabCount = tabs.length;
            out.intfTabLabels = tabs.map((t) => t.textContent.trim()).join('|');
            out.intfFirstActive = !!(tabs[0] && tabs[0].classList.contains('is-active'));
            out.intfReqRows = document.querySelectorAll('#intfDetailTbody tr').length;
            out.intfMsgCols = document.querySelectorAll('#intfDetailThead th').length;
            // colgroup 的 <col> 个数必须等于表头 <th> 个数（本项目踩过：差一个会静默错位）
            out.intfColMatch = document.querySelectorAll('#intfDetailCols col').length === out.intfMsgCols;
            // 加载成功后状态行必须收起来（拿桩数据还挂着 loading 文案就是骗人）
            out.intfStatusHidden = document.getElementById('intfDetailStatus').hidden;
            // 表头吸顶：吸顶规则绑在「本表自己的滚动视口」上
            out.intfThSticky = getComputedStyle(document.querySelector('#intfDetailThead th')).position;
            // 高度分配：弹窗主体不滚，富余高度给表格区（否则双滚动条）
            out.intfBodyOverflow = getComputedStyle(document.querySelector('#intfDetailDialog .intf-body')).overflowY;
            out.intfTblH = Math.round(document.querySelector('#intfDetailDialog .dlg-tbl-scroll')
              .getBoundingClientRect().height);
            // 只有 2 行 → 不该出现分页条（弹窗里一条「第 1 / 1 页」纯属噪音）
            out.intfPagerHidden = getComputedStyle(document.getElementById('intfDetailPager')).display === 'none';

            clickTab('resp');
            await wait(40);
            out.intfRespRows = document.querySelectorAll('#intfDetailTbody tr').length;
            out.intfRespCols = document.querySelectorAll('#intfDetailThead th').length;
            out.intfRespActive = !!document.querySelector('#intfDetailTabs [data-tab="resp"].is-active');
            clickTab('intfRev');
            await wait(40);
            out.intfRevRows = document.querySelectorAll('#intfDetailTbody tr').length;
            out.intfRevCols = document.querySelectorAll('#intfDetailThead th').length;
            out.intfRevFirst = txt('#intfDetailTbody tr td:nth-child(2)');   // 版本号 V1.0
            clickTab('deploy');
            await wait(40);
            out.intfDeployRows = document.querySelectorAll('#intfDetailTbody tr').length;
            out.intfDeployCols = document.querySelectorAll('#intfDetailThead th').length;
            out.intfDeployFirst = txt('#intfDetailTbody tr td:nth-child(2)'); // 网关服务编码
            clickTab('docRev');
            await wait(40);
            out.intfDocRevEmpty = !!document.querySelector('#intfDetailTbody .empty-hint');
            // 键盘：← → 切页签（焦点要跟着选中项走）
            const tabsEl = document.getElementById('intfDetailTabs');
            tabsEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
            await wait(40);
            out.intfAfterArrow = !!document.querySelector('#intfDetailTabs [data-tab="intfRev"].is-active');

            window.IntfDetailDialog.close();
            out.intfClosed = !document.getElementById('intfDetailOverlay').classList.contains('show');

            // ══ 操作记录 ══
            window.OpRecordDialog.open(ROW);
            await wait(100);
            out.opRows = document.querySelectorAll('#opRecordTbody tr').length;
            out.opCols = document.querySelectorAll('#opRecordThead th').length;
            out.opColMatch = document.querySelectorAll('#opRecordCols col').length === out.opCols;
            out.opCall = JSON.stringify(opCalls[0] || null);
            // 编码 → 显示名：实证与推断的都走名称，没命中的（999）原样显示数字
            out.opTypeLabels = Array.from(document.querySelectorAll('#opRecordTbody tr'))
              .map((tr) => tr.children[3].textContent.trim()).slice(0, 6).join(',');
            // 操作类型下拉必须被 createSearchableSelect 接管（原生 <select> 会被组件隐藏）
            const host = document.getElementById('opTypeFilter');
            out.opHostHidden = host ? getComputedStyle(host).display === 'none' : null;
            out.opPickedInput = !!document.querySelector('.op-record-filter .searchable-select-input');
            out.opPagerVisible = getComputedStyle(document.getElementById('opRecordPager')).display !== 'none';
            out.opPageInfo = txt('#opRecordPageInfo');

            // 翻页 → 服务端重新请求（pageNum=2），序号接着上一页数
            document.getElementById('opBtnNext').click();
            await wait(100);
            out.opPage2Call = opCalls[1] ? opCalls[1].pageNum : null;
            out.opPage2FirstIdx = txt('#opRecordTbody tr td.c-idx');

            // 筛选 → 请求里要真的带上 operationType（编码，不是显示名）
            const si = document.querySelector('.op-record-filter .searchable-select-input');
            if (si) {
              const inst = null;   // 走真实交互：点开面板选「服务订阅-归档」(52)
              si.click();
              await wait(60);
              const opt = Array.from(document.querySelectorAll('.searchable-select-option'))
                .find((o) => o.textContent.trim() === '服务订阅-归档');
              out.opPanelHasOption = !!opt;
              if (opt) opt.click();
              await wait(40);
              document.getElementById('btnOpQuery').click();
              await wait(100);
              const last = opCalls[opCalls.length - 1];
              out.opFilteredCall = last ? (last.operationType + '/' + last.pageNum) : null;
              void inst;
            }

            window.OpRecordDialog.close();
            out.opClosed = !document.getElementById('opRecordOverlay').classList.contains('show');
            return out;
          } finally {
            api.fetchServiceChildList = origChild;
            api.fetchOperationRecordList = origOp;
          }
        });
        process.stdout.write(`  结果行弹窗: ${JSON.stringify(rowDlg)}\n`);
        {
          const f = [];
          if (rowDlg.err) f.push(rowDlg.err);
          // 接口明细：5 个 tab + 每张表的列数（序号 + 列定义）
          if (rowDlg.intfTabCount !== 5) f.push('接口明细 tab 数不是 5：' + rowDlg.intfTabCount);
          if (rowDlg.intfTabLabels !== '请求报文|响应报文|文档级修订记录|接口级修订记录|应用系统服务部署') {
            f.push('接口明细 tab 文案/顺序不对：' + rowDlg.intfTabLabels);
          }
          if (!rowDlg.intfFirstActive) f.push('默认没有选中「请求报文」');
          if (rowDlg.intfReqRows !== 2 || rowDlg.intfMsgCols !== 10) {
            f.push(`请求报文表不对：rows=${rowDlg.intfReqRows} cols=${rowDlg.intfMsgCols}`);
          }
          if (!rowDlg.intfColMatch) f.push('接口明细 colgroup 的 col 数与表头 th 数不一致');
          if (!rowDlg.intfStatusHidden) f.push('接口明细加载成功后状态行没收起');
          if (rowDlg.intfThSticky !== 'sticky') f.push('接口明细表头没吸顶：' + rowDlg.intfThSticky);
          if (rowDlg.intfBodyOverflow !== 'hidden') {
            f.push('接口明细弹窗主体还在滚（会与表格区双滚动条）：' + rowDlg.intfBodyOverflow);
          }
          if (!(rowDlg.intfTblH > 100)) f.push('接口明细表格区没拿到高度：' + rowDlg.intfTblH);
          if (!rowDlg.intfPagerHidden) f.push('只有 2 行却显示了分页条');
          // 切 tab = 换表不换请求：响应报文 3 行、接口级修订 1 行、部署 1 行、文档级空态
          if (rowDlg.intfRespRows !== 3 || rowDlg.intfRespCols !== 10) {
            f.push(`响应报文表不对：rows=${rowDlg.intfRespRows} cols=${rowDlg.intfRespCols}`);
          }
          if (!rowDlg.intfRespActive) f.push('切到响应报文后选中态没跟上');
          if (rowDlg.intfRevRows !== 1 || rowDlg.intfRevCols !== 8 || rowDlg.intfRevFirst !== 'V1.0') {
            f.push(`接口级修订记录不对：rows=${rowDlg.intfRevRows} cols=${rowDlg.intfRevCols} vsn=${rowDlg.intfRevFirst}`);
          }
          if (rowDlg.intfDeployRows !== 1 || rowDlg.intfDeployCols !== 3
            || rowDlg.intfDeployFirst !== 'E00306GWG001') {
            f.push(`应用系统服务部署不对：rows=${rowDlg.intfDeployRows} cols=${rowDlg.intfDeployCols} gw=${rowDlg.intfDeployFirst}`);
          }
          if (!rowDlg.intfDocRevEmpty) f.push('文档级修订记录为空时没显示空态');
          if (!rowDlg.intfAfterArrow) f.push('接口明细页签不支持 ← → 键切换');
          if (!rowDlg.intfClosed) f.push('接口明细关了遮罩还带 .show');
          // 操作记录：6 列 + 服务端分页 + 编码映射 + 下拉被组件接管
          if (rowDlg.opRows !== 10 || rowDlg.opCols !== 6) {
            f.push(`操作记录表不对：rows=${rowDlg.opRows} cols=${rowDlg.opCols}`);
          }
          if (!rowDlg.opColMatch) f.push('操作记录 colgroup 的 col 数与表头 th 数不一致');
          if (rowDlg.opTypeLabels !==
            '正式版基线,服务发布-审核人审核通过,服务订阅-归档,下线,服务订阅-审核人审核通过,999') {
            f.push('操作类型编码映射不对（反推的要显示名称、没覆盖的要原样显示数字）：' + rowDlg.opTypeLabels);
          }
          if (rowDlg.opHostHidden !== true || !rowDlg.opPickedInput) {
            f.push('操作类型下拉没被 createSearchableSelect 接管（原生下拉展开面板样式不可控）');
          }
          if (!rowDlg.opPagerVisible || rowDlg.opPageInfo !== '第 1 / 3 页') {
            f.push(`操作记录分页条不对：visible=${rowDlg.opPagerVisible} info=${rowDlg.opPageInfo}`);
          }
          if (rowDlg.opPage2Call !== 2) f.push('翻页没重新请求（pageNum 不是 2）：' + rowDlg.opPage2Call);
          if (rowDlg.opPage2FirstIdx !== '11') f.push('第 2 页序号没接着数：' + rowDlg.opPage2FirstIdx);
          if (!rowDlg.opPanelHasOption) f.push('操作类型面板里没有「服务订阅-归档」这一项');
          if (rowDlg.opFilteredCall !== '52/1') {
            f.push('按操作类型筛选没把编码传下去 / 没回到第 1 页：' + rowDlg.opFilteredCall);
          }
          if (!rowDlg.opClosed) f.push('操作记录关了遮罩还带 .show');
          f.forEach((m) => process.stdout.write('    [FAIL] ' + m + '\n'));
          if (f.length) anyFail = true;
        }
      }

      if (pg.file === 'publish.html') {
        // 接口明细的**分页 / 每 tab 记住页码 / 表格区自己滚**（2026-09-21）。
        // 真实抓包每个 tab 只有 1~8 行，压根走不到第 2 页 —— 这条只能靠桩数据守：
        // 23 行 → 10 条/页 → 3 页；翻到第 2 页序号要接着数；切走再切回来页码不能丢。
        const intfPager = await page.evaluate(async () => {
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          const api = window.ToolApi;
          const orig = api.fetchServiceChildList;
          const idxOf = (sel) => {
            const t = document.querySelector(sel);
            return t ? t.textContent.trim() : null;
          };
          const idxList = () => Array.from(document.querySelectorAll('#intfDetailTbody tr td.c-idx'))
            .map((t) => t.textContent.trim());
          try {
            const mk = (i) => ({
              parameter: 'p' + i, parameterName: '参数' + i, dictNo: '', length: '16',
              type: 'String', isMust: '是', remark1: '', remark2: '备注' + i, remark3: '', sort: i,
            });
            api.fetchServiceChildList = async () => ({
              ok: true,
              local: false,
              lists: {
                childReqList: Array.from({ length: 23 }, (_, i) => mk(i)),
                childRespList: [], revisionList: [], interfaceModifyList: [], deployList: [],
              },
            });
            window.IntfDetailDialog.open({ publishId: 'p1', sysServeNo: 'E1' });
            await wait(120);
            const out = {};
            const rows = idxList();
            out.rowCount = rows.length;
            out.firstIdx = rows[0];
            out.lastIdx = rows[rows.length - 1];
            out.pagerVisible = getComputedStyle(document.getElementById('intfDetailPager')).display !== 'none';
            out.pageInfo = document.getElementById('intfPageInfo').textContent;
            // 翻到第 2 页（点页码条，走真实事件委托）
            const b2 = document.querySelector('#intfPageNumbers button[data-page="2"]');
            out.hasPage2 = !!b2;
            if (b2) b2.click();
            await wait(60);
            out.page2Info = document.getElementById('intfPageInfo').textContent;
            out.page2FirstIdx = idxOf('#intfDetailTbody tr td.c-idx');
            out.page2LastIdx = idxList().pop();
            // 10 行可能超过弹窗可用高度：表格区要自己成为滚动视口，且不能被弹窗裁掉
            const dlg = document.getElementById('intfDetailDialog').getBoundingClientRect();
            const sc = document.querySelector('#intfDetailDialog .dlg-tbl-scroll');
            out.tableInside = sc.getBoundingClientRect().bottom <= dlg.bottom + 1;
            out.pagerInside = document.getElementById('intfDetailPager').getBoundingClientRect().bottom
              <= dlg.bottom + 1;
            out.pagerBelowTable = document.getElementById('intfDetailPager').getBoundingClientRect().top
              >= sc.getBoundingClientRect().bottom - 1;
            // 切到别的 tab 再切回来：页码要记着（每个 tab 各自一份，不是全局一个）
            document.querySelector('#intfDetailTabs [data-tab="resp"]').click();
            await wait(50);
            out.emptyTabPagerHidden = getComputedStyle(document.getElementById('intfDetailPager')).display === 'none';
            document.querySelector('#intfDetailTabs [data-tab="req"]').click();
            await wait(50);
            out.afterSwitchBackInfo = document.getElementById('intfPageInfo').textContent;
            out.afterSwitchBackFirst = idxOf('#intfDetailTbody tr td.c-idx');
            window.IntfDetailDialog.close();
            return out;
          } finally { api.fetchServiceChildList = orig; }
        });
        process.stdout.write(`  接口明细分页: ${JSON.stringify(intfPager)}\n`);
        {
          const f = [];
          if (intfPager.rowCount !== 10) f.push('第 1 页不是 10 行：' + intfPager.rowCount);
          if (intfPager.firstIdx !== '1' || intfPager.lastIdx !== '10') {
            f.push(`第 1 页序号不对：${intfPager.firstIdx}~${intfPager.lastIdx}`);
          }
          if (!intfPager.pagerVisible || intfPager.pageInfo !== '第 1 / 3 页') {
            f.push(`分页条不对：visible=${intfPager.pagerVisible} info=${intfPager.pageInfo}`);
          }
          if (!intfPager.hasPage2) f.push('23 行没有生成第 2 页的页码按钮');
          if (intfPager.page2FirstIdx !== '11' || intfPager.page2LastIdx !== '20') {
            f.push(`第 2 页序号不对：${intfPager.page2FirstIdx}~${intfPager.page2LastIdx}`);
          }
          if (intfPager.page2Info !== '第 2 / 3 页') f.push('第 2 页页码文案不对：' + intfPager.page2Info);
          if (!intfPager.tableInside) f.push('表格区被弹窗裁掉了（下边超出弹窗）');
          if (!intfPager.pagerInside) f.push('分页条被弹窗裁掉了');
          if (!intfPager.pagerBelowTable) f.push('分页条没有排在表格下方');
          if (!intfPager.emptyTabPagerHidden) f.push('空表那个 tab 还显示着分页条');
          if (intfPager.afterSwitchBackInfo !== '第 2 / 3 页'
            || intfPager.afterSwitchBackFirst !== '11') {
            f.push(`切走再切回来页码没记住：${intfPager.afterSwitchBackInfo} / ${intfPager.afterSwitchBackFirst}`);
          }
          f.forEach((m) => process.stdout.write('    [FAIL] ' + m + '\n'));
          if (f.length) anyFail = true;
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

        // 「剩余 ≤3 天仅优先级变红」：注入一个 is-near 的 tag，确认字色为红（整行不变红由 CSS 只作用于 .prio-tag 保证）
        const nearCss = await page.evaluate(() => {
          const el = document.createElement('span');
          el.className = 'prio-tag is-near';
          el.textContent = 'T';
          document.body.appendChild(el);
          const c = getComputedStyle(el).color;
          el.remove();
          return c;
        });
        process.stdout.write(`  ≤3天优先级样式: color=${nearCss}\n`);
        const nm = /rgb\((\d+), (\d+), (\d+)\)/.exec(nearCss);
        const isRed = nm && Number(nm[1]) > 80 && Number(nm[2]) < 80 && Number(nm[3]) < 80;
        if (!isRed) {
          process.stdout.write(`    [FAIL] ≤3天优先级字色 ${nearCss} 不是红色\n`);
          anyFail = true;
        }

        // 批次时间的行来源 + 日历初始月份（2026-09-15 用户反馈的三个点一起守）：
        //   · 行 = 批次字典里落在批次窗口（当月 −2 ~ +3）内的批次（月度 + 独立），
        //     不再有「查询结果里冒出来的历史批次」（2408批次 就是这么进来的）；
        //   · 「作废」批次、解析不出年月的批次不进弹窗；
        //   · 打开日历直接定位到批次对应月份：功测 = 批次月 −1、上线 = 批次月。
        // ⚠️ 窗口 2026-09-21 从 12 个月（−2 ~ +9）收成 6 个月（−2 ~ +3）：
        //    2706批次 由「窗口内」变成「窗口外」，断言跟着换边（见下面的 mustHave / 不该有）。
        const btRows = await page.evaluate(async () => {
          // 字典桩：真实字典要打接口，冒烟环境用固定样本覆盖（窗口 = 2607 ~ 2612）
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
        const mustHave = ['2607批次', '2608批次', '26年8月独立'];
        mustHave.forEach((b) => {
          if (!btRows.includes(b)) {
            process.stdout.write(`    [FAIL] 批次行缺少 ${b}（字典窗口过滤 / 排序有问题）\n`);
            anyFail = true;
          }
        });
        // 2706批次 自 2026-09-21 起在窗口外（当月 +3 只到 2612）→ 换成「不该出现」这一侧
        ['2408批次', '26年8月独立批次(作废)', '技术支持类-2026年批次', '2706批次'].forEach((b) => {
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
        // 用「字典桩里的月度批次 + localStorage 里 20 个自定义批次」把表格撑长，制造真实滚动。
        // （字典桩给了 2607~2612 与 2701~2706，后者落在窗口外会被过滤掉，正好一并验证过滤。）
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
        // 导出：点一次要真的按页拉取、报进度、最后落文件；再点一次要能取消。
        // ⚠️ 这条是 2026-09-19 补的：当时 548 条单测全绿，但 exportCsv 里调了一个
        // 本文件不存在的 renderCount()，一点就 ReferenceError、按钮永久卡在「取消导出」
        // —— 页面脚本没有 node 侧假 DOM 可测，**只有真浏览器点一下才暴出来**。
        const exportCheck = await page.evaluate(async () => {
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const btn = document.querySelector('#btnExportCsv');
          const rc = document.querySelector('#resultCount');
          if (!btn || !rc) return { err: '缺少 #btnExportCsv 或 #resultCount' };
          const realE = window.CsvExporter;
          const realFetch = window.TaskApi.fetchTaskList;
          const realToast = window.toast;
          const toasts = [];
          let downloads = 0;
          window.CsvExporter = {
            fetchAllPages: realE.fetchAllPages,
            download: () => { downloads += 1; },
          };
          window.toast = (m) => { toasts.push(String(m)); };
          try {
            // 导出要求「先查询过」，所以先桩好按页取数、点一次查询把 state 喂起来。
            // 桩按调用方要的 pageSize 给行：查询页给 10 条、导出页给 500 条，total 恒 1200
            // → 导出应当正好发 3 次请求。
            let calls = 0;
            window.TaskApi.fetchTaskList = async (cond, p, size) => {
              calls += 1;
              await sleep(40);
              const n = Number(size) > 0 ? Number(size) : 10;
              return { ok: true, total: 1200, rows: Array.from({ length: n }, (_, i) => ({ serverNo: `p${p}-${i}` })) };
            };
            const q = document.querySelector('#btnQuery');
            if (!q) return { err: '缺少 #btnQuery' };
            q.click();
            for (let i = 0; i < 40 && !/1,?200/.test(rc.textContent); i++) await sleep(25);
            const queryCalls = calls;
            calls = 0;

            btn.click();
            let sawProgress = false;
            for (let i = 0; i < 30; i++) {
              await sleep(20);
              if (/导出中/.test(rc.textContent)) sawProgress = true;
            }
            const done = {
              queryCalls, sawProgress, exportCalls: calls, downloads,
              toast: toasts.join(' | '), btnText: btn.textContent.trim(),
            };

            // 取消路径：再点一次应当中止、不落文件、提示是「取消」而不是「失败」
            toasts.length = 0;
            calls = 0;
            downloads = 0;
            window.TaskApi.fetchTaskList = async (cond, p, size) => {
              calls += 1;
              await sleep(80);            // 慢到足够让我们在半路点取消
              const n = Number(size) > 0 ? Number(size) : 10;
              return { ok: true, total: 5000, rows: Array.from({ length: n }, (_, i) => ({ serverNo: `c${p}-${i}` })) };
            };
            btn.click();
            await sleep(120);              // 第一页在途
            btn.click();                   // 再点一次 = 取消
            await sleep(150);
            const cancelled = {
              toast: toasts.join(' | '), calls, downloads,
              btnText: btn.textContent.trim(),
              stillCounting: /导出中/.test(rc.textContent),
            };
            return { ok: true, done, cancelled };
          } finally {
            window.CsvExporter = realE;
            window.TaskApi.fetchTaskList = realFetch;
            window.toast = realToast;
          }
        });
        process.stdout.write(`  导出 CSV: ${JSON.stringify(exportCheck)}\n`);
        const exportOk = !exportCheck.err
          && exportCheck.done.queryCalls >= 1
          && exportCheck.done.sawProgress === true
          && exportCheck.done.exportCalls === 3
          && exportCheck.done.downloads === 1
          && /已导出 1200 条/.test(exportCheck.done.toast)
          && exportCheck.done.btnText !== '取消导出'
          && /已取消导出/.test(exportCheck.cancelled.toast)
          && !/导出失败/.test(exportCheck.cancelled.toast)
          && exportCheck.cancelled.downloads === 0
          && exportCheck.cancelled.calls <= 2
          && exportCheck.cancelled.btnText !== '取消导出'
          && exportCheck.cancelled.stillCounting === false;
        if (!exportOk) {
          process.stdout.write(`    [FAIL] 导出进度/取消异常：${JSON.stringify(exportCheck)}\n`);
          anyFail = true;
        }

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

    // 只在 publish.html 上跑（订阅弹窗在服务发布数据查询页；多选销毁在 task.js 里是长生命周期、不销毁）
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const fails = [];
      try {
        await page.goto(base + 'publish.html', { waitUntil: 'load', timeout: 15000 });
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

  // ═══════════════════════════════════════════════════════════════
  // 回车不串台（2026-09-16 修复的回归保护）
  // ═══════════════════════════════════════════════════════════════
  // 主页有个 document 级回车监听 =「回车即查询」。弹窗打开时，用户在订阅表单的普通
  // 输入框（TPS、任务编号、评委姓名…）敲回车，原来会顺带触发一次主页全量查询；
  // 而 loading 遮罩 z-index(2000) 高于弹窗(1000)，观感就是「填着表突然整页转圈」。
  // 断言三条：① 无弹窗时回车仍然查询（正面控制 —— 防止把功能一并改死）；
  //           ② 弹窗打开时回车不查询；③ 弹窗内另一个普通输入框同样不查询。
  //
  // 计数手法：window.PublishQuery 是 Object.freeze 的（publish-query.js:421），
  // 加载后赋值替换**静默失效**（踩过一次：正负样本都数到 0，弹窗那两条是假通过）。
  // 所以用 addInitScript 在页面脚本执行前装一个 setter，赋值时把它包成计数版。
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const fails = [];
    try {
      await page.addInitScript(() => {
        window.__enterQueryCalls = 0;
        let real = null;
        Object.defineProperty(window, 'PublishQuery', {
          configurable: true,
          get() { return real; },
          set(v) {
            if (!v || typeof v.doQuery !== 'function') { real = v; return; }
            real = Object.freeze(Object.assign({}, v, {
              doQuery() { window.__enterQueryCalls += 1; },   // 计数桩：不真发请求
            }));
          },
        });
      });
      await page.goto(base + 'publish.html', { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(1000);
      const eg = await page.evaluate(async () => {
        const out = { hasQuery: typeof window.PublishQuery === 'object' && !!window.PublishQuery };
        const pressEnter = () => document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
        );
        const calls = () => window.__enterQueryCalls;

        // ① 正面控制：无弹窗 + 主页普通输入框 → 必须查询
        const main = document.getElementById('f_serviceName');
        main.focus();
        out.mainFocused = document.activeElement === main;
        window.__enterQueryCalls = 0;
        pressEnter();
        out.noDialogCalls = calls();

        // ② 弹窗打开（订阅弹窗）：复刻 SubscribeDialog.open 的做法 —— display:flex + .show
        const overlay = document.getElementById('subscribeOverlay');
        overlay.style.display = 'flex';
        overlay.classList.add('show');
        await new Promise((r) => requestAnimationFrame(r));

        const tps = document.getElementById('sub_tpsPeak');
        tps.focus();
        out.tpsFocused = document.activeElement === tps;
        window.__enterQueryCalls = 0;
        pressEnter();
        out.dialogCalls = calls();

        // ③ 弹窗内另一个普通输入框（任务编号）同样不该查询
        const taskNo = document.getElementById('sub_taskNo');
        taskNo.focus();
        out.taskNoFocused = document.activeElement === taskNo;
        window.__enterQueryCalls = 0;
        pressEnter();
        out.dialogCalls2 = calls();

        overlay.classList.remove('show');
        overlay.style.display = '';
        return out;
      });
      process.stdout.write(`  回车不串台: ${JSON.stringify(eg)}\n`);
      if (!eg.hasQuery) fails.push('window.PublishQuery 缺失，本段断言不可信');
      else {
        if (eg.mainFocused !== true || eg.tpsFocused !== true || eg.taskNoFocused !== true) {
          fails.push(`探针没拿到焦点（main=${eg.mainFocused} tps=${eg.tpsFocused} taskNo=${eg.taskNoFocused}），本段断言不可信`);
        }
        if (eg.noDialogCalls !== 1) {
          fails.push(`正面控制失败：无弹窗时回车应触发 1 次查询，实际 ${eg.noDialogCalls} 次`);
        }
        if (eg.dialogCalls !== 0) fails.push(`弹窗打开时回车触发了 ${eg.dialogCalls} 次主页查询（应为 0）`);
        if (eg.dialogCalls2 !== 0) fails.push(`弹窗内任务编号回车触发了 ${eg.dialogCalls2} 次主页查询（应为 0）`);
      }
    } catch (e) {
      fails.push(`回车串台段异常：${e.message}`);
    }
    fails.forEach((f) => process.stdout.write(`    [FAIL] ${f}\n`));
    if (fails.length) anyFail = true;
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // 订阅表单必填校验 + 字段级聚焦（2026-09-16 修复的回归保护）
  // ═══════════════════════════════════════════════════════════════
  // 校验口径在 subscribe-model.js（已有单测），这里验的是**接线**：
  // 点「确认」→ 该拦的拦住（不发请求）→ 文案对得上 → 焦点真的落到出错字段上。
  // 三条都走真实弹窗（SubscribeDialog.open）+ 真实按钮，不用内部 API 造状态。
  //   (a) 空表单           → 「请选择调用方系统」    + 焦点 = 该下拉的输入框
  //   (b) 填了系统、没选文档 → 「请选择关联文档」     + 焦点 = 该行的「选 择」按钮
  //   (c) 补上文档、TPS 写 'abc' → 「TPS 请填大于 0 的数字」+ 焦点 = TPS 输入框
  //   (d) 修正 TPS          → 「请先填写评委信息」    + 焦点 = 「⤓ 拉取评委」
  //   (e) 填评委、清任务编号 → 「请填写任务编号」      + 焦点 = 任务编号输入框
  //   (f) 填回任务编号、确认  → setSubcription 与 subscriptionReview **一并发出**，
  //                           评委报文带 judgeInfoList，成功后弹窗自动关闭
  // 注：(c) 不填服务编号是故意的 —— 行数据能派生出 E00406TO1197 时应放行，
  //     这条同时守住「派生出得来就别拦」的分支。
  {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    const fails = [];
    try {
      // (f) 两个写接口在浏览器层拦下并回成功响应：验证「一并提交」的发包，不打真实后端
      await page.route('**/setSubcription*', (route) => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ code: 200, msg: '操作成功', data: null }),
      }));
      await page.route('**/subscriptionReview*', (route) => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ code: 200, msg: '操作成功', data: null }),
      }));
      await page.goto(base + 'publish.html', { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(1000);
      const vc = await page.evaluate(async () => {
        const out = {};
        if (!window.SubscribeDialog || typeof window.SubscribeDialog.open !== 'function') {
          return { err: 'window.SubscribeDialog.open 缺失' };
        }
        if (!window.AppServices || typeof window.AppServices.toast !== 'function') {
          return { err: 'AppServices.toast 缺失' };
        }
        // 记录 toast，避免依赖提示元素与队列时序
        const toasts = [];
        const realToast = window.AppServices.toast;
        window.AppServices.toast = (msg, d, t) => { toasts.push({ msg: String(msg), t }); };
        const lastToast = () => (toasts.length ? toasts[toasts.length - 1] : null);
        const clearToasts = () => { toasts.length = 0; };

        // 是否误发**写**请求：这套接口连查询都用 POST，所以只认写端点
        // （setSubcription = 订阅落库，subscriptionReview = 评委信息落库）
        const writes = [];
        const realFetch = window.fetch;
        window.fetch = (url, opts) => {
          const u = String(url);
          if (/setSubcription|subscriptionReview/i.test(u)) {
            writes.push({ url: u, body: opts && typeof opts.body === 'string' ? opts.body : null });
          }
          return realFetch.apply(window, [url, opts]);
        };

        const tick = () => new Promise((r) => setTimeout(r, 120));
        try {
        // 行数据：sysServeNo 带 TO 尾号 → 服务编号可派生（(c) 要用到这个分支）；
        // publishId 必须有 —— 评委随订阅一并提交时，subscriptionReview 报文要带它
        await window.SubscribeDialog.open({
          serverCoding: 'E00301TO1197', sysServeNo: 'E00301TO1197',
          provideComponentName: '冒烟探针组件', taskNo: 'SMOKE-1', publishId: 'P-SMOKE-VC',
        });
          await tick();
          out.opened = document.getElementById('subscribeOverlay').classList.contains('show');

          const confirm = document.getElementById('btnSubConfirm');

          // ── (a) 空表单 ──
          clearToasts();
          confirm.click();
          await tick();
          const t1 = lastToast();
          out.emptyToast = t1 && t1.msg;
          out.emptyFocus = (document.activeElement && (document.activeElement.id
            || document.activeElement.className || document.activeElement.tagName)) || '';

          // ── (b) 填调用方系统（走组件可见输入框 = 用户手输路径），文档仍为空 ──
          const csSel = document.getElementById('sub_callerSystem');
          const csBox = csSel.parentElement.querySelector('.searchable-select-input');
          csBox.value = 'E00406';
          csBox.dispatchEvent(new Event('input', { bubbles: true }));
          clearToasts();
          confirm.click();
          await tick();
          const t2 = lastToast();
          out.docToast = t2 && t2.msg;
          out.docFocusId = document.activeElement ? document.activeElement.id : '';

          // ── (c) 视为已选文档（写隐藏字段），TPS 手输非法值 ──
          document.getElementById('sub_relDocIds').value = 'doc-smoke-1';
          document.getElementById('sub_tpsPeak').value = 'abc';
          clearToasts();
          confirm.click();
          await tick();
          const t3 = lastToast();
          out.tpsToast = t3 && t3.msg;
          out.tpsFocusId = document.activeElement ? document.activeElement.id : '';
          out.writes = writes.length;

          // ── (d) 修正 TPS 后点确认：应被「评委信息必填」拦下。
          //     弹窗预置的两行评委只有角色、没填工号/姓名 → 收集结果为空，
          //     本行也没成功拉取过默认评委 → 不满足豁免条件。
          document.getElementById('sub_tpsPeak').value = '5';
          clearToasts();
          confirm.click();
          await tick();
          const t4 = lastToast();
          out.judgesToast = t4 && t4.msg;
          out.judgesFocusId = document.activeElement ? document.activeElement.id : '';
          out.writesAfterJudges = writes.length;

          // ── (e) 给评委行填上姓名（越过评委关），清空任务编号 → 任务编号必填拦下
          const jname = document.querySelector('#judgeTableBody tr.judge-row .judge-name');
          if (jname) {
            jname.value = '冒烟评委';
            jname.dispatchEvent(new Event('input', { bubbles: true }));
          }
          document.getElementById('sub_taskNo').value = '';
          clearToasts();
          confirm.click();
          await tick();
          const t5 = lastToast();
          out.taskNoToast = t5 && t5.msg;
          out.taskNoFocusId = document.activeElement ? document.activeElement.id : '';

          // ── (f) 填回任务编号并确认：setSubcription 与 subscriptionReview 应一并发出，
          //     评委报文带 judgeInfoList；全部成功后弹窗自动关闭
          document.getElementById('sub_taskNo').value = 'SMOKE-T1';
          clearToasts();
          confirm.click();
          await tick(600);
          out.writesAll = writes.map((w) => {
            let body = null;
            try { body = w.body ? JSON.parse(w.body) : null; } catch (_) { /* ignore */ }
            return {
              ep: (w.url.match(/(setSubcription|subscriptionReview)/i) || [])[1] || w.url,
              body,
            };
          });
          out.dialogClosedAfterSubmit
            = !document.getElementById('subscribeOverlay').classList.contains('show');
        } finally {
          window.AppServices.toast = realToast;
          window.fetch = realFetch;
          if (window.SubscribeDialog) window.SubscribeDialog.close();
        }
        return out;
      });
      process.stdout.write(`  订阅校验接线: ${JSON.stringify(vc)}\n`);
      if (vc.err) fails.push(vc.err);
      else {
        if (vc.opened !== true) fails.push('订阅弹窗没打开，本段断言不可信');
        if (!/请选择调用方系统/.test(String(vc.emptyToast))) {
          fails.push(`空表单应提示「请选择调用方系统」，实际：${vc.emptyToast}`);
        }
        if (vc.emptyFocus !== 'searchable-select-input') {
          fails.push(`空表单的焦点应落到调用方系统的下拉输入框，实际落在 ${vc.emptyFocus}`);
        }
        if (!/请选择关联文档/.test(String(vc.docToast))) {
          fails.push(`没选关联文档应被拦下，实际提示：${vc.docToast}`);
        }
        if (vc.docFocusId !== 'btnSelectDoc') {
          fails.push(`关联文档的焦点应落到「选 择」按钮，实际 ${vc.docFocusId}`);
        }
        if (!/TPS（峰值）请填大于 0 的数字/.test(String(vc.tpsToast))) {
          fails.push(`TPS 填 'abc' 应被拦下，实际提示：${vc.tpsToast}`);
        }
        if (vc.tpsFocusId !== 'sub_tpsPeak') {
          fails.push(`TPS 的焦点应落到 sub_tpsPeak，实际 ${vc.tpsFocusId}`);
        }
        if (vc.writes !== 0) fails.push(`被拦下的提交仍发出了 ${vc.writes} 个写请求`);

        // (d) 评委必填：没填评委且未拉取默认评委 → 拦，且一个写请求都不发
        if (!/评委信息/.test(String(vc.judgesToast))) {
          fails.push(`评委为空应被拦下（提示要提到评委信息），实际：${vc.judgesToast}`);
        }
        if (vc.judgesFocusId !== 'btnFetchJudges') {
          fails.push(`评委缺失时焦点应落到「⤓ 拉取评委」，实际 ${vc.judgesFocusId}`);
        }
        if (vc.writesAfterJudges !== 0) {
          fails.push(`评委缺失被拦时仍发出了 ${vc.writesAfterJudges} 个写请求`);
        }
        // (e) 任务编号必填
        if (!/请填写任务编号/.test(String(vc.taskNoToast))) {
          fails.push(`任务编号为空应被拦下，实际提示：${vc.taskNoToast}`);
        }
        if (vc.taskNoFocusId !== 'sub_taskNo') {
          fails.push(`任务编号的焦点应落到 sub_taskNo，实际 ${vc.taskNoFocusId}`);
        }
        // (f) 订阅与评委一并提交
        const subWrite = (vc.writesAll || []).find((w) => w.ep === 'setSubcription');
        const reviewWrite = (vc.writesAll || []).find((w) => w.ep === 'subscriptionReview');
        if (!subWrite || !reviewWrite) {
          fails.push(`确认订阅应一并发出订阅与评委两个写请求，实际 ${JSON.stringify((vc.writesAll || []).map((w) => w.ep))}`);
        }
        if (subWrite && subWrite.body && subWrite.body.publishSubcription) {
          const pub = subWrite.body.publishSubcription;
          if (pub.serverCoding !== 'E00301TO1197') {
            fails.push(`订阅报文里 serverCoding 应为行上的编码，实际 ${pub.serverCoding}`);
          }
          // 任务编号口径：行数据（taskNo=SMOKE-1）有值就以行为准，弹窗手填的 SMOKE-T1 不顶掉它
          if (pub.serverNo !== 'SMOKE-1' || pub.prodTaskNo !== 'SMOKE-1') {
            fails.push(`行数据有任务编号时应以行为准（serverNo/prodTaskNo=SMOKE-1），实际 ${pub.serverNo}/${pub.prodTaskNo}`);
          }
        }
        if (reviewWrite && reviewWrite.body) {
          const jl = reviewWrite.body.judgeInfoList || [];
          if (!jl.length || jl[0].judgeName !== '冒烟评委') {
            fails.push(`subscriptionReview 的 judgeInfoList 应带上填写的评委，实际 ${JSON.stringify(reviewWrite.body)}`);
          }
          // 抓包口径：每条评委 7 个键，角色名要映射出 judgeRoleId
          const keys = jl.length ? Object.keys(jl[0]).sort().join(',') : '';
          if (keys !== 'involvedProduct,judgeDeptId,judgeDeptName,judgeName,judgeRoleId,judgeRoleName,judgeUserId') {
            fails.push(`judgeInfoList 的字段集应与抓包一致（7 个键），实际 ${keys}`);
          }
          if (jl.length && jl[0].judgeRoleId !== '03') {
            fails.push(`「调用方产品负责人」应映射 judgeRoleId=03，实际 ${jl.length ? jl[0].judgeRoleId : 'MISSING'}`);
          }
          if (!reviewWrite.body.publishId) {
            fails.push('subscriptionReview 报文缺 publishId');
          }
        }
        if (vc.dialogClosedAfterSubmit !== true) {
          fails.push('订阅 + 评委都成功后弹窗应自动关闭');
        }
      }
    } catch (e) {
      fails.push(`订阅校验段异常：${e.message}`);
    }
    fails.forEach((f) => process.stdout.write(`    [FAIL] ${f}\n`));
    if (fails.length) anyFail = true;
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // 评委「按工号 / 按姓名」分流（2026-09-18 修复的回归保护）
  // ═══════════════════════════════════════════════════════════════
  // 抓包口径：两个端点各管一路 —— 按姓名 → getUserList?userName=，按工号 → getUserInfo?userId=。
  // 原实现把工号当 userName 发 getUserList（抓包里没这个形态），查不出来且不报错。
  // 这里用桩 UserApi 记录两个方法各自收到的参数，断言分流真的生效、且选中后能带出姓名/部门。
  {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    const fails = [];
    try {
      await page.goto(base + 'publish.html', { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(1000);
      const jr = await page.evaluate(async () => {
        const out = { list: [], detail: [] };
        if (!window.SubscribeDialog || !window.UserApi) {
          return { err: 'window.SubscribeDialog / window.UserApi 缺失' };
        }
        const origList = window.UserApi.fetchUserList;
        const origDetail = window.UserApi.fetchUserDetail;
        window.UserApi.fetchUserList = async (name) => {
          out.list.push(name);
          return {
            ok: true,
            list: [{
              userId: '4711510', userName: '郑梓辉', orgName: '中国银行软件中心（深圳）',
              teamName: '中国银行软件中心（深圳）开发三部',
            }],
          };
        };
        window.UserApi.fetchUserDetail = async (id) => {
          out.detail.push(id);
          return {
            ok: true,
            user: {
              userId: '8404725', userName: '魏甜甜', orgName: '中国银行软件中心（西安）',
              teamName: '中国银行软件中心（西安）开发一部',
            },
          };
        };
        const tick = (ms = 120) => new Promise((r) => setTimeout(r, ms));
        try {
          await window.SubscribeDialog.open({
            serverCoding: 'E00301TO1197', sysServeNo: 'E00301TO1197', publishId: 'P-JUDGE-SEARCH',
          });
          await tick(150);
          const tr = document.querySelector('#judgeTableBody tr.judge-row');
          const sel = tr && tr.querySelector('.judge-no');
          const box = sel && sel.parentElement.querySelector('.searchable-select-input');
          if (!box) return { err: '评委工号的可搜索输入框没找到' };
          // 选项面板可能被挂到 body（.is-floating 浮动定位）—— 必须按 aria-controls 找，
          // 只在容器内 querySelector 会永远查不到选项（踩过一次）。
          const panel = () => document.getElementById(box.getAttribute('aria-controls') || '');
          const options = () => (panel() ? [...panel().querySelectorAll('.searchable-select-option')] : []);
          const waitOption = async (re) => {
            for (let i = 0; i < 15; i += 1) {
              const hit = options().find((o) => re.test(o.textContent));
              if (hit) return hit;
              await tick(100);
            }
            return null;
          };
          const type = (v) => {
            box.value = v;
            box.dispatchEvent(new Event('input', { bubbles: true }));
          };
          const fill = () => ({
            name: (tr.querySelector('.judge-name') || {}).value || '',
            dept: (tr.querySelector('.judge-dept') || {}).value || '',
          });

          // ① 纯数字 → 工号 → getUserInfo(userId)，且**不得**落到 getUserList
          box.click();
          box.focus();
          type('8404725');
          await tick(700);
          out.afterEmpNo = { detail: out.detail.slice(), list: out.list.slice() };
          const optEmp = await waitOption(/魏甜甜/);
          out.empOptionLabel = optEmp ? optEmp.textContent.trim() : null;
          if (optEmp) { optEmp.click(); await tick(150); }
          out.empFilled = fill();

          // ② 非数字 → 姓名 → getUserList(userName)，且不得再打 getUserInfo
          type('');
          box.focus();
          type('郑梓辉');
          await tick(700);
          out.afterName = { detail: out.detail.slice(), list: out.list.slice() };
          const optName = await waitOption(/郑梓辉/);
          out.nameOptionLabel = optName ? optName.textContent.trim() : null;
          if (optName) { optName.click(); await tick(150); }
          out.nameFilled = fill();

          // ③ 负样本：接口返回的人跟关键字**无关**（真实后端忽略 userName，永远回登录人）。
          // 期望：不展示、不缓存，并提示改填工号 —— 原实现会把无关的人塞进下拉，
          // 用户一点就把评委填成了别人（评委是要提交审批的）。
          window.UserApi.fetchUserList = async () => ({
            ok: true,
            list: [{
              userId: '6464402', userName: '吴树海',
              orgName: '中国银行软件中心（深圳）', teamName: '中国银行软件中心（深圳）开发三部',
            }],
          });
          type('');
          box.focus();
          type('张三');
          await tick(800);
          out.irrelevantOption = options().find((o) => /吴树海/.test(o.textContent));
          out.irrelevantOptionLabel = out.irrelevantOption ? out.irrelevantOption.textContent.trim() : null;
          out.busyText = (panel() && panel().querySelector('.searchable-select-empty'))
            ? panel().querySelector('.searchable-select-empty').textContent.trim()
            : (panel() ? panel().textContent.trim().slice(0, 80) : '');
        } finally {
          window.UserApi.fetchUserList = origList;
          window.UserApi.fetchUserDetail = origDetail;
          if (window.SubscribeDialog) window.SubscribeDialog.close();
        }
        return out;
      });
      process.stdout.write(`  评委搜索分流(工号/姓名): ${JSON.stringify(jr)}\n`);
      if (jr.err) fails.push(jr.err);
      else {
        const ae = jr.afterEmpNo || { detail: [], list: [] };
        if (ae.detail.length !== 1 || ae.detail[0] !== '8404725') {
          fails.push(`按工号应调 getUserInfo(userId=8404725)，实际 detail=${JSON.stringify(ae.detail)}`);
        }
        if (ae.list.length !== 0) {
          fails.push(`按工号不得再调 getUserList，实际 list=${JSON.stringify(ae.list)}`);
        }
        if (!/魏甜甜/.test(String(jr.empOptionLabel))) {
          fails.push(`工号命中后下拉应出现「魏甜甜（8404725）」，实际 ${jr.empOptionLabel}`);
        }
        if (!jr.empFilled || jr.empFilled.name !== '魏甜甜' || !/开发一部/.test(String(jr.empFilled.dept))) {
          fails.push(`选中工号命中项后应带出姓名/部门，实际 ${JSON.stringify(jr.empFilled)}`);
        }
        const an = jr.afterName || { detail: [], list: [] };
        if (an.list.length !== 1 || an.list[0] !== '郑梓辉') {
          fails.push(`按姓名应调 getUserList(userName=郑梓辉)，实际 list=${JSON.stringify(an.list)}`);
        }
        if (an.detail.length !== ae.detail.length) {
          fails.push(`按姓名不得再调 getUserInfo，实际 detail=${JSON.stringify(an.detail)}`);
        }
        if (!jr.nameFilled || jr.nameFilled.name !== '郑梓辉') {
          fails.push(`选中姓名命中项后应带出姓名，实际 ${JSON.stringify(jr.nameFilled)}`);
        }
        // ③ 无关结果必须被挡住
        if (jr.irrelevantOption) {
          fails.push(`后端返回无关的人时不该出现在下拉里，实际 ${jr.irrelevantOptionLabel}`);
        }
        // 文案口径（2026-09-20 改）：不再断言「接口不按姓名过滤」—— 那是把离线回放的宽松匹配
        // 当成了后端行为（接到手里的报文里按姓名是能过滤的）。要守的是「无关结果不许进下拉 +
        // 得有一句话说清该怎么办」，措辞本身不是契约。
        if (!/没有名字含这个关键词的人/.test(String(jr.busyText || ''))) {
          fails.push(`无关结果时应提示「没有名字含这个关键词的人」，实际 ${JSON.stringify(String(jr.busyText || '').slice(0, 60))}`);
        }
      }
    } catch (e) {
      fails.push(`评委搜索分流段异常：${e.message}`);
    }
    fails.forEach((f) => process.stdout.write(`    [FAIL] ${f}\n`));
    if (fails.length) anyFail = true;
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // 订阅报文预演台（DRY RUN）自检
  // ═══════════════════════════════════════════════════════════════
  // 预演台的唯一价值是「可信」：它必须走真实组包函数，同时**一个真实请求都不能发**。
  // 这里从浏览器层盯住：① 场景矩阵全绿；② 预演确实捕获到两个报文；
  // ③ 页面没有发出任何指向 setSubcription / subscriptionReview 的真实请求。
  {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    const fails = [];
    const leaked = [];
    try {
      page.on('request', (r) => {
        if (/setSubcription|subscriptionReview/i.test(r.url())) leaked.push(r.url());
      });
      await page.goto(base + 'publish.html', { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(900);
      const dr = await page.evaluate(async () => {
        if (!window.SubscribeDryRun) return { err: 'window.SubscribeDryRun 缺失' };
        const sc = await window.SubscribeDryRun.scenarios({ quiet: true });
        // 弹窗没打开 → 用内置示例跑一次，保证「离线也能看报文」这条路可用
        const one = await window.SubscribeDryRun.run({ quiet: true });
        return {
          total: sc.total,
          failed: sc.failed,
          bad: sc.items.filter((i) => !i.pass).map((i) => i.name),
          requests: one.requests.map((r) => r.name),
          fetchCalls: one.fetchCalls,
          restored: one.restored,
          apiCallIsFunction: typeof window.API.call === 'function',
          validateOk: one.validate.ok,
        };
      });
      process.stdout.write(`  订阅预演台自检: ${JSON.stringify(dr)} 真实请求泄漏: ${leaked.length}\n`);
      if (dr.err) fails.push(dr.err);
      else {
        if (dr.failed !== 0) {
          fails.push(`预演台场景矩阵有 ${dr.failed} 项不符合预期：${JSON.stringify(dr.bad)}`);
        }
        if (dr.requests.join(',') !== 'setSubcription,subscriptionReview') {
          fails.push(`预演应捕获「订阅 + 评委」两个报文，实际 ${JSON.stringify(dr.requests)}`);
        }
        if (dr.fetchCalls !== 0) fails.push(`预演穿透到了 fetch 层（${dr.fetchCalls} 次）`);
        if (dr.restored !== true || dr.apiCallIsFunction !== true) {
          fails.push('预演结束后没有把 window.API.call 还原');
        }
        if (dr.validateOk !== true) fails.push('内置示例应能通过必填校验（示例数据不完整）');
      }
      if (leaked.length) {
        fails.push(`预演台发出了真实请求（应被 API/fetch 双层拦截）：${leaked.join(' | ')}`);
      }
    } catch (e) {
      fails.push(`订阅预演台自检段异常：${e.message}`);
    }
    fails.forEach((f) => process.stdout.write(`    [FAIL] ${f}\n`));
    if (fails.length) anyFail = true;
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // 点击驱动的订阅预演（?dryrun=1 → 点「确 认」不写入）
  // ═══════════════════════════════════════════════════════════════
  // 用户的实际用法：打开页面（带 ?dryrun=1）→ 点订阅 → 弹窗填表 → **点「确 认」**，
  // 请求被拦下并打印。这里从浏览器层验证整条点击链路，并确认没有真实写入泄漏。
  {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    const fails = [];
    const leaked = [];
    const logs = [];
    try {
      page.on('request', (r) => {
        if (/setSubcription|subscriptionReview/i.test(r.url())) leaked.push(r.url());
      });
      page.on('console', (m) => { logs.push(m.text()); });
      await page.goto(base + 'publish.html?dryrun=1', { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(900);
      const dc = await page.evaluate(async () => {
        const out = { enabled: window.SubscribeDryRun.isEnabled() };
        const badge = () => document.getElementById('dryrunBadge');
        out.badgeAtStart = badge() ? badge().textContent : null;
        out.subscribedBefore = window.SubscribeManager.getAll();

        await window.SubscribeDialog.open({
          id: 'PUB-SMOKE-CLICK', publishId: 'PUB-SMOKE-CLICK', serverCoding: 'E00301TO1197',
          sysServeNo: 'E00301TO1197', provideComponentName: '冒烟组件', provideSystemNumber: 'E00301',
          assemblyNo: 'E00301', prodBatch: '2611批次', serverNo: 'M-202607-11289',
        });
        await new Promise((r) => setTimeout(r, 250));
        const csBox = document.querySelector('#sub_callerSystem').parentElement.querySelector('.searchable-select-input');
        csBox.value = 'E00406';
        csBox.dispatchEvent(new Event('input', { bubbles: true }));
        // 故意**不选关联文档**：离线/内网拿不到文档列表时用户无从选择，
        // 预演模式必须放行，否则整条链路试不动（用户实际反馈的点）
        document.getElementById('sub_tpsPeak').value = '5';
        document.getElementById('sub_taskNo').value = 'T-SMOKE-1';
        const tr = document.querySelector('#judgeTableBody tr.judge-row');
        tr.querySelector('.judge-name').value = '冒烟评委';
        tr._judgeDeptId = 'K4229';
        await new Promise((r) => setTimeout(r, 120));

        document.getElementById('btnSubConfirm').click();     // ← 真实点击，不是调函数
        await new Promise((r) => setTimeout(r, 900));
        out.dialogClosed = !document.getElementById('subscribeOverlay').classList.contains('show');
        out.subscribedAfterClick = window.SubscribeManager.getAll();
        out.badgeAfterClick = badge() ? badge().textContent : null;

        const off = window.SubscribeDryRun.disable();
        out.offCount = off.count;
        out.offReverted = off.reverted;
        out.badgeGone = !badge();
        out.apiRestored = typeof window.API.call === 'function';
        out.subscribedAfterOff = window.SubscribeManager.getAll();
        return out;
      });
      const joined = logs.join('\n');
      process.stdout.write(`  点击驱动预演: ${JSON.stringify(dc)} 真实写请求泄漏: ${leaked.length}\n`);
      if (dc.enabled !== true) fails.push('?dryrun=1 应自动开启预演模式');
      if (!/已拦 0 条写请求/.test(String(dc.badgeAtStart))) {
        fails.push(`开启后应出现右下角浮标，实际 ${dc.badgeAtStart}`);
      }
      if (!/第 1 个写请求已拦截/.test(joined) || !/第 2 个写请求已拦截/.test(joined)) {
        fails.push('点「确 认」应打印两个被拦截的写请求（订阅 + 评委）');
      }
      if (!/subscriptionReview/.test(joined)) fails.push('评委报文也应被拦截并打印');
      if (!/本次点击共拦截 2 个写请求/.test(joined)) fails.push('缺少「本次点击」小计');
      // 未选关联文档：预演下必须照常走下去，报文里 documents 为空数组并明确标注
      if (!/预演模式：本次未选关联文档（必填已跳过）/.test(joined)) {
        fails.push('未选关联文档时未按预演模式放行（应打印「预演模式：本次未选关联文档（必填已跳过）」）');
      }
      if (!/"documents": \[\]/.test(joined)) {
        fails.push('未选关联文档时预演报文里 documents 应为空数组');
      }
      if (!/已拦 2 条写请求/.test(String(dc.badgeAfterClick))) {
        fails.push(`浮标计数应更新为 2，实际 ${dc.badgeAfterClick}`);
      }
      if (dc.dialogClosed !== true) fails.push('预演下订阅应像真成功一样关闭弹窗');
      if (!Array.isArray(dc.subscribedAfterClick) || !dc.subscribedAfterClick.includes('E00301TO1197')) {
        fails.push(`预演成功应在本地标记已订阅，实际 ${JSON.stringify(dc.subscribedAfterClick)}`);
      }
      if (dc.offCount !== 2) fails.push(`disable 应报告拦截数为 2，实际 ${dc.offCount}`);
      if (!Array.isArray(dc.offReverted) || !dc.offReverted.includes('E00301TO1197')) {
        fails.push(`disable 应撤销预演产生的本地标记，实际 ${JSON.stringify(dc.offReverted)}`);
      }
      if (dc.subscribedAfterOff.includes('E00301TO1197')) fails.push('撤销后本地清单不应还留着预演标记');
      if (dc.badgeGone !== true) fails.push('关闭后浮标应移除');
      if (dc.apiRestored !== true) fails.push('关闭后 API.call 必须可用');
      if (leaked.length) fails.push(`预演模式漏出了真实写请求：${leaked.join(' | ')}`);
    } catch (e) {
      fails.push(`点击驱动预演段异常：${e.message}`);
    }
    fails.forEach((f) => process.stdout.write(`    [FAIL] ${f}\n`));
    if (fails.length) anyFail = true;
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // 分页栏：居中 + 页码命中区 / 选中态（2026-09-16 调整的回归保护）
  // ═══════════════════════════════════════════════════════════════
  // 页码的坑是「点错相邻页」：原来按钮 32×32、间距 4px、当前页只靠底色区分，
  // 连号数字挤在一起时很容易点到隔壁。这里把几何尺寸和状态差异都钉成断言。
  // 走真实渲染器（SubscriptionView.renderPagination）而不是手搓 DOM，
  // 保证页码结构与类名跟线上一致。
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const fails = [];
    try {
      await page.goto(base + 'subscription.html', { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(800);
      const pg = await page.evaluate(() => {
        if (!window.SubscriptionView || typeof window.SubscriptionView.renderPagination !== 'function') {
          return { err: 'window.SubscriptionView.renderPagination 缺失' };
        }
        const els = {
          bar: document.getElementById('pagination'),
          pageTotal: document.getElementById('pageTotal'),
          pageNumbers: document.getElementById('pageNumbers'),
          btnPrev: document.getElementById('btnPrev'),
          btnNext: document.getElementById('btnNext'),
          pageJumpInput: document.getElementById('pageJumpInput'),
        };
        const gotos = [];
        window.SubscriptionView.renderPagination(els, {
          pageNum: 5, total: 480, pages: 20, queried: true, onGoto: (n) => { gotos.push(n); },
        });

        const btns = [...els.pageNumbers.querySelectorAll('button[data-page]')];
        const rect = (el) => el.getBoundingClientRect();
        const cs = (el) => getComputedStyle(el);
        const cur = els.pageNumbers.querySelector('button.is-current');
        const nb = btns.find((b) => b !== cur
          && Math.abs(Number(b.dataset.page) - Number(cur.dataset.page)) === 1);

        // 相邻页码之间的最小缝隙：只比对页码相差 1 的两对按钮
        // （差 2 及以上中间夹着省略号，量出来的是省略号宽度，没有意义）
        let minGap = Infinity;
        for (let i = 0; i < btns.length - 1; i += 1) {
          const a = Number(btns[i].dataset.page);
          const b = Number(btns[i + 1].dataset.page);
          if (b - a === 1) minGap = Math.min(minGap, rect(btns[i + 1]).left - rect(btns[i]).right);
        }

        // 点一下相邻页码：按钮放大后必须仍然可点、且回传正确页码
        let clickErr = '';
        try { nb.click(); } catch (e) { clickErr = String(e && e.message); }

        return {
          barJustify: cs(els.bar).justifyContent,
          barDisplay: cs(els.bar).display,
          btnCount: btns.length,
          minW: Math.min(...btns.map((b) => rect(b).width)),
          minH: Math.min(...btns.map((b) => rect(b).height)),
          gapPx: Number.isFinite(minGap) ? Math.round(minGap * 100) / 100 : -1,
          currentCount: els.pageNumbers.querySelectorAll('button.is-current').length,
          currentPage: cur && cur.dataset.page,
          curBg: cs(cur).backgroundColor,
          curWeight: Number(cs(cur).fontWeight) || 0,
          curColor: cs(cur).color,
          nbPage: nb && nb.dataset.page,
          nbBg: cs(nb).backgroundColor,
          nbWeight: Number(cs(nb).fontWeight) || 0,
          nbColor: cs(nb).color,
          prevH: rect(els.btnPrev).height,
          gotos,
          clickErr,
        };
      });
      process.stdout.write(`  分页栏几何/状态: ${JSON.stringify(pg)}\n`);
      if (pg.err) fails.push(pg.err);
      else {
        if (pg.barJustify !== 'center') fails.push(`分页栏应居中，实际 justify-content=${pg.barJustify}`);
        if (pg.barDisplay !== 'flex') fails.push(`分页栏应可见（display:flex），实际 ${pg.barDisplay}`);
        if (pg.minW < 40 || pg.minH < 40) {
          fails.push(`页码命中区应 ≥40×40，实际最小 ${pg.minW}×${pg.minH}`);
        }
        if (pg.gapPx < 6) fails.push(`相邻页码间距应 ≥6px，实际 ${pg.gapPx}px`);
        if (pg.prevH < 36) fails.push(`上一页/下一页按钮高度应 ≥36px，实际 ${pg.prevH}`);
        if (pg.currentCount !== 1) fails.push(`应只有一个 .is-current，实际 ${pg.currentCount} 个`);
        if (pg.currentPage !== '5') fails.push(`当前页应标在 5，实际 ${pg.currentPage}`);
        if (pg.curBg === pg.nbBg) fails.push(`当前页底色应与相邻页不同（都是 ${pg.curBg}）`);
        if (!(pg.curWeight > pg.nbWeight)) {
          fails.push(`当前页应比相邻页更重（bold），实际 cur=${pg.curWeight} nb=${pg.nbWeight}`);
        }
        if (pg.curColor === pg.nbColor) fails.push(`当前页文字色应与相邻页不同（都是 ${pg.curColor}）`);
        if (pg.clickErr) fails.push(`点击相邻页码报错：${pg.clickErr}`);
        if (pg.gotos.join(',') !== String(pg.nbPage)) {
          fails.push(`点相邻页码应回传 ${pg.nbPage}，实际回传 [${pg.gotos.join(',')}]`);
        }
      }
    } catch (e) {
      fails.push(`分页栏段异常：${e.message}`);
    }
    fails.forEach((f) => process.stdout.write(`    [FAIL] ${f}\n`));
    if (fails.length) anyFail = true;
    await page.close();
  }

  // 首页的分页栏共用同一套 CSS，这里只确认它也被居中（该页是「上一页/第 X / Y 页/下一页」结构）
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const fails = [];
    try {
      await page.goto(base + 'publish.html', { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(600);
      const r = await page.evaluate(() => {
        const bar = document.getElementById('pagination');
        if (!bar) return { justify: 'NO-BAR' };
        // 该页分页条默认 display:none（还没查询过），先显示出来才量得到真实几何
        bar.style.display = '';
        const prev = bar.querySelector('#btnPrev');
        return {
          justify: getComputedStyle(bar).justifyContent,
          prevH: prev ? prev.getBoundingClientRect().height : -1,
        };
      });
      process.stdout.write(`  发布页分页栏: ${JSON.stringify(r)}\n`);
      if (r.justify !== 'center') fails.push(`发布页分页栏应居中，实际 ${r.justify}`);
      if (!(r.prevH >= 36)) fails.push(`发布页上一页按钮高度应 ≥36px，实际 ${r.prevH}`);
    } catch (e) {
      fails.push(`发布页分页栏段异常：${e.message}`);
    }
    fails.forEach((f) => process.stdout.write(`    [FAIL] ${f}\n`));
    if (fails.length) anyFail = true;
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // 对齐与命中区（2026-09-16 第二批优化）
  // ═══════════════════════════════════════════════════════════════
  // 覆盖：表头跟着内容居中、操作列按钮命中区、下拉 ✕/▼ 与弹窗 ✕、折叠 chevron。
  // 伪元素扩出来的命中区不能只用 getBoundingClientRect（那还是原尺寸），
  // 所以这里用 elementFromPoint 从元素中心向外 14px 打点，命中的必须是该元素本身。
  {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const fails = [];
    try {
      await page.goto(base + 'publish.html', { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(900);
      const r = await page.evaluate(() => {
        const cs = (el, pseudo) => getComputedStyle(el, pseudo);
        const box = (el) => {
          const b = el.getBoundingClientRect();
          return { w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 };
        };
        /** 从元素中心向外 d 像素打点，四个方向都必须命中该元素（含其伪元素） */
        const probeHit = (el, d) => {
          if (!el) return 'MISSING';
          el.scrollIntoView({ block: 'center' });
          const b = el.getBoundingClientRect();
          const cx = b.left + b.width / 2;
          const cy = b.top + b.height / 2;
          const owns = (x, y) => {
            const hit = document.elementFromPoint(x, y);
            return !!hit && (hit === el || el.contains(hit));
          };
          return {
            left: owns(cx - d, cy), right: owns(cx + d, cy),
            up: owns(cx, cy - d), down: owns(cx, cy + d),
          };
        };
        const out = {};

        // ── 表头跟着内容居中 ──
        out.thCentered = {};
        ['col-status', 'col-check', 'col-sub', 'col-op'].forEach((cls) => {
          const th = document.querySelector(`.result-table thead th.${cls}`);
          out.thCentered[cls] = th ? cs(th).textAlign : 'MISSING';
        });
        const thName = document.querySelector('.result-table thead th.col-name');
        out.thNameAlign = thName ? cs(thName).textAlign : 'MISSING';

        // ── 操作列「详情 / 订阅」命中区与间距 ──
        const probe = document.createElement('div');
        probe.className = 'result-table';
        probe.innerHTML = '<div class="col-op"><div class="action-row">'
          + '<button class="text-btn btn-xs" type="button">详情</button>'
          + '<button class="text-btn btn-xs" type="button">订阅</button></div></div>';
        document.body.appendChild(probe);
        const pb = probe.querySelectorAll('.text-btn');
        out.opBtn = box(pb[0]);
        out.opGap = Math.round((pb[1].getBoundingClientRect().left - pb[0].getBoundingClientRect().right) * 10) / 10;
        probe.remove();

        // ── 下拉箭头：伪元素扩命中区（CSS 契约 + 行为打点）──
        const arrow = document.querySelector('.searchable-select-arrow');
        out.arrowBox = arrow ? box(arrow) : 'MISSING';
        out.arrowBefore = arrow ? cs(arrow, '::before').content : 'MISSING';
        out.arrowHit = probeHit(arrow, 14);

        // ── 折叠 chevron：外观 24px，命中区 32px ──
        const chev = document.querySelector('.chevron');
        out.chevron = chev ? box(chev) : 'MISSING';
        out.chevronHit = probeHit(chev, 14);

        // ── 弹窗 ✕：32×32（弹窗未打开，只量尺寸）──
        const closeBtn = document.querySelector('.sub-close');
        out.subClose = closeBtn ? box(closeBtn) : 'MISSING';
        return out;
      });
      process.stdout.write(`  对齐与命中区: ${JSON.stringify(r)}\n`);
      const centered = r.thCentered || {};
      ['col-status', 'col-check', 'col-sub', 'col-op'].forEach((cls) => {
        if (centered[cls] !== 'center') fails.push(`表头 .${cls} 应居中，实际 ${centered[cls]}`);
      });
      if (r.thNameAlign !== 'left') fails.push(`非居中列表头 .col-name 应保持左对齐，实际 ${r.thNameAlign}`);
      if (!(r.opBtn && r.opBtn.h >= 32)) fails.push(`操作列按钮高度应 ≥32，实际 ${r.opBtn && r.opBtn.h}`);
      if (r.opGap < 8) fails.push(`操作列按钮间距应 ≥8px，实际 ${r.opGap}`);
      if (r.arrowBefore !== '""') fails.push(`下拉箭头应有 ::before 扩命中区，实际 content=${r.arrowBefore}`);
      const ah = r.arrowHit || {};
      if (!ah.left || !ah.right || !ah.up || !ah.down) {
        fails.push(`下拉箭头命中区应覆盖中心 ±14px，实际 ${JSON.stringify(ah)}（外观 ${JSON.stringify(r.arrowBox)}）`);
      }
      const ch = r.chevronHit || {};
      if (!ch.left || !ch.down) fails.push(`折叠 chevron 命中区应覆盖中心 ±14px，实际 ${JSON.stringify(ch)}`);
      if (!(r.chevron && r.chevron.w <= 25)) fails.push(`chevron 外观应保持约 24px，实际 ${JSON.stringify(r.chevron)}`);
      if (!(r.subClose && r.subClose.w >= 32 && r.subClose.h >= 32)) {
        fails.push(`弹窗 ✕ 命中区应 ≥32×32，实际 ${JSON.stringify(r.subClose)}`);
      }
    } catch (e) {
      fails.push(`对齐与命中区段异常：${e.message}`);
    }
    fails.forEach((f) => process.stdout.write(`    [FAIL] ${f}\n`));
    if (fails.length) anyFail = true;
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // 评委随订阅一并提交：部分失败的补交路径。
  //   订阅成功、评委提交失败 → 弹窗**不关**（关了就没有补交入口，已订阅的行
  //   不会再出现「订阅」按钮）；再点「确 认」只补发 subscriptionReview，
  //   绝不重复发 setSubcription —— 否则要么丢评委，要么同一条订阅写两遍。
  // ═══════════════════════════════════════════════════════════════
  {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    const fails = [];
    let subCalls = 0;
    let reviewCalls = 0;
    let reviewShouldFail = true;
    try {
      await page.route('**/setSubcription*', (route) => {
        subCalls += 1;
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ code: 200, msg: '操作成功' }),
        });
      });
      await page.route('**/subscriptionReview*', (route) => {
        reviewCalls += 1;
        const body = reviewShouldFail
          ? JSON.stringify({ code: 500, msg: '评审服务暂时不可用' })
          : JSON.stringify({ code: 200, msg: '操作成功' });
        return route.fulfill({ status: 200, contentType: 'application/json', body });
      });
      await page.goto(base + 'publish.html', { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(1000);

      // 第 1 次确认：订阅成功、评委提交失败 → 弹窗保持打开 + 明确提示
      const first = await page.evaluate(async () => {
        const tick = (ms) => new Promise((r2) => setTimeout(r2, ms));
        const toasts = [];
        const realToast = window.AppServices.toast;
        window.AppServices.toast = (msg) => { toasts.push(String(msg)); };
        try {
          await window.SubscribeDialog.open({
            serverCoding: 'E00301TO1197', sysServeNo: 'E00301TO1197',
            provideComponentName: '补交评委探针', taskNo: 'SMOKE-R', publishId: 'P-SMOKE-R',
          });
          await tick(200);
          const csBox = document.getElementById('sub_callerSystem')
            .parentElement.querySelector('.searchable-select-input');
          csBox.value = 'E00406';
          csBox.dispatchEvent(new Event('input', { bubbles: true }));
          document.getElementById('sub_relDocIds').value = 'doc-smoke-r';
          document.getElementById('sub_tpsPeak').value = '5';
          const jname = document.querySelector('#judgeTableBody tr.judge-row .judge-name');
          jname.value = '补交评委';
          document.getElementById('btnSubConfirm').click();
          await tick(500);
          return {
            stillOpen: document.getElementById('subscribeOverlay').classList.contains('show'),
            partialToast: toasts.find((t) => /评委信息提交失败/.test(t)) || null,
          };
        } finally {
          window.AppServices.toast = realToast;
        }
      });
      process.stdout.write(`  部分失败(评委补交): 第1次 ${JSON.stringify(first)}\n`);
      if (first.stillOpen !== true) fails.push('订阅成功但评委失败时弹窗应保持打开（否则没有补交入口）');
      if (!first.partialToast) fails.push('评委提交失败应给出明确提示（含「评委信息提交失败」）');

      // 评审接口恢复 → 第 2 次确认：只补交评委，setSubcription 不得再发
      reviewShouldFail = false;
      const retry = await page.evaluate(async () => {
        const tick = (ms) => new Promise((r2) => setTimeout(r2, ms));
        document.getElementById('btnSubConfirm').click();
        await tick(500);
        return {
          closedAfterRetry: !document.getElementById('subscribeOverlay').classList.contains('show'),
        };
      });
      process.stdout.write(`  部分失败(评委补交): 第2次 ${JSON.stringify(retry)} sub=${subCalls} review=${reviewCalls}\n`);
      if (subCalls !== 1) fails.push(`补交评委时 setSubcription 被重复发送了 ${subCalls - 1} 次（应只发 1 次）`);
      if (reviewCalls !== 2) fails.push(`subscriptionReview 应发 2 次（首次失败 + 补交成功），实际 ${reviewCalls}`);
      if (retry.closedAfterRetry !== true) fails.push('补交评委成功后弹窗应自动关闭');
    } catch (e) {
      fails.push(`评委补交段异常：${e.message}`);
    }
    fails.forEach((f) => process.stdout.write(`    [FAIL] ${f}\n`));
    if (fails.length) anyFail = true;
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // 空态提示 / 防重复提交（2026-09-16 第二批优化）
  // ═══════════════════════════════════════════════════════════════
  // ① 评委空态提示：文案不带乱码，且加了评委后要隐藏（原来 JS 零引用、永不隐藏）
  // ② 提交评委：连点只能发一次请求（原来没有 in-flight 锁，会重复写审核数据）
  // ③ 文档弹窗分页栏：每页条数下拉必须被约束成 108px（原来被撑到 804px）
  // ④ 弹窗内的可访问名称：主循环那条 a11yCheck 跑在弹窗打开之前，评委行还不存在；
  //    这里弹窗已开、行刚由「＋ 新增」建出来，是覆盖评委行取名口径的窗口
  {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const fails = [];
    let reviewCalls = 0;
    try {
      // 延迟评委提交接口的响应，用来观察「连点是不是只发一次」
      await page.route('**/subscriptionReview*', async (route) => {
        reviewCalls += 1;
        await new Promise((r2) => setTimeout(r2, 900));
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0, msg: 'ok' }) });
      });
      await page.goto(base + 'publish.html', { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(900);
      const r = await page.evaluate(async () => {
        const out = {};
        const tick = (ms) => new Promise((r2) => setTimeout(r2, ms));
        const box = (el) => {
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 };
        };
        await window.SubscribeDialog.open({
          serverCoding: 'E00301TO1197', sysServeNo: 'E00301TO1197',
          publishId: 'P-SMOKE-1', provideComponentName: '冒烟探针', taskNo: 'SMOKE-2',
        });
        await tick(400);

        // ① 评委空态提示：双向验证 —— 有评委行时隐藏、全部删掉后重新出现
        //    （弹窗打开时会预置 2 行「调用方/服务方产品负责人」，所以初始就是有行的状态）
        const hint = document.getElementById('judgeEmptyHint');
        const rowCount = () => document.querySelectorAll('#judgeTableBody tr.judge-row').length;
        out.hintText = hint ? hint.textContent : 'MISSING';
        out.rowsOnOpen = rowCount();
        out.hintHiddenWithRows = hint ? hint.hidden : 'MISSING';
        // 全选 → 删除，把行清空
        const checkAll = document.getElementById('judgeCheckAll');
        checkAll.checked = true;
        checkAll.dispatchEvent(new Event('change', { bubbles: true }));
        document.getElementById('btnRemoveJudge').click();
        await tick(60);
        out.rowsAfterDeleteAll = rowCount();
        out.hintHiddenWhenEmpty = hint ? hint.hidden : 'MISSING';
        // 再加回来
        document.getElementById('btnAddJudge').click();
        await tick(60);
        out.hintHiddenAfterAdd = hint ? hint.hidden : 'MISSING';
        // 给新增的行填个名字，否则提交校验会以「请先添加评委信息」拦下，测不到锁
        const nameInput = document.querySelector('#judgeTableBody tr.judge-row .judge-name');
        if (nameInput) { nameInput.value = '冒烟探针'; nameInput.dispatchEvent(new Event('input', { bubbles: true })); }

        // ── 弹窗内的「可访问名称」统计：挂在弹窗已打开、评委行已存在之后 ──
        // 主循环里那条 a11yCheck 跑在页面刚加载完、弹窗还没打开的时候，评委行根本不存在，
        // 覆盖不到这条路径。而评委行在 <td> 里、字段名只写在表头 <th> 上，**弹窗内没有
        // 任何可见 label 元素可取** —— 「评委角色」「评委工号」两个下拉的名字完全依赖
        // subscribe-dialog.js 显式传的 { label: ... }，姓名/部门靠 subscribe-model.js 的
        // JUDGE_ROW_TEMPLATE。这两处被删掉时页面照常工作、只有读屏念不出字段名，
        // 所以下面把四个名字写死断言（口径同表头文案）。
        // 注：.overlay 缺 .show 时是 opacity:0 + pointer-events:none，只判 display:flex
        //     会把「没真打开」误判成打开（本仓库踩过），所以这里按 classList 判断是否 .show。
        out.dialogA11y = (() => {
          const overlay = document.getElementById('subscribeOverlay');
          const dialog = document.getElementById('subscribeDialog');
          const nameOf = (el) => (el ? (el.getAttribute('aria-label') || '').trim() : '__MISSING__');
          const boxes = Array.from(dialog.querySelectorAll(
            '.searchable-select-input, .msel-display, .judge-name, .judge-dept'));
          // 无名控件要给「认得出是哪个」的标识：宿主 select 的 id/class，退化到自身类名 + 列号
          const who = (el) => {
            const wrap = el.closest('.searchable-select');
            const host = (wrap && wrap.previousElementSibling)
              || (el.parentElement && el.parentElement.querySelector('select'));
            if (host && (host.id || host.className)) return host.id || String(host.className).trim();
            const td = el.closest('td');
            const col = td && td.parentElement
              ? Array.prototype.indexOf.call(td.parentElement.children, td) : -1;
            return String(el.className).split(/\s+/)[0] + (col >= 0 ? `@第${col + 1}列` : '');
          };
          const tr = dialog.querySelector('#judgeTableBody tr.judge-row');
          const boxNameOf = (hostSel) => {
            const host = tr && tr.querySelector(hostSel);
            const ctl = host && host.parentElement.querySelector('.searchable-select-input');
            return nameOf(ctl);
          };
          const inputNameOf = (sel) => {
            const el = tr && tr.querySelector(sel);
            return el ? nameOf(el) : '__NO_JUDGE_ROW__';
          };
          return {
            shown: overlay ? overlay.classList.contains('show') : false,
            rows: dialog.querySelectorAll('#judgeTableBody tr.judge-row').length,
            total: boxes.length,
            nameless: boxes.filter((el) => !nameOf(el)).map(who),
            judge: {
              role: boxNameOf('.judge-role'),
              no: boxNameOf('.judge-no'),
              name: inputNameOf('.judge-name'),
              dept: inputNameOf('.judge-dept'),
            },
          };
        })();

        // ② 连点提交
        const btn = document.getElementById('btnSubmitJudges');
        btn.click();
        btn.click();
        await tick(120);
        out.submitLabel = btn.textContent;
        out.submitDisabled = btn.disabled;
        await tick(1100);
        out.submitLabelAfter = btn.textContent;
        out.submitDisabledAfter = btn.disabled;

        // ③ 文档子弹窗分页栏
        document.getElementById('btnSelectDoc').click();
        await tick(700);
        const docSel = document.getElementById('docPageSize');
        const wrap = docSel ? docSel.nextElementSibling : null;
        out.docPageSizeWrap = wrap ? box(wrap) : 'MISSING';
        out.docPageSizeInput = wrap ? box(wrap.querySelector('.searchable-select-input')) : 'MISSING';
        out.docPagerPrev = box(document.getElementById('btnDocPrev'));
        window.DocPicker.close();
        window.SubscribeDialog.close();
        return out;
      });
      const dlgA11y = r.dialogA11y;
      delete r.dialogA11y;   // 单独成行打印，别混进上面那串 JSON
      process.stdout.write(`  空态/防重复提交/文档分页: ${JSON.stringify({ ...r, reviewCalls })}\n`);
      process.stdout.write(`  订阅弹窗可访问名称: ${JSON.stringify(dlgA11y)}\n`);
      if (/chu/.test(String(r.hintText))) fails.push(`评委空态提示仍含乱码：${r.hintText}`);
      if (!(r.rowsOnOpen > 0)) fails.push(`弹窗打开时应有预置评委行，实际 ${r.rowsOnOpen} 行`);
      if (r.hintHiddenWithRows !== true) fails.push('有评委行时空态提示应隐藏');
      if (r.rowsAfterDeleteAll !== 0) fails.push(`全选删除后应 0 行，实际 ${r.rowsAfterDeleteAll} 行`);
      if (r.hintHiddenWhenEmpty !== false) fails.push('评委行清空后空态提示应重新出现');
      if (r.hintHiddenAfterAdd !== true) fails.push('再加回一条评委后空态提示应再次隐藏');
      if (r.submitDisabled !== true || r.submitLabel !== '提交中…') {
        fails.push(`提交期间按钮应禁用并显示「提交中…」，实际 disabled=${r.submitDisabled} label=${r.submitLabel}`);
      }
      if (r.submitDisabledAfter !== false) fails.push('提交结束后按钮应恢复可用');
      if (reviewCalls !== 1) fails.push(`连点两次只应发 1 个评委提交请求，实际 ${reviewCalls} 个`);
      if (!(r.docPageSizeWrap && r.docPageSizeWrap.w <= 130)) {
        fails.push(`文档弹窗「每页条数」应被约束到约 108px，实际 ${JSON.stringify(r.docPageSizeWrap)}`);
      }
      if (!(r.docPageSizeInput && r.docPageSizeInput.h === 30)) {
        fails.push(`文档弹窗「每页条数」应与同行控件同高 30px，实际 ${JSON.stringify(r.docPageSizeInput)}`);
      }

      // ④ 弹窗内的可访问名称（读屏念得出字段名）：评委行那两个下拉没有 label 可取，
      //    名字只来自 subscribe-dialog.js 显式传的 opts.label —— 这条就是钉住它。
      if (!dlgA11y) fails.push('订阅弹窗可访问名称没测到（探针没跑到），本段等于没断言');
      else {
        if (dlgA11y.shown !== true) {
          fails.push('订阅弹窗没真的打开（#subscribeOverlay 缺 .show），可访问名称断言不可信');
        }
        if (!(dlgA11y.rows > 0)) {
          fails.push(`弹窗内没有评委行，评委框的可访问名称没被覆盖（rows=${dlgA11y.rows}）`);
        }
        if (dlgA11y.total < dlgA11y.rows * 4) {
          fails.push(`弹窗内可聚焦框只有 ${dlgA11y.total} 个，${dlgA11y.rows} 行评委每行 4 个框至少该有 `
            + `${dlgA11y.rows * 4} 个 —— 选择器或评委行结构变了，本段统计不再可信`);
        }
        if (dlgA11y.nameless && dlgA11y.nameless.length) {
          fails.push(`弹窗内这些可聚焦框读屏念不出字段名：${JSON.stringify(dlgA11y.nameless)}`);
        }
        const wantJudgeName = { role: '评委角色', no: '评委工号', name: '评委姓名', dept: '评委部门' };
        Object.keys(wantJudgeName).forEach((k) => {
          const got = dlgA11y.judge ? dlgA11y.judge[k] : undefined;
          if (got !== wantJudgeName[k]) {
            fails.push(`评委行「${k}」框的可访问名称应为「${wantJudgeName[k]}」，实际 ${JSON.stringify(got)}`
              + `（角色/工号来自 subscribe-dialog.js 的 { label }，姓名/部门来自 subscribe-model.js 的 JUDGE_ROW_TEMPLATE`
              + ` aria-label；弹窗内没有可见 label 可取，删掉这两处就只剩 placeholder）`);
          }
        });
      }
    } catch (e) {
      fails.push(`空态/防重复提交段异常：${e.message}`);
    }
    fails.forEach((f) => process.stdout.write(`    [FAIL] ${f}\n`));
    if (fails.length) anyFail = true;
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // 第三批优化（2026-09-16 晚）：复选框命中区 / 分页条语义 / 下拉 title
  // ═══════════════════════════════════════════════════════════════
  {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const fails = [];
    try {
      await page.goto(base + 'publish.html', { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(900);
      const r = await page.evaluate(() => {
        const box = (el) => {
          const b = el.getBoundingClientRect();
          return { w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 };
        };
        const out = {};

        // ── B3 复选框命中区：真结构 = .sub-tbl 里 <td class="c-chk"><label class="chk-hit"><input>
        const probe = document.createElement('table');
        probe.className = 'sub-tbl';
        probe.innerHTML = '<tbody><tr>'
          + '<td class="c-chk"><label class="chk-hit"><input type="checkbox" checked></label></td>'
          + '<td>普通数据格</td></tr></tbody>';
        document.body.appendChild(probe);
        const cbEl = probe.querySelector('input[type="checkbox"]');
        const lab = probe.querySelector('.chk-hit');
        out.cbBox = box(cbEl);
        out.cbHit = box(lab);
        // 命中区不能只看 getBoundingClientRect，要真打点：从标签中心 ±12px 必须命中它或方框本身
        const lb = lab.getBoundingClientRect();
        const cx = lb.left + lb.width / 2;
        const cy = lb.top + lb.height / 2;
        const owns = (x, y) => {
          const hit = document.elementFromPoint(x, y);
          return !!hit && (hit === cbEl || lab.contains(hit));
        };
        out.cbProbe = { left: owns(cx - 12, cy), right: owns(cx + 12, cy), up: owns(cx, cy - 12), down: owns(cx, cy + 12) };
        // 行高不能被撑高：.doc-tbl-wrap「正好 10 行」的 max-height 是按行高算出来的
        out.cbRowH = box(lab).h;
        probe.remove();
        // 页面上静态的「全选」表头也必须是同一套结构（评委表 + 文档表各一处）
        out.headCbCount = document.querySelectorAll('th.c-chk > label.chk-hit > input[type="checkbox"]').length;

        // ── A9 分页条语义 ──
        const bar = document.getElementById('pagination');
        const info = document.getElementById('pageInfo');
        out.barTag = bar ? bar.tagName : 'MISSING';
        out.barLabel = bar ? bar.getAttribute('aria-label') : 'MISSING';
        out.infoRole = info ? info.getAttribute('role') : 'MISSING';
        out.infoLive = info ? info.getAttribute('aria-live') : 'MISSING';
        out.infoInsideBar = !!(bar && info && bar.contains(info));
        out.infoLiveMatchesCount = (function () {
          const rc = document.getElementById('resultCount');
          return !!rc && rc.getAttribute('aria-live') === (info && info.getAttribute('aria-live'));
        }());

        // ── C10 可搜索下拉：选中值同步写进 title（否则窄下拉里的超长值只能看到省略号）──
        const wrap = document.createElement('div');
        const sel = document.createElement('select');
        wrap.appendChild(sel);
        document.body.appendChild(wrap);
        const inst = window.createSearchableSelect(sel, [{ value: 'v1', label: '一个特别长的选项名称用于验证省略号后的完整值' }]);
        inst.setValue('v1');
        out.selTitle = wrap.querySelector('.searchable-select-input').getAttribute('aria-label') || '';
        inst.destroy();
        wrap.remove();
        return out;
      });
      process.stdout.write(`  复选框/分页语义/下拉title: ${JSON.stringify(r)}\n`);
      if (!(r.cbBox && r.cbBox.w === 18 && r.cbBox.h === 18)) {
        fails.push(`复选框应为 18×18，实际 ${JSON.stringify(r.cbBox)}`);
      }
      const cp = r.cbProbe || {};
      if (!cp.left || !cp.right || !cp.up || !cp.down) {
        fails.push(`复选框命中区未覆盖整格（中心 ±12px 必须命中），实际 ${JSON.stringify(cp)}`);
      }
      if (!(r.cbHit && r.cbHit.h <= 40)) {
        fails.push(`命中区不应撑高行高（应 ≈ 行高 39px），实际 ${JSON.stringify(r.cbHit)}`);
      }
      if (r.headCbCount < 2) {
        fails.push(`「全选」表头应有两处同套结构（评委表 / 文档表），实际 ${r.headCbCount} 处`);
      }
      if (r.barTag !== 'NAV' || !r.barLabel) fails.push(`分页条应为 <nav aria-label>，实际 ${r.barTag}/${r.barLabel}`);
      if (r.infoRole !== 'status' || r.infoLive !== 'polite') {
        fails.push(`#pageInfo 应有 role=status + aria-live=polite，实际 ${r.infoRole}/${r.infoLive}`);
      }
      if (!r.infoInsideBar) fails.push('#pageInfo 应在分页条内');
      if (!r.infoLiveMatchesCount) fails.push('#pageInfo 的 aria-live 应与 #resultCount 同口径');
      // 2026-09-21：提示文字删光后，完整值不再进 title/aria-label；
      // aria-label 只承担「可访问名=字段名」这一个职责，永远非空即可。
      if (!r.selTitle || !r.selTitle.trim()) {
        fails.push(`可搜索下拉的 aria-label（可访问名）必须非空，实际 ${JSON.stringify(r.selTitle)}`);
      }
    } catch (e) {
      fails.push(`第三批（尺寸/语义）段异常：${e.message}`);
    }
    fails.forEach((f) => process.stdout.write(`    [FAIL] ${f}\n`));
    if (fails.length) anyFail = true;
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // 第三批优化：多选控件键盘 / task 页重置与回车 / 人员行键盘
  // ═══════════════════════════════════════════════════════════════
  {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const fails = [];
    try {
      await page.goto(base + 'task.html', { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(900);
      const r = await page.evaluate(async () => {
        const tick = (ms) => new Promise((res) => setTimeout(res, ms));
        const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
        const out = {};
        const calls = [];
        const api = window.TaskApi;
        const origList = api && api.fetchTaskList;
        if (api) api.fetchTaskList = async (cond, p) => { calls.push({ no: cond && cond.taskApplicationTaskNo, page: p }); return { ok: true, rows: [], total: 0 }; };
        try {
          // ① 普通输入框回车 → 发起查询（task 页原来完全没有这条处理）
          const inp = document.getElementById('t_taskNo');
          inp.value = 'T-1';
          inp.focus();
          key(inp, 'Enter');
          await tick(100);
          out.afterInputEnter = calls.length;

          // ② 页面上真实的多选控件（#msel_batch）：回车只开面板，不得顺带查一次
          const host = document.getElementById('msel_batch');
          const disp = host.querySelector('.msel-display');
          const panel = host.querySelector('.msel-panel');
          disp.focus();
          key(disp, 'Enter');
          await tick(50);
          out.mselOpened = panel.classList.contains('show');
          out.mselExpanded = disp.getAttribute('aria-expanded');
          out.callsAfterMselEnter = calls.length;

          // ③ 往 #filterCard 里塞一个「有选项」的多选控件，验证完整的键盘路径。
          //    放进筛选卡是有意的：它的回车会冒泡到页面的「筛选区回车即查询」，
          //    控件没 stopPropagation 的话这里就会多发一次查询。
          const probe = document.createElement('div');
          probe.className = 'msel';
          document.getElementById('filterCard').appendChild(probe);
          const probeInst = window.createMultiSelect(probe, [
            { value: 'a', label: '选项A' }, { value: 'b', label: '选项B' }, { value: 'c', label: '选项C' },
          ], '全部探针');
          const pDisp = probe.querySelector('.msel-display');
          const pPanel = probe.querySelector('.msel-panel');
          pDisp.focus();
          key(pDisp, 'Enter');
          await tick(40);
          out.probeOpened = pPanel.classList.contains('show');
          key(pDisp, 'ArrowDown');
          await tick(40);
          out.focusInList = !!(document.activeElement && document.activeElement.closest
            && document.activeElement.closest('.msel-item'));
          key(document.activeElement, 'Enter');           // 回车勾选当前项
          await tick(40);
          out.checkedByEnter = probeInst.getValues().join(',');
          out.callsAfterListEnter = calls.length;
          key(document.activeElement, 'Escape');          // Esc 收起 + 焦点归还
          await tick(40);
          out.probeClosed = !pPanel.classList.contains('show');
          out.focusBackToDisplay = document.activeElement === pDisp;
          out.expandedAfterEsc = pDisp.getAttribute('aria-expanded');
          probeInst.destroy();
          probe.remove();

          // ④ C7 重置：清空筛选 + 回到初始空态 + toast（原来只清控件、旧结果留着）。
          //    toast 用桩收，避免被上一步「查询完成…」的队列挡住看不见。
          const toasts = [];
          const origToast = window.toast;
          window.toast = (m) => { toasts.push(String(m)); };
          const body = document.getElementById('resultBody');
          const bar = document.getElementById('pagination');
          const stats = document.getElementById('statsRow');
          const rc = document.getElementById('resultCount');
          body.innerHTML = '<tr data-index="0"><td class="col-index">1</td><td colspan="12">X</td></tr>';
          bar.style.display = '';
          stats.style.display = '';
          rc.textContent = '共 1 条 · 本页 1 条';
          document.getElementById('btnReset').click();
          await tick(150);
          window.toast = origToast;
          out.resetInput = document.getElementById('t_taskNo').value;
          out.resetRows = body.querySelectorAll('tr').length;
          out.resetEmptyCls = (body.querySelector('td') || {}).className || '';
          out.resetBar = bar.style.display;
          out.resetStats = stats.style.display;
          out.resetCount = rc.textContent;
          out.resetToast = toasts.join(' | ');

          // ⑥ B9 人员查询行：可 Tab 聚焦 + aria-expanded 随展开切换
          const uApi = window.UserApi;
          const origList2 = uApi && uApi.fetchUserList;
          const origDetail = uApi && uApi.fetchUserDetail;
          if (uApi) {
            uApi.fetchUserList = async () => ({
              ok: true,
              list: [{ userId: 'U1', userName: '张三', orgName: '软件中心', teamName: '开发一部', userStatus: '1' }],
            });
            uApi.fetchUserDetail = async () => ({ ok: true, user: { userId: 'U1', userName: '张三' } });
          }
          document.getElementById('psKeyword').value = '张三';
          document.getElementById('psSearchBtn').click();
          await tick(150);
          const psRow = document.querySelector('tr.ps-row');
          out.psTabIndex = psRow ? psRow.getAttribute('tabindex') : 'MISSING';
          out.psExpandedInit = psRow ? psRow.getAttribute('aria-expanded') : 'MISSING';
          if (psRow) { key(psRow, 'Enter'); await tick(120); }
          out.psExpandedAfterEnter = document.querySelector('tr.ps-row')
            ? document.querySelector('tr.ps-row').getAttribute('aria-expanded') : 'MISSING';
          out.psDetailRow = !!document.getElementById('psDetailRow');
          if (uApi) { uApi.fetchUserList = origList2; uApi.fetchUserDetail = origDetail; }
        } finally {
          if (api && origList) api.fetchTaskList = origList;
        }
        return out;
      });
      process.stdout.write(`  多选键盘/重置/人员行: ${JSON.stringify(r)}\n`);
      if (r.afterInputEnter !== 1) fails.push(`筛选输入框回车应发起 1 次查询，实际 ${r.afterInputEnter}`);
      if (r.mselOpened !== true) fails.push('多选控件按回车应打开面板');
      if (r.mselExpanded !== 'true') fails.push(`面板打开时 aria-expanded 应为 true，实际 ${r.mselExpanded}`);
      if (r.callsAfterMselEnter !== r.afterInputEnter) {
        fails.push(`多选面板按回车不得顺带查询（${r.afterInputEnter} → ${r.callsAfterMselEnter}）`);
      }
      if (r.focusInList !== true) fails.push('多选面板里按 ↓ 应把焦点移进选项');
      if (r.probeOpened !== true) fails.push('筛选卡内的多选控件按回车应打开面板');
      if (r.checkedByEnter !== 'a') fails.push(`面板里按回车应勾选当前项，实际勾中 ${JSON.stringify(r.checkedByEnter)}`);
      if (r.callsAfterListEnter !== r.afterInputEnter) {
        fails.push(`列表里按回车不得顺带查询（${r.afterInputEnter} → ${r.callsAfterListEnter}）`);
      }
      if (r.probeClosed !== true || r.focusBackToDisplay !== true) {
        fails.push(`Esc 应收起面板并把焦点还给显示框（closed=${r.probeClosed} back=${r.focusBackToDisplay}）`);
      }
      if (r.expandedAfterEsc !== 'false') fails.push(`收起后 aria-expanded 应为 false，实际 ${r.expandedAfterEsc}`);
      if (r.resetInput !== '') fails.push(`重置应清空筛选输入框，实际 ${JSON.stringify(r.resetInput)}`);
      if (r.resetRows !== 1 || !String(r.resetEmptyCls).includes('empty-hint')) {
        fails.push(`重置后结果应回到初始空态，实际 rows=${r.resetRows} cls=${r.resetEmptyCls}`);
      }
      if (r.resetBar !== 'none' || r.resetStats !== 'none') {
        fails.push(`重置后分页条/统计行都应隐藏，实际 bar=${r.resetBar} stats=${r.resetStats}`);
      }
      if (r.resetCount !== '') fails.push(`重置后计数应清空，实际 ${JSON.stringify(r.resetCount)}`);
      if (!String(r.resetToast).includes('重置')) fails.push(`重置应给可见反馈，实际 toast=${JSON.stringify(r.resetToast)}`);
      if (r.psTabIndex !== '0') fails.push(`人员查询行应可 Tab 聚焦，实际 tabindex=${r.psTabIndex}`);
      if (r.psExpandedInit !== 'false' || r.psExpandedAfterEnter !== 'true') {
        fails.push(`人员行 aria-expanded 应 0 → 1，实际 ${r.psExpandedInit} → ${r.psExpandedAfterEnter}`);
      }
      if (r.psDetailRow !== true) fails.push('人员行按回车应展开详情');
    } catch (e) {
      fails.push(`第三批（键盘/重置）段异常：${e.message}`);
    }
    fails.forEach((f) => process.stdout.write(`    [FAIL] ${f}\n`));
    if (fails.length) anyFail = true;
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // 宽表空态浮层（订阅页 3046px / 任务单页 1346px 的宽表）：
  // <td colspan> 里的文案没法真正居中 —— 按单元格居中会跑到视口右侧外面。
  // 由 .table-empty-overlay 负责显示。断言三件事：
  //   ① 文案在滚动容器可见区里水平居中；② 浮层上沿贴着表头下沿（不盖表头）；
  //   ③ 浮层铺到容器底部。
  // ═══════════════════════════════════════════════════════════════
  for (const [file, tag] of [['subscription.html', '订阅'], ['task.html', '任务单']]) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const fails = [];
    try {
      await page.goto(base + file, { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(800);
      const r = await page.evaluate(() => {
        const scroll = document.querySelector('.tbl-scroll');
        const overlay = scroll && scroll.querySelector('.table-empty-overlay');
        const txt = overlay && overlay.querySelector('.table-empty-overlay-text');
        const thead = scroll && scroll.querySelector('thead');
        if (!scroll || !overlay || !txt || !thead) return { missing: true };
        const sr = scroll.getBoundingClientRect();
        const or = overlay.getBoundingClientRect();
        const hr = thead.getBoundingClientRect();
        const rng = document.createRange();
        rng.selectNodeContents(txt);
        const tr = rng.getBoundingClientRect();
        return {
          overlayHidden: overlay.hidden,
          textCenterOffset: Math.round((tr.left + tr.width / 2) - (sr.left + sr.width / 2)),
          overlayTopVsHeadBottom: Math.round(or.top - hr.bottom),
          overlayBottomVsScrollBottom: Math.round(sr.bottom - or.bottom),
          text: txt.textContent.trim(),
        };
      });
      if (r.missing) {
        process.stdout.write(`  空态浮层(${tag}): ${JSON.stringify(r)}\n`);
        fails.push(`${tag}页没找到宽表空态浮层（.table-empty-overlay / thead）`);
      } else {
        // 再走一遍共享 helper 的显示/隐藏接线：数据渲染完必须能收起浮层，
        // 否则空态浮层会一直盖在数据行上（这次改动最容易引入的回归）。
        const r2 = await page.evaluate(() => {
          const ov = document.querySelector('.table-empty-overlay');
          const txt = ov && ov.querySelector('.table-empty-overlay-text');
          const out = {};
          window.TableUtils.renderEmpty('空态文案变更测试', 23);
          out.txtAfterRenderEmpty = txt ? txt.textContent : null;
          out.shownAfterRenderEmpty = !!ov && ov.hidden === false;
          window.TableUtils.hideEmptyOverlay();
          out.hiddenAfterHide = !!ov && ov.hidden === true;
          return out;
        });
        process.stdout.write(`  空态浮层(${tag}): ${JSON.stringify(r)} 显示/隐藏: ${JSON.stringify(r2)}\n`);
        if (r.overlayHidden !== false) fails.push(`${tag}页空态浮层应可见`);
        if (Math.abs(r.textCenterOffset) > 1) {
          fails.push(`${tag}页空态文案应水平居中，实际偏 ${r.textCenterOffset}px`);
        }
        // 上沿贴表头下沿：差值应在 [0, 2] 内（0=正好，2=像素舍入）。负数说明盖住了表头。
        if (r.overlayTopVsHeadBottom < 0 || r.overlayTopVsHeadBottom > 2) {
          fails.push(`${tag}页浮层上沿应对齐表头下沿（差值 ${r.overlayTopVsHeadBottom}px，负数=盖住了表头）`);
        }
        if (Math.abs(r.overlayBottomVsScrollBottom) > 2) {
          fails.push(`${tag}页浮层应铺到容器底部（差值 ${r.overlayBottomVsScrollBottom}px）`);
        }
        if (!/请输入条件后点击/.test(r.text)) fails.push(`${tag}页空态文案不符：${r.text}`);
        if (r2.txtAfterRenderEmpty !== '空态文案变更测试') {
          fails.push(`${tag}页 renderEmpty 应同步浮层文案，实际 ${JSON.stringify(r2.txtAfterRenderEmpty)}`);
        }
        if (r2.shownAfterRenderEmpty !== true) fails.push(`${tag}页 renderEmpty 后浮层应可见`);
        if (r2.hiddenAfterHide !== true) fails.push(`${tag}页 hideEmptyOverlay 后浮层应隐藏（否则会盖住数据行）`);
      }
    } catch (e) {
      fails.push(`空态浮层段异常（${tag}）：${e.message}`);
    }
    fails.forEach((f) => process.stdout.write(`    [FAIL] ${f}\n`));
    if (fails.length) anyFail = true;
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // 必填标记（C5）：.required 的星号规则已从 publish.html 的页面样式提到 theme.css 共享。
  // 2026-09-21 起发布页的「系统 / 批次」改为**非必选**（星号撤掉，校验换成查询前的二次确认），
  // 所以这里守两点：发布页**不该**再出现 .required；订阅页查询表单的「二选一必填」标记 + 说明仍在。
  // ═══════════════════════════════════════════════════════════════
  {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const fails = [];
    const star = (sel) => page.evaluate((s) => {
      const lb = document.querySelector(s);
      if (!lb) return { missing: true };
      const cs = getComputedStyle(lb, '::before');
      return { cls: lb.className, content: cs.content, color: cs.color };
    }, sel);
    try {
      await page.goto(base + 'publish.html', { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(700);
      const pubReq = await star('label.required');

      await page.goto(base + 'subscription.html', { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(700);
      const caller = await star('label[for="f_callerCompNum"]');
      const provider = await star('label[for="f_providerCompNum"]');
      const note = await page.evaluate(() => {
        const n = document.querySelector('.filter-required-note');
        return n ? n.textContent.replace(/\s+/g, ' ').trim() : null;
      });
      process.stdout.write(`  必填标记(C5): 发布页=${JSON.stringify(pubReq)} 调用方=${JSON.stringify(caller)}`
        + ` 提供方=${JSON.stringify(provider)} 说明=${JSON.stringify(note)}\n`);
      const hasStar = (x) => !!x && !x.missing && String(x.content).indexOf('*') > -1;
      if (pubReq && !pubReq.missing) {
        fails.push(`发布页不该再有必填星号（系统/批次已改为非必选），实际 ${JSON.stringify(pubReq)}`);
      }
      if (!hasStar(caller)) fails.push(`订阅页「调用方系统/分行」应带必填星号，实际 ${JSON.stringify(caller)}`);
      if (!hasStar(provider)) fails.push(`订阅页「提供方系统」应带必填星号，实际 ${JSON.stringify(provider)}`);
      if (!note || note.indexOf('二选一') < 0) {
        fails.push(`订阅页应给出「二选一」说明，实际 ${JSON.stringify(note)}`);
      }
    } catch (e) {
      fails.push(`必填标记段异常：${e.message}`);
    }
    fails.forEach((f) => process.stdout.write(`    [FAIL] ${f}\n`));
    if (fails.length) anyFail = true;
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // 三个查询页的工具栏（2026-09-21 补）：**每页**都要有「🔑 Token」和跳往另外两个
  // 查询页的按钮。以前只有发布页（+首页）有，在任务单页/订阅页想改 token 或去别的页
  // 只能先退回首页。按钮在还不算数 —— 这里还要真的点一下，确认 init() 接上了。
  // ═══════════════════════════════════════════════════════════════
  {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const fails = [];
    const PAGES = [
      ['发布查询页', 'publish.html', ['/task', '/subscription']],
      ['任务单页', 'task.html', ['/publish', '/subscription']],
      ['订阅关系页', 'subscription.html', ['/publish', '/task']],
    ];
    try {
      for (const [name, file, hops] of PAGES) {
        await page.goto(base + file, { waitUntil: 'load', timeout: 15000 });
        await page.waitForTimeout(900);
        const r = await page.evaluate((needHops) => {
          const links = [...document.querySelectorAll('.page-header .toolbar a')]
            .map((a) => a.getAttribute('href'));
          return {
            hasToolbar: !!document.querySelector('.page-header .toolbar'),
            hasTokenBtn: !!document.getElementById('btnTokenManager'),
            hasHomeLink: links.indexOf('/home') > -1,
            missingHops: needHops.filter((h) => links.indexOf(h) < 0),
          };
        }, hops);
        // 按钮存在还不够：点了要真弹出 Token 管理弹窗（验证 TokenManager.init() 接上了）
        await page.click('#btnTokenManager');
        await page.waitForTimeout(900);
        r.tokenOpens = await page.evaluate(() => !!document.querySelector('.dlg-util-overlay.show'));
        if (r.tokenOpens) {
          await page.locator('.dlg-util-overlay.show .sub-foot button').first().click();   // 取 消
          await page.waitForTimeout(500);
        }
        process.stdout.write(`  ${name}工具栏: ${JSON.stringify(r)}\n`);
        if (!r.hasToolbar) fails.push(`${name} 缺 .page-header .toolbar`);
        if (!r.hasTokenBtn) fails.push(`${name} 缺「🔑 Token」按钮（#btnTokenManager）`);
        if (!r.hasHomeLink) fails.push(`${name} 缺回首页的链接`);
        if (r.missingHops.length) fails.push(`${name} 缺跳往 ${r.missingHops.join('、')} 的按钮`);
        if (!r.tokenOpens) fails.push(`${name} 点「🔑 Token」没弹出管理弹窗（TokenManager.init 没接上？）`);
      }
    } catch (e) {
      fails.push(`工具栏段异常：${e.message}`);
    }
    fails.forEach((f) => process.stdout.write(`    [FAIL] ${f}\n`));
    if (fails.length) anyFail = true;
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // 发布页分页条（A5）：原来只有「上一页 / 下一页 / 第 X / Y 页」，
  // 翻到第 20 页要点 19 次。用假 state 直接驱动 PublishView.updatePagination
  // 验证渲染（页码/首末页/跳页/禁用态），再点一个页码验证事件委托真的接管了点击。
  // ═══════════════════════════════════════════════════════════════
  {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const fails = [];
    try {
      await page.goto(base + 'publish.html', { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(800);
      const r = await page.evaluate(() => {
        const out = {};
        const bar = document.getElementById('pagination');
        if (!bar) return { missing: true };
        bar.style.display = '';   // 该页分页条默认 display:none（还没查询），先显示才量得到
        const V = window.PublishView;
        const nums = document.getElementById('pageNumbers');
        const cur = () => nums.querySelector('button.is-current');

        // ① 第 1 页：首页 / 上一页 都应禁用
        V.updatePagination({ filteredRows: new Array(95), pageSize: 10, pageNum: 1 });
        out.firstDisabledAt1 = document.getElementById('btnFirst').disabled;
        out.prevDisabledAt1 = document.getElementById('btnPrev').disabled;

        // ② 第 5 页 / 共 10 页
        V.updatePagination({ filteredRows: new Array(95), pageSize: 10, pageNum: 5 });
        out.btnCount = nums.querySelectorAll('button[data-page]').length;
        out.curText = cur() ? cur().textContent : null;
        out.curAria = cur() ? cur().getAttribute('aria-current') : null;
        out.firstDisabledAt5 = document.getElementById('btnFirst').disabled;
        out.lastDisabledAt5 = document.getElementById('btnLast').disabled;
        out.jumpMax = document.getElementById('pageJump').max;
        out.jumpValue = document.getElementById('pageJump').value;
        out.pageInfoAt5 = document.getElementById('pageInfo').textContent;
        out.numbersBefore = out.btnCount;

        // ③ 点第 7 页（10 页 / 当前第 5 页时，页码条是 1,3,4,5,6,7,10，7 一定在）：
        //    事件委托应接管 → gotoPage 用**真实** state 重渲染，
        //    于是页码条从「10 页的 7 颗」变回真实数据（本页无数据 → 1 页）。
        const target = nums.querySelector('button[data-page="7"]');
        out.hasTargetPage = !!target;
        if (target) target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        out.numbersAfterClick = nums.querySelectorAll('button[data-page]').length;
        out.pageInfoAfterClick = document.getElementById('pageInfo').textContent;
        return out;
      });
      process.stdout.write(`  发布页分页条(A5): ${JSON.stringify(r)}\n`);
      if (r.missing) {
        fails.push('首页没找到 #pagination');
      } else {
        if (r.firstDisabledAt1 !== true || r.prevDisabledAt1 !== true) {
          fails.push(`第 1 页时首页/上一页应禁用（first=${r.firstDisabledAt1} prev=${r.prevDisabledAt1}）`);
        }
        if (r.btnCount !== 7) fails.push(`第 5/10 页应渲染 7 颗页码按钮（1,3,4,5,6,7,10），实际 ${r.btnCount}`);
        if (r.curText !== '5') fails.push(`当前页按钮应为 5，实际 ${r.curText}`);
        if (r.curAria !== 'page') fails.push(`当前页应带 aria-current="page"，实际 ${r.curAria}`);
        if (r.firstDisabledAt5 !== false || r.lastDisabledAt5 !== false) {
          fails.push(`第 5 页时首页/末页都该可点（first=${r.firstDisabledAt5} last=${r.lastDisabledAt5}）`);
        }
        if (r.jumpMax !== '10' || r.jumpValue !== '5') {
          fails.push(`跳页框应为 max=10 / value=5，实际 max=${r.jumpMax} value=${r.jumpValue}`);
        }
        if (r.hasTargetPage !== true) {
          fails.push('第 5/10 页的页码条里应存在第 7 页按钮（1,3,4,5,6,7,10）');
        }
        // 委托生效的证据：点击后重渲染成真实数据的分页（1 页），且页码数变了
        if (r.numbersAfterClick === r.numbersBefore) {
          fails.push(`点页码应触发重新分页（点击前后都是 ${r.numbersBefore} 颗 → 事件委托没接上）`);
        }
        if (!/第 1 \/ 1 页/.test(r.pageInfoAfterClick)) {
          fails.push(`点页码后应按真实数据重渲染分页文案，实际 ${r.pageInfoAfterClick}`);
        }
      }
    } catch (e) {
      fails.push(`发布页分页条段异常：${e.message}`);
    }
    fails.forEach((f) => process.stdout.write(`    [FAIL] ${f}\n`));
    if (fails.length) anyFail = true;
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // 第三批优化：排序入口是真按钮 + 复制单元格键盘漫游
  // ═══════════════════════════════════════════════════════════════
  {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const fails = [];
    try {
      await page.goto(base + 'subscription.html', { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(900);
      const r = await page.evaluate(() => {
        const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
        const out = {};
        // ① 排序入口（B9）：换成真 <button> 后 Tab 能到、Enter/空格原生可触发；aria-sort 跟着走
        const btn = document.getElementById('btnSortPrio');
        const th = document.getElementById('thPrio');
        out.btnTag = btn ? btn.tagName : 'MISSING';
        out.sortInit = th ? th.getAttribute('aria-sort') : 'MISSING';
        if (btn) {
          btn.focus();
          out.btnFocusable = document.activeElement === btn;
          btn.click();
          out.sortAfter1 = th.getAttribute('aria-sort');
          btn.click();
          out.sortAfter2 = th.getAttribute('aria-sort');
          btn.click();                      // 第三档回到起始态，别把页面留在别的排序上
          out.sortBack = th.getAttribute('aria-sort');
        }

        // ② 复制单元格漫游（B9）：真 DOM 渲染两行，验证只有一格进 Tab 顺序
        const tb = document.createElement('tbody');
        document.body.appendChild(tb);
        const M = window.SubscriptionModel;
        const rows = [0, 1].map((i) => {
          const row = { sysServeNo: 'S' + i };
          M.COLUMNS.forEach(([k]) => { row[k] = 'v' + k + i; });
          return M.decorateRow(row, new Date(2026, 8, 16));
        });
        let copied = 0;
        window.SubscriptionView.renderTable(tb, rows, {
          onJump() {},
          onCopy(t) { copied += 1; out.lastCopy = t; },
        });
        const cells = Array.prototype.slice.call(tb.querySelectorAll('td.copy-cell'));
        const tabbable = () => cells.filter((c) => c.tabIndex === 0).length;
        out.cellCount = cells.length;
        out.tabbableBefore = tabbable();
        const first = cells.find((c) => c.tabIndex === 0);
        if (first) {
          first.focus();
          out.firstFocusable = document.activeElement === first;
          key(first, 'Enter');
          out.copiedOnEnter = copied;
          key(first, 'ArrowRight');
          out.tabbableAfterRight = tabbable();
          out.activeIsCell = !!(document.activeElement && document.activeElement.closest
            && document.activeElement.closest('td.copy-cell'));
          key(document.activeElement, ' ');
          out.copiedAfterSpace = copied;
        }
        tb.remove();
        return out;
      });
      process.stdout.write(`  排序按钮/复制漫游: ${JSON.stringify(r)}\n`);
      if (r.btnTag !== 'BUTTON') fails.push(`排序入口应是真 <button>（键盘可达），实际 ${r.btnTag}`);
      if (r.btnFocusable !== true) fails.push('排序按钮应可聚焦');
      if (r.sortInit !== 'ascending') fails.push(`默认排序应为 ascending，实际 ${r.sortInit}`);
      if (r.sortAfter1 !== 'descending' || r.sortAfter2 !== 'none') {
        fails.push(`排序三态应 ascending → descending → none，实际 ${r.sortAfter1} → ${r.sortAfter2}`);
      }
      if (r.sortBack !== 'ascending') fails.push(`再点一次应回到 ascending，实际 ${r.sortBack}`);
      if (r.cellCount !== 42) fails.push(`两行应有 42 个可复制格（21 列 × 2），实际 ${r.cellCount}`);
      if (r.tabbableBefore !== 1) {
        fails.push(`整表只应有 1 个 Tab 停靠点（否则 Tab 要穿 220 格），实际 ${r.tabbableBefore}`);
      }
      if (r.firstFocusable !== true) fails.push('漫游格应可聚焦');
      if (r.copiedOnEnter !== 1) fails.push(`当前格按回车应复制，实际复制 ${r.copiedOnEnter} 次`);
      if (r.tabbableAfterRight !== 1 || r.activeIsCell !== true) {
        fails.push(`→ 应把漫游位移到下一格，实际 tabbable=${r.tabbableAfterRight} active=${r.activeIsCell}`);
      }
      if (r.copiedAfterSpace !== 2) fails.push(`空格也应复制，实际累计 ${r.copiedAfterSpace} 次`);
    } catch (e) {
      fails.push(`第三批（排序/复制）段异常：${e.message}`);
    }
    fails.forEach((f) => process.stdout.write(`    [FAIL] ${f}\n`));
    if (fails.length) anyFail = true;
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // 第三批优化：订阅弹窗脏检查（B5）
  // ═══════════════════════════════════════════════════════════════
  // 四条关闭路径（✕ / 取 消 / 点遮罩 / Esc）原来都会把 28 字段长表单一次性丢掉且无提示。
  // 现在：没改过 → 直接关；改过 → 先确认，确认框里取消则弹窗与内容都保留。
  {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const fails = [];
    try {
      await page.goto(base + 'publish.html', { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(900);
      const r = await page.evaluate(async () => {
        const tick = (ms) => new Promise((res) => setTimeout(res, ms));
        const overlay = document.getElementById('subscribeOverlay');
        const isOpen = () => !!overlay && overlay.classList.contains('show');
        const row = { serverCoding: 'TST-CODING', sysServeName: '脏检查测试服务' };
        const out = {};

        // ① 打开后没改任何东西 → 取 消 应直接关闭，不该弹确认框
        await window.SubscribeDialog.open(row);
        await tick(220);
        out.opened = isOpen();
        document.getElementById('btnSubCancel').click();
        await tick(260);
        out.closedClean = !isOpen();
        out.confirmOnClean = !!document.querySelector('.dlg-util-overlay');

        // ② 改一个字段再取消 → 必须出现确认框，且主弹窗仍开着
        await window.SubscribeDialog.open(row);
        await tick(220);
        document.getElementById('sub_taskNo').value = 'T-脏检查';
        document.getElementById('btnSubCancel').click();
        await tick(260);
        const box = document.querySelector('.dlg-util-overlay');
        out.stillOpenOnDirty = isOpen();
        out.confirmShown = !!box;
        out.confirmText = box ? box.textContent.replace(/\s+/g, ' ').trim() : '';

        // ③ 在确认框里点「取 消」→ 弹窗与已填内容都保留（不是「点了没反应」）
        const btns = box ? box.querySelectorAll('.sub-foot button') : [];
        if (btns[0]) btns[0].click();
        await tick(260);
        out.stillOpenAfterAbort = isOpen();
        out.taskNoKept = document.getElementById('sub_taskNo').value;
        out.boxGoneAfterAbort = !document.querySelector('.dlg-util-overlay');

        // ④ 再来一次并确认放弃 → 这次才关
        document.getElementById('btnSubCancel').click();
        await tick(260);
        const box2 = document.querySelector('.dlg-util-overlay');
        const okBtn = box2 ? box2.querySelector('.sub-foot .filled') : null;
        out.confirmTwice = !!box2;
        if (okBtn) okBtn.click();
        await tick(320);
        out.closedAfterConfirm = !isOpen();
        return out;
      });
      process.stdout.write(`  订阅弹窗脏检查: ${JSON.stringify(r)}\n`);
      if (r.opened !== true) fails.push('订阅弹窗未打开，脏检查无法验证');
      if (r.closedClean !== true) fails.push('没改过表单时「取 消」应直接关闭');
      if (r.confirmOnClean) fails.push('没改过表单不该弹放弃确认框');
      if (r.stillOpenOnDirty !== true) fails.push('改过表单后点「取 消」应先拦下来，不能直接丢内容');
      if (r.confirmShown !== true) fails.push('改过表单后关闭应弹放弃确认框');
      if (!/放弃|关闭/.test(String(r.confirmText))) {
        fails.push(`确认框文案要说清后果，实际 ${JSON.stringify(r.confirmText)}`);
      }
      if (r.stillOpenAfterAbort !== true) fails.push('确认框里选「取 消」后主弹窗应仍然打开');
      if (r.taskNoKept !== 'T-脏检查') fails.push(`放弃确认后已填内容必须保留，实际 ${JSON.stringify(r.taskNoKept)}`);
      if (r.boxGoneAfterAbort !== true) fails.push('确认框选「取 消」后自身应关闭');
      if (r.confirmTwice !== true) fails.push('再次关闭仍应弹确认框');
      if (r.closedAfterConfirm !== true) fails.push('确认放弃后主弹窗应关闭');
    } catch (e) {
      fails.push(`第三批（脏检查）段异常：${e.message}`);
    }
    fails.forEach((f) => process.stdout.write(`    [FAIL] ${f}\n`));
    if (fails.length) anyFail = true;
    await page.close();
  }

  // ═══════════════════════════════════════════════════════════════
  // 订阅面板「本地口径」（2026-09-19 定的口径，别退化成"未同步服务端"的说法）
  // ═══════════════════════════════════════════════════════════════
  // 后端没有订阅查询接口，右上角这个数字只能来自本机 localStorage。
  // 断言三件事：① 计数按钮悬停要说明来源；② 面板里要有「本机维护」的说明；
  // ③ 移除一条要能从清单里真删掉，且解释「服务端关系不变」。
  {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    const fails = [];
    try {
      await page.goto(base + 'publish.html', { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(700);
      const r = await page.evaluate(async () => {
        const tick = (ms) => new Promise((rs) => setTimeout(rs, ms));
        const SM = window.SubscribeManager;
        const btn = document.getElementById('btnSubscribePanel');
        const out = { hasBtn: !!btn, hasMgr: !!SM };

        SM.clear();
        SM.add('LOC-VERIFY-1');
        SM.add('LOC-VERIFY-2');
        btn.click();
        await tick(320);

        out.btnText = btn.textContent.trim();
        out.btnTitle = btn.getAttribute('title') || '';
        out.bodyText = (document.querySelector('.overlay.show .dialog') || {}).textContent || '';
        out.countShown = (document.getElementById('subCount') || {}).textContent || '';

        // 删第一条：确认框要是「本地口径」的说法，点了之后清单真少一条
        const delBtn = document.querySelector('#subList [data-code]');
        out.rowBefore = document.querySelectorAll('#subList [data-code]').length;
        if (delBtn) delBtn.click();
        await tick(360);
        const dlg = document.querySelector('.dlg-util-overlay');
        out.confirmText = dlg ? dlg.textContent.replace(/\s+/g, ' ').trim() : '';
        const okBtn = dlg ? dlg.querySelector('.sub-foot .filled') : null;
        if (okBtn) okBtn.click();
        await tick(420);
        out.rowAfter = document.querySelectorAll('#subList [data-code]').length;
        out.stillLocalOnly = SM.getAll().length;
        window.DialogUtils && typeof DialogUtils.close === 'function' && DialogUtils.close();
        SM.clear();
        return out;
      });
      process.stdout.write(`  订阅面板本地口径: ${JSON.stringify(r)}\n`);
      if (r.hasBtn !== true || r.hasMgr !== true) fails.push('订阅面板/管理器未就绪，用例无效');
      if (r.btnText !== '已订阅 (2)') fails.push(`计数按钮应显示「已订阅 (2)」，实际 ${JSON.stringify(r.btnText)}`);
      // 2026-09-21：提示文字删光，来源说明收进面板一行「本机清单（非服务端订阅关系）」
      if (!/本机清单/.test(r.bodyText)) fails.push('面板里要写明「本机清单」，否则会被当成服务端数据');
      if (!(/本机清单|本机这条标记/.test(r.confirmText))) {
        fails.push(`删除确认要说清只删本机标记，实际 ${JSON.stringify(r.confirmText)}`);
      }
      if (r.rowAfter !== r.rowBefore - 1) {
        fails.push(`移除一条后列表应少一条（${r.rowBefore} → ${r.rowAfter}）`);
      }
      if (r.stillLocalOnly !== 1) fails.push(`移除后本机清单应剩 1 条，实际 ${r.stillLocalOnly}`);
    } catch (e) {
      fails.push(`订阅面板本地口径段异常：${e.message}`);
    }
    fails.forEach((f) => process.stdout.write(`    [FAIL] ${f}\n`));
    if (fails.length) anyFail = true;
    await page.close();
  }

  await browser.close();
  server.close();
  process.stdout.write(`\n==== 结果: ${anyFail ? '有 FAIL' : 'ALL PASS (静态加载/接线无报错)'} ====\n`);
  process.exit(anyFail ? 1 : 0);
})();
