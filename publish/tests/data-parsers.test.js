/**
 * 字典解析器单测（js/data/*.js）。
 *
 * 这三个解析器把后端响应变成下拉选项，**响应形态对不上时会静默变成空下拉**，
 * 页面看起来只是「没有数据」，很难自查。项目历史上也正因字段猜错踩过坑
 * （getOrgTreeList 的 value/key、批次 label 的 4 种写法），所以按抓包样本钉死。
 */
'use strict';

const assert = require('assert');
const { loadScript, test } = require('./harness');

function loadDataModules() {
  const win = {};
  loadScript('js/data/batch-data.js', {}, win);
  loadScript('js/data/provider-data.js', {}, win);
  loadScript('js/data/department-data.js', {}, win);
  return win;
}

test('parseBatchPayload：解析 data.batchList（code 是字符串 "200"）', () => {
  const win = loadDataModules();
  const list = win.parseBatchPayload({
    msg: '查询成功',
    code: '200',
    data: {
      batchList: [
        { label: '2609批次', value: '2609' },
        { label: '26年8月独立', value: '268dl' },
        { label: '2507-仿真', value: '2507' },
      ],
    },
  });
  const labels = list.map((o) => o.label);
  assert.ok(labels.includes('2609批次'));
  assert.ok(labels.includes('26年8月独立'));
  assert.ok(labels.includes('2507-仿真'));
});

test('parseBatchPayload：业务码不对时抛错，不静默返回空列表', () => {
  const win = loadDataModules();
  assert.throws(() => win.parseBatchPayload({ code: 500, msg: '炸了' }), /炸了|500/);
  assert.throws(() => win.parseBatchPayload(null));
});

test('parseProviderPayload：合并三个列表并按「编号-名称」归一化', () => {
  const win = loadDataModules();
  const list = win.parseProviderPayload({
    code: '200',
    data: {
      phyTechCompList: [{ label: '7×24值班管理系统-T-NCDMS', value: 'T50157', shortEn: 'T-NCDMS' }],
      physicalApplicationComponentList: [{ label: '400客服-知识库系统-BOCKB', value: 'C20032', shortEn: 'BOCKB' }],
      subSystemList: [{ label: '资产负债管理系统-ALMS', value: 'E13300', shortEn: 'ALMS' }],
    },
  });
  assert.strictEqual(list.length, 3);
  const byValue = Object.fromEntries(list.map((o) => [o.value, o.label]));
  assert.strictEqual(byValue.T50157, 'T50157-7×24值班管理系统-T-NCDMS');
  assert.strictEqual(byValue.E13300, 'E13300-资产负债管理系统-ALMS');
});

test('parseProviderPayload：三个列表都解析不出东西时抛错（刻意不返回空下拉）', () => {
  const win = loadDataModules();
  // 模块注释写明：结构不符直接报错，不做猜测性兜底 —— 猜错比报错更难查
  assert.throws(() => win.parseProviderPayload({ code: 200, data: {} }), /未从三个列表中解析出任何提供方系统/);
});

test('parseDepartmentPayload：扁平数组 + value/key（不是 children 树）', () => {
  const win = loadDataModules();
  // 抓包样本：value 是部门名，key 是部门ID —— 与直觉相反，搞反了下拉就没值
  const list = win.parseDepartmentPayload({
    msg: '操作成功',
    code: 200,
    data: [
      { value: '中国银行软件中心党委宣传部（企业文化部）', key: '1628A' },
      { value: '软件中心（深圳）开发三部', key: 'K4229' },
    ],
  });
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].key, '1628A');
  assert.strictEqual(list[0].value, '中国银行软件中心党委宣传部（企业文化部）');
});

test('parseDepartmentPayload：结构不符时抛错（宁可报错也别猜）', () => {
  const win = loadDataModules();
  assert.throws(() => win.parseDepartmentPayload({ code: 200, data: { children: [] } }));
});
