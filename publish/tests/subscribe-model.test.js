/**
 * subscribe-model.js 单测：覆盖从 subscribe-dialog.js 抽出的常量与纯函数。
 * 通过 tests/harness.js 的 loadScript 注入 window 后读取 window.SubscribeModel。
 *
 * 注意：本文件只验证纯函数本身（无 DOM、无行为变更），文案与口径按搬出前的原值钉死。
 */
'use strict';

const { loadScript, test } = require('./harness');
const assert = require('assert');

const win = loadScript('js/ui/subscribe-model.js');
const SM = win.SubscribeModel;

test('SubscribeModel：暴露预期接口且冻结', () => {
  [
    'docId', 'isMemberDoc', 'normalizeDoc', 'filterDocs', 'sortDocs', 'toPickedDetails',
    'displayBatch', 'batchLabel', 'batchSortKey', 'buildDocBatchOptions',
    'pickField', 'normalizeDigits', 'judgeFieldsFromApi', 'roleOptionsWith', 'toServiceNoOptions',
    'deriveCallerServiceNo', 'toJudgeInfoList', 'validateSubscribe', 'validateJudgeSubmit',
    'judgeQueryIsEmpNo', 'judgeSearchOutcome',
    'createUserCache', 'opts',
  ].forEach((k) => assert.strictEqual(typeof SM[k], 'function', '缺少函数 ' + k));
  ['DICT', 'SEARCHABLE_FIELDS', 'DOC_SEARCHABLE_IDS', 'TEXT_FIELDS'].forEach((k) => {
    assert.strictEqual(typeof SM[k], 'object', '缺少常量 ' + k);
  });
  assert.strictEqual(typeof SM.PLACEHOLDER_TEXT, 'string');
  assert.strictEqual(typeof SM.JUDGE_ROW_TEMPLATE, 'string');
  assert.strictEqual(typeof SM.JUDGE_API_KEYS, 'object');
  assert.deepStrictEqual(SM.JUDGE_ROLE_IDS, { 调用方产品负责人: '03', 服务方产品负责人: '05' });
  assert.strictEqual(Object.isFrozen(SM), true);   // 禁止外部改写
});

test('常量：字典 / 字段清单与搬出前一致', () => {
  assert.deepStrictEqual(SM.DICT.mq, [
    { label: 'TDMQ', value: 'TDMQ' },
    { label: 'IBMMQ', value: 'IBMMQ' },
    { label: 'KAFKA', value: 'KAFKA' },
  ]);
  // yesNo 三项（含「无需幂等」），不是普通是否
  assert.strictEqual(SM.DICT.yesNo.length, 3);
  assert.strictEqual(SM.DICT.pageSize[0].label, '10 条');
  assert.deepStrictEqual(SM.DOC_SEARCHABLE_IDS, ['docFilterBatch', 'docPageSize']);
  // 文档子弹窗的两个下拉必须仍在全量清单里，否则没人创建它们的实例
  const ids = SM.SEARCHABLE_FIELDS.map((f) => f.id);
  SM.DOC_SEARCHABLE_IDS.forEach((id) => assert.ok(ids.includes(id), '缺 ' + id));
  // 主弹窗跳过的正好是 doc 那两个，其余 14 个仍归主弹窗
  const mainIds = SM.SEARCHABLE_FIELDS
    .filter((f) => SM.DOC_SEARCHABLE_IDS.indexOf(f.id) < 0).map((f) => f.id);
  assert.strictEqual(mainIds.length, SM.SEARCHABLE_FIELDS.length - 2);
  assert.strictEqual(mainIds.includes('docFilterBatch'), false);
  assert.strictEqual(mainIds.includes('sub_callerSystem'), true);
  assert.strictEqual(SM.TEXT_FIELDS.length, 16);
  assert.ok(SM.TEXT_FIELDS.includes('sub_tpsPeak'));
  assert.strictEqual(SM.PLACEHOLDER_TEXT, '（待抓包补全：此字典接口尚未抓包）');
  // opts 把字符串数组转成 {label,value}
  assert.deepStrictEqual(SM.opts(['A']), [{ label: 'A', value: 'A' }]);
  assert.deepStrictEqual(SM.opts([{ label: 'L', value: 'v' }]), [{ label: 'L', value: 'v' }]);
});

test('displayBatch：作废 / dl 独立 / 纯数字 三类模式 + 兜底', () => {
  // ① 作废批次（精确匹配）
  assert.strictEqual(SM.displayBatch('26n6ydlpc'), '26年6月独立批次(作废)');
  // ② dl 结尾的独立批次：year 是 '20' + 前缀前两位，所以是四位数年份
  assert.strictEqual(SM.displayBatch('269dl'), '2026年9月独立');
  assert.strictEqual(SM.displayBatch('2610dl'), '2026年10月独立');
  // ③ 纯数字常规批次
  assert.strictEqual(SM.displayBatch('2609'), '2609批次');
  assert.strictEqual(SM.displayBatch('2611'), '2611批次');
  // 兜底：未知格式原样返回；空值空串；两端空白先 trim
  assert.strictEqual(SM.displayBatch('other'), 'other');
  assert.strictEqual(SM.displayBatch('  2609  '), '2609批次');
  assert.strictEqual(SM.displayBatch(''), '');
  assert.strictEqual(SM.displayBatch(null), '');
});

