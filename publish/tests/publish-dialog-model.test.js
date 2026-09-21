/**
 * publish-dialog-model.js 单测 —— 发布查询页结果行两个弹窗的**纯逻辑**部分。
 *
 * 为什么这些断言值得写（都是「静默错」那一类，浏览器里看不出来）：
 *   · 列定义里的字段名写错 → 表格照渲染，只是整列都是 '—'（不报错）
 *   · operationType 映射写错 → 显示成别的动作，用户按错误的理解去核对流水
 *   · 未确认的编码被"猜"成中文 → 比少一个映射更坏（看着像真的）
 *   · sortRows 不稳定 → 同 sort 的行序每次刷新都在变
 *
 * 样本字段全部抄自 `操作记录和接口明细.har`（2026-09-21，用户提供），
 * 一个字段都没有编造；编码集合 = 该次抓包 data.rows[] 里真实出现过的值。
 */
'use strict';

const { loadScript, test } = require('./harness');
const assert = require('assert');

const win = loadScript('js/ui/publish-dialog-model.js');
const M = win.PublishDialogModel;

test('PublishDialogModel：暴露预期接口且已冻结', () => {
  ['opTypeLabel', 'opTypeOptions', 'parseIntfDetail', 'sortRows',
    'totalPages', 'pageSlice', 'isMustText', 'blank'].forEach((k) => {
    assert.strictEqual(typeof M[k], 'function', '缺少函数 ' + k);
  });
  ['OP_TYPES', 'OP_COLS', 'MSG_COLS', 'REV_COLS', 'DEPLOY_COLS', 'INTF_TABS'].forEach((k) => {
    assert.ok(M[k], '缺少常量 ' + k);
  });
  assert.strictEqual(Object.isFrozen(M), true, '命名空间必须冻结');
});

