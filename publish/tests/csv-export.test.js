/**
 * csv-export.js 单测：csvCell 转义、download 的列映射与 BOM/CRLF、
 * downloadRows 的模块缺失保护。
 * 用 stub 捕获 Blob 内容，不真的下载文件。
 */
'use strict';

const { loadScript, test } = require('./harness');
const assert = require('assert');

// 捕获 download 写出的内容：stub Blob / URL / document
const captured = { text: null, filename: null, type: null };

class FakeBlob {
  constructor(parts, opts) {
    captured.text = parts.join('');
    captured.type = opts && opts.type;
  }
}

const anchor = {
  href: '',
  download: '',
  click() { captured.filename = this.download; },
  remove() {},
};

const globals = {
  document: {
    createElement: () => anchor,
    body: { appendChild() {}, removeChild() {} },
  },
  Blob: FakeBlob,
  URL: { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} },
  setTimeout: () => {},
};

const Csv = loadScript('js/ui/csv-export.js', globals).CsvExporter;

test('csvCell：空值、普通值、需转义的三种字符', () => {
  assert.strictEqual(Csv.csvCell(null), '');
  assert.strictEqual(Csv.csvCell(undefined), '');
  assert.strictEqual(Csv.csvCell('plain'), 'plain');
  assert.strictEqual(Csv.csvCell('a,b'), '"a,b"', '含逗号要加引号');
  assert.strictEqual(Csv.csvCell('say "hi"'), '"say ""hi"""', '内部引号要翻倍');
  assert.strictEqual(Csv.csvCell('l1\nl2'), '"l1\nl2"', '含换行要加引号');
});

test('download：表头、列顺序、缺字段填空、BOM + CRLF', () => {
  Csv.download(
    [{ a: 1, b: 'x,y' }, { a: 2 }],
    [['a', '列A'], ['b', '列B']],
    'f.csv',
  );
  assert.strictEqual(captured.filename, 'f.csv');
  // lines.join('\r\n')：行间 CRLF，末行无换行；开头带 UTF-8 BOM 供 Excel 识别
  assert.strictEqual(captured.text, '﻿列A,列B\r\n1,"x,y"\r\n2,');
  assert.ok(captured.type.includes('utf-8'), 'charset 要带 utf-8，否则中文乱码');
});

test('download：只导出 columns 声明的字段，多余字段丢弃', () => {
  Csv.download([{ a: 'A', z: '不该出现' }], [['a', '列A']], 'g.csv');
  assert.strictEqual(captured.text, '﻿列A\r\nA');
  assert.ok(!captured.text.includes('不该出现'));
});

test('downloadRows：走 download，文件名与列映射一致', () => {
  Csv.downloadRows([{ a: 'q' }], [['a', 'A']], 'h.csv');
  assert.strictEqual(captured.filename, 'h.csv');
  assert.strictEqual(captured.text, '﻿A\r\nq');
});

test('downloadRows：模块缺失时给出提示且不抛异常（降级不静默）', () => {
  const win = loadScript('js/ui/csv-export.js', globals);
  const downloadRows = win.CsvExporter.downloadRows;
  let warned = null;
  win.toast = (msg) => { warned = msg; };
  delete win.CsvExporter; // 模拟脚本没加载 / 被清掉

  assert.doesNotThrow(() => downloadRows([{ a: 1 }], [['a', 'A']], 'x.csv'));
  assert.ok(warned && String(warned).includes('导出模块未加载'), '应提示导出模块未加载');
});

// ══════════════════════════════════════════════════════════
// fetchAllPages：导出用的「按页拉全 + 进度 + 取消」
// ══════════════════════════════════════════════════════════
//
// 任务单页导出 5000 条 = 串行 10 次请求，是页面里最长的一个动作。
// 原先只有按钮文案「导出中…」：看不到进展、也停不下来。
// 这段循环放在 csv-export.js 里（而不是长在 task.js 的闭包中）就是为了让
// 「取消 / 中途失败 / 正好拉完 / 超过上限」这些分支在 node 侧能被测到。