test('docId / isMemberDoc：唯一 id 与成员判定', () => {
  assert.strictEqual(SM.docId({ value: 'V' }), 'V');          // 抓包确认字段是 value
  assert.strictEqual(SM.docId({ docInstId: 'D' }), 'D');      // 兜底
  assert.strictEqual(SM.docId({ id: 'I' }), 'I');             // 兜底
  assert.strictEqual(SM.docId({ value: 'V', id: 'I' }), 'V');
  assert.strictEqual(SM.docId({}), '');
  assert.strictEqual(SM.docId(null), '');

  assert.strictEqual(SM.isMemberDoc({ isMember: '1' }), true);
  assert.strictEqual(SM.isMemberDoc({ isMember: 1 }), true);
  assert.strictEqual(SM.isMemberDoc({ isMember: '0' }), false);
  assert.strictEqual(SM.isMemberDoc({}), false);
  assert.strictEqual(SM.isMemberDoc(null), false);
});

test('normalizeDoc：三列字段兜底与成员标记收敛到一处', () => {
  const n = SM.normalizeDoc({ value: 'V', docNo: 'N', docName: '名', batchNum: '2609', isMember: '1' });
  assert.deepStrictEqual(n, { id: 'V', docNo: 'N', docName: '名', batchNum: '2609', member: true });
  // 候选字段名兜底：no / name / batch
  const alt = SM.normalizeDoc({ no: 'N2', name: '名2', batch: '2610' });
  assert.strictEqual(alt.docNo, 'N2');
  assert.strictEqual(alt.docName, '名2');
  assert.strictEqual(alt.batchNum, '2610');
  assert.strictEqual(alt.member, false);
  // 全缺省 → 空串（不是 undefined，渲染与过滤都按空串比）
  const empty = SM.normalizeDoc({});
  assert.deepStrictEqual([empty.docNo, empty.docName, empty.batchNum, empty.id], ['', '', '', '']);
  assert.strictEqual(SM.normalizeDoc(null).docNo, '');
});

test('filterDocs：编号/名称模糊 + 批次精确，空条件放行', () => {
  const rows = [
    { value: '1', docNo: 'DOC-001', docName: '需求说明书', batchNum: '2609' },
    { value: '2', no: 'OTHER-9', name: '联合测试报告', batch: '2610' },
    { value: '3', docNo: 'doc-002', docName: '设计说明', batchNum: '2609' },
  ];
  // 空条件：全部放行
  assert.strictEqual(SM.filterDocs(rows, {}).length, 3);
  assert.strictEqual(SM.filterDocs(rows).length, 3);
  // 编号模糊 + 大小写不敏感
  assert.deepStrictEqual(SM.filterDocs(rows, { kw: 'doc-00' }).map(SM.docId), ['1', '3']);
  // 名称模糊（用兜底字段 name 也要能筛到）
  assert.deepStrictEqual(SM.filterDocs(rows, { kw: '报告' }).map(SM.docId), ['2']);
  // 批次精确：2609 不能命中 2610
  assert.deepStrictEqual(SM.filterDocs(rows, { batch: '2609' }).map(SM.docId), ['1', '3']);
  // 两个条件同时生效
  assert.deepStrictEqual(SM.filterDocs(rows, { kw: 'DOC', batch: '2609' }).map(SM.docId), ['1', '3']);
  assert.deepStrictEqual(SM.filterDocs(rows, { kw: '设计', batch: '2610' }).map(SM.docId), []);
  // 空行集合不炸
  assert.deepStrictEqual(SM.filterDocs(null, { kw: 'x' }), []);
});

test('sortDocs：已勾选最前、非成员最后、组内保持原序、不改入参', () => {
  const rows = [
    { value: 'a', isMember: '0' },   // 非成员
    { value: 'b', isMember: '1' },
    { value: 'c', isMember: '1' },   // 已勾选
    { value: 'd', isMember: '0' },
  ];
  const out = SM.sortDocs(rows, new Set(['c']));
  assert.deepStrictEqual(out.map(SM.docId), ['c', 'b', 'a', 'd']);
  // 数组形式的已选 id 也接受
  assert.deepStrictEqual(SM.sortDocs(rows, ['b']).map(SM.docId), ['b', 'c', 'a', 'd']);
  // 原数组顺序不变
  assert.deepStrictEqual(rows.map(SM.docId), ['a', 'b', 'c', 'd']);
  // 无已选时等同于「成员在前」
  assert.deepStrictEqual(SM.sortDocs(rows, null).map(SM.docId), ['b', 'c', 'a', 'd']);
});

