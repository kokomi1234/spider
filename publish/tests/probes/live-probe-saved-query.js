/* 联调诊断：走**真实代理 + 真实后端**，打印「保存到首页」这条链路的实际文本。
   ────────────────────────────────────────────────────────────────
   为什么要它：本轮修的是「摘要/默认名显示编号而不是名称」，而这类问题
   **只能连真实字典才验得出来** —— 离线冒烟里批次选项为空，label 拿不到，
   代码会正确地回落到编号，测试照样全绿，问题却还在。

   它不做断言（真实数据的名称会变），只把关键文本打出来给人看：
     · 下拉选中后原生 value（编号）vs 组件 label（名称）
     · 命名弹窗的默认名
     · 落库记录的 name / summary / labels / v

   前置：`cd publish && node proxy.js`（端口 3000），且后端可达。
   运行：SMOKE_CHROME_PATH="<chrome路径>" node tests/probes/live-probe-saved-query.js
   注意：它会在页面上真的点一次「保存到首页」，会往 localStorage 写一条测试记录。 */
'use strict';
const path = require('path');
const { chromium } = require('../../vendor/playwright-core');

const CHROME = process.env.SMOKE_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.VERIFY_URL || 'http://localhost:3000/publish.html';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  const out = {};

  page.on('pageerror', (e) => { out.pageError = e.message; });

  await page.goto(URL, { waitUntil: 'load', timeout: 20000 });
  await page.waitForTimeout(3500); // 等字典接口返回并建好下拉

  // 选批次：点开下拉 → 选第一个选项
  async function pickFirst(sel) {
    const input = await page.$(sel + ' + div .searchable-select-input, ' + sel + ' ~ div .searchable-select-input');
    if (!input) return { err: 'no input for ' + sel };
    await input.click();
    await page.waitForTimeout(500);
    const opt = await page.$('.searchable-select-dropdown .searchable-select-option');
    if (!opt) return { err: 'no option for ' + sel };
    const text = (await opt.textContent() || '').trim();
    await opt.click();
    await page.waitForTimeout(300);
    return { picked: text };
  }

  out.batch = await pickFirst('#f_prodBatch');

  // 提供方系统（先看它是不是 searchable-select）
  const provIsSS = await page.$('#f_provideSystemNumber + div .searchable-select-input');
  if (provIsSS) out.provider = await pickFirst('#f_provideSystemNumber');
  else {
    const v = await page.$eval('#f_provideSystemNumber', (el) => el.value);
    out.provider = { native: v };
  }

  // 记录当前原生 value（编号）与摘要生成所依赖的实例文本
  out.rawValues = await page.evaluate(() => ({
    batch: (document.getElementById('f_prodBatch') || {}).value,
    provider: (document.getElementById('f_provideSystemNumber') || {}).value,
  }));

  // 点保存 → 读弹窗默认名
  await page.click('#btnSaveQuery');
  await page.waitForTimeout(600);
  out.promptDefault = await page.evaluate(() => {
    const ov = document.querySelector('.dlg-util-overlay');
    const inp = ov && ov.querySelector('input');
    return inp ? inp.value : null;
  });

  // 点确认保存，再读存储里的记录
  await page.evaluate(() => {
    const ov = document.querySelector('.dlg-util-overlay');
    if (ov) ov.querySelector('.sub-foot .filled').click();
  });
  await page.waitForTimeout(600);

  out.record = await page.evaluate(() => {
    const S = window.SavedQuery;
    if (!S) return { err: 'SavedQuery 未加载' };
    const it = S.list()[0];
    return it ? { name: it.name, summary: it.summary, labels: it.labels, v: it.v, fields: it.fields } : null;
  });

  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