// ── 操作类型编码 ────────────────────────────────────────
// 映射来自用户 2026-09-21 抓包分析的编码表（见 publish-dialog-model.js 的 OP_TYPES 注释）。
// 这一版**推翻了**上一版那 5 条猜测映射，所以断言要盯住「推翻后的值」——
// 旧值（12 删除 / 43 修改 / 45 新增 / 50 CHECKIN / 52 CHECKOUT）一条都不许再回来。
test('opTypeLabel：按抓包编码表映射，未覆盖的编码原样返回数字（不猜中文）', () => {
  // 被推翻的 5 条，真名如下
  assert.strictEqual(M.opTypeLabel('12'), '正式版基线');
  assert.strictEqual(M.opTypeLabel('43'), '服务发布-审核人审核通过');
  assert.strictEqual(M.opTypeLabel('45'), '服务发布-归档');
  assert.strictEqual(M.opTypeLabel('50'), '服务订阅-审核人审核通过');
  assert.strictEqual(M.opTypeLabel('52'), '服务订阅-归档');
  // 旧值必须彻底消失（显示成旧动作 = 用户按错误的理解去核对流水）
  [['12', '删除'], ['43', '修改'], ['45', '新增'], ['50', 'CHECKIN'], ['52', 'CHECKOUT']]
    .forEach(([c, old]) => {
      assert.notStrictEqual(M.opTypeLabel(c), old, '编码 ' + c + ' 不该再映射成旧值 ' + old);
    });
  // 真正叫 CHECKOUT / CHECKIN 的是 14 / 15
  assert.strictEqual(M.opTypeLabel('14'), 'CHECKOUT');
  assert.strictEqual(M.opTypeLabel('15'), 'CHECKIN');
  // 抓包那 21 条里出现过的 8 个编码，现在全部有名字
  assert.strictEqual(M.opTypeLabel('17'), '订阅功能测试基线');
  assert.strictEqual(M.opTypeLabel('18'), '订阅正式版基线');
  assert.strictEqual(M.opTypeLabel('47'), '服务订阅-申请人处理');
  // 基线族的两个三元组（映射的结构性证据：错一个编码这里就会露馅）
  assert.deepStrictEqual([10, 11, 12].map(M.opTypeLabel),
    ['开发基线', '功能测试基线', '正式版基线']);
  assert.deepStrictEqual([16, 17, 18].map(M.opTypeLabel),
    ['订阅开发基线', '订阅功能测试基线', '订阅正式版基线']);
  assert.strictEqual(M.opTypeLabel('2'), '订阅');
  assert.strictEqual(M.opTypeLabel('75'), 'CHECKIN作废-流程关闭');
  // 数字入参（后端有时给 number）与带空格的字符串同口径
  assert.strictEqual(M.opTypeLabel(52), '服务订阅-归档');
  assert.strictEqual(M.opTypeLabel(' 43 '), '服务发布-审核人审核通过');
  // 反推的 13 条（名字来自 59 项总表、编码按位置唯一确定）。它们**不是实证**，
  // 但既然写进来了就要守住值 —— 免得以后有人当"猜的"随手改掉或删掉
  assert.strictEqual(M.opTypeLabel('13'), '下线');
  assert.strictEqual(M.opTypeLabel('19'), '订阅下线');
  assert.strictEqual(M.opTypeLabel('29'), '删除接口与文档关系');
  assert.strictEqual(M.opTypeLabel('35'), '订阅基线作废');
  assert.strictEqual(M.opTypeLabel('36'), '订阅基线取消作废');
  assert.deepStrictEqual([41, 44].map(M.opTypeLabel),
    ['服务发布-审核人审核', '服务发布-手动归档']);
  assert.deepStrictEqual([48, 49, 51].map(M.opTypeLabel),
    ['服务订阅-审核人审核', '服务订阅-审核人审核退回', '服务订阅-手动归档']);
  assert.deepStrictEqual([56, 59, 61].map(M.opTypeLabel),
    ['取消订阅-审核人审核', '取消订阅-手动归档', '取消订阅-关闭']);
  // 编码表没覆盖的：原样显示，**不许猜**
  ['1', '9', '32', '999'].forEach((c) => {
    assert.strictEqual(M.opTypeLabel(c), c, '编码 ' + c + ' 没有映射依据，必须原样显示');
  });
  // 反推不出来的名字一律**不许**填编码：它们挤在 22~25 / 64~74 里定不了，
  // 硬填会静默查错数据（看着像真的，比留个数字更坏）
  ['删除', '接口批量更新', '发布', '取消发布', 'UNCHECK', '服务订阅-删除',
    '性能容量-修改', '批量授权',
    '取消订阅时上一批量新增订阅关系审批流程接口材料移除'].forEach((name) => {
    assert.ok(!Object.keys(M.OP_TYPES).some((c) => M.OP_TYPES[c] === name),
      '「' + name + '」的编码没有证据，不该出现在映射表里');
  });
  // 空值
  assert.strictEqual(M.opTypeLabel(null), '—');
  assert.strictEqual(M.opTypeLabel(''), '—');
  assert.strictEqual(M.opTypeLabel(undefined), '—');
});

test('opTypeOptions：首项是「全部」，其余与编码表一一对应、按编码升序', () => {
  const opts = M.opTypeOptions();
  assert.strictEqual(opts[0].value, '', '必须有一个空值项表示「全部」');
  const codes = opts.slice(1).map((o) => o.value);
  const expect = Object.keys(M.OP_TYPES).sort((a, b) => Number(a) - Number(b));
  assert.deepStrictEqual(codes, expect, '下拉项应与 OP_TYPES 的编码集合完全一致且升序');
  assert.strictEqual(new Set(codes).size, codes.length, '编码不能重复');
  codes.forEach((c) => assert.ok(M.OP_TYPES[c], '下拉项 ' + c + ' 没有对应显示名'));
  // 表里没有的编码不许混进下拉（筛选填错编码会静默查出别的数据）
  ['1', '9', '32', '999'].forEach((c) => {
    assert.strictEqual(codes.indexOf(c), -1, '未映射的编码 ' + c + ' 不该出现在筛选下拉里');
  });
  // 来源表里编码 32 是占位符「-」，不写进映射
  assert.strictEqual(M.OP_TYPES['32'], undefined);
});

