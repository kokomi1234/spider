/**
 * 订阅弹窗 — 纯业务模型（无 DOM 依赖）
 *
 * ── 职责 ──────────────────────────────────────────────
 * 从 subscribe-dialog.js 抽出的「输入数据 → 输出数据」的常量与纯函数。
 * 本模块只做值变换，不碰 DOM、不读 window 运行时状态（除挂自身接口外）；
 * 需要 DOM 的读写、事件绑定与流程编排留在 subscribe-dialog.js /
 * doc-picker.js，用到纯逻辑时调 window.SubscribeModel.*。
 *
 * 约定（与项目其它模块一致）：浏览器 IIFE，挂 window.SubscribeModel。
 */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════
  // 字典配置
  // ═══════════════════════════════════════════════════

  /** 把字符串数组转成 [{label, value}] */
  const opts = (arr) => arr.map((v) => (typeof v === 'string' ? { label: v, value: v } : v));

  /**
   * TODO(抓包后)：下面 4 个字典的真实选项还没有抓包，
   * 按项目铁律「没有抓包就不要写接口代码」，这里只放占位项、不臆造枚举值。
   * 拿到订阅表单的字典接口后，把数组换成真实 [{label, value}] 即可，其余代码不用动。
   */
  const DICT = {
    serviceMode:   opts(['直接调用', '通过MCIS', '通过IPS']),
    ifaceMode:     opts(['直接调用', '通过MCIS', '通过IPS']),
    mq:            opts(['TDMQ', 'IBMMQ', 'KAFKA']),
    msgCommType:   opts(['消息中心SDK', '腾讯原生SDK', '消息中心消息转换', '消息中心消息分发']),
    pageSize:      opts([{ label: '10 条', value: '10' }, { label: '30 条', value: '30' }, { label: '50 条', value: '50' }]),
    judgeRole:     opts(['调用方产品负责人', '服务方产品负责人']),
    yesNo:         opts(['是', '否', '无需幂等']),
  };

  /**
   * 字典没配时的占位文案。
   * ⚠️ 不要做成 `{ label, value: '' }` 的选项：那样它会被当成一个**可选项**，
   * 用户选中后字段静默为空，看起来像「选过了但没提交上去」。
   * 统一走 createSearchableSelect 的 setBusy(text)：面板里显示不可点的占位说明。
   */
  const PLACEHOLDER_TEXT = '（待抓包补全：此字典接口尚未抓包）';

  /**
   * 需要包成「可搜索下拉」的字段。
   *
   * source 决定选项来源：
   *   'provider'  → 调用方系统选项（与提供方共用同一次接口响应）
   *   'batch'     → AppServices.batchOptions（295 条批次，来自 conditions/subscribe）
   *   'dict'      → DICT[dict]（4 个字典 + yesNo；选项都很少，纯可搜索）
   *   'none'      → 暂无数据源 → 退化为可手输的输入框
   *
   * 历史：原 SELECT_FIELDS（7 个）走原生 <select>，虽然 theme.css 的 .sub-ctl
   * 已经做了 appearance:none + 自定义箭头，但**点击后弹出的 popup 是系统
   * 原生的**（白底/系统字体/系统滚动条），与可搜索下拉的 div 面板观感
   * 不一致。所以统一收进 SEARCHABLE_FIELDS，共用一套外观与展开面板。
   */
  const SEARCHABLE_FIELDS = [
    { id: 'sub_callerSystem',     source: 'provider' },
    { id: 'sub_callerServiceNo',  source: 'none' },
    { id: 'sub_callerBatch',      source: 'batch' },
    { id: 'sub_gatewayCode',      source: 'none' },
    { id: 'sub_groupContext',     source: 'none' },
    { id: 'sub_mcisCode',         source: 'none' },
    { id: 'sub_ipsCode',          source: 'none' },
    // 关联文档子弹窗的下拉也复用同一套面板，避免文档区出现原生 popup
    { id: 'docFilterBatch',       source: 'batch' },
    { id: 'docPageSize',          source: 'dict', dict: 'pageSize' },
    // ── 原标准下拉（选项都是 2-4 项的小字典）──
    { id: 'sub_serviceMode',      source: 'dict', dict: 'serviceMode' },
    { id: 'sub_ifaceMode',        source: 'dict', dict: 'ifaceMode' },
    { id: 'sub_mq',               source: 'dict', dict: 'mq' },
    { id: 'sub_msgOwner',         source: 'dict', dict: 'yesNo' },
    { id: 'sub_msgCommType',      source: 'dict', dict: 'msgCommType' },
    { id: 'sub_idempotent',       source: 'dict', dict: 'yesNo' },
    { id: 'sub_needCopy',         source: 'dict', dict: 'yesNo' },
  ];

  /**
   * SEARCHABLE_FIELDS 里属于「文档子弹窗」的两个 id。
   * createSearchableSelect 不是幂等的（每调一次就往父节点插一个 .searchable-select 容器），
   * 所以同一 <select> 只能被包一次：这两个由 doc-picker.js 建实例，
   * 主弹窗建实例时要按本表跳过。
   */
  const DOC_SEARCHABLE_IDS = ['docFilterBatch', 'docPageSize'];

  /** 纯文本字段（打开弹窗时按当前行预填 / 重置） */
  const TEXT_FIELDS = [
    'sub_serviceCnName', 'sub_taskNo', 'sub_protocol', 'sub_msgSpec', 'sub_codeSystem',
    'sub_tdmqCluster', 'sub_topicName', 'sub_subName', 'sub_noIdemReason', 'sub_implUnit',
    'sub_tpsDaily', 'sub_volumeDaily', 'sub_rtDaily',
    'sub_tpsPeak', 'sub_volumePeak', 'sub_rtPeak',
  ];

  // ═══════════════════════════════════════════════════
  // 文档（关联文档子弹窗）
  // ═══════════════════════════════════════════════════

  /**
   * 文档记录唯一 id（抓包确认字段是 value，其余候选名只是兜底）
   */
  function docId(d) {
    return String((d && (d.value || d.docInstId || d.id)) || '');
  }

  /** 只有成员文档（isMember === '1'）允许勾选 */
  function isMemberDoc(d) {
    return !!d && (d.isMember === '1' || d.isMember === 1);
  }

  /**
   * 文档行的展示字段兜底口径（唯一实现）。
   *
   * 原先 applyDocFilter（按 docNo/docName/batchNum 过滤）与 renderDocTable
   * （渲染三列）各写了一份一模一样的 `d.docNo || d.no || ''` 兜底，
   * 改字段名要改两处、漏一处就出现「能筛出来但列表里是空的」。这里收敛成一份。
   *
   * ⚠️ 返回值刻意不做 String() 强转：原实现里过滤侧强转（再 toLowerCase），
   * 渲染侧靠 esc() 强转，两侧口径本来就不同，保持原样才不会改变 `===` 比较结果。
   * toPickedDetails 的 6 字段口径与这里**不同**（docNo 没有 d.no 兜底），
   * 所以它不复用本函数。
   */
  function normalizeDoc(d) {
    const o = d || {};
    return {
      id:       docId(o),
      docNo:    o.docNo || o.no || '',
      docName:  o.docName || o.name || '',
      batchNum: o.batchNum || o.batch || '',
      member:   isMemberDoc(o),
    };
  }

  /**
   * 文档编号 / 名称模糊 + 批次精确 的前端过滤。
   * @param {Array} rows
   * @param {{kw?:string, batch?:string}} [cond] kw 已在调用侧 trim（此处再 trim+小写，口径不变）
   */
  function filterDocs(rows, cond) {
    cond = cond || {};
    const kw = String(cond.kw == null ? '' : cond.kw).trim().toLowerCase();
    const batch = cond.batch == null ? '' : cond.batch;
    return (rows || []).filter((d) => {
      const n = normalizeDoc(d);
      const docNo = String(n.docNo);
      const docName = String(n.docName);
      const docBatch = String(n.batchNum);
      const m1 = !kw || docNo.toLowerCase().includes(kw) || docName.toLowerCase().includes(kw);
      const m2 = !batch || docBatch === batch;
      return m1 && m2;
    });
  }

  /**
   * 让能操作的文档浮到上面：
   *   ① 已勾选的排最前（重开弹窗时一眼看得到上次选了谁）
   *   ② 非成员文档（不可勾选）排最后
   *   ③ 其余保持接口返回的原顺序
   * 只在筛选 / 打开时排一次，勾选本身不重排 —— 否则点了复选框行就跳走了。
   *
   * @param {Array} list
   * @param {Set|Array} selectedIds 已勾选 id 集合（Set 优先，数组也接受）
   */
  function sortDocs(list, selectedIds) {
    const sel = (selectedIds && typeof selectedIds.has === 'function')
      ? selectedIds
      : new Set(selectedIds || []);
    const rank = (d) => (sel.has(docId(d)) ? 0 : (isMemberDoc(d) ? 1 : 2));
    return (list || []).slice().sort((a, b) => rank(a) - rank(b));
  }

  /**
   * 已勾选文档 → 提交用的 6 字段明细。
   * 真实成功报文里这 6 个字段都有值（原先只传 id + 名称，其余发空串）。
   * ⚠️ docNo 只有 d.docNo、没有 d.no 兜底（与 normalizeDoc 口径不同，勿合并）。
   */
  function toPickedDetails(picked) {
    return (picked || []).map((d) => ({
      docInstId:    docId(d),
      docNo:        d.docNo || '',
      docName:      d.docName || d.name || '',
      batchNum:     d.batchNum || '',
      label:        d.label || '',
      templateCode: d.templateCode || '',
    }));
  }

  /**
   * 文档批次显示名映射（模式匹配）
   *
   * 批次分三类：
   *   1. 含 n6ydlpc → 26年6月独立批次（作废）
   *   2. dl 结尾    → XX年X月独立批次（如 269dl→26年9月独立, 2610dl→26年10月独立）
   *   3. 纯数字      → XXYY批次（如 2609→2609批次, 2611→2611批次）
   */
  function displayBatch(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    // 1. 作废批次（精确匹配）
    if (s === '26n6ydlpc') return '26年6月独立批次(作废)';
    // 2. dl 结尾的独立批次：提取前缀年月，转为「26年9月独立」格式
    if (/^\d+dl$/.test(s)) {
      const prefix = s.replace('dl', '');
      // 269 → 26年9月, 2610 → 26年10月
      const year = '20' + prefix.slice(0, 2);
      const month = prefix.slice(2);
      return `${year}年${month}月独立`;
    }
    // 3. 纯数字常规批次：直接「2609批次」
    if (/^\d+$/.test(s)) return s + '批次';
    // 兜底：未知格式原样返回
    return s;
  }

  /**
   * 批次显示名：优先用批次字典的 label，取不到再按批次号推。
   * @param {string} raw 批次号
   * @param {Array<{label,value}>} options 批次字典（原为 AppServices.batchOptions）
   */
  function batchLabel(raw, options) {
    const code = String(raw || '').trim();
    if (!code) return '';
    const hit = (options || []).find((o) => String(o.value) === code);
    if (hit && hit.label) return hit.label;
    return displayBatch(code);
  }

  /** 排序键：2606 / 2610dl / 344 都取前导数字，新批次排前面 */
  function batchSortKey(raw) {
    const m = /^(\d+)/.exec(String(raw || ''));
    return m ? Number(m[1]) : 0;
  }

  /**
   * 「文档投产批次」下拉选项：按当前文档去重生成，
   * 下拉里有的批次，列表里一定有文档，不会出现「选了批次却查不到东西」。
   * 一条文档都没有时退回全局批次字典（别让下拉空着）。
   *
   * @param {Array} docs 文档行
   * @param {Array<{label,value}>} fallback 全局批次字典
   */
  function buildDocBatchOptions(docs, fallback) {
    const map = new Map();
    (docs || []).forEach((d) => {
      const raw = String((d && (d.batchNum || d.batch)) || '').trim();
      if (raw && !map.has(raw)) map.set(raw, batchLabel(raw, fallback));
    });
    if (!map.size) {
      (fallback || []).forEach((o) => {
        if (o && o.value != null && String(o.value) !== '') map.set(String(o.value), o.label || String(o.value));
      });
    }
    return Array.from(map, ([value, label]) => ({ value, label }))
      .sort((a, b) => batchSortKey(b.value) - batchSortKey(a.value));
  }

  // ═══════════════════════════════════════════════════
  // 通用取值
  // ═══════════════════════════════════════════════════

  /** 从接口行里按候选字段名取第一个非空值 */
  function pickField(obj, keys) {
    for (const k of keys) {
      if (obj && obj[k] != null && obj[k] !== '') return String(obj[k]);
    }
    return '';
  }

  /** getJudgeInfo（har/userinfo.har）返回行的候选字段名 */
  const JUDGE_API_KEYS = {
    role:   ['judgeRoleName', 'roleName', 'role'],
    roleId: ['judgeRoleId', 'roleId'],
    no:     ['judgeUserId', 'userId', 'empNo'],
    name:   ['judgeName', 'userName', 'name'],
    dept:   ['judgeDeptName', 'orgName', 'teamName', 'dept'],
    deptId: ['judgeDeptId', 'teamId', 'deptId'],
  };

  /**
   * 角色名 → judgeRoleId。抓包（analysis/har/订阅.json 的两次 subscriptionReview）里
   * 「调用方产品负责人 = 03」「服务方产品负责人 = 05」两次完全一致，正好覆盖弹窗的角色字典。
   * 字典外的角色**不猜**：留空交给后端（宁可少发一个字段，也不要发错的角色号）。
   */
  const JUDGE_ROLE_IDS = {
    调用方产品负责人: '03',
    服务方产品负责人: '05',
  };

  /** 评委接口行 → 表格要填的字段（含提交报文要用的两个 id） */
  function judgeFieldsFromApi(it) {
    return {
      role:   pickField(it, JUDGE_API_KEYS.role),
      roleId: pickField(it, JUDGE_API_KEYS.roleId),
      no:     pickField(it, JUDGE_API_KEYS.no),
      name:   pickField(it, JUDGE_API_KEYS.name),
      dept:   pickField(it, JUDGE_API_KEYS.dept),
      deptId: pickField(it, JUDGE_API_KEYS.deptId),
    };
  }

  /**
   * 角色预填用选项：字典里没有这个角色（如接口新返回的角色）时临时并进去，避免下拉里选不中。
   * 返回原数组本身表示「不需要改」，调用方据此跳过 updateOptions（与原实现逐字一致）。
   */
  function roleOptionsWith(role, base) {
    const list = Array.isArray(base) ? base : [];
    if (!role || list.some((o) => o.value === role)) return list;
    return list.concat([{ value: role, label: role }]);
  }

  /**
   * getDocSysServeNoList 的返回值 → 可搜索下拉选项。
   * 兼容字符串与 {value,label} 两种形态；空 value 的条目丢弃。
   */
  function toServiceNoOptions(list) {
    return (list || [])
      .map((o) => {
        if (typeof o === 'string') return { value: o, label: o };
        const v = o.value != null ? String(o.value) : '';
        if (!v) return null;
        return { value: v, label: o.label != null ? String(o.label) : v };
      })
      .filter(Boolean);
  }

  /**
   * 评委行的 HTML 模板（纯字符串，无 DOM 依赖）。
   * 与拆分前逐字符一致：`<tr>` 上下文里纯空白文本节点会被解析器忽略，不影响结果。
   * 勾选框外面包了一层 <label class="chk-hit">：把整个单元格变成命中区（清单 B3），
   * 方框本体 18×18 的样式在 theme.css 的 .sub-tbl 一节，这里只负责结构。
   */
  const JUDGE_ROW_TEMPLATE = `
      <td class="c-chk"><label class="chk-hit"><input type="checkbox" class="judge-check" aria-label="选择该行"></label></td>
      <td class="c-idx judge-idx">—</td>
      <td><select class="judge-role sub-ctl"></select></td>
      <td><select class="judge-no sub-ctl" placeholder="请输入工号"></select></td>
      <td><input type="text" class="judge-name sub-input" placeholder="选中后自动带出"></td>
      <td><input type="text" class="judge-dept sub-input" placeholder="选中后自动带出"></td>
    `;

  /**
   * 全角数字 → 半角（"０５" → "05"）。
   * 为什么需要：中文输入法处于全角状态时敲出来的数字是全角字符，在 TPS 这类数值字段里
   * 肉眼几乎看不出区别，但正则不认、后端多半也不认，用户只会看到「请填数字」却看不出哪里错。
   * 收集表单（subscribe-dialog.js）与校验（validateSubscribe）共用这一个函数，避免规则漂移。
   */
  function normalizeDigits(v) {
    return String(v == null ? '' : v)
      .replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  }

  /**
   * 「调用方应用系统服务编号」推导：
   *   规则 = 调用方系统编号（如 E00406）+ 当前行服务编号尾部序号（如 TO1197）
   * 两处调用（调用方系统 change 联动、提交评委时兜底）共用一份，避免规则漂移。
   * 推不出来返回 ''（调用方按各自语义处理：一个清空、一个保持为空列表）。
   */
  function deriveCallerServiceNo(caller, sysServeNo) {
    const c = String(caller == null ? '' : caller).trim();
    const m = String(sysServeNo == null ? '' : sysServeNo).match(/(TO\d+)$/);
    if (c && m) return c + m[1];
    return '';
  }

  /**
   * 评委行 → 提交接口的 judgeInfoList。
   * 字段集与抓包（subscriptionReview）逐字对齐：每条评委 7 个键 ——
   * judgeName / judgeUserId / judgeDeptName / involvedProduct / judgeRoleName
   * / judgeRoleId / judgeDeptId（原先只发前 5 个，缺两个 id）。
   * judgeRoleId 优先按**当前角色名**查抓包映射（角色被改过也不会残留旧 id），
   * 映射里没有才退回接口带来的 roleId；judgeDeptId 由调用方从
   * 「拉取评委」的 judgeDeptId 或选中人员的 teamId 一路带下来。
   */
  function toJudgeInfoList(judges) {
    return (judges || []).map((j) => ({
      judgeName:       j.name,
      judgeUserId:     j.empNo,
      judgeDeptName:   j.dept,
      involvedProduct: '',
      judgeRoleName:   j.role,
      judgeRoleId:     JUDGE_ROLE_IDS[j.role] || j.roleId || '',
      judgeDeptId:     j.deptId || '',
    }));
  }

  // ═══════════════════════════════════════════════════
  // 校验（返回结构化结果，由调用方决定 toast / 聚焦）
  // ═══════════════════════════════════════════════════

  /**
   * 确认订阅前的必填校验。检查顺序（按表单从上到下，报第一个缺的）：
   *   行 → 服务编码 → 是否已订阅 → 调用方系统 → 关联文档 → 服务编号 → TPS(峰值)
   *   → 评委信息 → 任务编号
   *
   * 「调用方投产/变更批次」不在这里拦：该下拉当前并未进入请求体
   * （service-api 的 prodBatch 只取 row.prodBatch），拦了只会白挡用户，
   * 属于待业务口径确认的接线问题，不是校验问题。
   *
   * 评委信息（订阅弹窗修复，2026-09-17）：随订阅一并提交，**必填**；
   * 唯一豁免是 `judgeState.defaultsFetched` —— 本行已成功拉取默认评委
   * （评委来自后端、随订阅一并提交，用户不必手工维护）。
   * 任务编号：提交前必填，缺失时阻止提交并给明确提示。
   *
   * @param {object} row 当前行
   * @param {object} form collectForm() 的结果
   * @param {(code:string)=>boolean} [isSubscribed] 传 SubscribeManager.isSubscribed；
   *        不传则跳过「已在订阅列表」这一关
   * @param {{judges?:Array, defaultsFetched?:boolean}} [judgeState]
   *        judges=confirmSubscribe 收集的评委行（已按 empNo/name 过滤）；
   *        传了才做评委必填校验（只校验「有没有」，publishId 口径见 validateJudgeSubmit）
   * @returns {{ok:boolean, code:string, msg:string, duration:number, focus?:string, serverCoding?:string}}
   *          ok:false 且 msg 为空表示静默返回（无行数据）；
   *          focus 是出错字段的 DOM id（调用方负责把焦点/滚动落过去）
   */
  function validateSubscribe(row, form, isSubscribed, judgeState) {
    if (!row) return { ok: false, code: 'no-row', msg: '', duration: 0 };
    const serverCoding = row.serverCoding || row.sysServeNo || '';
    if (!serverCoding) {
      return { ok: false, code: 'no-coding', msg: '⚠️ 无法获取服务编码', duration: 2500 };
    }
    if (typeof isSubscribed === 'function' && isSubscribed(serverCoding)) {
      return { ok: false, code: 'subscribed', msg: '⚠️ 该服务已在订阅列表中', duration: 2500 };
    }
    if (!form || !form.callerSystem) {
      return { ok: false, code: 'no-caller', msg: '⚠️ 请选择调用方系统', duration: 2500, focus: 'sub_callerSystem' };
    }
    // 关联文档必填：空着提交时 service-api 只会发出 documents: []（后端必然拒），
    // 用户却要等一次往返才看到错。拦在前端，焦点落到这一行的「选 择」按钮上。
    // 例外：**预演模式**（订阅预演台 enable()，judgeState.dryRun）不拦 —— 文档列表来自
    // 真实接口，离线/内网拿不到时用户根本无从选择，拦了整条链路就试不动；
    // 预演只看报文，放行更可用（报文里 documents 会是空数组，预演台会明确标注）。
    const dryRun = !!(judgeState && judgeState.dryRun);
    if (!dryRun && !String(form.relDocIds || '').trim()) {
      return { ok: false, code: 'no-doc', msg: '⚠️ 请选择关联文档', duration: 2500, focus: 'sub_relDoc' };
    }
    // 调用方应用系统服务编号：表单没填还能靠派生救回来（= 调用方系统编号 + 行服务编号尾号 TOxxxx，
    // 见 deriveCallerServiceNo，service-api.js 会用同一规则拼 prodSysServeNoList）。
    // 派生不出来才是真缺 —— 那种请求 prodSysServeNoList 是空数组，等于订阅一条没有服务编号的记录。
    if (!String(form.callerServiceNo || '').trim()) {
      // 取编码的顺序必须与 service-api.js 的 providerSysServeNo 一致
      // （sysServeNo → serviceId → serverCoding），否则会出现「后端拼得出来、前端却拦」的假失败。
      const derived = deriveCallerServiceNo(
        form.callerSystem,
        row.sysServeNo || row.serviceId || row.serverCoding,
      );
      if (!derived) {
        return {
          ok: false, code: 'no-service-no',
          msg: '⚠️ 请选择调用方应用系统服务编号', duration: 2500, focus: 'sub_callerServiceNo',
        };
      }
    }
    // TPS（峰值）：既要有、也得是数字 —— 后端字段是数值型，
    // 手输 "abc" 会原样写进 prodTPSPeak（service-api.js:291）。
    // 全角数字先归一，免得用户被「请填数字」卡住却看不出哪里不对。
    const tps = normalizeDigits(form.perfPeak && form.perfPeak.tps).trim();
    if (!tps) {
      // 需要把焦点放回输入框，所以把目标 id 一并带出去
      return { ok: false, code: 'no-tps', msg: '⚠️ 请填写 TPS（峰值）', duration: 2500, focus: 'sub_tpsPeak' };
    }
    if (!/^\d+(\.\d+)?$/.test(tps) || Number(tps) <= 0) {
      return {
        ok: false, code: 'bad-tps',
        msg: '⚠️ TPS（峰值）请填大于 0 的数字', duration: 2500, focus: 'sub_tpsPeak',
      };
    }
    // 评委信息必填（随订阅一并提交，订阅弹窗修复）：一行有效评委都没有就拦。
    // 豁免：defaultsFetched —— 本行已成功拉取默认评委（评委来自后端、随订阅一并提交，
    // 用户不必手工维护）。焦点落到「拉取评委」按钮，让用户离最近的补救动作最近。
    const js = judgeState || null;
    if (js && Array.isArray(js.judges) && !js.judges.length && !js.defaultsFetched) {
      return {
        ok: false, code: 'no-judges',
        msg: '⚠️ 请先填写评委信息：点「⤓ 拉取评委」带入默认评委，或「＋ 新增」手工添加',
        duration: 3200, focus: 'btnFetchJudges',
      };
    }
    // 任务编号必填（订阅弹窗修复）：缺失时阻止提交并给明确提示。
    // 位于「基础信息」区（评委区之后），所以校验顺序排在评委之后。
    if (!String(form.taskNo || '').trim()) {
      return { ok: false, code: 'no-task-no', msg: '⚠️ 请填写任务编号', duration: 2500, focus: 'sub_taskNo' };
    }
    return { ok: true, code: '', msg: '', duration: 0, serverCoding };
  }

  /**
   * 提交评委信息前的校验（入参 judges 已由调用方按 empNo/name 过滤）。
   * @param {object} row 当前行
   * @param {Array} judges
   * @returns {{ok:boolean, code:string, msg:string, duration:number, publishId?:string}}
   */
  function validateJudgeSubmit(row, judges) {
    if (!row) return { ok: false, code: 'no-row', msg: '', duration: 0 };
    if (!judges || !judges.length) {
      return { ok: false, code: 'no-judges', msg: '⚠️ 请先添加评委信息', duration: 2500 };
    }
    const publishId = row.publishId || row.id || '';
    if (!publishId) {
      return { ok: false, code: 'no-publish-id', msg: '⚠️ 当前行缺少 publishId，无法提交评委信息', duration: 2800 };
    }
    return { ok: true, code: '', msg: '', duration: 0, publishId };
  }

  // ═══════════════════════════════════════════════════
  // 评委工号在线搜索的用户缓存
  // ═══════════════════════════════════════════════════

  /**
   * 已搜用户缓存工厂。
   *
   * 抓包（har/userinfo.har）确认：getUserList 只认「完整姓名」或「完整工号」，
   * 中间过程（如"郑梓""zheng"）后端直接返回 500 查询失败。所以搜到的人要沉淀下来，
   * 下次输入同一批人能立刻被本地过滤出来，行为就跟「调用方系统 / 批次」这些
   * 本地下拉一致。原先这份缓存是模块级单例（judgeUserCache），这里改成工厂，
   * 让状态归属调用方、也便于单测。
   *
   * @returns {{cacheUsers:(list:Array)=>void, cachedUserOptions:()=>Array, get:(id:string)=>object|undefined, size:number}}
   */
  function createUserCache() {
    const store = new Map();
    /** 搜到的人存进共享缓存，跨评委行复用 */
    function cacheUsers(list) {
      (list || []).forEach((u) => {
        if (u && u.userId) store.set(String(u.userId), u);
      });
    }
    /** 缓存里的全部已搜用户 → 下拉选项；组件会按当前输入实时过滤 */
    function cachedUserOptions() {
      return Array.from(store.values()).map((u) => ({
        value: u.userId,
        label: u.userName ? `${u.userName}（${u.userId}）` : String(u.userId),
      }));
    }
    /** 按工号取用户（原 judgeUserCache.get，键是 String(userId)） */
    function get(userId) {
      return store.get(userId);
    }
    return {
      cacheUsers,
      cachedUserOptions,
      get,
      get size() { return store.size; },
    };
  }

  window.SubscribeModel = Object.freeze({
    // 常量
    DICT,
    PLACEHOLDER_TEXT,
    SEARCHABLE_FIELDS,
    DOC_SEARCHABLE_IDS,
    TEXT_FIELDS,
    opts,
    // 文档
    docId,
    isMemberDoc,
    normalizeDoc,
    filterDocs,
    sortDocs,
    toPickedDetails,
    displayBatch,
    batchLabel,
    batchSortKey,
    buildDocBatchOptions,
    // 通用
    pickField,
    normalizeDigits,
    JUDGE_API_KEYS,
    JUDGE_ROLE_IDS,
    judgeFieldsFromApi,
    roleOptionsWith,
    toServiceNoOptions,
    JUDGE_ROW_TEMPLATE,
    deriveCallerServiceNo,
    toJudgeInfoList,
    // 校验
    validateSubscribe,
    validateJudgeSubmit,
    // 缓存工厂
    createUserCache,
  });
})();