/** 造一个按页给数据的假接口：total 条、每页 pageSize 条 */
const pageFetcher = (total, opts = {}) => {
  const pageSize = opts.pageSize || 500;
  const calls = [];
  const fn = async (p, size) => {
    calls.push(p);
    if (opts.failAt && opts.failAt === p) return { ok: false, error: opts.error || 'HTTP 500' };
    if (opts.emptyAt && opts.emptyAt === p) return { ok: true, rows: [], total };
    const start = (p - 1) * size;
    const rows = [];
    for (let i = start; i < Math.min(start + size, total); i++) rows.push({ n: i });
    return { ok: true, rows, total };
  };
  fn.calls = calls;
  return fn;
};

test('fetchAllPages：按页拉全，页数与条数都对，进度按页递增', async () => {
  const seen = [];
  const r = await Csv.fetchAllPages(pageFetcher(1200), {
    total: 1200, pageSize: 500, max: 5000, onProgress: (p) => seen.push(p.done),
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.rows.length, 1200, '不足一页的尾巴也要收进来');
  assert.deepStrictEqual(seen, [500, 1000, 1200], '进度按累计条数报');
  assert.strictEqual(r.truncated, false, '没超上限不该报截断');
});

test('fetchAllPages：超过 max 只取前 max 条，并标出被截断', async () => {
  const r = await Csv.fetchAllPages(pageFetcher(90000), { total: 90000, pageSize: 500, max: 5000 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.rows.length, 5000);
  assert.strictEqual(r.truncated, true, '页面要靠它决定提示文案');
});

test('fetchAllPages：服务端提前给空页就停（不能死循环）', async () => {
  const f = pageFetcher(600, { emptyAt: 2 });
  const r = await Csv.fetchAllPages(f, { total: 9999, pageSize: 500, max: 5000 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.rows.length, 500, 'total 报大了就以实际拿到的为准');
  assert.deepStrictEqual(f.calls, [1, 2], '空页之后不该继续请求');
});

test('fetchAllPages：某一页失败 → ok:false 并带上原因，不返回半截数据当成功', async () => {
  const r = await Csv.fetchAllPages(pageFetcher(2000, { failAt: 2 }), { total: 2000, pageSize: 500 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'HTTP 500');
  assert.strictEqual(r.rows, undefined, '失败时不该给 rows，免得调用方把半截结果导出去');
});

test('fetchAllPages：取消信号在请求之间生效 → aborted:true，且不算失败', async () => {
  const ctl = new AbortController();
  const f = pageFetcher(3000);
  const r = await Csv.fetchAllPages(f, {
    total: 3000, pageSize: 500,
    signal: ctl.signal,
    onProgress: () => { ctl.abort(); },   // 用户在第一页回来后按了「取消导出」
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.aborted, true, '中止要能跟故障区分开，否则提示成「导出失败」');
  assert.deepStrictEqual(f.calls, [1], '中止后不该再发下一页');
});

test('fetchAllPages：中止发生在在途请求里（接口因中止而报错）也不算失败', async () => {
  const ctl = new AbortController();
  const f = async () => {
    ctl.abort();                                        // fetch 被中断
    return { ok: false, error: 'signal is aborted without reason' };
  };
  const r = await Csv.fetchAllPages(f, { total: 100, signal: ctl.signal });
  assert.strictEqual(r.aborted, true, '接口把中止报成错误时，以 signal 为准');
  assert.strictEqual(r.error, undefined);
});

test('fetchAllPages：入参畸形（没有取数函数 / total=0 / 负数 max）都不抛', async () => {
  assert.strictEqual((await Csv.fetchAllPages(null, { total: 10 })).ok, false);
  const empty = await Csv.fetchAllPages(pageFetcher(0), { total: 0 });
  assert.deepStrictEqual({ ok: empty.ok, want: empty.want, rows: empty.rows }, { ok: true, want: 0, rows: [] });
  const bad = await Csv.fetchAllPages(pageFetcher(3), { total: 3, pageSize: -5, max: 0 });
  assert.strictEqual(bad.ok, true, 'pageSize/max 非法要退回默认值而不是把循环写崩');
});

test('fetchAllPages：进度回调抛错不该影响导出', async () => {
  const r = await Csv.fetchAllPages(pageFetcher(600), {
    total: 600, pageSize: 500, onProgress: () => { throw new Error('渲染崩了'); },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.rows.length, 600);
});
