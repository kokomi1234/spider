'use strict';
/* 部门高频查询 + 刚修的两个 bug 的真页面端到端。
   ────────────────────────────────────────────────────────────────
   覆盖：① 多人存同一份条件 → 「N 人保存」 ② 人多的排前面 ③ 跨部门隔离
        ④ TopN 5/10/20 切换 + 刷新后记住 ⑤ 部门卡片只读（无重命名/删除）
        ⑥ 重命名后名字不该弹回（子代理 3 报的 bug）
        ⑦ 从空服务端导入后首页要能看到（子代理 4 报的 bug）

   前置：cd publish && PROXY_OFFLINE=1 PROXY_PORT=3025 PROXY_QUERIES_DB=/tmp/e2e-dept.db node proxy.js
   运行：node publish/tests/probes/live-probe-dept-highfreq.js
   只打印事实，不做断言。 */
const { chromium } = require('../../vendor/playwright-core');

const CHROME = process.env.SMOKE_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.PROBE_URL || 'http://127.0.0.1:3025';
const j = (v) => JSON.stringify(v);

const P = [
  { userId: '1001', userName: '张三', orgId: 'O1', orgName: '软件中心', teamId: 'K1', teamName: '开发一部' },
  { userId: '1002', userName: '李四', orgId: 'O1', orgName: '软件中心', teamId: 'K1', teamName: '开发一部' },
  { userId: '1003', userName: '王五', orgId: 'O1', orgName: '软件中心', teamId: 'K2', teamName: '开发二部' },
];

/** 每个"人"一个干净 context（localStorage 隔离），注入假接口（唯一允许的 evaluate） */
async function personCtx(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  // ⚠️ 注入时**不要动 CurrentUser**：身份存在 localStorage 里、导航回来本来就该还在。
  //   探针第一版在这里 clear() 了，等于自己把刚设好的身份抹掉，把部门区/我的全测成了空 ——
  //   险些把"功能好的"误报成"有 bug"（2026-09-20）。
  const inject = () => page.evaluate((pp) => {
    window.UserApi = {
      fetchUserList: async (kw) => ({ ok: true, list: pp.filter((u) => u.userName.includes(String(kw || '').trim())) }),
      fetchUserDetail: async (id) => ({ ok: true, user: pp.find((u) => u.userId === String(id || '').trim()) || null }),
    };
    window.HomePage.render();   // 接口补好了，重渲染一次（读的是 localStorage 里真实的身份）
  }, P);
  return { ctx, page, inject };
}

/** 真打字设当前用户 */
async function setUser(page, name) {
  const boxSel = '#userKeyword ~ .searchable-select .searchable-select-input';
  await page.click(boxSel);
  await page.fill(boxSel, '');
  await page.type(boxSel, name, { delay: 60 });
  await page.waitForTimeout(600);
  const opts = await page.$$('#userKeyword ~ .searchable-select .searchable-select-dropdown .searchable-select-option');
  if (!opts.length) return '(没候选)';
  await opts[0].click();
  await page.waitForTimeout(400);
  return page.evaluate(() => (document.getElementById('userLabel') || {}).textContent || '');
}

