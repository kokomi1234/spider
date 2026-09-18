'use strict';
/**
 * 「部门常用查询」多人自测探针（真浏览器 + 真 localStorage）
 * ------------------------------------------------------------------
 * 为什么需要它：部门排行是在**本机**把多台帐uate的记录按 teamId/teamName 归并出来的，
 * 单测里的假 DOM 量不到「切不同人时列表到底过滤对不对」，所以这里真开几个 mock 的人：
 * 各自存若干条查询（带不同 hits），切换「当前用户」后再看首页渲染出来的条数、
 * 顺序、归属文案是否符合预期。
 *
 * 用法：
 *   node tests/dept-topn-probe.js
 *   PROBE_KEEP=1 node tests/dept-topn-probe.js    # 出错时保留浏览器现场（不自动关）
 *
 * 与其它测试的关系：
 *   tests/run.js            —— 零依赖单测（ SavedQuery.listByDept 的纯函数层）
 *   tests/smoke-browser.js  —— 接线/脚本顺序回归
 *   本文件                —— 多人多部门的数据层自测，肉眼可读的结论输出
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('../vendor/playwright-core');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

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

/**
 * 拉起本地代理（只为 /local/saved-queries 端点，不碰任何真实业务接口），
 * 共享文件指到临时目录，跑完删掉，不污染开发者的 shared/saved-queries.json。
 * @returns {Promise<{base:string, stop:Function, sharedFile:string}|null>} 起不来返回 null
 */
async function startProxy() {
  const sharedFile = path.join(os.tmpdir(), `spider-probe-queries-${Date.now()}.json`);
  const port = 3900 + Math.floor(Math.random() * 90);
  const child = spawn(process.execPath, [path.join(ROOT, 'proxy.js')], {
    cwd: ROOT,
    env: { ...process.env, PROXY_PORT: String(port), PROXY_QUERIES_FILE: sharedFile },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const req = http.get(base + 'health', (res) => { res.resume(); resolve(res.statusCode === 200); });
      req.on('error', () => resolve(false));
      req.setTimeout(600, () => { req.destroy(); resolve(false); });
    });
    if (ok) return { base, sharedFile, stop: () => { try { child.kill(); } catch (_) { /* 已退出 */ } } };
    await new Promise((r) => setTimeout(r, 300));
  }
  try { child.kill(); } catch (_) { /* noop */ }
  return null;
}

function findChrome() {
  if (process.env.SMOKE_CHROME_PATH) return process.env.SMOKE_CHROME_PATH;
  const cands = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
  for (const c of cands) { try { fs.accessSync(c, fs.constants.X_OK); return c; } catch (_) { /* 下一个 */ } }
  return null;
}

/**
 * 第二阶段：两台「机器」（两个独立浏览器上下文）经代理同步后，
 * 部门归属信息还在不在 —— 同步把 owner 丢了的话，排行会整个空掉。
 */

// ── mock 的人：同一个 org 下拆出两个 team，还有一个只有 org 的（测 team 缺失回退）──
const PEOPLE = [
  { userId: '1001', userName: '张三', orgId: 'O1', orgName: '中国银行软件中心（深圳）', teamId: 'T01', teamName: '开发一部' },
  { userId: '1002', userName: '李四', orgId: 'O1', orgName: '中国银行软件中心（深圳）', teamId: 'T02', teamName: '开发二部' },
  { userId: '1003', userName: '王五', orgId: 'O2', orgName: '中国银行软件中心（西安）', teamId: '', teamName: '' },
  // 与张三同 teamId 但 teamName 拼写得不一样：deptKeyOf 以 teamId 优先，应并进「开发一部」
  { userId: '1004', userName: '赵六', orgId: 'O1', orgName: '中国银行软件中心（深圳）', teamId: 'T01', teamName: '开发一部（临时写法）' },
];

// ── mock 的记录：[归属人下标, 查询名, 打开次数] ──
const RECORDS = [
  [0, '发布-按调用方查 delist', 9],
  [0, '发布-按服务编号查接口', 7],
  [0, '订阅-我负责的服务', 5],
  [0, '任务单-本月待办', 3],
  [0, '发布-冷门排查', 1],
  [0, '发布-从没点开过', 0],
  [1, '发布-同单位另一个部门', 8],
  [1, '任务单-二部的单', 4],
  [1, '订阅-二部订阅', 2],
  [2, '发布-西安那条', 6],
  [2, '任务单-西安它单', 1],
  [3, '发布-张三组同事存的最高频', 10],
];

