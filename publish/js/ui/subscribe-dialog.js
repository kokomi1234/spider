/**
 * 订阅弹窗模块
 *
 * ── 职责 ──────────────────────────────────────────────
 * 1. 点表格里的「订阅」不再直接订阅，先弹出模态对话框填单
 * 2. 基础信息表单区：28 个字段（纯文本 / 标准下拉 / 带搜索下拉 / 禁用框+选择按钮 / 多行文本）
 * 3. 「关联文档」：禁用输入框 + 「选择」按钮 → 打开文档选择子弹窗（筛选 + 分页 + 多选）
 * 4. 评委信息表格区：复选框 / 序号 / 评委角色 / 评委工号 / 评委姓名 / 评委部门，支持新增删除
 * 5. 底部：取消 / 确认
 *
 * ── 弹窗通用行为 ──────────────────────────────────────
 * 本模块不重复实现，统一用 js/ui/dialog-utils.js：
 *   - 打开即锁滚动（多级弹窗只锁一次，关最外层统一解锁）
 *   - 标题栏（.sub-head）可拖拽，重新打开弹窗时复位回居中
 *
 * ── 对外 ──────────────────────────────────────────────
 *   window.SubscribeDialog.open(row)   // row 为当前行的服务数据
 *   window.SubscribeDialog.close()
 *
 * ── 数据来源约定（重要）────────────────────────────────
 * 调用方系统        → 复用提供方系统选项 window.loadProviderList()
 * 调用方投产/变更批次 → AppServices.batchOptions（295 条，来自 conditions/subscribe 的 batchList）
 * 其余下拉字典       → 见下方 DICT，抓包后只需改这一处
 * 关联文档列表         → POST /itamp-tool/intfcMgmt/docList，通过 window.API.call() 代理转发
 */

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

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

  /** 纯文本字段（打开弹窗时按当前行预填 / 重置） */
  const TEXT_FIELDS = [
    'sub_serviceCnName', 'sub_taskNo', 'sub_protocol', 'sub_msgSpec', 'sub_codeSystem',
    'sub_tdmqCluster', 'sub_topicName', 'sub_subName', 'sub_noIdemReason', 'sub_implUnit',
    'sub_tpsDaily', 'sub_volumeDaily', 'sub_rtDaily',
    'sub_tpsPeak', 'sub_volumePeak', 'sub_rtPeak',
  ];

  // ═══════════════════════════════════════════════════
  // 状态
  // ═══════════════════════════════════════════════════

  let dom = null;              // DOM 引用集合
  let booted = null;           // 初始化 Promise（只跑一次）
  let selectInstances = {};    // id -> searchable-select 实例
  let typedValues = {};        // id -> 用户手输的文本（getValue 只认选中项，手输要单独记）
  let callerOptions = [];      // 调用方系统选项缓存

  let currentRow = null;       // 当前订阅的行数据
  let openSeq = 0;             // 弹窗会话号：open / close 各 +1，用来丢弃「关窗后才回来的异步响应」
  let submitting = false;      // 确认订阅 in-flight 锁：防连点重复提交
  let judgeFetching = false;   // 评委拉取 in-flight 锁：同上
  let returnFocus = null;      // 关闭后要还原的焦点
  let dragInstances = {};      // 'sub' / 'doc' → dialog-utils 的拖拽句柄（含 reset）
  let judgeSeq = 0;            // 评委行自增 id
  /** userId -> 用户对象。跨评委行共享，搜过的人下次输入能立刻被本地过滤出来 */
  const judgeUserCache = new Map();

  // 文档选择子弹窗状态
  let docAllRows = [];          // 当前调用方系统下的全部文档行（前端内存分页的数据源）
  let docBackendTotal = 0;      // 后端声明的总数（可能大于实际拿到的，用于提示截断）
  let docTruncated = false;     // 是否因上限没拉全
  let docPickedDetails = [];    // 已勾选文档的完整明细（提交时要用到真实报文里的 6 个字段）
  let docLoadedFor = '';        // 已成功拉过文档的调用方系统编号（空结果也算拉过，避免每次打开重复请求）
  let docFiltered = [];
  let docSelected = new Set();
  let docPage = 1;
  let docSize = 10;

  // ═══════════════════════════════════════════════════
  // 小工具
  // ═══════════════════════════════════════════════════

  function toast(msg, duration = 2500, type = 'info') {
    const notify = window.AppServices && window.AppServices.toast;
    if (typeof notify === 'function') {
      notify(msg, duration, type);
      return;
    }
    const toast = window.AppServices && window.AppServices.toast;
    if (typeof toast === 'function') {
      toast(msg, duration, type);
      return;
    }
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), duration);
  }

  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * 读取「可搜索下拉」手输的文本。
   *
   * 组件的 getValue() 只在选中了选项时才有值，纯手输读不到，
   * 所以这里额外记一份输入框里的文本。
   * 监听器挂在父节点的捕获阶段：组件自己的 input 监听器会在展开下拉时
   * 先把输入框清空，只有在它之前取值才拿得到用户刚敲的内容。
   */
  function bindTypedCapture(key, el) {
    const host = el && el.parentElement;
    if (!host) return;
    host.addEventListener('input', () => {
      const box = host.querySelector('.searchable-select .searchable-select-input');
      if (box) typedValues[key] = String(box.value || '').trim();
    }, true);
  }

  function searchableText(key, el) {
    const typed = typedValues[key];
    if (typed) return typed;
    if (!el || !el.parentElement) return '';
    const box = el.parentElement.querySelector('.searchable-select .searchable-select-input');
    return box ? String(box.value || '').trim() : '';
  }

  /** 给原生 <select> 灌选项（空字典只留「请选择」，不再塞一个空值占位项） */
  function fillSelect(sel, list) {
    if (!sel) return;
    const arr = (list && list.length) ? list : [];
    sel.innerHTML = '';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '请选择';
    sel.appendChild(blank);
    arr.forEach((o) => {
      const op = document.createElement('option');
      op.value = o.value;
      op.textContent = o.label;
      sel.appendChild(op);
    });
    sel.value = '';
  }

  // ═══════════════════════════════════════════════════
  // 初始化（首次打开时执行一次）
  // ═══════════════════════════════════════════════════

  function collectDom() {
    dom = {
      overlay:   $('#subscribeOverlay'),
      dialog:    $('#subscribeDialog'),
      btnClose:  $('#btnSubClose'),
      btnCancel: $('#btnSubCancel'),
      btnConfirm:$('#btnSubConfirm'),
      relDoc:    $('#sub_relDoc'),
      relDocIds: $('#sub_relDocIds'),
      btnPickDoc:$('#btnSelectDoc'),
      remark:    $('#sub_remark'),
      tpsPeak:   $('#sub_tpsPeak'),
      callerSys: $('#sub_callerSystem'),

      judgeBody:      $('#judgeTableBody'),
      judgeEmptyHint: $('#judgeEmptyHint'),
      judgeAll:       $('#judgeCheckAll'),
      btnAddJudge:$('#btnAddJudge'),
      btnDelJudge:$('#btnRemoveJudge'),
      btnFetchJudges: $('#btnFetchJudges'),
      btnSubmitJudges: $('#btnSubmitJudges'),

      docOverlay: $('#docSelectOverlay'),
      docDialog:  $('#docSelectDialog'),
      btnDocClose:$('#btnDocClose'),
      btnDocCancel:$('#btnDocCancel'),
      btnDocConfirm:$('#btnDocConfirm'),
      btnDocSearch:$('#btnDocSearch'),
      btnDocReset: $('#btnDocReset'),
      docFilterNo: $('#docFilterNo'),
      docFilterBatch: $('#docFilterBatch'),
      docBody:    $('#docTableBody'),
      docCheckAll:$('#docCheckAll'),
      docTotal:   $('#docTotalInfo'),
      docPageInfo:$('#docPageInfo'),
      docPageSize:$('#docPageSize'),
      docPageJump:$('#docPageJump'),
      btnDocPrev: $('#btnDocPrev'),
      btnDocNext: $('#btnDocNext'),
    };
    return dom.overlay && dom.dialog;
  }

  async function boot() {
    if (booted) return booted;

    booted = (async () => {
      if (!collectDom()) {
        console.warn('[SubscribeDialog] 弹窗 DOM 不存在，模块未启用');
        return;
      }

      // 调用方系统复用提供方系统选项（与提供方共用同一次接口响应，不会多发请求）
      try {
        if (typeof window.loadProviderList === 'function') {
          callerOptions = await window.loadProviderList();
        }
      } catch (e) {
        console.warn('[SubscribeDialog] 调用方系统选项加载失败，降级为空列表:', e.message);
        callerOptions = [];
      }

      // SEARCHABLE_FIELDS 现在包含弹窗所有 select（包括文档子弹窗），
      // 一并由 buildSearchableSelects() 处理，这里不再单独 fillSelect。
      buildSearchableSelects();
      bindEvents();
      wireDialogBehaviors();
      renderJudgeTable();
    })();

    return booted;
  }

  function buildSearchableSelects() {
    if (typeof window.createSearchableSelect !== 'function') {
      console.warn('[SubscribeDialog] searchable-select 未加载，带搜索下拉退化为普通下拉');
      SEARCHABLE_FIELDS.forEach((f) => fillSelect($('#' + f.id), resolveOptions(f)));
      return;
    }
    SEARCHABLE_FIELDS.forEach((f) => {
      const el = $('#' + f.id);
      if (!el || selectInstances[f.id]) return;
      const list = resolveOptions(f);
      selectInstances[f.id] = window.createSearchableSelect(el, list, {});
      if (!list || !list.length) {
        // 空字典给一个不可选的说明，避免下拉看起来「坏了」或被误选成空值
        selectInstances[f.id].setBusy(PLACEHOLDER_TEXT);
      }
      bindTypedCapture(f.id, el);
    });
  }

  /**
   * 弹窗通用行为：滚动锁定 + 标题栏拖拽。
   * 具体逻辑在 js/ui/dialog-utils.js，这里只负责把两个弹窗接上去。
   */
  function wireDialogBehaviors() {
    const du = window.DialogUtils;
    if (!du) return;
    dragInstances.sub = du.makeDraggable(dom.dialog, dom.dialog.querySelector('.sub-head'));
    dragInstances.doc = du.makeDraggable(dom.docDialog, dom.docDialog.querySelector('.sub-head'));
  }

  /**
   * 跨模块取值：统一优先 `window.AppServices`，回退旧的 `window._私有桥`（仅兼容）。
   * 项目铁律禁止新增 window._桥；这两个读取点此前直接读旧桥，现改为先查注册表。
   */
  function batchOptions() {
    const as = window.AppServices;
    return (as && as.batchOptions) || [];
  }
  function prodBatchInstance() {
    const as = window.AppServices;
    return (as && as.prodBatchInstance) || null;
  }

  function resolveOptions(f) {
    if (f.source === 'provider') return callerOptions;
    if (f.source === 'batch') return batchOptions();
    if (f.source === 'dict') return DICT[f.dict] || [];
    return [];
  }

  // ═══════════════════════════════════════════════════
  // 事件绑定
  // ═══════════════════════════════════════════════════

  function bindEvents() {
    dom.btnClose.addEventListener('click', close);
    dom.btnCancel.addEventListener('click', close);
    dom.btnConfirm.addEventListener('click', confirmSubscribe);

    dom.overlay.addEventListener('click', (e) => { if (e.target === dom.overlay) close(); });

    // 关联文档
    dom.btnPickDoc.addEventListener('click', openDocDialog);
    dom.btnDocClose.addEventListener('click', closeDocDialog);
    dom.btnDocCancel.addEventListener('click', closeDocDialog);
    dom.btnDocConfirm.addEventListener('click', confirmDocSelection);
    dom.btnDocSearch.addEventListener('click', () => { docPage = 1; applyDocFilter(); });

    // 文档编号：输入即筛（250ms 防抖），不必再点「查询」
    let docFilterTimer = null;
    dom.docFilterNo.addEventListener('input', () => {
      clearTimeout(docFilterTimer);
      docFilterTimer = setTimeout(() => { docPage = 1; applyDocFilter(); }, 250);
    });
    dom.docFilterNo.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();          // 别冒泡到 index.js 的全局「回车即查询」
      e.stopPropagation();
      clearTimeout(docFilterTimer);
      docPage = 1;
      applyDocFilter();
    });

    // 文档批次：选完立刻过滤（searchable-select 选中/清除都会向原 <select> 派发 change）
    dom.docFilterBatch.addEventListener('change', () => { docPage = 1; applyDocFilter(); });

    dom.btnDocReset.addEventListener('click', () => {
      dom.docFilterNo.value = '';
      if (selectInstances.docFilterBatch) selectInstances.docFilterBatch.clear();
      else dom.docFilterBatch.value = '';
      docPage = 1;
      applyDocFilter();
    });
    dom.docOverlay.addEventListener('click', (e) => { if (e.target === dom.docOverlay) closeDocDialog(); });

    dom.btnDocPrev.addEventListener('click', () => { if (docPage > 1) { docPage--; renderDocTable(); } });
    dom.btnDocNext.addEventListener('click', () => { if (docPage < docTotalPages()) { docPage++; renderDocTable(); } });
    dom.docPageSize.addEventListener('change', (e) => {
      docSize = Number(e.target.value) || 10;
      docPage = 1;
      renderDocTable();
    });
    dom.docPageJump.addEventListener('change', () => {
      const n = Number(dom.docPageJump.value);
      if (n >= 1 && n <= docTotalPages()) { docPage = n; renderDocTable(); }
    });
    dom.docCheckAll.addEventListener('change', toggleDocAll);

    // 调用方系统 → 联动自动填入「调用方应用系统服务编号」：
    //   规则 = 调用方系统编号（如 E00406）+ 当前行服务编号尾部序号（如 TO1197）
    //   searchable-select 选中/清除时都会向原 <select> 派发 change（bubbles）
    dom.callerSys.addEventListener('change', () => {
      const caller = String(dom.callerSys.value || '').trim();
      const inst = selectInstances['sub_callerServiceNo'];
      if (!inst) return;
      const sysServeNo = (currentRow && (currentRow.sysServeNo || currentRow.serverCoding)) || '';
      const m = sysServeNo.match(/(TO\d+)$/);
      if (caller && m) {
        const no = caller + m[1];
        try { inst.updateOptions([{ value: no, label: no }]); } catch (_) { /* 忽略 */ }
        try { inst.setValue(no); } catch (_) { /* 忽略 */ }
      } else {
        try { inst.clear(); } catch (_) { /* 忽略 */ }
      }
    });

    // 评委信息
    dom.btnAddJudge.addEventListener('click', () => { addJudgeRow(); renderJudgeTable(); });
    dom.btnDelJudge.addEventListener('click', removeSelectedJudges);
    dom.judgeAll.addEventListener('change', toggleJudgeAll);
    if (dom.btnFetchJudges) dom.btnFetchJudges.addEventListener('click', fetchJudges);
    if (dom.btnSubmitJudges) dom.btnSubmitJudges.addEventListener('click', submitJudges);

    // ESC：先关子弹窗，再关主弹窗
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (dom.docOverlay.classList.contains('show')) closeDocDialog();
      else if (dom.overlay.classList.contains('show')) close();
    });
  }

  // ═══════════════════════════════════════════════════
  // 打开 / 关闭
  // ═══════════════════════════════════════════════════

  async function open(row) {
    if (!row) return;
    await boot();
    if (!dom || !dom.overlay) return;

    currentRow = row;
    openSeq += 1;               // 新会话：之前那次提交的迟到响应一律作废
    submitting = false;
    returnFocus = document.activeElement;
    resetForm();

    // 锁滚动 + 复位到居中（上次拖到哪都算重来）
    if (window.DialogUtils) window.DialogUtils.lockScroll();
    if (dragInstances.sub) dragInstances.sub.reset();

    dom.overlay.style.display = 'flex';
    requestAnimationFrame(() => dom.overlay.classList.add('show'));
    if (dom.dialog) dom.dialog.focus();
  }

  function close() {
    if (!dom || !dom.overlay) return;
    openSeq += 1;               // 关窗即作废：在途的订阅/评委请求回来时不再回写界面
    // 关最外层时子弹窗可能还开着 → 顺手一起关，然后一次性解锁
    if (dom.docOverlay && dom.docOverlay.classList.contains('show')) closeDocDialog();
    dom.overlay.classList.remove('show');
    setTimeout(() => { dom.overlay.style.display = 'none'; }, 200);
    if (window.DialogUtils) window.DialogUtils.forceUnlockAll();
    if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
    returnFocus = null;
    currentRow = null;
  }

  /** 每次打开都回到干净状态，并按当前行预填已知字段 */
  function resetForm() {
    const row = currentRow || {};

    // 所有可搜索下拉（SEARCHABLE_FIELDS 覆盖原本的标准下拉）一并在 selectInstances 里
    Object.keys(selectInstances).forEach((id) => {
      try { selectInstances[id].clear(); } catch (_) { /* 忽略未初始化实例 */ }
    });
    typedValues = {};

    TEXT_FIELDS.forEach((id) => { const el = $('#' + id); if (el) el.value = ''; });
    dom.tpsPeak.value = '5';  // TPS（峰值）默认值
    dom.remark.value = '';
    dom.relDoc.value = '';
    dom.relDocIds.value = '';
    docPickedDetails = [];

    docSelected = new Set();
    judgeSeq = 0;
    // 只移除数据行
    dom.judgeBody.querySelectorAll('tr.judge-row').forEach((tr) => {
      if (tr._noInstance) { try { tr._noInstance.destroy(); } catch (_) {} }
      if (tr._roleInstance) { try { tr._roleInstance.destroy(); } catch (_) {} }
      tr.remove();
    });
    dom.judgeAll.checked = false;

    // 默认两个评委行：调用方产品负责人 + 服务方产品负责人
    addDefaultJudgeRow('调用方产品负责人');
    addDefaultJudgeRow('服务方产品负责人');

    renderJudgeTable();

    // 用当前行的信息预填：服务中文名 / 编号类字段
    $('#sub_serviceCnName').value = row.sysServeName || row.serverName || row.serviceName || '';
    const taskNo = row.taskNo || row.sheetNo || '';
    if (taskNo) $('#sub_taskNo').value = taskNo;

    // 跟随首页已选的提供方批次：如果用户在首页选了批次，订阅弹窗自动填入
    if (selectInstances['sub_callerBatch'] && prodBatchInstance()) {
      const homeBatch = prodBatchInstance().value;
      if (homeBatch) {
        try { selectInstances['sub_callerBatch'].setValue(homeBatch); } catch (_) { /* 忽略 */ }
      }
    }
  }

  // ═══════════════════════════════════════════════════
  // 确认订阅
  // ═══════════════════════════════════════════════════

  function collectForm() {
    const val = (id) => { const el = $('#' + id); return el ? String(el.value || '').trim() : ''; };
    const selVal = (id) => {
      const inst = selectInstances[id];
      // 带搜索下拉允许手输：组件的 getValue() 只在选中了选项时才有值，
      // 纯手输的场景要退回输入框里的文本，否则用户填了也读不到
      if (inst) return String(inst.getValue() || '').trim() || searchableText(id, $('#' + id));
      return val(id);
    };

    return {
      // 基础信息
      callerSystem:        selVal('sub_callerSystem'),
      relDocIds:           dom.relDocIds.value,
      relDocNames:         dom.relDoc.value,
      relDocDetails:       docPickedDetails,   // 完整文档明细（见 confirmDocSelection）
      callerServiceNo:     selVal('sub_callerServiceNo'),
      serviceCnName:       val('sub_serviceCnName'),
      serviceMode:         selVal('sub_serviceMode'),
      callerBatch:         selVal('sub_callerBatch'),
      taskNo:              val('sub_taskNo'),
      protocol:            val('sub_protocol'),
      msgSpec:             val('sub_msgSpec'),
      codeSystem:          val('sub_codeSystem'),
      ifaceMode:           selVal('sub_ifaceMode'),
      gatewayCode:         selVal('sub_gatewayCode'),
      groupContext:        selVal('sub_groupContext'),
      mcisCode:            selVal('sub_mcisCode'),
      ipsCode:             selVal('sub_ipsCode'),
      mq:                  selVal('sub_mq'),
      tdmqCluster:         val('sub_tdmqCluster'),
      topicName:           val('sub_topicName'),
      msgOwner:            selVal('sub_msgOwner'),
      msgCommType:         selVal('sub_msgCommType'),
      subName:             val('sub_subName'),
      idempotent:          selVal('sub_idempotent'),
      noIdemReason:        val('sub_noIdemReason'),
      implUnit:            val('sub_implUnit'),
      needCopy:            selVal('sub_needCopy'),
      // 性能指标
      perfDaily: { tps: val('sub_tpsDaily'), volume: val('sub_volumeDaily'), rt: val('sub_rtDaily') },
      perfPeak:  { tps: val('sub_tpsPeak'),  volume: val('sub_volumePeak'),  rt: val('sub_rtPeak') },
      // 其它
      remark:              dom.remark.value.trim(),
      judges:              collectJudges(),
      // 冗余一份 label（这些字段 value === label，所以等于 selVal）
      _labels: {
        serviceMode: selVal('sub_serviceMode'),
        ifaceMode:   selVal('sub_ifaceMode'),
        mq:          selVal('sub_mq'),
        msgCommType: selVal('sub_msgCommType'),
      },
    };
  }

  async function confirmSubscribe() {
    if (!currentRow) return;
    const serverCoding = currentRow.serverCoding || currentRow.sysServeNo || '';
    if (!serverCoding) {
      toast('⚠️ 无法获取服务编码', 2500, 'warn');
      return;
    }
    if (window.SubscribeManager && window.SubscribeManager.isSubscribed(serverCoding)) {
      toast('⚠️ 该服务已在订阅列表中', 2500, 'warn');
      return;
    }
    const form = collectForm();
    if (!form.callerSystem) {
      toast('⚠️ 请选择调用方系统', 2500, 'warn');
      return;
    }
    if (!form.perfPeak.tps) {
      dom.tpsPeak.focus();
      toast('⚠️ 请填写 TPS（峰值）', 2500, 'warn');
      return;
    }

    // 提交锁：写请求期间禁掉确认按钮并挡住重入 —— 否则连点会发两次订阅
    if (submitting) return;
    submitting = true;
    const seq = openSeq;
    if (dom && dom.btnConfirm) dom.btnConfirm.disabled = true;

    const api = window.ServiceApi;
    let res = { ok: true, local: true };
    try {
      if (api && typeof api.subscribeWithForm === 'function') {
        res = await api.subscribeWithForm(currentRow, form);  // 传整个 row
      } else if (api && typeof api.subscribe === 'function') {
        res = await api.subscribe(serverCoding);
      }
    } catch (e) {
      res = { ok: false, error: (e && e.message) || String(e) };
    } finally {
      submitting = false;
      if (dom && dom.btnConfirm) dom.btnConfirm.disabled = false;
    }

    // 弹窗在等响应期间被关掉 / 换了一行 → 只报结果，不回写界面，避免幽灵行与错位的 toast
    if (seq !== openSeq) {
      if (res && res.ok) toast(`✅ 已订阅: ${serverCoding}`, 2200, 'success');
      else toast(`⚠️ 订阅失败：${(res && res.error) || '未知错误'}`, 3000, 'error');
      return;
    }

    if (!res || !res.ok) {
      toast(`⚠️ 订阅失败：${(res && res.error) || '未知错误'}`, 3000, 'error');
      return;
    }

    if (window.SubscribeManager) window.SubscribeManager.add(serverCoding);
    toast(`✅ 已订阅: ${serverCoding}`, 2200, 'success');
    close();

    // 让列表页自己刷新（订阅状态 / 统计 / 分页），避免模块反向依赖 index.js 内部函数
    const refresh = window.AppServices && window.AppServices.afterSubscribeChanged;
    if (typeof refresh === 'function') {
      try { refresh(); } catch (e) { console.error(e); }
    } else if (window.AppServices && typeof window.AppServices.afterSubscribeChanged === 'function') {
      try { window.AppServices.afterSubscribeChanged(); } catch (e) { console.error(e); }
    }
  }

  // ═══════════════════════════════════════════════════
  // 评委信息表格
  // ═══════════════════════════════════════════════════

  /** 创建一行，可选预填角色 */
  function addJudgeRow(role) {
    const tr = document.createElement('tr');
    tr.className = 'judge-row';
    tr.dataset.id = ++judgeSeq;
    tr.innerHTML = `
      <td class="c-chk"><input type="checkbox" class="judge-check" aria-label="选择该行"></td>
      <td class="c-idx judge-idx">—</td>
      <td><select class="judge-role sub-ctl"></select></td>
      <td><select class="judge-no sub-ctl" placeholder="请输入工号"></select></td>
      <td><input type="text" class="judge-name sub-input" placeholder="选中后自动带出"></td>
      <td><input type="text" class="judge-dept sub-input" placeholder="选中后自动带出"></td>
    `;
    dom.judgeBody.appendChild(tr);

    const roleSel = tr.querySelector('.judge-role');
    // 评委角色：选项来自 DICT.judgeRole；走可搜索下拉与「服务方式」等保持外观一致
    if (typeof window.createSearchableSelect === 'function') {
      const roleKey = 'judge-role-' + judgeSeq;
      tr._roleKey = roleKey;
      const roleList = DICT.judgeRole || [];
      tr._roleInstance = window.createSearchableSelect(roleSel, roleList, { placeholder: '请选择' });
      if (!roleList.length) tr._roleInstance.setBusy(PLACEHOLDER_TEXT);
      bindTypedCapture(roleKey, roleSel);
      // 预填角色
      if (role && tr._roleInstance) {
        try {
          const base = Array.isArray(DICT.judgeRole) ? DICT.judgeRole : [];
          if (!base.some((o) => o.value === role)) {
            tr._roleInstance.updateOptions(base.concat([{ value: role, label: role }]));
          }
          tr._roleInstance.setValue(role);
        } catch (_) { /* 忽略 */ }
      }
    } else {
      fillSelect(roleSel, DICT.judgeRole);
      if (role) {
        const opts = roleSel.querySelectorAll('option');
        for (let i = 0; i < opts.length; i++) {
          if (opts[i].value === role) { roleSel.selectedIndex = i; break; }
        }
      }
    }

    // 评委工号：可搜索下拉 + 按姓名在线搜索（UserApi，来自 har/userinfo.har 抓包）
    const noSel = tr.querySelector('.judge-no');
    const noKey = 'judge-no-' + judgeSeq;
    tr._noKey = noKey;
    tr._userMap = {};   // userId -> 用户对象，选中工号后联动姓名/部门
    if (typeof window.createSearchableSelect === 'function') {
      tr._noInstance = window.createSearchableSelect(noSel, [], {});
      bindTypedCapture(noKey, noSel);
      bindJudgeUserSearch(tr, noSel);
    } else {
      fillSelect(noSel, []);
    }
    tr.querySelector('.judge-check').addEventListener('change', syncJudgeAllState);
    return tr;
  }

  /** 快捷创建默认评委行（只填角色，不搜人） */
  function addDefaultJudgeRow(role) {
    addJudgeRow(role);
  }

  // ═══════════════════════════════════════════════════
  // 评委工号在线搜索
  // ═══════════════════════════════════════════════════

  // 抓包（har/userinfo.har）确认：getUserList 只认「完整姓名」或「完整工号」，
  // 中间过程（如“郑梓”“zheng”）后端直接返回 500 查询失败。所以这里：
  //   ① 边输入边搜（不等点按钮），失败/无结果时把原因写进下拉面板，而不是静默；
  //   ② 搜到的人沉淀进 judgeUserCache，下次输入同一批人能立刻被本地过滤出来，
  //      行为就跟「调用方系统 / 批次」这些本地下拉一致。
  const JUDGE_SEARCH_MIN = 2;      // 少于 2 个字不打请求
  const JUDGE_SEARCH_DELAY = 300;  // 防抖：够快又不至于每个字母都发请求

  /** 搜到的人存进共享缓存，跨评委行复用 */
  function cacheUsers(list) {
    (list || []).forEach((u) => {
      if (u && u.userId) judgeUserCache.set(String(u.userId), u);
    });
  }

  /** 缓存里的全部已搜用户 → 下拉选项；组件会按当前输入实时过滤 */
  function cachedUserOptions() {
    return Array.from(judgeUserCache.values()).map((u) => ({
      value: u.userId,
      label: u.userName ? `${u.userName}（${u.userId}）` : String(u.userId),
    }));
  }

  /** 结果回来时面板若不巧关了就再展开一次（只在输入框仍有焦点时，避免抢焦点） */
  function ensurePanelOpen(inst, targetEl) {
    if (!inst || inst.isOpen()) return;
    const host = targetEl && targetEl.parentElement;
    const box = host && host.querySelector('.searchable-select .searchable-select-input');
    if (box && document.activeElement === box) inst.open();
  }

  /** 评委工号：输入即搜 + 本地缓存即时过滤，选中后带出姓名/部门 */
  function bindJudgeUserSearch(tr, noSel) {
    const host = noSel && noSel.parentElement;
    if (!host) return;
    let timer = null;
    let searchSeq = 0;   // 防竞态：只认最后一次搜索的结果

    const readInput = () => {
      const box = host.querySelector('.searchable-select .searchable-select-input');
      return box ? String(box.value || '').trim() : '';
    };

    /** 核心搜索逻辑：读取输入框内容并触发异步搜索（抽取为函数以便 input / compositionend 复用） */
    function doSearch() {
      const kw = readInput();
      const inst = tr._noInstance;
      clearTimeout(timer);

      if (kw.length < JUDGE_SEARCH_MIN) {
        if (inst) inst.setBusy('');
        return;
      }
      if (inst) inst.setBusy('搜索中…');

      timer = setTimeout(async () => {
        if (!window.UserApi || typeof window.UserApi.fetchUserList !== 'function') return;
        const seq = ++searchSeq;
        const r = await window.UserApi.fetchUserList(kw);
        const inst2 = tr._noInstance;
        if (seq !== searchSeq || !inst2) return;
        if (readInput() !== kw) return;

        try {
          if (r && r.ok && r.list.length) {
            cacheUsers(r.list);
            inst2.updateOptions(cachedUserOptions());
          } else if (r && r.ok) {
            inst2.setBusy('未找到匹配用户（接口只认完整姓名或工号）');
          } else {
            inst2.setBusy(`⚠️ 搜索失败：${(r && r.error) || '未知错误'}`);
          }
          ensurePanelOpen(inst2, noSel);
        } catch (_) { /* 实例已销毁（行被删除），忽略 */ }
      }, JUDGE_SEARCH_DELAY);
    }

    // 非 IME 输入法：实时输入时立即搜索
    host.addEventListener('input', (e) => {
      if (e && e.isComposing) return;   // 仅跳过 IME 组字中的中间状态
      doSearch();
    }, true);

    // 中文输入法确认候选词后搜索
    host.addEventListener('compositionend', () => {
      doSearch();
    }, true);

    // searchable-select 选中项时会向原 <select> 派发 change → 自动带出姓名/部门
    noSel.addEventListener('change', () => {
      const u = judgeUserCache.get(noSel.value) || (tr._userMap && tr._userMap[noSel.value]);
      if (!u) return;
      const nameEl = tr.querySelector('.judge-name');
      const deptEl = tr.querySelector('.judge-dept');
      if (nameEl) nameEl.value = u.userName || '';
      // 部门要的是小组级的 teamName（如「中国银行软件中心（深圳）开发三部」），
      // orgName 只有到软件中心一级，所以 teamName 优先。
      if (deptEl) deptEl.value = u.teamName || u.orgName || deptEl.value;
    });
  }

  /** 从接口行里按候选字段名取第一个非空值 */
  function pickField(obj, keys) {
    for (const k of keys) {
      if (obj && obj[k] != null && obj[k] !== '') return String(obj[k]);
    }
    return '';
  }

  /** ⤓ 拉取评委（ToolApi.getJudgeInfo）：按当前组件编号 + 调用方系统拉取并填充表格 */
  async function fetchJudges() {
    if (!currentRow) return;
    if (!window.ToolApi || typeof window.ToolApi.fetchJudgeInfo !== 'function') {
      toast('⚠️ ToolApi 未加载', 2200, 'warn');
      return;
    }
    const compNum = currentRow.assemblyNo || currentRow.provideSystemNumber || currentRow.compNum || '';
    if (!compNum) {
      toast('⚠️ 当前行缺少组件编号（assemblyNo），无法拉取评委', 2800, 'warn');
      return;
    }
    // 拉取期间禁掉按钮 + 记会话号：连点只会发一次，关窗/换行后回来的数据直接丢弃
    if (judgeFetching) return;
    judgeFetching = true;
    const seq = openSeq;
    const btn = dom && dom.btnFetchJudges;
    if (btn) btn.disabled = true;

    const form = collectForm();
    toast('评委信息拉取中…', 2000);
    let r = null;
    try {
      r = await window.ToolApi.fetchJudgeInfo({
        compNum,
        principal: '',
        callerComponent: form.callerSystem || '',
      });
    } catch (e) {
      r = { ok: false, error: (e && e.message) || String(e) };
    } finally {
      judgeFetching = false;
      if (btn) btn.disabled = false;
    }

    if (seq !== openSeq) return;            // 弹窗已关闭 / 换了行 → 别往已失效的表格里写
    if (!r || !r.ok) {
      toast(`⚠️ 拉取失败：${(r && r.error) || '未知错误'}`, 3000, 'error');
      return;
    }
    if (!r.list.length) {
      toast('接口未返回评委数据', 2500, 'warn');
      return;
    }
    // 清空现有行再填充
    dom.judgeBody.querySelectorAll('tr.judge-row').forEach((tr) => {
      if (tr._noInstance) { try { tr._noInstance.destroy(); } catch (_) {} }
      if (tr._roleInstance) { try { tr._roleInstance.destroy(); } catch (_) {} }
      tr.remove();
    });
    r.list.forEach((it) => {
      const tr = addJudgeRow();
      const role = pickField(it, ['judgeRoleName', 'roleName', 'role']);
      const no = pickField(it, ['judgeUserId', 'userId', 'empNo']);
      const name = pickField(it, ['judgeName', 'userName', 'name']);
      const dept = pickField(it, ['judgeDeptName', 'orgName', 'teamName', 'dept']);
      const nameEl = tr.querySelector('.judge-name');
      const deptEl = tr.querySelector('.judge-dept');
      if (name) nameEl.value = name;
      if (dept) deptEl.value = dept;
      if (tr._userMap) tr._userMap[no] = { userId: no, userName: name, orgName: dept, teamName: dept };
      // 顺手沉淀到共享缓存：后面新增的评委行也能即时搜到这批人
      if (no) cacheUsers([{ userId: no, userName: name, orgName: dept, teamName: dept }]);
      if (no && tr._noInstance) {
        try {
          tr._noInstance.updateOptions([{ value: no, label: name ? `${name}（${no}）` : no }]);
          tr._noInstance.setValue(no);
        } catch (_) { /* 忽略 */ }
      }
      if (role && tr._roleInstance) {
        try {
          const base = Array.isArray(DICT.judgeRole) ? DICT.judgeRole : [];
          if (!base.some((o) => o.value === role)) {
            tr._roleInstance.updateOptions(base.concat([{ value: role, label: role }]));
          }
          tr._roleInstance.setValue(role);
        } catch (_) { /* 忽略 */ }
      }
    });
    renderJudgeTable();
    toast(`✅ 已拉取 ${r.list.length} 条评委信息`, 2200, 'success');
  }

  /** ↑ 提交评委信息（ToolApi.subscriptionReview） */
  async function submitJudges() {
    if (!currentRow) return;
    if (!window.ToolApi || typeof window.ToolApi.submitSubscriptionReview !== 'function') {
      toast('⚠️ ToolApi 未加载', 2200, 'warn');
      return;
    }
    const judges = collectJudges().filter((j) => j.empNo || j.name);
    if (!judges.length) {
      toast('⚠️ 请先添加评委信息', 2500, 'warn');
      return;
    }
    const publishId = currentRow.publishId || currentRow.id || '';
    if (!publishId) {
      toast('⚠️ 当前行缺少 publishId，无法提交评委信息', 2800, 'warn');
      return;
    }
    const form = collectForm();
    // 调用方应用系统服务编号（如 E00406TO1197）；没填则按调用方系统 + 服务编号尾部序号推一份
    let prodSysServeNoList = form.callerServiceNo ? [form.callerServiceNo] : [];
    if (!prodSysServeNoList.length) {
      const sysServeNo = currentRow.sysServeNo || currentRow.serverCoding || '';
      const caller = form.callerSystem || '';
      const m = sysServeNo.match(/(TO\d+)$/);
      if (sysServeNo && caller && m) prodSysServeNoList = [caller + m[1]];
    }
    const judgeInfoList = judges.map((j) => ({
      judgeName:      j.name,
      judgeUserId:    j.empNo,
      judgeDeptName:  j.dept,
      involvedProduct: '',
      judgeRoleName:  j.role,
    }));
    const r = await window.ToolApi.submitSubscriptionReview({ publishId, prodSysServeNoList, judgeInfoList });
    if (!r || !r.ok) {
      toast(`⚠️ 提交失败：${(r && r.error) || '未知错误'}`, 3000, 'error');
      return;
    }
    if (r.local) {
      toast('接口未启用，评委信息仅保留在表单中', 2500, 'warn');
      return;
    }
    toast('✅ 评委信息已提交', 2200, 'success');
  }

  function renderJudgeTable() {
    const rows = dom.judgeBody.querySelectorAll('tr.judge-row');
    rows.forEach((tr, i) => { tr.querySelector('.judge-idx').textContent = i + 1; });
    syncJudgeAllState();
  }

  function removeSelectedJudges() {
    const checked = dom.judgeBody.querySelectorAll('.judge-check:checked');
    if (!checked.length) {
      toast('⚠️ 请先勾选要删除的评委行', 2000, 'warn');
      return;
    }
    checked.forEach((cb) => {
      const tr = cb.closest('tr.judge-row');
      if (tr && tr._noInstance) { try { tr._noInstance.destroy(); } catch (_) {} }
      if (tr && tr._roleInstance) { try { tr._roleInstance.destroy(); } catch (_) {} }
      if (tr) tr.remove();
    });
    renderJudgeTable();
  }

  function toggleJudgeAll() {
    const on = dom.judgeAll.checked;
    dom.judgeBody.querySelectorAll('.judge-check').forEach((cb) => { cb.checked = on; });
  }

  function syncJudgeAllState() {
    const all = dom.judgeBody.querySelectorAll('.judge-check');
    if (!all.length) { dom.judgeAll.checked = false; dom.judgeAll.indeterminate = false; return; }
    const on = Array.prototype.filter.call(all, (cb) => cb.checked).length;
    dom.judgeAll.checked = on === all.length && on > 0;
    dom.judgeAll.indeterminate = on > 0 && on < all.length;
  }

  function collectJudges() {
    const out = [];
    dom.judgeBody.querySelectorAll('tr.judge-row').forEach((tr) => {
      // 评委角色：走可搜索下拉实例
      const roleInst = tr._roleInstance;
      const roleVal = roleInst
        ? (String(roleInst.getValue() || '').trim() || searchableText(tr._roleKey, tr.querySelector('.judge-role')))
        : (() => {
            // 退化路径：组件未加载 → 还是原生 select
            const sel = tr.querySelector('.judge-role');
            return sel ? String(sel.value || '').trim() : '';
          })();
      const noEl = tr.querySelector('.judge-no');
      const noInst = tr._noInstance;
      const noPicked = noInst ? String(noInst.getValue() || '').trim() : String((noEl && noEl.value) || '');
      const noVal = noPicked || searchableText(tr._noKey, noEl);
      out.push({
        role: roleVal,
        roleText: roleVal,  // DICT.judgeRole 里 value === label
        empNo: String(noVal || '').trim(),
        name: (tr.querySelector('.judge-name').value || '').trim(),
        dept: (tr.querySelector('.judge-dept').value || '').trim(),
      });
    });
    return out;
  }

  // ═══════════════════════════════════════════════════
  // 文档选择子弹窗
  // ═══════════════════════════════════════════════════

  /**
   * 获取关联文档列表（通过 API 代理转发，避免 CORS）
   *
   * 接口: POST /itamp-tool/intfcMgmt/docList
   * 请求体: { compNum, batchNum, batchNumList, type, pageSize, pageNum, docNo }
   * 响应体: { code: '200', msg: '查询成功', data: { total, rows: [{ value, docNo, docName, batchNum, ... }] } }
   * 注意：记录数组字段是 rows（不是 records/list），ID 字段是 value（不是 docInstId）
   */
  async function fetchDocList(pageNum, pageSize, docNo, batchNum) {
    try {
      // 调用方系统编号（文档归属到调用方）
      const callerCompNum = selectInstances['sub_callerSystem']
        ? selectInstances['sub_callerSystem'].getValue()
        : '';
      if (!callerCompNum) {
        console.warn('[SubscribeDialog] 调用方系统编号为空，无法查询文档');
        return { ok: false, total: 0, records: [] };
      }
      const resp = await window.API.call('/itamp-tool/intfcMgmt/docList', {
        method: 'POST',
        body: {
          compNum: callerCompNum,
          batchNum: batchNum || '',
          batchNumList: [],
          type: 'infoDoc',
          pageSize,
          pageNum,
          docNo: docNo || '',
        },
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const json = await resp.json();
      // 兼容不同可能的响应结构（抓包确认后端用 rows）
      const records = json?.data?.rows || json?.data?.records || json?.data?.list
        || json?.records || json?.list || [];
      return {
        ok: true,
        total: json?.data?.total || json?.total || records.length,
        records,
      };
    } catch (e) {
      console.warn('[SubscribeDialog] 获取文档列表失败:', e);
      return { ok: false, total: 0, records: [], error: (e && e.message) || String(e) };
    }
  }

  /**
   * 加载文档列表（分页 + 筛选）
   * 首次打开时加载第一页，后续翻页直接过滤内存数据
   */
  /**
   * 拉全量文档行（后端分页 → 前端内存分页）。
   *
   * 原先写死 pageSize: 9999 一次要全量：后端若按自己的上限截断（常见 200/500），
   * 本地 docAllRows 就偏小，总页数与「共 N 条」跟着偏小，而且没有任何提示。
   * 现在按后端返回的 total 逐页拉，并给出上限，拉不全时明确记录 docTruncated。
   */
  const DOC_FETCH_SIZE = 500;    // 单页请求条数（后端真实上限未抓包确认，宁可多几轮）
  const DOC_MAX_ROWS = 5000;     // 文档列表上限，防止一次点开拉爆内存

  async function loadDocRows() {
    docTruncated = false;
    const first = await fetchDocList(1, DOC_FETCH_SIZE, '', '');
    if (!first.ok) {                       // 真失败：保留现场，下次打开重试
      docAllRows = [];
      docBackendTotal = 0;
      return { rows: [], ok: false, error: first.error };
    }
    const total = Number(first.total) || first.records.length;
    const rows = first.records.slice();
    const pageCount = Math.ceil(Math.min(total, DOC_MAX_ROWS) / DOC_FETCH_SIZE);

    for (let p = 2; p <= pageCount; p += 1) {
      const res = await fetchDocList(p, DOC_FETCH_SIZE, '', '');
      if (!res.records.length) break;          // 后端提前到底，别再无意义翻页
      rows.push(...res.records);
    }

    if (total > rows.length) docTruncated = true;   // 后端 total 大于实际拿到的
    docBackendTotal = total;
    docAllRows = rows;
    return { rows: docAllRows, ok: true };
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

  async function openDocDialog() {
    await boot();

    // 校验：必须先选择调用方系统
    const callerVal = selectInstances['sub_callerSystem']
      ? selectInstances['sub_callerSystem'].getValue()
      : '';
    if (!callerVal) {
      toast('⚠️ 请先选择调用方系统', 2500, 'warn');
      return;
    }

    // 文档列表是按「调用方系统」拉取的：换了调用方系统必须重新拉，
    // 否则会把上一个系统能看的文档列表当成当前系统的（原实现不失效缓存）。
    if (docLoadedFor !== callerVal) {
      const res = await loadDocRows();
      // 只有真的拉成功（含「确实没有文档」）才记缓存；失败/空值下次打开再试
      if (res.ok) docLoadedFor = callerVal;
    }
    // 再次打开时沿用上次已选的文档（可继续勾选/取消），而不是每次从头再来
    docSelected = new Set(
      String(dom.relDocIds.value || '').split(',').map((s) => s.trim()).filter(Boolean)
    );
    docPage = 1;

    // 将主弹窗已选的批次同步到文档弹窗（如果用户已在主弹窗选了批次）
    const mainBatchVal = selectInstances['sub_callerBatch']
      ? String(selectInstances['sub_callerBatch'].getValue() || '')
      : '';

    refreshDocBatchOptions();

    // 先设置批次值（setValue 不派发 change，需手动过滤）
    if (mainBatchVal && selectInstances.docFilterBatch) {
      selectInstances.docFilterBatch.setValue(mainBatchVal);
      applyDocFilter();
    } else {
      // 主弹窗没选批次 → 文档弹窗也清空
      if (selectInstances.docFilterBatch) selectInstances.docFilterBatch.clear();
      applyDocFilter();
    }

    if (window.DialogUtils) window.DialogUtils.lockScroll();
    if (dragInstances.doc) dragInstances.doc.reset();

    dom.docOverlay.style.display = 'flex';
    requestAnimationFrame(() => dom.docOverlay.classList.add('show'));
  }

  function closeDocDialog() {
    dom.docOverlay.classList.remove('show');
    setTimeout(() => { dom.docOverlay.style.display = 'none'; }, 200);
    if (window.DialogUtils) window.DialogUtils.unlockScroll();
  }

  /**
   * 「文档投产批次」下拉按当前文档去重生成：
   * 下拉里有的批次，列表里一定有文档，不会出现「选了批次却查不到东西」。
   * 显示名优先用批次字典的 label（2609批次 / 26年10月独立），取不到再按批次号推。
   */
  function refreshDocBatchOptions() {
    const inst = selectInstances.docFilterBatch;
    if (!inst) return;
    const map = new Map();
    docAllRows.forEach((d) => {
      const raw = String(d.batchNum || d.batch || '').trim();
      if (raw && !map.has(raw)) map.set(raw, batchLabel(raw));
    });
    // 一条文档都没有时别让下拉空着，退回全局批次字典
    if (!map.size) {
      batchOptions().forEach((o) => {
        if (o && o.value != null && String(o.value) !== '') map.set(String(o.value), o.label || String(o.value));
      });
    }
    const list = Array.from(map, ([value, label]) => ({ value, label }))
      .sort((a, b) => batchSortKey(b.value) - batchSortKey(a.value));
    inst.updateOptions(list);
  }

  function batchLabel(raw) {
    const code = String(raw || '').trim();
    if (!code) return '';
    const hit = batchOptions().find((o) => String(o.value) === code);
    if (hit && hit.label) return hit.label;
    return displayBatch(code);
  }

  /** 排序键：2606 / 2610dl / 344 都取前导数字，新批次排前面 */
  function batchSortKey(raw) {
    const m = /^(\d+)/.exec(String(raw || ''));
    return m ? Number(m[1]) : 0;
  }

  /** 文档记录唯一 id（抓包确认字段是 value，其余候选名只是兜底） */
  function docId(d) {
    return String(d.value || d.docInstId || d.id || '');
  }

  /** 只有成员文档（isMember === '1'）允许勾选 */
  function isMemberDoc(d) {
    return d.isMember === '1' || d.isMember === 1;
  }

  function applyDocFilter() {
    const kw = (dom.docFilterNo.value || '').trim().toLowerCase();
    const batch = selectInstances.docFilterBatch
      ? String(selectInstances.docFilterBatch.getValue() || '')
      : (dom.docFilterBatch.value || '');
    const hit = docAllRows.filter((d) => {
      // 适配接口返回的字段名
      const docNo = String(d.docNo || d.no || '');
      const docName = String(d.docName || d.name || '');
      const docBatch = String(d.batchNum || d.batch || '');
      const m1 = !kw || docNo.toLowerCase().includes(kw) || docName.toLowerCase().includes(kw);
      const m2 = !batch || docBatch === batch;
      return m1 && m2;
    });
    docFiltered = sortDocs(hit);
    renderDocTable();
  }

  /**
   * 让能操作的文档浮到上面：
   *   ① 已勾选的排最前（重开弹窗时一眼看得到上次选了谁）
   *   ② 非成员文档（不可勾选）排最后
   *   ③ 其余保持接口返回的原顺序
   * 只在筛选 / 打开时排一次，勾选本身不重排 —— 否则点了复选框行就跳走了。
   */
  function sortDocs(list) {
    const rank = (d) => (docSelected.has(docId(d)) ? 0 : (isMemberDoc(d) ? 1 : 2));
    return list.slice().sort((a, b) => rank(a) - rank(b));
  }

  function docTotalPages() {
    return Math.max(1, Math.ceil(docFiltered.length / docSize));
  }

  function renderDocTable() {
    const totalPages = docTotalPages();
    if (docPage > totalPages) docPage = totalPages;
    const start = (docPage - 1) * docSize;
    const pageRows = docFiltered.slice(start, start + docSize);

    dom.docBody.innerHTML = pageRows.length
      ? pageRows.map((d) => {
          const id = docId(d);
          const no = d.docNo || d.no || '';
          const name = d.docName || d.name || '';
          const batch = d.batchNum || d.batch || '';
          const member = isMemberDoc(d);
          // 已选文档高亮，不可勾选的非成员文档压暗 —— 一眼看出哪些能操作
          const cls = [docSelected.has(id) ? 'is-picked' : '', member ? '' : 'is-nonmember']
            .filter(Boolean).join(' ');
          return `<tr class="${cls}" data-id="${esc(id)}" data-is-member="${member}"` +
            (member ? '' : ' title="非成员文档，不可勾选"') + `>
            <td class="c-chk"><input type="checkbox" class="doc-check" data-id="${esc(id)}"` +
            (member ? '' : ' disabled') + (docSelected.has(id) ? ' checked' : '') + `></td>
            <td>${esc(no)}</td>
            <td title="${esc(name)}">${esc(name)}</td>
            <td title="${esc(batch)}">${esc(displayBatch(batch))}</td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="4" class="sub-empty">没有匹配的文档</td></tr>';

    dom.docBody.querySelectorAll('.doc-check').forEach((cb) => {
      cb.addEventListener('change', () => {
        // 非成员文档的 checkbox 已 disabled，不会触发此事件
        if (cb.checked) docSelected.add(cb.dataset.id);
        else docSelected.delete(cb.dataset.id);
        cb.closest('tr').classList.toggle('is-picked', cb.checked);
        syncDocAllState();
      });
    });

    dom.docTotal.textContent = docTruncated
      ? `共 ${docFiltered.length} 条（后端共 ${docBackendTotal} 条，超过上限 ${DOC_MAX_ROWS} 未全部载入）`
      : `共 ${docFiltered.length} 条`;
    dom.docPageInfo.textContent = `${docPage} / ${totalPages}`;
    dom.docPageJump.max = String(totalPages);
    dom.docPageJump.value = String(docPage);
    dom.btnDocPrev.disabled = docPage <= 1;
    dom.btnDocNext.disabled = docPage >= totalPages;
    syncDocAllState();
  }

  function toggleDocAll() {
    const on = dom.docCheckAll.checked;
    const start = (docPage - 1) * docSize;
    docFiltered.slice(start, start + docSize).forEach((d) => {
      if (!isMemberDoc(d)) return;   // 只勾选成员文档（isMember === '1'）
      const id = docId(d);
      if (on) docSelected.add(id);
      else docSelected.delete(id);
    });
    renderDocTable();
  }

  function syncDocAllState() {
    const start = (docPage - 1) * docSize;
    const pageRows = docFiltered.slice(start, start + docSize);
    if (!pageRows.length) { dom.docCheckAll.checked = false; dom.docCheckAll.indeterminate = false; return; }
    const on = pageRows.filter((d) => docSelected.has(docId(d))).length;
    dom.docCheckAll.checked = on === pageRows.length;
    dom.docCheckAll.indeterminate = on > 0 && on < pageRows.length;
  }

  function confirmDocSelection() {
    if (!docSelected.size) {
      toast('⚠️ 请至少选择一个文档', 2200, 'warn');
      return;
    }
    const picked = docAllRows.filter((d) => docSelected.has(docId(d)));
    dom.relDoc.value = picked.map((d) => d.docName || d.name || '').join('、');
    dom.relDocIds.value = picked.map(docId).join(',');
    // 连同 docNo / batchNum / label / templateCode 一起留给提交用：
    // 真实成功报文里这 6 个字段都有值（原先只传 id + 名称，其余发空串）
    docPickedDetails = picked.map((d) => ({
      docInstId:    docId(d),
      docNo:        d.docNo || '',
      docName:      d.docName || d.name || '',
      batchNum:     d.batchNum || '',
      label:        d.label || '',
      templateCode: d.templateCode || '',
    }));

    // 选完文档 → 联动拉取调用方应用系统服务编号（getDocSysServeNoList，来自 har/订阅.json 抓包）
    const docInstIds = picked.map(docId).filter(Boolean);
    if (docInstIds.length && window.ToolApi && window.ToolApi.isEnabled('docSysServeNoList')) {
      window.ToolApi.fetchDocSysServeNoList(docInstIds).then((r) => {
        if (!r || !r.ok || !r.list.length) return;
        const inst = selectInstances['sub_callerServiceNo'];
        if (!inst) return;
        const opts = r.list
          .map((o) => {
            if (typeof o === 'string') return { value: o, label: o };
            const v = o.value != null ? String(o.value) : '';
            if (!v) return null;
            return { value: v, label: o.label != null ? String(o.label) : v };
          })
          .filter(Boolean);
        if (opts.length) {
          try { inst.updateOptions(opts); } catch (_) { /* 忽略 */ }
          toast(`已按关联文档带出 ${opts.length} 个服务编号`, 2000, 'success');
        }
      }).catch(() => { /* 静默降级，不阻塞文档选择 */ });
    }

    closeDocDialog();
  }

  // ═══════════════════════════════════════════════════

  if (typeof window !== 'undefined') {
    window.SubscribeDialog = { open, close };
  }
})();
