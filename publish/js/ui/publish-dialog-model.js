/**
 * 发布查询页两个结果行弹窗的**纯逻辑**（不碰 DOM，可单测）
 *
 * ── 为什么单独成文件 ────────────────────────────────────────
 * 「接口明细」和「操作记录」两个弹窗各有一半逻辑是「数据进、数据出」：
 *   · 接口明细：5 个 tab 的定义、响应里 5 个数组的取用、按 sort 排序、分页切片
 *   · 操作记录：operationType 数字编码 → 显示名、行数据归一化
 * 这些逻辑塞在弹窗文件里既测不到、也没法复用（两个弹窗都要分页/空态口径）。
 * DOM 部分留在 intf-detail-dialog.js / op-record-dialog.js。
 *
 * ── 数据来源（全部来自抓包，一个字段都没猜）────────────────
 * `操作记录和接口明细.har`（2026-09-21，用户提供）
 *   POST /itamp-tool/operation/getOperationRecordList  body { operationType, pageNum, pageSize, publishId }
 *     → data.total / data.rows[].{ operationerName, createTime, operationType, subscribeName, prodSysServeNo }
 *   POST /itamp-tool/intfcMgmt/serviceChildList        body { dataId, sysServeNo }
 *     → data.{ childReqList, childRespList, revisionList, interfaceModifyList, deployList }
 * 字段说明另见 analysis/output/接口文档.md 的对应小节（⚠️ 那份文档里**只有
 * getOperationRecordList**；serviceChildList 尚未补进去（它落后于 `接口编码.har` 那批），
 * 所以接口明细的字段以本文件的列定义为准，别去文档里找。
 *
 * ── 对外 ──────────────────────────────────────────────────
 *   PublishDialogModel.OP_TYPES              编码→显示名（唯一来源，补映射只改它）
 *   PublishDialogModel.opTypeLabel(code)     编码→显示名（未覆盖的原样返回编码）
 *   PublishDialogModel.opTypeOptions()       操作类型下拉选项
 *   PublishDialogModel.OP_COLS               操作记录表格的列
 *   PublishDialogModel.INTF_TABS             接口明细 5 个 tab 的定义
 *   PublishDialogModel.parseIntfDetail(lists) 响应 → 按 tab 归好的行
 *   PublishDialogModel.sortRows(rows)        按 sort 升序（缺失的排最后，稳定）
 *   PublishDialogModel.pageSlice(rows,p,s)   分页切片
 *   PublishDialogModel.totalPages(total,size) 总页数
 *   PublishDialogModel.isMustText(v)         是否必填的显示口径
 *   PublishDialogModel.blank(v)              空值统一显示 '—'
 */