test('toPickedDetails：提交用的 6 字段口径（docNo 无 d.no 兜底）', () => {
  const out = SM.toPickedDetails([
    { value: 'V', docNo: 'N1', docName: '名', batchNum: '2609', label: 'L', templateCode: 'T' },
    { value: 'V2', no: 'N2', name: '名2' },
  ]);
  assert.deepStrictEqual(out[0], {
    docInstId: 'V', docNo: 'N1', docName: '名', batchNum: '2609', label: 'L', templateCode: 'T',
  });
  // 第二行：docNo/batchNum/label/templateCode 发空串，docName 走 name 兜底
  assert.deepStrictEqual(out[1], {
    docInstId: 'V2', docNo: '', docName: '名2', batchNum: '', label: '', templateCode: '',
  });
  assert.strictEqual(SM.toPickedDetails(null).length, 0);
});

test('batchSortKey / batchLabel / buildDocBatchOptions', () => {
  assert.strictEqual(SM.batchSortKey('2609'), 2609);
  assert.strictEqual(SM.batchSortKey('2610dl'), 2610);
  assert.strictEqual(SM.batchSortKey('344'), 344);
  assert.strictEqual(SM.batchSortKey(''), 0);
  assert.strictEqual(SM.batchSortKey('abc'), 0);

  const dict = [{ value: '2609', label: '2609批次' }, { value: '269dl', label: '26年9月独立' }];
  assert.strictEqual(SM.batchLabel(' 2609 ', dict), '2609批次');   // 字典 label 优先
  assert.strictEqual(SM.batchLabel('269dl', dict), '26年9月独立');
  assert.strictEqual(SM.batchLabel('2611', dict), '2611批次');     // 字典没有 → 按批次号推
  assert.strictEqual(SM.batchLabel('', dict), '');

  // 下拉按文档去重生成，按批次号倒序（新批次在前）
  const opts = SM.buildDocBatchOptions([
    { batchNum: '2609' }, { batchNum: '2611' }, { batch: '2609' }, {},
  ], dict);
  assert.deepStrictEqual(opts, [
    { value: '2611', label: '2611批次' },
    { value: '2609', label: '2609批次' },
  ]);
  // 一条文档都没有 → 退回全局批次字典（并滤掉空 value）
  assert.deepStrictEqual(
    SM.buildDocBatchOptions([], [{ value: '2609', label: '2609批次' }, { value: '', label: 'x' }, null]),
    [{ value: '2609', label: '2609批次' }],
  );
});

test('pickField / judgeFieldsFromApi：接口行候选字段名', () => {
  assert.strictEqual(SM.pickField({ a: '', b: 'B' }, ['a', 'b']), 'B');
  assert.strictEqual(SM.pickField({ a: '', b: 'B' }, ['a']), '');     // 全空 → 空串
  assert.strictEqual(SM.pickField({ a: 0 }, ['a']), '0');             // 0 不算空，强转字符串
  assert.strictEqual(SM.pickField(null, ['a']), '');

  const f = SM.judgeFieldsFromApi({
    judgeRoleName: '调用方产品负责人', judgeUserId: 'U1', judgeName: '张三', judgeDeptName: '某部',
    judgeRoleId: '03', judgeDeptId: 'K4229',
  });
  assert.deepStrictEqual(f, {
    role: '调用方产品负责人', roleId: '03', no: 'U1', name: '张三', dept: '某部', deptId: 'K4229',
  });
  // 兜底字段名（提交报文要的两个 id：roleId / teamId）
  const g = SM.judgeFieldsFromApi({ role: 'R', roleId: '09', empNo: 'E', userName: '李四', teamName: 'T', teamId: 'D1' });
  assert.deepStrictEqual(g, { role: 'R', roleId: '09', no: 'E', name: '李四', dept: 'T', deptId: 'D1' });
  assert.deepStrictEqual(SM.judgeFieldsFromApi({}), {
    role: '', roleId: '', no: '', name: '', dept: '', deptId: '',
  });
});

test('roleOptionsWith：字典里没有该角色时才并入（命中时返回原数组本身）', () => {
  const base = [{ value: 'A', label: 'A' }];
  assert.strictEqual(SM.roleOptionsWith('A', base), base);            // 不改动 → 调用方跳过 updateOptions
  assert.deepStrictEqual(SM.roleOptionsWith('X', base), [
    { value: 'A', label: 'A' }, { value: 'X', label: 'X' },
  ]);
  assert.strictEqual(SM.roleOptionsWith('', base), base);             // 空角色不动
  assert.deepStrictEqual(SM.roleOptionsWith('X', null), [{ value: 'X', label: 'X' }]);
});

test('toServiceNoOptions：字符串/对象两种形态，空 value 丢弃', () => {
  assert.deepStrictEqual(
    SM.toServiceNoOptions(['E00406TO1', { value: 'E00406TO2', label: '二号' }, { value: '' }]),
    [{ value: 'E00406TO1', label: 'E00406TO1' }, { value: 'E00406TO2', label: '二号' }],
  );
  assert.deepStrictEqual(SM.toServiceNoOptions(null), []);
});