(async () => {
  const chromePath = findChrome();
  if (!chromePath) {
    console.error('未找到 Google Chrome，可用 SMOKE_CHROME_PATH 指定。');
    process.exit(2);
  }
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto(base + 'index.html', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(900);

  const report = await page.evaluate(async (payload) => {
    const tick = (ms) => new Promise((r) => setTimeout(r, ms));
    const S = window.SavedQuery;
    const CU = window.CurrentUser;
    const out = { steps: [], errors: [] };

    // ① 把 mock 数据落进本机存储（走模块自己的 save+hit，不手搓 DOM）
    S.clear();
    CU.clear();
    const now = Date.now();
    payload.records.forEach(([pi, name, hits], i) => {
      const owner = payload.people[pi];
      const r = S.save({
        page: ['publish', 'task', 'subscription'][i % 3],
        name,
        fields: { probe: true },
        summary: `${owner.userName} 的常用查询`,
        labels: {},
        owner,
      });
      if (!r.ok) { out.errors.push(`save 失败：${name} → ${r.error}`); return; }
      // 打开次数：用真实的 hit() 累加，顺带验证计数本身是通的
      for (let n = 0; n < hits; n += 1) S.hit(r.item.id);
    });

    const total = S.list().length;
    out.total = total;

    /** 读一次首页「部门排行」的当前状态 */
    const snapshot = () => {
      const rows = [...document.querySelectorAll('#deptList .saved-item')].map((el) => ({
        name: (el.querySelector('.saved-name span:last-child') || {}).textContent || '',
        meta: (el.querySelector('.saved-meta') || {}).textContent || '',
        badge: (el.querySelector('.saved-badge') || {}).textContent || '',
      }));
      return {
        title: (document.getElementById('deptTitle') || {}).textContent || '',
        emptyShown: !document.getElementById('deptEmpty').hidden,
        emptyText: (document.getElementById('deptEmpty') || {}).textContent || '',
        rows,
        myListCount: document.querySelectorAll('#savedList .saved-item').length,
      };
    };

    /** 切换「当前用户」并重新渲染（等价于页面上重新查询到人并选中） */
    const asUser = async (p, topN) => {
      if (topN) window.localStorage.setItem('spider.deptTopN.v1', String(topN));
      CU.set(p);
      await tick(60);
      window.HomePage.render();
      await tick(80);
      return snapshot();
    };

    // ② 没设置当前用户：应明确提示先设置，而不是空列表
    CU.clear();
    window.HomePage.render();
    await tick(60);
    const noUser = snapshot();
    out.steps.push({
      who: '（未设置）',
      expect: '提示先设置当前用户',
      title: noUser.title,
      rows: noUser.rows.map((r) => r.name),
      emptyShown: noUser.emptyShown,
      emptyText: noUser.emptyText.slice(0, 40),
    });

    // ③ 依次切到每个人
    for (const p of payload.people) {
      const snap = await asUser(p, 10);
      out.steps.push({
        who: `${p.userName}（${p.userId}）· teamId=${p.teamId || '无'}`,
        expect: `只出现自己部门的记录（${p.teamName || p.orgName}）`,
        title: snap.title,
        rows: snap.rows.map((r) => `${r.name}｜${r.meta}`),
        emptyShown: snap.emptyShown,
        myListAll: snap.myListCount,
      });
    }

    // ④ TopN 生效：张三那组有 7 条（自己 6 + 同 teamId 同事 1）
    const n5 = await asUser(payload.people[0], 5);
    const n20 = await asUser(payload.people[0], 20);
    out.topN = {
      five: n5.rows.length,
      twenty: n20.rows.length,
      firstOfFive: n5.rows.length ? n5.rows[0].name : null,
      topOne: n20.rows.length ? n20.rows[0].meta : null,
    };

    // ⑤ 点开一次 → 计一次 hits，排行要往下沉（真实点击 + 拦住跳转）
    const before = await asUser(payload.people[0], 10);
    const first = document.querySelector('#deptList .saved-item .saved-main');
    if (first) {
      first.addEventListener('click', (e) => e.preventDefault(), { once: true });
      first.click();
    }
    await tick(120);
    window.HomePage.renderDept();
    await tick(80);
    const after = snapshot();
    out.clickEffect = {
      beforeTop: before.rows.length ? before.rows[0].name : null,
      afterTop: after.rows.length ? after.rows[0].name : null,
      beforeMeta: before.rows.length ? before.rows[0].meta : null,
      afterMeta: after.rows.length ? after.rows[0].meta : null,
    };

    S.clear();
    CU.clear();
    return out;
  }, { people: PEOPLE, records: RECORDS });

  // ── 结论输出 ──
  const fails = [];
  const line = (s) => process.stdout.write(s + '\n');

  line(`\n本机记录总数: ${report.total} 条（预期 ${RECORDS.length}）`);
  if (report.total !== RECORDS.length) fails.push(`记录总数不符：期望 ${RECORDS.length}，实际 ${report.total}`);

  report.steps.forEach((s) => {
    line(`\n── ${s.who}  [${s.expect}]`);
    line(`   标题: ${s.title}`);
    line(`   条数: ${s.rows.length}${s.emptyShown ? '（空态: ' + s.emptyText + '…）' : ''}`);
    if (typeof s.myListAll === 'number') {
      // 两个视图的口径要能对上：部门排行是「我的常用查询」的子集，不能被过滤漏
      line(`   我的常用查询（不分部门）: ${s.myListAll} 条`);
      if (s.myListAll !== RECORDS.length) {
        fails.push(`${s.who}：上部列表应始终是全部 ${RECORDS.length} 条，实际 ${s.myListAll}`);
      }
      if (s.rows.length > s.myListAll) fails.push(`${s.who}：部门条数不该多于全部记录数`);
    }
    s.rows.forEach((r, i) => line(`     ${String(i + 1).padStart(2)}. ${r}`));
  });

  line(`\n── TopN 切换（张三组）`);
  line(`   5 条时: ${JSON.stringify(report.topN)}`);

  line(`\n── 点一次卡片的计数效果`);
  line(`   ${JSON.stringify(report.clickEffect)}`);

  // ══ 第二阶段：两台机器经代理同步后，部门归属还在不在 ════════════════
  // 同步过程中 owner（谁存的、哪个部门）一旦被丢，列表看着还在、
  // 「部门常用查询」却会整个空掉 —— 这种故障只有跨机器跑一遍才暴露。
  const proxy = await startProxy();
  if (!proxy) {
    line('\n── 跨机器同步：代理没起来（跳过，不影响上面的结论）');
  } else {
    line('\n══ 第二阶段：两台机器经代理同步 ══');
    try {
      const TEAMMATE_A = { userId: '1001', userName: '张三', orgId: 'O1', orgName: '中国银行软件中心（深圳）', teamId: 'T01', teamName: '开发一部' };
      const TEAMMATE_B = { userId: '1002', userName: '李四', orgId: 'O1', orgName: '中国银行软件中心（深圳）', teamId: 'T02', teamName: '开发二部' };

      const runIn = async (label, fn) => {
        const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
        const pg = await ctx.newPage();
        pg.on('pageerror', (e) => pageErrors.push(`[${label}] ${e.message}`));
        await pg.goto(proxy.base + 'index.html', { waitUntil: 'load', timeout: 15000 });
        await pg.waitForTimeout(700);
        const r = await pg.evaluate(async (payload) => {
          const ownerA = payload.a;
          const ownerB = payload.b;
          return eval(`(${payload.src})`)(ownerA, ownerB);
        }, { a: TEAMMATE_A, b: TEAMMATE_B, src: fn.toString() });
        await ctx.close();
        return r;
      };

      const dumpFile = (tag) => {
        let raw = '(无文件)';
        try { raw = fs.readFileSync(proxy.sharedFile, 'utf8'); } catch (_) { /* 还没创建 */ }
        line(`  [共享文件 ${tag}] ${raw.slice(0, 260)}`);
      };
      dumpFile('A 之前');
      const a = await runIn('A', async (ownerA) => {
        const S = window.SavedQuery;
        const CU = window.CurrentUser;
        S.clear(); CU.clear();
        const save = (name, hits) => {
          const r = S.save({ page: 'publish', name, fields: {}, summary: '', labels: {}, owner: ownerA });
          for (let i = 0; i < hits; i += 1) S.hit(r.item.id);
          return r.item.id;
        };
        save('A-高频查询', 6);
        save('A-偶尔用', 2);
        await new Promise((r) => setTimeout(r, 250));   // 让页面加载那次自动同步先落定
        const pushed = await S.pushToServer();
        await new Promise((r) => setTimeout(r, 150));
        return {
          local: S.list().length,
          pushed: pushed && pushed.ok,
          serverTotal: pushed && pushed.total,
          error: pushed && !pushed.ok ? pushed.error : null,
        };
      });

      line(`  机器 A（张三）: ${JSON.stringify(a)}`);
      dumpFile('A 推完');

      // 机器 B：先同步拉回，再看有没有张三的记录、归属是否完整
      const b = await runIn('B', async (ownerA, ownerB) => {
        // 注意：**不能**用 S.clear() —— 它的语义是「清空本机清单并把这个删除意图同步给服务端」，
        // 在这里调用会把刚拉回来的同事记录一起标墓碑（第一轮我就是这么误伤的）。
        // 新 context 本机本来就是空的，直接进下一步。
        const S = window.SavedQuery;
        const CU = window.CurrentUser;
        const pulled = await S.pushToServer();
        const ownersBefore = S.list().length;
        const owners = S.list().map((it) => (it.owner ? `${it.owner.userName}/${it.owner.teamName || it.owner.orgName}` : '无归属'));
        // B 自己也存一条
        const mine = S.save({ page: 'task', name: 'B-任务单', fields: {}, summary: '', labels: {}, owner: ownerB });
        for (let i = 0; i < 3; i += 1) S.hit(mine.item.id);
        const pushed = await S.pushToServer();
        window.HomePage.render();
        await new Promise((r) => setTimeout(r, 80));
        const readDept = (who) => {
          CU.set(who);
          window.HomePage.renderDept();
          return {
            title: document.getElementById('deptTitle').textContent,
            rows: [...document.querySelectorAll('#deptList .saved-item')]
              .map((el) => ((el.querySelector('.saved-name span:last-child') || {}).textContent || '')),
          };
        };
        return {
          pulled: pulled && pulled.ok,
          pullTotal: pulled && pulled.total,
          pullError: pulled && !pulled.ok ? pulled.error : null,
          ownersBefore,
          totalAfterPull: S.list().length,
          owners,
          pushed: pushed && pushed.ok,
          asZhangsan: readDept(ownerA),
          asLisi: readDept(ownerB),
        };
      });

      line(`  机器 A（张三）: ${JSON.stringify(a)}`);
      dumpFile('B 推完');
      line(`  机器 B 拉取: ${JSON.stringify({ pulled: b.pulled, pullTotal: b.pullTotal, pullError: b.pullError, totalAfterPull: b.totalAfterPull })}`);
      line(`  归属保留情况: ${JSON.stringify(b.owners)}`);
      line(`  B 视角看「开发一部」: ${JSON.stringify(b.asZhangsan)}`);
      line(`  B 视角看「开发二部」: ${JSON.stringify(b.asLisi)}`);

      if (a.local !== 2 || a.pushed !== true) fails.push(`机器 A 推共享失败：${JSON.stringify(a)}`);
      if (!b.owners.every((o) => o !== '无归属')) fails.push(`同步后有人丢了归属信息：${JSON.stringify(b.owners)}`);
      if (b.asZhangsan.rows.length !== 2) fails.push(`B 端应能看到开发一部的 2 条，实际 ${b.asZhangsan.rows.length}`);
      if (b.asLisi.rows.length !== 1) fails.push(`B 端应只看到自己那条，实际 ${b.asLisi.rows.length}`);
    } catch (e) {
      fails.push(`第二阶段异常：${e.message}`);
    }
    proxy.stop();
    try { fs.unlinkSync(proxy.sharedFile); } catch (_) { /* 已删 */ }
  }

  if (pageErrors.length) {
    line(`\n[页面异常] ${pageErrors.join(' | ')}`);
    fails.push('出现未捕获页面异常');
  }
  if (report.errors.length) fails.push(report.errors.join(' | '));

  if (!process.env.PROBE_KEEP) await browser.close();
  server.close();
  line(`\n==== ${fails.length ? '有问题: ' + fails.join(' | ') : '跑完，无异常'} ====`);
  process.exit(fails.length ? 1 : 0);
})();