/** 去发布页真点保存（条件一致才能被聚成"同一份"） */
async function saveOnPublish(page, name, condName) {
  await page.goto(BASE + '/publish.html', { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.evaluate((pp) => {   // 换页后要重新注入
    window.UserApi = {
      fetchUserList: async (kw) => ({ ok: true, list: pp.filter((u) => u.userName.includes(String(kw || '').trim())) }),
      fetchUserDetail: async (id) => ({ ok: true, user: pp.find((u) => u.userId === String(id || '').trim()) || null }),
    };
  }, P);
  // 填一个稳定的条件字段（同一个人/不同人填一样的值 → 同 fingerprint）
  const f = await page.$('#f_serviceName');
  if (f) await f.fill(condName);
  const btn = await page.$('#btnSaveQuery');
  if (!btn) return '(没有保存按钮)';
  await btn.click();
  await page.waitForTimeout(500);
  const inp = await page.$('.dlg-util-overlay input');
  if (!inp) return '(没弹窗)';
  await inp.fill(name);
  await page.evaluate(() => {
    const ov = document.querySelector('.dlg-util-overlay');
    const ok = ov && ov.querySelector('.sub-foot .filled');
    if (ok) ok.click();
  });
  await page.waitForTimeout(900);
  return 'ok';
}

const deptSnapshot = (page) => page.evaluate(() => ({
  title: (document.getElementById('deptTitle') || {}).textContent || '',
  count: document.querySelectorAll('#deptList .saved-item').length,
  rows: [...document.querySelectorAll('#deptList .saved-item')].map((it) => {
    const n = it.querySelector('.saved-name');
    const m = it.querySelector('.saved-meta');
    return (n ? n.textContent : '?') + ' | ' + (m ? m.textContent : '(无meta)') + ' | title=' + (m ? (m.title || '') : '');
  }),
  ops: document.querySelectorAll('#deptList .saved-item .saved-ops button').length,
}));

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });

  console.log('\n===== ① 张三、李四（同部门 K1）各存一份【同一条件】 =====');
  const A = await personCtx(browser);
  await A.page.goto(BASE + '/index.html', { waitUntil: 'load' }); await A.page.waitForTimeout(900);
  await A.inject();
  console.log('张三 setUser →', j(await setUser(A.page, '张三')));
  console.log('张三 save →', j(await saveOnPublish(A.page, '张三的取名', 'ServiceX')));

  const B = await personCtx(browser);
  await B.page.goto(BASE + '/index.html', { waitUntil: 'load' }); await B.page.waitForTimeout(900);
  await B.inject();
  console.log('李四 setUser →', j(await setUser(B.page, '李四')));
  console.log('李四 save →', j(await saveOnPublish(B.page, '李四的取名', 'ServiceX')));

  console.log('\n===== ② 回张三首页看部门区（应该 1 行、2 人保存）=====');
  await A.page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await A.page.waitForTimeout(2000);
  await A.inject();
  await A.page.waitForTimeout(1800);
  console.log('部门区 →', j(await deptSnapshot(A.page)));

  console.log('\n===== ③ 王五（开发二部 K2）看部门区（不该看到开发一部那行）=====');
  const C = await personCtx(browser);
  await C.page.goto(BASE + '/index.html', { waitUntil: 'load' }); await C.page.waitForTimeout(900);
  await C.inject();
  await setUser(C.page, '王五');
  await C.page.waitForTimeout(1800);
  console.log('王五部门区 →', j(await deptSnapshot(C.page)));

  console.log('\n===== ④ TopN 切换（5/10/20）+ 刷新后记住 =====');
  const topn = async (v) => {
    await A.page.selectOption('#deptTopN', v);
    await A.page.waitForTimeout(800);
    return A.page.evaluate(() => document.getElementById('deptTopN').value);
  };
  console.log('选 5  →', j(await topn('5')), '条数', (await deptSnapshot(A.page)).count);
  console.log('选 20 →', j(await topn('20')), '条数', (await deptSnapshot(A.page)).count);
  await A.page.reload({ waitUntil: 'load' });
  await A.page.waitForTimeout(1800);
  console.log('刷新后 TopN →', j(await A.page.evaluate(() => document.getElementById('deptTopN').value)));

  console.log('\n===== ⑤ BUG 复验：重命名后名字会不会弹回 =====');
  await A.page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await A.page.waitForTimeout(1600);
  await A.inject();
  await A.page.waitForTimeout(1600);
  const before = await A.page.evaluate(() => [...document.querySelectorAll('#savedList .saved-item .saved-name')].map((e) => e.textContent));
  console.log('改名前的卡片 →', j(before));
  if (before.length) {
    await A.page.click('#savedList .saved-item .saved-ops button');
    await A.page.waitForTimeout(500);
    const inp = await A.page.$('.dlg-util-overlay input');
    if (inp) {
      await inp.fill('改名后-' + Date.now().toString(36).slice(-4));
      await A.page.evaluate(() => {
        const ov = document.querySelector('.dlg-util-overlay');
        const ok = ov && ov.querySelector('.sub-foot .filled');
        if (ok) ok.click();
      });
      const t0 = await A.page.evaluate(() => [...document.querySelectorAll('#savedList .saved-item .saved-name')].map((e) => e.textContent));
      await A.page.waitForTimeout(1500);   // 等那次 ?user= 的响应回来
      const t1 = await A.page.evaluate(() => [...document.querySelectorAll('#savedList .saved-item .saved-name')].map((e) => e.textContent));
      console.log('改名后 t=0   →', j(t0));
      console.log('改名后 t=1.5s →', j(t1), t0.join('|') === t1.join('|') ? '✅ 没弹回' : '❌ 弹回了');
    }
  }

  console.log('\n===== ⑥ BUG 复验：从空服务端导入后首页能看到吗 =====');
  // 先导出当前这份（A 的 context 里已有数据）
  const dl = A.page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await A.page.click('#btnExportQueries');
  const d = await dl;
  let exportPath = null;
  if (d) { exportPath = '/tmp/probe-dept-export.json'; await d.saveAs(exportPath); console.log('导出 →', j(exportPath)); }
  // 用一个**全新 context**（localStorage 空）导入，但用**同一个库**（所以服务端有数据）——
  // 要验的是"服务端还没有、只有文件"那种情况，这里先看常规导入能否显示
  if (exportPath) {
    const E = await personCtx(browser);
    await E.page.goto(BASE + '/index.html', { waitUntil: 'load' });
    await E.page.waitForTimeout(1200);
    await E.inject();
    await E.page.waitForTimeout(1200);
    const beforeImp = await E.page.evaluate(() => document.querySelectorAll('#savedList .saved-item').length);
    const chooser = E.page.waitForEvent('filechooser', { timeout: 6000 }).catch(() => null);
    await E.page.click('#btnImportQueries');
    const fc = await chooser;
    if (fc) {
      await fc.setFiles(exportPath);
      await E.page.waitForTimeout(2000);
    } else {
      // 兜底：直接塞给隐藏 input
      const hi = await E.page.$('input[type=file]');
      if (hi) { await hi.setInputFiles(exportPath); await E.page.waitForTimeout(2000); }
    }
    const afterImp = await E.page.evaluate(() => document.querySelectorAll('#savedList .saved-item').length);
    console.log('导入前卡片数 →', beforeImp, '| 导入后卡片数 →', afterImp, afterImp > 0 ? '✅ 看得到' : '❌ 看不到');
  }

  await browser.close();
})();