test('deriveCallerServiceNo：调用方系统 + 服务编号尾部 TO 序号', () => {
  assert.strictEqual(SM.deriveCallerServiceNo('E00406', 'E00301TP0050TO1197'), 'E00406TO1197');
  assert.strictEqual(SM.deriveCallerServiceNo(' E00406 ', 'XTO1197'), 'E00406TO1197');
  // 尾部没有 TO 序号 / 任一侧为空 → 推不出来，返回空串（调用方清空或留空列表）
  assert.strictEqual(SM.deriveCallerServiceNo('E00406', 'E00301TP0050'), '');
  assert.strictEqual(SM.deriveCallerServiceNo('', 'XTO1197'), '');
  assert.strictEqual(SM.deriveCallerServiceNo('E00406', ''), '');
  assert.strictEqual(SM.deriveCallerServiceNo('E00406', 'TO1197abc'), '');
  assert.strictEqual(SM.deriveCallerServiceNo(null, null), '');
});

test('toJudgeInfoList：评委行 → 提交接口结构（7 字段，与抓包一致）', () => {
  assert.deepStrictEqual(
    SM.toJudgeInfoList([{ name: '张三', empNo: 'U1', dept: '某部', role: '调用方产品负责人', deptId: 'K4229' }]),
    [{
      judgeName: '张三', judgeUserId: 'U1', judgeDeptName: '某部',
      involvedProduct: '', judgeRoleName: '调用方产品负责人',
      judgeRoleId: '03', judgeDeptId: 'K4229',
    }],
  );
  // 角色名 → judgeRoleId 按抓包映射（两份 subscriptionReview 里 03/05 两次都一致）
  assert.strictEqual(
    SM.toJudgeInfoList([{ name: '李四', role: '服务方产品负责人' }])[0].judgeRoleId, '05',
  );
  // 字典外的角色不猜：映射里没有，才退回接口给的 roleId；都没有就留空
  assert.strictEqual(
    SM.toJudgeInfoList([{ name: '王五', role: '某新角色', roleId: '09' }])[0].judgeRoleId, '09',
  );
  assert.strictEqual(
    SM.toJudgeInfoList([{ name: '赵六', role: '某新角色' }])[0].judgeRoleId, '',
  );
  // 角色被改过时以当前角色名为准，不会残留接口带来的旧 id
  assert.strictEqual(
    SM.toJudgeInfoList([{ name: '李四', role: '服务方产品负责人', roleId: '03' }])[0].judgeRoleId, '05',
  );
  // 「拉取评委」来的行：deptId 直接透传
  assert.strictEqual(
    SM.toJudgeInfoList([{ name: '魏甜甜', role: '服务方产品负责人', deptId: '1465A' }])[0].judgeDeptId, '1465A',
  );
  assert.deepStrictEqual(SM.toJudgeInfoList([]), []);
  // 报文键集固定为抓包那 7 个（多一个少一个都要在这里失败）
  assert.deepStrictEqual(
    Object.keys(SM.toJudgeInfoList([{ name: 'A', empNo: 'U', dept: 'D', role: '调用方产品负责人', deptId: 'X' }])[0]).sort(),
    ['involvedProduct', 'judgeDeptId', 'judgeDeptName', 'judgeName', 'judgeRoleId', 'judgeRoleName', 'judgeUserId'],
  );
});