// ── 列定义必须与抓包字段一一对应 ────────────────────────
test('列定义：字段名逐条对上抓包响应（写错一列就会整列全是「—」）', () => {
  assert.deepStrictEqual(M.OP_COLS.map((c) => c.key),
    ['operationerName', 'createTime', 'operationType', 'subscribeName', 'prodSysServeNo']);

  assert.deepStrictEqual(M.MSG_COLS.map((c) => c.key),
    ['parameter', 'parameterName', 'dictNo', 'length', 'type', 'isMust',
      'remark1', 'remark2', 'remark3']);

  // 修订记录两张表共用一套列：字段来自 interfaceModifyList 的真实键
  // （vsn / modifyDetail / modifyDate / modifier / prodBatch / serverNo 都实测存在）
  assert.deepStrictEqual(M.REV_COLS.map((c) => c.label),
    ['版本号', '修订内容', '修订日期', '修订人', '备注', '批次', '任务编号']);

  assert.deepStrictEqual(M.DEPLOY_COLS.map((c) => c.key), ['gatewayCode', 'context']);
});

test('INTF_TABS：5 个 tab 的顺序与响应数组名（抓包里的键）', () => {
  assert.deepStrictEqual(M.INTF_TABS.map((t) => t.label),
    ['请求报文', '响应报文', '文档级修订记录', '接口级修订记录', '应用系统服务部署']);
  assert.deepStrictEqual(M.INTF_TABS.map((t) => t.source),
    ['childReqList', 'childRespList', 'revisionList', 'interfaceModifyList', 'deployList']);
  // 报文两张表列数一致（抓包里两个数组的字段完全相同）
  assert.deepStrictEqual(M.INTF_TABS[0].cols, M.INTF_TABS[1].cols);
  // 修订两张表列数一致（成对的兄弟表）
  assert.deepStrictEqual(M.INTF_TABS[2].cols, M.INTF_TABS[3].cols);
});

test('parseIntfDetail：按 5 个数组归行；缺键补空数组；lists 为 null 全空（区分「没有」与「没拿到」）', () => {
  const lists = {
    childReqList: [{ parameter: 'bancsCustNo', sort: 1 }],
    childRespList: [{ parameter: 'rsltCode', sort: 0 }],
    interfaceModifyList: [{ vsn: 'V1.0' }],
    // revisionList / deployList 缺席 —— 后端偶尔不返回空数组
  };
  const out = M.parseIntfDetail(lists);
  assert.deepStrictEqual(Object.keys(out).sort(),
    ['deploy', 'docRev', 'intfRev', 'req', 'resp']);
  assert.strictEqual(out.req.length, 1);
  assert.strictEqual(out.resp.length, 1);
  assert.strictEqual(out.intfRev.length, 1);
  assert.deepStrictEqual(out.docRev, [], '缺席的数组要补成空数组，不能是 undefined');
  assert.deepStrictEqual(out.deploy, []);

  // lists 为 null：接口没配上 / 没拿到数据 → 全空，调用方据此显示「失败」而不是「没有数据」
  const none = M.parseIntfDetail(null);
  Object.keys(none).forEach((k) => assert.deepStrictEqual(none[k], []));
  // 键存在但值不是数组（后端返 null）也不能抛
  assert.deepStrictEqual(M.parseIntfDetail({ childReqList: null }).req, []);
});

test('sortRows：按 sort 升序；没有 sort 的排最后；同 sort 保持后端原序（稳定）', () => {
  const rows = [
    { id: 'a', sort: 2 },
    { id: 'b' },                 // 抓包实证：interfaceModifyList 的 sort 是 null
    { id: 'c', sort: 0 },
    { id: 'd', sort: null },
    { id: 'e', sort: 2 },        // 与 a 同 sort → 谁在前保持原序
    { id: 'f', sort: '1' },      // 字符串数字也要能比
  ];
  assert.deepStrictEqual(M.sortRows(rows).map((r) => r.id), ['c', 'f', 'a', 'e', 'b', 'd']);
  assert.deepStrictEqual(M.sortRows([]), []);
  assert.deepStrictEqual(M.sortRows(null), []);
  // 不改动入参数组的顺序（原先踩过「边排边改」导致多次渲染结果不同）
  assert.strictEqual(rows[0].id, 'a');
});

// ── 分页口径 ────────────────────────────────────────────
test('totalPages：0 条也至少 1 页（与全站「第 1 / 1 页」一致）', () => {
  assert.strictEqual(M.totalPages(0, 10), 1);
  assert.strictEqual(M.totalPages(1, 10), 1);
  assert.strictEqual(M.totalPages(10, 10), 1);
  assert.strictEqual(M.totalPages(11, 10), 2);
  assert.strictEqual(M.totalPages(21, 10), 3);
  // 脏入参不抛、不返回 NaN
  assert.strictEqual(M.totalPages(null, 10), 1);
  assert.strictEqual(M.totalPages(21, 0), 21);
});

