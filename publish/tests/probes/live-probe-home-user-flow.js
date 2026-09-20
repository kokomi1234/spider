'use strict';
/* 真·页面端到端：一切都在浏览器里**真打字、真点按钮**，不调 SavedQuery 的 API 走捷径。
   ────────────────────────────────────────────────────────────────
   为什么要有它：2026-09-20 用户报「用户查询框第一个字被吞、根本没法输入工号」，
   而我的旧探针都是 page.evaluate 里直接调 API —— 那种测法**结构上就发现不了**这个 bug。
   这个文件专门盯"人在页面上真的敲了一遍"会发生什么。

   前置：cd publish && PROXY_OFFLINE=1 PROXY_PORT=3013 PROXY_QUERIES_DB=/tmp/xxx.db node proxy.js
   运行：node tests/probes/live-probe-home-user-flow.js
   只打印事实，不做断言；看的是「输入框里最后留下什么」。 */
const { chromium } = require('../../vendor/playwright-core');

const CHROME = process.env.SMOKE_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.PROBE_URL || 'http://127.0.0.1:3013';

const j = (v) => JSON.stringify(v);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(800);

  // mock 几个可查的人（否则内网接口在开发机不可达）
  await page.evaluate(() => {
    const P = [
      { userId: '4711510', userName: '郑梓辉', orgId: '1645A', orgName: '中国银行软件中心（深圳）', teamId: 'K4229', teamName: '中国银行软件中心（深圳）开发三部' },
      { userId: '6464402', userName: '吴树海', orgId: '1645A', orgName: '中国银行软件中心（深圳）', teamId: 'K4229', teamName: '中国银行软件中心（深圳）开发三部' },
      { userId: '8404725', userName: '魏甜甜', orgId: '1645A', orgName: '中国银行软件中心（西安）', teamId: 'K5001', teamName: '中国银行软件中心（西安）开发一部' },
    ];
    window.__mockPeople = P;
    window.UserApi = {
      fetchUserList: async (kw) => ({ ok: true, list: P.filter((u) => u.userName.includes(String(kw || '').trim())) }),
      fetchUserDetail: async (id) => ({ ok: true, user: P.find((u) => u.userId === String(id || '').trim()) || null }),
    };
    window.CurrentUser.clear();
    window.HomePage.render();
  });
  await page.waitForTimeout(400);

  const boxSel = '#userKeyword ~ .searchable-select .searchable-select-input';
  const boxVal = () => page.inputValue(boxSel).catch(() => '(读不到)');
  const panelCount = () => page.evaluate(() => {
    const b = document.querySelector('#userKeyword ~ .searchable-select .searchable-select-input');
    const p = b && document.getElementById(b.getAttribute('aria-controls'));
    return p ? p.querySelectorAll('.searchable-select-option').length : -1;
  });

  console.log('\n===== ① 真键盘敲工号（用户报「根本没法输入工号」）=====');
  await page.click(boxSel);
  await page.waitForTimeout(150);
  await page.type(boxSel, '4711510', { delay: 90 });
  await page.waitForTimeout(120);
  console.log('敲完 "4711510" 后输入框里实际是 →', j(await boxVal()), '（应当是完整的 4711510）');

  console.log('\n===== ② 真键盘敲姓名 =====');
  await page.fill(boxSel, '');
  await page.waitForTimeout(120);
  await page.type(boxSel, '郑梓辉', { delay: 90 });
  await page.waitForTimeout(500);
  console.log('敲完 "郑梓辉" 后输入框里 →', j(await boxVal()));
  console.log('候选数 →', await panelCount());

  console.log('\n===== ③ 只敲 1 个字母，看会不会被吞 =====');
  await page.fill(boxSel, '');
  await page.waitForTimeout(150);
  await page.type(boxSel, 'a', { delay: 120 });
  await page.waitForTimeout(120);
  console.log('敲 1 个 "a" 后输入框里 →', j(await boxVal()), '（应当是 "a"）');

  console.log('\n===== ④ 只敲 1 个数字（以前这里就被清掉了）=====');
  await page.fill(boxSel, '');
  await page.waitForTimeout(150);
  await page.type(boxSel, '4', { delay: 120 });
  await page.waitForTimeout(120);
  console.log('敲 1 个 "4" 后输入框里 →', j(await boxVal()), '（应当是 "4"）');
  await page.type(boxSel, '711510', { delay: 90 });
  await page.waitForTimeout(150);
  console.log('接着敲完 "4711510" →', j(await boxVal()), '（应当完整）');

  console.log('\n===== ⑤ 点候选（真点击）→ 设成当前用户 =====');
  await page.waitForTimeout(500);
  const opts = await page.$$('#userKeyword ~ .searchable-select .searchable-select-dropdown .searchable-select-option');
  console.log('面板里的候选数 →', opts.length);
  if (opts.length) {
    console.log('第一项文案 →', j((await opts[0].textContent() || '').trim()));
    await opts[0].click();
    await page.waitForTimeout(400);
  }
  console.log('设完后当前用户 →', j(await page.evaluate(() => {
    const u = window.CurrentUser.get();
    return u ? (u.userName + '/' + u.userId) : null;
  })));
  console.log('身份条显示 →', j(await page.evaluate(() => (document.getElementById('userLabel') || {}).textContent || '')));
  console.log('输入表单是否收起 →', await page.evaluate(() => document.getElementById('userForm').hidden));

  console.log('\n===== ⑥ 去发布页真保存一条（真点按钮、真填弹窗）=====');
  await page.goto(BASE + '/publish.html', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const hasSaveBtn = await page.$('#btnSaveQuery');
  console.log('发布页有「保存到首页」按钮 →', !!hasSaveBtn);
  if (hasSaveBtn) {
    await hasSaveBtn.click();
    await page.waitForTimeout(500);
    const dlgInput = await page.$('.dlg-util-overlay input');
    console.log('命名弹窗里的默认名 →', j(dlgInput ? await dlgInput.inputValue() : '(没弹窗)'));
    if (dlgInput) {
      await dlgInput.fill('探针-页面存的一条');
      await page.evaluate(() => {
        const ov = document.querySelector('.dlg-util-overlay');
        const ok = ov && ov.querySelector('.sub-foot .filled');
        if (ok) ok.click();
      });
      await page.waitForTimeout(900);
    }
    console.log('保存后本机那条的 owner →', j(await page.evaluate(() => {
      const it = window.SavedQuery.list().find((x) => x.name === '探针-页面存的一条');
      return it ? ((it.owner && (it.owner.userName + '/' + it.owner.userId)) || 'owner 为空 ⚠️') : '(没存上)';
    })));
  }

  console.log('\n===== ⑦ 回首页，看「我的常用查询」=====');
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  console.log('标题 →', j(await page.evaluate(() => (document.getElementById('savedTitle') || {}).textContent || '')));
  console.log('计数 →', j(await page.evaluate(() => (document.getElementById('savedCount') || {}).textContent || '')));
  console.log('我的卡片 →', j(await page.evaluate(() => [...document.querySelectorAll('#savedList .saved-item .saved-name')].map((e) => e.textContent))));
  console.log('空态文案（若为空）→', j(await page.evaluate(() => {
    const e = document.getElementById('savedEmpty');
    return e && !e.hidden ? e.textContent : '';
  })));
  console.log('部门区卡片 →', j(await page.evaluate(() => [...document.querySelectorAll('#deptList .saved-item .saved-name')].map((e) => e.textContent))));

  console.log('\n===== ⑧ 切到另一个人（真操作：点「切换用户」再搜索）=====');
  await page.click('#btnUserChange');
  await page.waitForTimeout(300);
  await page.click(boxSel);
  await page.type(boxSel, '吴树海', { delay: 90 });
  await page.waitForTimeout(700);
  const opts2 = await page.$$('#userKeyword ~ .searchable-select .searchable-select-dropdown .searchable-select-option');
  console.log('切人时候选数 →', opts2.length);
  if (opts2.length) {
    await opts2[0].click();
    await page.waitForTimeout(1500);
  }
  console.log('切完标题 →', j(await page.evaluate(() => (document.getElementById('savedTitle') || {}).textContent || '')));
  console.log('切完计数 →', j(await page.evaluate(() => (document.getElementById('savedCount') || {}).textContent || '')));
  console.log('切完我的卡片 →', j(await page.evaluate(() => [...document.querySelectorAll('#savedList .saved-item .saved-name')].map((e) => e.textContent))));
  console.log('切完空态 →', j(await page.evaluate(() => {
    const e = document.getElementById('savedEmpty');
    return e && !e.hidden ? e.textContent : '';
  })));

  await browser.close();
})();