test('validateSubscribe：行 → 编码 → 已订阅 → 调用方系统 → 关联文档 → 服务编号 → TPS → 评委 → 任务编号', () => {
  // 完整必填集（服务编号显式填了，走「用户确认过的值」这条路）
  const good = {
    callerSystem: 'E00406', relDocIds: 'doc-1', callerServiceNo: 'E00406TO1197',
    perfPeak: { tps: '5' }, taskNo: 'T-2026-001',
  };
  // 无行数据：静默（没有文案，也没有聚焦目标）
  const noRow = SM.validateSubscribe(null, good);
  assert.strictEqual(noRow.ok, false);
  assert.strictEqual(noRow.msg, '');
  // 拿不到服务编码（serverCoding 优先，回退 sysServeNo）
  const noCode = SM.validateSubscribe({}, good);
  assert.strictEqual(noCode.code, 'no-coding');
  assert.strictEqual(noCode.msg, '⚠️ 无法获取服务编码');
  assert.strictEqual(noCode.duration, 2500);
  // 已订阅
  const sub = SM.validateSubscribe({ serverCoding: 'S' }, good, (c) => c === 'S');
  assert.strictEqual(sub.msg, '⚠️ 该服务已在订阅列表中');
  assert.strictEqual(sub.code, 'subscribed');
  // 未订阅 → 继续往下校验
  assert.strictEqual(SM.validateSubscribe({ sysServeNo: 'S' }, good, () => false).ok, true);
  // 未选调用方系统：文案 + 聚焦目标
  const noCaller = SM.validateSubscribe({ serverCoding: 'S' }, {
    relDocIds: 'd', callerServiceNo: 'E00406TO1197', perfPeak: { tps: '5' },
  });
  assert.strictEqual(noCaller.msg, '⚠️ 请选择调用方系统');
  assert.strictEqual(noCaller.focus, 'sub_callerSystem');
  // 未选关联文档：拦在前端（否则 documents 发空数组，白等一次往返才知道错）
  const noDoc = SM.validateSubscribe({ serverCoding: 'S' }, {
    callerSystem: 'E00406', perfPeak: { tps: '5' },
  });
  assert.strictEqual(noDoc.code, 'no-doc');
  assert.strictEqual(noDoc.msg, '⚠️ 请选择关联文档');
  assert.strictEqual(noDoc.focus, 'sub_relDoc');
  // 服务编号：表单空、但行数据能派生（调用方系统 + TO 尾号）→ 放行（service-api 用同一规则）
  assert.strictEqual(
    SM.validateSubscribe({ serverCoding: 'E00301TO1197' }, {
      callerSystem: 'E00406', relDocIds: 'd', perfPeak: { tps: '5' }, taskNo: 'T-1',
    }).ok,
    true,
  );
  // 服务编号：表单空且派生不出来 → 拦（这种情况 prodSysServeNoList 会是空数组）
  const noService = SM.validateSubscribe({ serverCoding: 'E00301' }, {
    callerSystem: 'E00406', relDocIds: 'd', perfPeak: { tps: '5' },
  });
  assert.strictEqual(noService.code, 'no-service-no');
  assert.strictEqual(noService.msg, '⚠️ 请选择调用方应用系统服务编号');
  assert.strictEqual(noService.focus, 'sub_callerServiceNo');
  // TPS 缺失：文案 + 需要把焦点放回输入框
  const noTps = SM.validateSubscribe({ serverCoding: 'S' }, {
    callerSystem: 'E00406', relDocIds: 'd', callerServiceNo: 'E00406TO1197', perfPeak: { tps: '' },
  });
  assert.strictEqual(noTps.msg, '⚠️ 请填写 TPS（峰值）');
  assert.strictEqual(noTps.focus, 'sub_tpsPeak');
  // 通过：把服务编码交回调用方
  const ok = SM.validateSubscribe({ serverCoding: 'S' }, good);
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.serverCoding, 'S');
  assert.strictEqual(ok.msg, '');
  // 校验顺序：编码缺失时不能先报「请选择调用方系统」
  assert.strictEqual(SM.validateSubscribe({}, {}).code, 'no-coding');
  // 已订阅时不能先报调用方系统
  assert.strictEqual(SM.validateSubscribe({ serverCoding: 'S' }, {}, () => true).code, 'subscribed');
});

test('validateSubscribe：TPS（峰值）必须是大于 0 的数字（后端字段是数值型）', () => {
  const base = { callerSystem: 'E00406', relDocIds: 'd', callerServiceNo: 'E00406TO1197', taskNo: 'T-1' };
  const withTps = (tps) => SM.validateSubscribe({ serverCoding: 'S' }, { ...base, perfPeak: { tps } });

  for (const bad of ['abc', '5a', '-1', '0', '0.0', '１a', ' ', '5.5.5']) {
    const r = withTps(bad);
    assert.strictEqual(r.ok, false, `「${bad}」不该通过`);
    assert.ok(r.code === 'bad-tps' || r.code === 'no-tps', `「${bad}」的 code 应为 bad-tps/no-tps`);
    assert.strictEqual(r.focus, 'sub_tpsPeak');
    assert.strictEqual(r.duration, 2500);
  }
  // 全角数字先归一再看数值：中文输入法全角状态下敲的 "５" 应当被接受
  // （否则用户看到「请填数字」却看不出哪里不对，是个死胡同）
  for (const ok of ['5', '12.5', '0.5', '1000', ' 5 ', '５', '０.５', '１２']) {
    assert.strictEqual(withTps(ok).ok, true, `「${ok}」应当通过`);
  }
});

test('normalizeDigits：全角数字转半角，非数字原样保留', () => {
  assert.strictEqual(SM.normalizeDigits('０１２３４５６７８９'), '0123456789');
  assert.strictEqual(SM.normalizeDigits('０.５'), '0.5');
  assert.strictEqual(SM.normalizeDigits('  ５  '), '  5  ');   // 只管字符，不 trim
  assert.strictEqual(SM.normalizeDigits('abc5'), 'abc5');
  assert.strictEqual(SM.normalizeDigits(null), '');
  assert.strictEqual(SM.normalizeDigits(undefined), '');
  assert.strictEqual(SM.normalizeDigits(0), '0');
});

