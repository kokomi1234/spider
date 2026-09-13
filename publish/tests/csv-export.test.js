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