test('pageSlice：页码越界要夹取（别切出空白页）', () => {
  const rows = Array.from({ length: 21 }, (_, i) => ({ i }));
  assert.deepStrictEqual(M.pageSlice(rows, 1, 10).map((r) => r.i),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepStrictEqual(M.pageSlice(rows, 3, 10).map((r) => r.i), [20]);
  // 超出末页 → 夹到末页；小于 1 → 第 1 页
  assert.deepStrictEqual(M.pageSlice(rows, 99, 10).map((r) => r.i), [20]);
  assert.deepStrictEqual(M.pageSlice(rows, 0, 10).map((r) => r.i).length, 10);
  assert.deepStrictEqual(M.pageSlice([], 1, 10), []);
});

// ── 显示口径 ────────────────────────────────────────────
test('isMustText：是/否 收敛成中文，M/O/1/0 这类也认，未知值原样透出', () => {
  assert.strictEqual(M.isMustText('是'), '是');
  assert.strictEqual(M.isMustText('M'), '是');
  assert.strictEqual(M.isMustText('Y'), '是');
  assert.strictEqual(M.isMustText('否'), '否');
  assert.strictEqual(M.isMustText('O'), '否');
  assert.strictEqual(M.isMustText('N'), '否');
  assert.strictEqual(M.isMustText(null), '—');
  assert.strictEqual(M.isMustText(''), '—');
  // 未知值不许吞掉：原样显示，用户才能看出后端换了口径
  assert.strictEqual(M.isMustText('待定'), '待定');
});

test('blank：空值统一显示 —，但 0 与 false 必须保留（0 是有效取值）', () => {
  assert.strictEqual(M.blank(null), '—');
  assert.strictEqual(M.blank(undefined), '—');
  assert.strictEqual(M.blank(''), '—');
  assert.strictEqual(M.blank(0), 0);
  assert.strictEqual(M.blank(false), false);
  assert.strictEqual(M.blank('E00301TPC303'), 'E00301TPC303');
});

test('真实样本：抓包的 4 类行按各自列定义都能取到值（不是整列全是「—」）', () => {
  // 摘自 操作记录和接口明细.har 的真实行
  const req = {
    parameter: 'bancsCustNo', parameterName: '核心客户号', dictNo: '', length: '16',
    type: 'String', isMust: '是', remark1: '', remark2: '', remark3: '', messageType: '1', sort: 0,
  };
  const rev = {
    vsn: '', modifyDetail: '新增接口', modifyDate: '2026-07-17', modifier: '崔丹',
    assessor: '', prodBatch: null, serverNo: null, sort: null,
  };
  const deploy = { gatewayCode: 'E00306GWG001', context: 'E00306CTX', sort: 0 };
  const op = {
    operationerName: '杨彤', createTime: '2026-09-09 16:29:37', operationType: '52',
    subscribeName: 'E00301-互联网金融服务平台-BOCNET-G-IFS', prodSysServeNo: 'E00301TPC303',
  };

  const cell = (cols, r) => cols.map((c) => {
    const raw = c.get ? c.get(r) : r[c.key];
    const val = c.fmt ? c.fmt(raw) : raw;
    return M.blank(val);
  });

  assert.deepStrictEqual(cell(M.MSG_COLS, req),
    ['bancsCustNo', '核心客户号', '—', '16', 'String', '是', '—', '—', '—']);
  // 修订记录表按候选键取，取不到（vsn 为空串、批次/任务编号为 null）显示 '—'，不吞掉有值的那几列
  assert.deepStrictEqual(cell(M.REV_COLS, rev),
    ['—', '新增接口', '2026-07-17', '崔丹', '—', '—', '—']);
  assert.deepStrictEqual(cell(M.DEPLOY_COLS, deploy), ['E00306GWG001', 'E00306CTX']);
  assert.deepStrictEqual(cell(M.OP_COLS, op),
    ['杨彤', '2026-09-09 16:29:37', '服务订阅-归档', 'E00301-互联网金融服务平台-BOCNET-G-IFS', 'E00301TPC303']);
});