test('validateSubscribe：服务编号的派生源与 service-api 一致（含 serviceId）', () => {
  // service-api.js 的 providerSysServeNo = sysServeNo || serviceId || serverCoding，
  // 校验侧必须同源，否则「后端拼得出来、前端却拦」＝假失败。
  const form = { callerSystem: 'E00406', relDocIds: 'd', perfPeak: { tps: '5' }, taskNo: 'T-1' };
  // serverCoding 只是普通编码，TO 尾号藏在 serviceId 里 → 派生得出来，放行
  assert.strictEqual(
    SM.validateSubscribe({ serverCoding: 'E00301', serviceId: 'E00301TO1197' }, form).ok,
    true,
  );
  // 三个字段都没有 TO 尾号 → 派生不出来，拦
  assert.strictEqual(
    SM.validateSubscribe({ serverCoding: 'E00301', serviceId: 'X' }, form).code,
    'no-service-no',
  );
});

test('validateSubscribe：批次刻意不做前端硬拦（该下拉当前未进请求体）', () => {
  // service-api.js 组包时 prodBatch / prodBatchList 只取 row，form.callerBatch 并未参与，
  // 所以在这里拦「批次必填」只会白挡用户、并不能改善数据质量。
  // 哪天把批次接进请求体了，这条用例会失败 —— 提醒把校验一起补上再改这里。
  const r = SM.validateSubscribe({ serverCoding: 'S' }, {
    callerSystem: 'E00406', relDocIds: 'd', callerServiceNo: 'E00406TO1197',
    perfPeak: { tps: '5' }, callerBatch: '', taskNo: 'T-1',
  });
  assert.strictEqual(r.ok, true);
});

test('validateSubscribe：任务编号必填（缺失时阻止提交并给明确提示）', () => {
  const base = {
    callerSystem: 'E00406', relDocIds: 'd', callerServiceNo: 'E00406TO1197', perfPeak: { tps: '5' },
  };
  // 空串 / 纯空白 都算缺
  for (const taskNo of ['', '   ']) {
    const r = SM.validateSubscribe({ serverCoding: 'S' }, { ...base, taskNo });
    assert.strictEqual(r.ok, false, `任务编号「${taskNo}」不该放行`);
    assert.strictEqual(r.code, 'no-task-no');
    assert.strictEqual(r.msg, '⚠️ 请填写任务编号');
    assert.strictEqual(r.focus, 'sub_taskNo');
    assert.strictEqual(r.duration, 2500);
  }
  // 填了就放行（其余字段齐全）
  assert.strictEqual(SM.validateSubscribe({ serverCoding: 'S' }, { ...base, taskNo: 'T-1' }).ok, true);
});

test('validateSubscribe：评委信息必填，唯一豁免是「已成功拉取默认评委」', () => {
  const form = {
    callerSystem: 'E00406', relDocIds: 'd', callerServiceNo: 'E00406TO1197',
    perfPeak: { tps: '5' }, taskNo: 'T-1',
  };
  const row = { serverCoding: 'S' };

  // 评委为空且没拉取过默认评委 → 拦，提示里要给出两条补救路径
  const blocked = SM.validateSubscribe(row, form, null, { judges: [], defaultsFetched: false });
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.code, 'no-judges');
  assert.ok(/评委信息/.test(blocked.msg), '提示要点明是评委');
  assert.ok(/拉取评委/.test(blocked.msg) && /新增/.test(blocked.msg), '提示要给出补救路径');
  assert.strictEqual(blocked.focus, 'btnFetchJudges', '焦点落到「⤓ 拉取评委」，离补救动作最近');

  // 豁免：defaultsFetched=true（本行已成功拉取默认评委）→ 放行
  assert.strictEqual(
    SM.validateSubscribe(row, form, null, { judges: [], defaultsFetched: true }).ok,
    true,
  );
  // 有评委 → 放行
  assert.strictEqual(
    SM.validateSubscribe(row, form, null, { judges: [{ empNo: '4711510', name: '李胜' }], defaultsFetched: false }).ok,
    true,
  );
  // 调用方没传 judgeState（旧签名）→ 不做评委校验，保持向后兼容
  assert.strictEqual(SM.validateSubscribe(row, form, null).ok, true);

  // 校验顺序：评委缺 + 任务编号缺 → 先报评委（评委区在任务编号之前）
  const bothMissing = SM.validateSubscribe(row, {
    callerSystem: 'E00406', relDocIds: 'd', callerServiceNo: 'E00406TO1197', perfPeak: { tps: '5' },
  }, null, { judges: [], defaultsFetched: false });
  assert.strictEqual(bothMissing.code, 'no-judges');
});