(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════
  // 1) 操作类型（operationType）
  // ═══════════════════════════════════════════════════════

  /**
   * 后端 operationType 是数字编码，界面要显示中文/英文名。
   *
   * 下面 5 条是**唯一有证据**的映射（用户 2026-09-21 提供的映射表，
   * 与抓包数据里的编码集合对得上）：
   *   52 → CHECKOUT     50 → CHECKIN     45 → 新增
   *   43 → 修改          12 → 删除
   *
   * ⚠️ 抓包的 21 条记录里还出现过 17 / 18 / 47（它们的 subscribeName 都有值，
   *   看形态是订阅类动作）。**没有证据说明这三个编码叫什么**，
   *   按用户 2026-09-21 拍板：未覆盖的编码原样显示数字，不猜中文。
   *   同理，用户提示词里提到的「接口批量更新 / 接口批量新增」两个选项
   *   找不到对应编码 —— 编码填错会让筛选静默查错数据，比少一个选项更糟，
   *   所以暂不放进下拉，等拿到映射表后在这里各加一行即可。
   */
  const OP_TYPES = Object.freeze({
    12: '删除',
    43: '修改',
    45: '新增',
    50: 'CHECKIN',
    52: 'CHECKOUT',
  });

  /** 编码 → 显示名。未覆盖的编码原样返回（不猜、也不显示成「未知」）。 */
  function opTypeLabel(code) {
    if (code == null || code === '') return '—';
    const key = String(code).trim();
    return Object.prototype.hasOwnProperty.call(OP_TYPES, key) ? OP_TYPES[key] : key;
  }

  /**
   * 操作类型下拉的选项：只有 value 已知的编码才会出现在这里。
   * 空值项 = 「全部」，与提示词里的「支持清空」一致（选中后 operationType 传 ''）。
   */
  function opTypeOptions() {
    const out = [{ value: '', label: '全部' }];
    Object.keys(OP_TYPES)
      .sort((a, b) => Number(a) - Number(b))
      .forEach((code) => out.push({ value: code, label: OP_TYPES[code] }));
    return out;
  }

  /** 操作记录表格的列（字段名来自抓包响应 data.rows[]） */
  const OP_COLS = Object.freeze([
    { label: '操作人', key: 'operationerName' },
    { label: '操作时间', key: 'createTime', cls: 'c-mono' },
    { label: '操作类型', key: 'operationType', cls: 'c-center', fmt: opTypeLabel },
    { label: '调用方组件或应用系统名称', key: 'subscribeName', cls: 'c-long' },
    { label: '调用方应用系统服务编号', key: 'prodSysServeNo', cls: 'c-mono' },
  ]);

  // ═══════════════════════════════════════════════════════
  // 2) 接口明细：5 个 tab
  // ═══════════════════════════════════════════════════════
  //
  // 「请求报文 / 响应报文」两张表的列来自抓包（childReqList 与 childRespList 字段完全一致）。
  // 「文档级 / 接口级修订记录」两张表共用一套列 —— 它们在同一响应里是成对的兄弟表，
  //   接口级有真实样本（interfaceModifyList 1 条），文档级那次抓包是空数组，
  //   所以字段名按兄弟表口径取，取不到就显示 '—'（**待真机核对**，见 CHANGELOG）。
  // 「应用系统服务部署」的列来自抓包（deployList 1 条：gatewayCode / context）。

  /** 取值：按候选键顺序取第一个非空值（与 publish-model.js 的 normalizeRow 同一套防御式读法） */
  function first(v, keys) {
    for (const k of keys) {
      const x = v ? v[k] : null;
      if (x != null && x !== '') return x;
    }
    return '';
  }

  /** 空值统一显示 '—'（与全站表格口径一致） */
  function blank(v) {
    return v == null || v === '' ? '—' : v;
  }

  /**
   * 「是否必填」的显示口径：抓包里是 '是' / '否'，但接口文档另一处样本是 'M'。
   * 统一收敛成中文，未知值原样显示（不吞数据）。
   */
  function isMustText(v) {
    if (v == null || v === '') return '—';
    const s = String(v).trim();
    if (/^(是|必填|Y|M|1)$/i.test(s)) return '是';
    if (/^(否|非必填|O|N|0)$/i.test(s)) return '否';
    return s;
  }

  /** 报文类表格（请求 / 响应）的列 */
  const MSG_COLS = Object.freeze([
    { label: '信息域参数', key: 'parameter', cls: 'c-mono' },
    { label: '信息域名称', key: 'parameterName' },
    { label: '企业级数据字典项编号', key: 'dictNo', cls: 'c-mono c-center' },
    { label: '长度', key: 'length', cls: 'c-center' },
    { label: '类型', key: 'type', cls: 'c-center' },
    { label: '是否必填', key: 'isMust', cls: 'c-center', fmt: isMustText },
    { label: '备注1', key: 'remark1', cls: 'c-long' },
    { label: '备注2', key: 'remark2', cls: 'c-long' },
    { label: '备注3', key: 'remark3', cls: 'c-long' },
  ]);

  /** 修订记录类表格（文档级 / 接口级）的列 */
  const REV_COLS = Object.freeze([
    { label: '版本号', cls: 'c-center', get: (r) => first(r, ['vsn', 'version', 'versionNo']) },
    { label: '修订内容', get: (r) => first(r, ['modifyDetail', 'modifyContent', 'content']) },
    { label: '修订日期', get: (r) => first(r, ['modifyDate', 'updateDate', 'date']) },
    { label: '修订人', get: (r) => first(r, ['modifier', 'updateBy', 'operator']) },
    { label: '备注', cls: 'c-long', get: (r) => first(r, ['remark', 'remark1']) },
    { label: '批次', get: (r) => first(r, ['prodBatch', 'batch']) },
    { label: '任务编号', get: (r) => first(r, ['taskNo', 'taskId', 'serverNo']) },
  ]);

  /** 应用系统服务部署的列（抓包确认） */
  const DEPLOY_COLS = Object.freeze([
    { label: '网关服务编码', key: 'gatewayCode', cls: 'c-mono' },
    { label: '分组CONTEXT', key: 'context', cls: 'c-mono' },
  ]);

  /**
   * 5 个 tab 的定义。source = 响应 data 里的数组名。
   * 顺序与用户给的界面一致：请求报文默认选中。
   */
  const INTF_TABS = Object.freeze([
    { key: 'req', label: '请求报文', source: 'childReqList', cols: MSG_COLS },
    { key: 'resp', label: '响应报文', source: 'childRespList', cols: MSG_COLS },
    { key: 'docRev', label: '文档级修订记录', source: 'revisionList', cols: REV_COLS },
    { key: 'intfRev', label: '接口级修订记录', source: 'interfaceModifyList', cols: REV_COLS },
    { key: 'deploy', label: '应用系统服务部署', source: 'deployList', cols: DEPLOY_COLS },
  ]);

  /**
   * 响应 → 每个 tab 的行。
   * @param {object|null} lists serviceChildList 响应里的 data（5 个数组）
   * @returns {Object} { req:[], resp:[], docRev:[], intfRev:[], deploy:[] }
   *   lists 为 null（接口没配上 / 没拿到）时返回全空，调用方据此区分「没数据」与「没拿到」。
   */
  function parseIntfDetail(lists) {
    const out = {};
    INTF_TABS.forEach((tab) => {
      const rows = lists && Array.isArray(lists[tab.source]) ? lists[tab.source] : [];
      out[tab.key] = sortRows(rows);
    });
    return out;
  }

  /**
   * 按 sort 升序排序，**stable**：
   * 接口级修订记录的 sort 是 null（抓包实证），部署表 sort=0；
   * 同 sort 或都缺 sort 时保持后端给的原始顺序，不要打乱。
   * @param {Array} rows
   */
  function sortRows(rows) {
    return (rows || [])
      .map((r, i) => ({ r, i }))
      .sort((a, b) => {
        const sa = numOrNull(a.r && a.r.sort);
        const sb = numOrNull(b.r && b.r.sort);
        if (sa == null && sb == null) return a.i - b.i;
        if (sa == null) return 1;              // 没 sort 的排最后
        if (sb == null) return -1;
        return sa === sb ? a.i - b.i : sa - sb;
      })
      .map((x) => x.r);
  }

  function numOrNull(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // ═══════════════════════════════════════════════════════
  // 3) 分页（两个弹窗共用同一口径）
  // ═══════════════════════════════════════════════════════

  /** 总页数：至少 1 页（0 条时也显示「第 1 / 1 页」，与全站一致） */
  function totalPages(total, size) {
    const n = Number(total) || 0;
    const s = Number(size) || 1;
    return Math.max(1, Math.ceil(n / s));
  }

  /** 客户端分页切片（接口明细 5 个 tab 用；操作记录是后端分页） */
  function pageSlice(rows, page, size) {
    const list = rows || [];
    const s = Number(size) || 10;
    const p = Math.min(Math.max(1, Number(page) || 1), totalPages(list.length, s));
    const start = (p - 1) * s;
    return list.slice(start, start + s);
  }

  window.PublishDialogModel = Object.freeze({
    OP_TYPES,
    opTypeLabel,
    opTypeOptions,
    OP_COLS,
    MSG_COLS,
    REV_COLS,
    DEPLOY_COLS,
    INTF_TABS,
    parseIntfDetail,
    sortRows,
    totalPages,
    pageSlice,
    isMustText,
    blank,
  });
})();
