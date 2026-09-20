'use strict';
/* 真·页面复现：子页面「保存到首页」弹了「保存失败」但实际存进去了（2026-09-20 晚用户报）。
   抓：保存流程里出现的**每一条 toast**、console 报错、请求结果、最终库里有什么。
   分两种身份跑：① 设了当前用户（张三）② 没设（未设置，与用户截图一致）。
   前置：cd publish && PROXY_OFFLINE=1 PROXY_PORT=3026 PROXY_QUERIES_DB=/tmp/dup-test.db node proxy.js */
const { chromium } = require('../../vendor/playwright-core');

const CHROME = process.env.SMOKE_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.PROBE_URL || 'http://127.0.0.1:3026';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-proxy-server'] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 160)); });

  const inject = () => page.evaluate(() => {
    const P = [
      { userId: '1001', userName: '张三', orgId: '1645A', orgName: '中银软开', teamId: 'K4229', teamName: '开发一部' },
    ];
    window.UserApi = {
      fetchUserList: async (kw) => ({ ok: true, list: P.filter((u) => u.userName.includes(String(kw || '').trim())) }),
      fetchUserDetail: async (id) => ({ ok: true, user: P.find((u) => u.userId === String(id || '').trim()) || null }),
    };
    // 被动收集 toast（只观察 DOM，不干预交互）
    if (!window.__toasts) {
      window.__toasts = [];
      const grab = () => {
        document.querySelectorAll('.toast, [class*=toast]').forEach((t) => {
          const s = (t.textContent || '').trim();
          if (s && window.__toasts[window.__toasts.length - 1] !== s) window.__toasts.push(s);
        });
      };
      new MutationObserver(grab).observe(document.body, { childList: true, subtree: true, characterData: true });
    }
  });

  /** 首页选人（可选） */
  async function pickUser(name) {
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    inject();
    await page.waitForTimeout(600);
    const sw = page.locator('#btnUserChange').first();
    if (await sw.isVisible().catch(() => false)) { await sw.click(); await page.waitForTimeout(400); }
    const box = '#userKeyword ~ .searchable-select .searchable-select-input';
    await page.click(box);
    await page.type(box, name);
    await page.waitForTimeout(500);
    await page.locator('.searchable-select-option', { hasText: name }).first().click();
    await page.waitForTimeout(400);
  }

  /** 发布页真点保存：填条件 → 点「保存到首页」→ 弹窗打字 → 确认 → 等 toast */
  async function saveOnPublish(name) {
    await page.goto(BASE + '/publish', { waitUntil: 'load' });
    inject();
    await page.waitForTimeout(800);
    await page.fill('#f_serviceName', '服务Y');
    await page.click('text=保存到首页');
    await page.waitForTimeout(500);
    const dlgInput = page.locator('.dlg-util-overlay input[type=text]').first();
    await dlgInput.fill('');
    await dlgInput.type(name);
    await page.locator('.dlg-util-overlay .sub-foot .filled, .dlg-util-overlay button:has-text("确定")').first().click();
    await page.waitForTimeout(1500);   // 等 toast 出现 + 网络落定
    return page.evaluate(() => window.__toasts.slice());
  }

  console.log('── 场景① 设了当前用户（张三）');
  await pickUser('张三');
  console.log('toast 序列:', JSON.stringify(await saveOnPublish('张三的服务Y'), null, 0));

  console.log('── 场景② 未设置当前用户');
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  inject();
  await page.evaluate(() => window.CurrentUser && window.CurrentUser.clear());   // 清身份（探针专用，模拟"未设置"）
  await page.waitForTimeout(400);
  console.log('toast 序列:', JSON.stringify(await saveOnPublish('没身份的服务Y'), null, 0));

  console.log('── 最终库内容');
  console.log(await page.evaluate(async () => {
    const r = await fetch('/local/saved-queries').then((x) => x.json()).catch((e) => ({ err: String(e) }));
    return JSON.stringify((r.data && r.data.items || []).map((i) => ({ id: i.id.slice(-6), name: i.name, owner: i.owner && i.owner.userName })));
  }));

  await browser.close();
})().catch((e) => { console.error('探针炸了:', e); process.exit(1); });