test('validateSubscribe：预演模式（judgeState.dryRun）不拦关联文档，其它必填照旧', () => {
  const base = {
    callerSystem: 'E00406', callerServiceNo: 'E00406TO1197',
    perfPeak: { tps: '5' }, taskNo: 'T-1', relDocIds: '',
  };
  const row = { serverCoding: 'S' };
  // 平时：未选关联文档 → 拦（线上行为，不能被预演开关带偏）
  assert.strictEqual(SM.validateSubscribe(row, base).code, 'no-doc');
  assert.strictEqual(SM.validateSubscribe(row, base, null, { dryRun: false }).code, 'no-doc');
  // 预演模式：放行（离线拿不到文档列表时用户无从选择，拦了整条链路就试不动）
  assert.strictEqual(SM.validateSubscribe(row, base, null, { dryRun: true }).ok, true);
  // 但其它必填/格式规则一律照旧 —— 预演只放开文档这一条
  assert.strictEqual(
    SM.validateSubscribe(row, { ...base, perfPeak: { tps: 'abc' } }, null, { dryRun: true }).code, 'bad-tps',
  );
  assert.strictEqual(
    SM.validateSubscribe(row, { ...base, taskNo: '' }, null, { dryRun: true }).code, 'no-task-no',
  );
  assert.strictEqual(
    SM.validateSubscribe(row, base, null, { dryRun: true, judges: [], defaultsFetched: false }).code, 'no-judges',
  );
  assert.strictEqual(
    SM.validateSubscribe(row, { ...base, callerSystem: '' }, null, { dryRun: true }).code, 'no-caller',
  );
});

test('validateJudgeSubmit：无评委 / 无 publishId / 通过', () => {
  assert.strictEqual(SM.validateJudgeSubmit(null, [{ name: 'a' }]).code, 'no-row');
  const noJudges = SM.validateJudgeSubmit({ id: 'X' }, []);
  assert.strictEqual(noJudges.msg, '⚠️ 请先添加评委信息');
  assert.strictEqual(noJudges.duration, 2500);
  // publishId 优先，回退行 id；缺了要拦（否则提交会打到错的行）
  const noId = SM.validateJudgeSubmit({}, [{ name: 'a' }]);
  assert.strictEqual(noId.msg, '⚠️ 当前行缺少 publishId，无法提交评委信息');
  assert.strictEqual(noId.duration, 2800);
  const ok = SM.validateJudgeSubmit({ publishId: 'P' }, [{ name: 'a' }]);
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.publishId, 'P');
  assert.strictEqual(SM.validateJudgeSubmit({ id: 'X' }, [{ name: 'a' }]).publishId, 'X');
});

test('createUserCache：跨行共享的已搜用户缓存', () => {
  const cache = SM.createUserCache();
  assert.strictEqual(cache.size, 0);
  cache.cacheUsers([
    { userId: 'U1', userName: '张三', teamName: '开发三部' },
    { userId: 'U2' },                                  // 无姓名 → label 用工号
    { userName: '没有工号' },                           // 无 userId → 丢弃
    null,
  ]);
  assert.strictEqual(cache.size, 2);
  // 同一工号再塞一次是覆盖，不是新增
  cache.cacheUsers([{ userId: 'U1', userName: '张三丰' }]);
  assert.strictEqual(cache.size, 2);
  assert.strictEqual(cache.get('U1').userName, '张三丰');
  assert.deepStrictEqual(cache.cachedUserOptions(), [
    { value: 'U1', label: '张三丰（U1）' },
    { value: 'U2', label: 'U2' },
  ]);
  // cacheUsers(null) 不炸
  cache.cacheUsers(null);
  assert.strictEqual(cache.size, 2);
});

test('JUDGE_ROW_TEMPLATE：仍是 6 个单元格的评委行', () => {
  assert.strictEqual(SM.JUDGE_ROW_TEMPLATE.split('<td').length - 1, 6);
  ['judge-check', 'judge-idx', 'judge-role', 'judge-no', 'judge-name', 'judge-dept']
    .forEach((cls) => assert.ok(SM.JUDGE_ROW_TEMPLATE.includes(cls), '缺 ' + cls));
  assert.ok(SM.JUDGE_ROW_TEMPLATE.includes('placeholder="请输入工号"'));
});

// ══════════════════════════════════════════════════════════
// 评委搜索结果核对（从 subscribe-dialog 的搜索闭包里抽出来的那段判断）
// ══════════════════════════════════════════════════════════
//
// 抽出来的动机：后端会**忽略查询参数**（2026-09-18 实测：按姓名搜返回的是 token
// 对应的登录人）。这段核对以前只有浏览器冒烟覆盖，node 侧测不到；
// 而它守的是「把评委填成别人」——评委要提交给后端审批，填错人代价很高。

const LOGINER = { userId: '4711510', userName: '兰春武', teamName: '开发三部' };

test('judgeQueryIsEmpNo：纯数字算工号，带空格也算；汉字/混合都不算', () => {
  assert.strictEqual(SM.judgeQueryIsEmpNo('4711510'), true);
  assert.strictEqual(SM.judgeQueryIsEmpNo('  4711510 '), true, '输入要 trim 后再判');
  assert.strictEqual(SM.judgeQueryIsEmpNo('郑梓辉'), false);
  assert.strictEqual(SM.judgeQueryIsEmpNo('4711510a'), false);
  assert.strictEqual(SM.judgeQueryIsEmpNo(''), false);
  assert.strictEqual(SM.judgeQueryIsEmpNo(null), false, 'null/undefined 不能抛');
});

test('工号搜索：返回的就是那个工号 → 给下拉用', () => {
  const o = SM.judgeSearchOutcome({ ok: true, user: LOGINER }, '4711510');
  assert.strictEqual(o.byEmpNo, true);
  assert.strictEqual(o.kind, 'users');
  assert.deepStrictEqual(o.users, [LOGINER]);
});

test('工号搜索：后端返回了**别人**（忽略了参数）→ 绝不进下拉，只提示不一致', () => {
  const o = SM.judgeSearchOutcome({ ok: true, user: LOGINER }, '8404725');
  assert.strictEqual(o.kind, 'busy', '不是 users —— 填错评委比搜不到严重得多');
  assert.ok(/8404725/.test(o.text) && /4711510/.test(o.text), '要说清输入的是什么、返回的是什么：' + o.text);
  assert.ok(/不一致/.test(o.text));
});

test('工号搜索：后端返回数字工号也要能对上（报文里 userId 有时是 number）', () => {
  const o = SM.judgeSearchOutcome({ ok: true, user: { userId: 4711510, userName: '兰春武' } }, '4711510');
  assert.strictEqual(o.kind, 'users', 'String(userId) !== kw 的比较必须先把数字转字符串');
});

test('工号搜索：没这个人 → 明说按 userId 精确匹配；接口失败 → 带上原因', () => {
  assert.strictEqual(SM.judgeSearchOutcome({ ok: true, user: null }, '4711510').text,
    '未找到该工号（接口按 userId 精确匹配）');
  const f = SM.judgeSearchOutcome({ ok: false, error: 'HTTP 500' }, '4711510');
  assert.strictEqual(f.kind, 'busy');
  assert.ok(/HTTP 500/.test(f.text), f.text);
});

test('姓名搜索：只认「名字里真的含关键字」的人，登录人不算命中', () => {
  const other = { userId: '1001', userName: '郑梓辉' };
  const o = SM.judgeSearchOutcome({ ok: true, list: [LOGINER, other] }, '郑梓辉');
  assert.strictEqual(o.byEmpNo, false);
  assert.strictEqual(o.kind, 'users');
  assert.deepStrictEqual(o.users, [other], '登录人必须被筛掉，否则选中就把评委填成了他');
});

test('姓名搜索：返回的全是不相干的人（典型=登录人）→ 提示改用工号，不进下拉', () => {
  const o = SM.judgeSearchOutcome({ ok: true, list: [LOGINER] }, '郑梓辉');
  assert.strictEqual(o.kind, 'busy');
  assert.ok(/请直接填工号/.test(o.text), o.text);
});

test('姓名搜索：空列表 / 缺 list / 接口失败，三种情况文案各不同', () => {
  assert.ok(/只认完整姓名/.test(SM.judgeSearchOutcome({ ok: true, list: [] }, '郑梓辉').text));
  assert.ok(/只认完整姓名/.test(SM.judgeSearchOutcome({ ok: true }, '郑梓辉').text),
    '后端给了 ok 但没有 list 数组时不该抛，也不该当命中');
  assert.ok(/搜索失败/.test(SM.judgeSearchOutcome({ ok: false, error: '查询失败' }, '郑梓辉').text));
});

test('姓名搜索：脏记录（null / 没 userName）不影响其余人命中，也不会进结果', () => {
  const other = { userId: '1001', userName: '郑梓辉' };
  const o = SM.judgeSearchOutcome({ ok: true, list: [null, { userId: '2' }, other] }, '郑梓辉');
  assert.deepStrictEqual(o.users, [other]);
});

test('核对口径不依赖调用方传的 byEmpNo：由输入自己判', () => {
  // 传第三个参数也不该改变行为（避免有人以为可以从外面指定）
  const o = SM.judgeSearchOutcome({ ok: true, user: LOGINER }, '郑梓辉');
  assert.strictEqual(o.byEmpNo, false, '非纯数字一律按姓名口径');
  assert.ok(/只认完整姓名/.test(o.text) || /填工号/.test(o.text), o.text);
});

test('结果核对的畸形入参：list 不是数组 / user 没有工号，都不许进下拉', () => {
  // 后端偶尔会把 list 给成字符串或类数组；照着 .length / .filter 走会直接抛，
  // 抛出去就被搜索闭包的 catch 吞掉 —— 表现是「输入了但什么都不发生」。
  const strList = SM.judgeSearchOutcome({ ok: true, list: '张三' }, '张三');
  assert.strictEqual(strList.kind, 'busy', 'list 不是数组时不能当命中');
  const arrayLike = SM.judgeSearchOutcome({ ok: true, list: { length: 1 } }, '张三');
  assert.strictEqual(arrayLike.kind, 'busy');
  // 工号搜索但回来的人没有 userId：拿不到可核对的工号 = 不采用
  const noId = SM.judgeSearchOutcome({ ok: true, user: { userName: '张三' } }, '4711510');
  assert.strictEqual(noId.kind, 'busy', '没有 userId 就没法核对，绝不能填进评委');
  assert.ok(/未找到该工号/.test(noId.text), noId.text);
});
