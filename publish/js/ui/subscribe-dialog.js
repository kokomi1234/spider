/**
 * 订阅弹窗模块（主弹窗 + 主表单 + 评委表格）
 *
 * ── 职责 ──────────────────────────────────────────────
 * 1. 点表格里的「订阅」不再直接订阅，先弹出模态对话框填单
 * 2. 基础信息表单区：28 个字段（纯文本 / 标准下拉 / 带搜索下拉 / 禁用框+选择按钮 / 多行文本）
 * 3. 「关联文档」：禁用输入框 + 「选择」按钮 → 打开文档选择子弹窗（见 js/ui/doc-picker.js）
 * 4. 评委信息表格区：复选框 / 序号 / 评委角色 / 评委工号 / 评委姓名 / 评委部门，支持新增删除
 * 5. 底部：取消 / 确认
 *
 * ── 拆出去的兄弟模块 ──────────────────────────────────
 *   js/ui/subscribe-model.js  无 DOM 依赖的常量与纯函数（字典 / 文档口径 / 表单校验 / 缓存工厂）
 *   js/ui/doc-picker.js       文档选择子弹窗。它不读本文件的私有状态：系统编号、已选 id、
 *                             确认结果全走 init/open 入参与 onConfirm 回调
 *
 * ── 弹窗通用行为 ──────────────────────────────────────
 * 统一用 js/ui/dialog-utils.js：打开即锁滚动（多级弹窗只锁一次，关最外层统一解锁）；
 * 标题栏（.sub-head）可拖拽，重新打开弹窗时复位回居中。
 *
 * ── 对外 / 数据来源 ───────────────────────────────────
 *   window.SubscribeDialog.open(row)  /  window.SubscribeDialog.close()
 *   调用方系统 → 复用 window.loadProviderList()；投产批次 → AppServices.batchOptions；
 *   其余下拉字典 → subscribe-model.js 的 DICT（抓包后只改那一处）；
 *   关联文档列表 → POST /itamp-tool/intfcMgmt/docList（走 window.API.call() 代理转发）
 */

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  // ── 状态 ─────────────────────────────────────────────
  let M = null;                // window.SubscribeModel（boot 时取，避免依赖 <script> 顺序）
  let dom = null;              // DOM 引用集合
  let booted = null;           // 初始化 Promise（只跑一次）
  let selectInstances = {};    // id -> searchable-select 实例（只含主弹窗字段）
  let typedValues = {};        // id -> 用户手输的文本（getValue 只认选中项，手输要单独记）
  let callerOptions = [];      // 调用方系统选项缓存
  let currentRow = null;       // 当前订阅的行数据
  let openSeq = 0;             // 弹窗会话号：open / close 各 +1，用来丢弃「关窗后才回来的异步响应」
  let submitting = false;      // 确认订阅 in-flight 锁：防连点重复提交
  let judgeFetching = false;   // 评委拉取 in-flight 锁：同上
  let returnFocus = null;      // 关闭后要还原的焦点
  let dragInstance = null;     // 主弹窗的 dialog-utils 拖拽句柄（含 reset）
  let judgeSeq = 0;            // 评委行自增 id
  let docPickedDetails = [];   // 已勾选文档的完整明细（提交时要用到真实报文里的 6 个字段）
  let judgeUserCache = null;   // 已搜用户缓存（实现见 subscribe-model.js，状态归本模块）

  // ── 小工具 ───────────────────────────────────────────
  function toast(msg, duration = 2500, type = 'info') {
    const notify = window.AppServices && window.AppServices.toast;
    if (typeof notify === 'function') {
      notify(msg, duration, type);
      return;
    }
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), duration);
  }

  /**
   * 读取「可搜索下拉」手输的文本：组件的 getValue() 只在选中了选项时才有值，纯手输读不到，
   * 所以额外记一份。监听器挂在父节点捕获阶段 —— 组件自己会在展开下拉时先清空输入框，
   * 只有在它之前取值才拿得到用户刚敲的内容。
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

  /**
   * 把焦点（并滚到视野中间）落到校验失败的那个字段上 —— 光有 toast 文案，
   * 用户在 28 个字段的长表单里还得自己找是哪一个。
   * 三种目标的落法不同：
   *   · 可搜索下拉：原生 <select> 已被隐藏（searchable-select.js 里 display:none），要聚焦它旁边的输入框
   *   · 禁用输入框（关联文档）：自己不吃焦点，退到同一行的「选 择」按钮
   *   · 普通输入框（TPS 峰值）：直接聚焦
   * @param {string} id 出错字段的 DOM id（来自 subscribe-model.js 的校验结果）
   */
  function focusField(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const host = el.parentElement;
    let target = host && host.querySelector('.searchable-select .searchable-select-input');
    if (!target && !el.disabled) target = el;
    if (!target && host) target = host.querySelector('button');
    if (!target) return;
    if (typeof target.focus === 'function') target.focus();
    if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'center' });
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

  // ── 初始化（首次打开时执行一次）───────────────────────
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
      judgeAll:       $('#judgeCheckAll'),
      btnAddJudge:$('#btnAddJudge'),
      btnDelJudge:$('#btnRemoveJudge'),
      btnFetchJudges: $('#btnFetchJudges'),
      btnSubmitJudges: $('#btnSubmitJudges'),
    };
    return dom.overlay && dom.dialog;
  }

  async function boot() {
    if (booted) return booted;

    booted = (async () => {
      M = window.SubscribeModel;
      judgeUserCache = M.createUserCache();

      if (!collectDom()) {
        console.warn('[SubscribeDialog] 弹窗 DOM 不存在，模块未启用');
        return;
      }

      // 文档子弹窗自管 DOM / 下拉 / 事件；依赖从这里注入，它不反向读本模块私有状态
      window.DocPicker.init({ toast, batchOptions, getPickedIds: pickedDocIds });

      // 调用方系统复用提供方系统选项（与提供方共用同一次接口响应，不会多发请求）
      try {
        if (typeof window.loadProviderList === 'function') {
          callerOptions = await window.loadProviderList();
        }
      } catch (e) {
        console.warn('[SubscribeDialog] 调用方系统选项加载失败，降级为空列表:', e.message);
        callerOptions = [];
      }

      buildSearchableSelects();
      bindEvents();
      wireDialogBehaviors();
      renderJudgeTable();
    })();

    return booted;
  }

  function buildSearchableSelects() {
    // 文档子弹窗那两个下拉由 DocPicker 独占创建：createSearchableSelect 不幂等，
    // 同一 <select> 被包两次会多插一套容器
    const fields = M.SEARCHABLE_FIELDS.filter((f) => M.DOC_SEARCHABLE_IDS.indexOf(f.id) < 0);
    if (typeof window.createSearchableSelect !== 'function') {
      console.warn('[SubscribeDialog] searchable-select 未加载，带搜索下拉退化为普通下拉');
      fields.forEach((f) => fillSelect($('#' + f.id), resolveOptions(f)));
      return;
    }
    fields.forEach((f) => {
      const el = $('#' + f.id);
      if (!el || selectInstances[f.id]) return;
      const list = resolveOptions(f);
      selectInstances[f.id] = window.createSearchableSelect(el, list, {});
      if (!list || !list.length) {
        // 空字典给一个不可选的说明，避免下拉看起来「坏了」或被误选成空值
        selectInstances[f.id].setBusy(M.PLACEHOLDER_TEXT);
      }
      bindTypedCapture(f.id, el);
    });
  }

  /** 弹窗通用行为：滚动锁定 + 标题栏拖拽（具体逻辑在 js/ui/dialog-utils.js） */
  function wireDialogBehaviors() {
    const du = window.DialogUtils;
    if (!du) return;
    dragInstance = du.makeDraggable(dom.dialog, dom.dialog.querySelector('.sub-head'));
  }

  /** 跨模块取值：统一优先 window.AppServices */
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
    if (f.source === 'dict') return M.DICT[f.dict] || [];
    return [];
  }

  // ── 事件绑定 ─────────────────────────────────────────
  function bindEvents() {
    dom.btnClose.addEventListener('click', close);
    dom.btnCancel.addEventListener('click', close);
    dom.btnConfirm.addEventListener('click', confirmSubscribe);
    dom.overlay.addEventListener('click', (e) => { if (e.target === dom.overlay) close(); });

    // 关联文档：子弹窗自己绑定内部事件，这里只负责把当前上下文交出去
    dom.btnPickDoc.addEventListener('click', openDocPicker);

    // 调用方系统 → 联动自动填入「调用方应用系统服务编号」：
    //   规则 = 调用方系统编号（如 E00406）+ 当前行服务编号尾部序号（如 TO1197）
    //   searchable-select 选中/清除时都会向原 <select> 派发 change（bubbles）
    dom.callerSys.addEventListener('change', () => {
      const inst = selectInstances['sub_callerServiceNo'];
      if (!inst) return;
      const no = M.deriveCallerServiceNo(
        String(dom.callerSys.value || '').trim(),
        currentRow && (currentRow.sysServeNo || currentRow.serverCoding),
      );
      if (no) {
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
      if (window.DocPicker.isOpen()) window.DocPicker.close();
      else if (dom.overlay.classList.contains('show')) close();
    });
  }

  // ── 打开 / 关闭 ──────────────────────────────────────
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
    if (dragInstance) dragInstance.reset();

    dom.overlay.style.display = 'flex';
    requestAnimationFrame(() => dom.overlay.classList.add('show'));
    if (dom.dialog) dom.dialog.focus();
  }

  function close() {
    if (!dom || !dom.overlay) return;
    openSeq += 1;               // 关窗即作废：在途的订阅/评委请求回来时不再回写界面
    // 关最外层时子弹窗可能还开着 → 顺手一起关，然后一次性解锁
    if (window.DocPicker.isOpen()) window.DocPicker.close();
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
    window.DocPicker.resetSelects();   // 子弹窗那两个下拉同样归零（clear 不派发 change）

    M.TEXT_FIELDS.forEach((id) => { const el = $('#' + id); if (el) el.value = ''; });
    dom.tpsPeak.value = '5';  // TPS（峰值）默认值
    dom.remark.value = '';
    dom.relDoc.value = '';
    dom.relDocIds.value = '';
    docPickedDetails = [];

    window.DocPicker.resetSelection();
    judgeSeq = 0;
    dropJudgeRows(dom.judgeBody.querySelectorAll('tr.judge-row'));   // 只移除数据行
    dom.judgeAll.checked = false;

    // 默认两个评委行：调用方产品负责人 + 服务方产品负责人
    addJudgeRow('调用方产品负责人');
    addJudgeRow('服务方产品负责人');
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

  // ── 确认订阅 ─────────────────────────────────────────
  function collectForm() {
    const val = (id) => { const el = $('#' + id); return el ? String(el.value || '').trim() : ''; };
    // 数值字段（性能指标的 6 个输入）统一把全角数字转半角：中文输入法全角状态下敲的
    // "５" 肉眼与 "5" 无异，但正则与后端都不认（规则见 subscribe-model.js 的 normalizeDigits）
    const numVal = (id) => {
      const raw = val(id);
      return (M && typeof M.normalizeDigits === 'function') ? M.normalizeDigits(raw) : raw;
    };
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
      relDocDetails:       docPickedDetails,   // 完整文档明细（见 applyPickedDocs）
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
      perfDaily: { tps: numVal('sub_tpsDaily'), volume: numVal('sub_volumeDaily'), rt: numVal('sub_rtDaily') },
      perfPeak:  { tps: numVal('sub_tpsPeak'),  volume: numVal('sub_volumePeak'),  rt: numVal('sub_rtPeak') },
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
    // 校验口径在 subscribe-model.js，这里只负责按结果 toast / 聚焦
    const form = collectForm();
    const v = M.validateSubscribe(currentRow, form, (code) => (
      !!(window.SubscribeManager && window.SubscribeManager.isSubscribed(code))
    ));
    if (!v.ok) {
      if (v.focus) focusField(v.focus);
      if (v.msg) toast(v.msg, v.duration, 'warn');
      return;
    }
    const serverCoding = v.serverCoding;

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
    const after = window.AppServices && window.AppServices.afterSubscribeChanged;
    if (typeof after === 'function') {
      try { after(); } catch (e) { console.error(e); }
    }
  }

  // ── 关联文档（与子弹窗对接：只通过入参 / 回调交互）────
  /** 主弹窗当前已选的文档 id（子弹窗打开时按它预置勾选） */
  function pickedDocIds() {
    return String(dom.relDocIds.value || '').split(',').map((s) => s.trim()).filter(Boolean);
  }

  /** 打开文档子弹窗：把主弹窗的上下文作为入参传进去 */
  async function openDocPicker() {
    await boot();
    const callerInst = selectInstances['sub_callerSystem'];
    const batchInst = selectInstances['sub_callerBatch'];
    window.DocPicker.open({
      callerSystem: callerInst ? callerInst.getValue() : '',
      mainBatch: batchInst ? batchInst.getValue() : '',
      pickedIds: pickedDocIds(),
      onConfirm: applyPickedDocs,
    });
  }

  /**
   * 子弹窗确认选择后回写主弹窗：关联文档名称 / id / 明细，并联动拉取服务编号。
   * 明细含 docNo / batchNum / label / templateCode —— 真实成功报文里这 6 个字段都有值
   * （原先只传 id + 名称，其余发空串）。
   * @param {{ids:string[], names:string[], details:Array}} p
   */
  function applyPickedDocs(p) {
    dom.relDoc.value = p.names.join('、');
    dom.relDocIds.value = p.ids.join(',');
    docPickedDetails = p.details;

    // 选完文档 → 联动拉取调用方应用系统服务编号（getDocSysServeNoList，来自 har/订阅.json 抓包）
    const docInstIds = p.ids.filter(Boolean);
    if (!docInstIds.length) return;
    if (!window.ToolApi || !window.ToolApi.isEnabled('docSysServeNoList')) return;
    window.ToolApi.fetchDocSysServeNoList(docInstIds).then((r) => {
      if (!r || !r.ok || !r.list.length) return;
      const inst = selectInstances['sub_callerServiceNo'];
      if (!inst) return;
      const options = M.toServiceNoOptions(r.list);
      if (!options.length) return;
      try { inst.updateOptions(options); } catch (_) { /* 忽略 */ }
      toast(`已按关联文档带出 ${options.length} 个服务编号`, 2000, 'success');
    }).catch(() => { /* 静默降级，不阻塞文档选择 */ });
  }

  // ── 评委信息表格 ─────────────────────────────────────
  /** 创建一行，可选预填角色 */
  function addJudgeRow(role) {
    const tr = document.createElement('tr');
    tr.className = 'judge-row';
    tr.dataset.id = ++judgeSeq;
    tr.innerHTML = M.JUDGE_ROW_TEMPLATE;
    dom.judgeBody.appendChild(tr);

    const roleSel = tr.querySelector('.judge-role');
    // 评委角色：选项来自 DICT.judgeRole；走可搜索下拉与「服务方式」等保持外观一致
    if (typeof window.createSearchableSelect === 'function') {
      const roleKey = 'judge-role-' + judgeSeq;
      tr._roleKey = roleKey;
      const roleList = M.DICT.judgeRole || [];
      tr._roleInstance = window.createSearchableSelect(roleSel, roleList, { placeholder: '请选择' });
      if (!roleList.length) tr._roleInstance.setBusy(M.PLACEHOLDER_TEXT);
      bindTypedCapture(roleKey, roleSel);
      presetRole(tr._roleInstance, role);
    } else {
      fillSelect(roleSel, M.DICT.judgeRole);
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

  /** 角色预填：字典里没有这个角色时临时并进去（两个调用点共用） */
  function presetRole(inst, role) {
    if (!inst || !role) return;
    const list = M.roleOptionsWith(role, M.DICT.judgeRole);
    try {
      if (list !== M.DICT.judgeRole) inst.updateOptions(list);
      inst.setValue(role);
    } catch (_) { /* 忽略 */ }
  }

  /** 销毁并移除评委行（连带两个 searchable-select 实例，避免残留全局监听） */
  function dropJudgeRows(rows) {
    rows.forEach((tr) => {
      if (tr._noInstance) { try { tr._noInstance.destroy(); } catch (_) {} }
      if (tr._roleInstance) { try { tr._roleInstance.destroy(); } catch (_) {} }
      tr.remove();
    });
  }

  // ── 评委工号在线搜索 ─────────────────────────────────
  // 抓包（har/userinfo.har）确认：getUserList 只认「完整姓名」或「完整工号」，中间过程
  // （如“郑梓”“zheng”）后端直接返回 500。所以这里边输入边搜，失败/无结果把原因写进
  // 下拉面板而不是静默；搜到的人沉淀进 judgeUserCache，下次输入同批人能立刻本地过滤出来。
  const JUDGE_SEARCH_MIN = 2;      // 少于 2 个字不打请求
  const JUDGE_SEARCH_DELAY = 300;  // 防抖：够快又不至于每个字母都发请求

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

    /** 核心搜索逻辑：读输入框内容并触发异步搜索（input / compositionend 复用） */
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
            judgeUserCache.cacheUsers(r.list);
            inst2.updateOptions(judgeUserCache.cachedUserOptions());
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
    dropJudgeRows(dom.judgeBody.querySelectorAll('tr.judge-row'));   // 清空现有行再填充
    r.list.forEach((it) => {
      const tr = addJudgeRow();
      const f = M.judgeFieldsFromApi(it);
      const nameEl = tr.querySelector('.judge-name');
      const deptEl = tr.querySelector('.judge-dept');
      if (f.name) nameEl.value = f.name;
      if (f.dept) deptEl.value = f.dept;
      if (tr._userMap) tr._userMap[f.no] = { userId: f.no, userName: f.name, orgName: f.dept, teamName: f.dept };
      // 顺手沉淀到共享缓存：后面新增的评委行也能即时搜到这批人
      if (f.no) {
        judgeUserCache.cacheUsers([{ userId: f.no, userName: f.name, orgName: f.dept, teamName: f.dept }]);
      }
      if (f.no && tr._noInstance) {
        try {
          tr._noInstance.updateOptions([{ value: f.no, label: f.name ? `${f.name}（${f.no}）` : f.no }]);
          tr._noInstance.setValue(f.no);
        } catch (_) { /* 忽略 */ }
      }
      presetRole(tr._roleInstance, f.role);
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
    const v = M.validateJudgeSubmit(currentRow, judges);
    if (!v.ok) {
      if (v.msg) toast(v.msg, v.duration, 'warn');
      return;
    }
    const form = collectForm();
    // 调用方应用系统服务编号（如 E00406TO1197）；没填则按调用方系统 + 服务编号尾部序号推一份
    const derived = M.deriveCallerServiceNo(
      form.callerSystem,
      currentRow.sysServeNo || currentRow.serverCoding,
    );
    const prodSysServeNoList = form.callerServiceNo ? [form.callerServiceNo] : (derived ? [derived] : []);
    const r = await window.ToolApi.submitSubscriptionReview({
      publishId: v.publishId,
      prodSysServeNoList,
      judgeInfoList: M.toJudgeInfoList(judges),
    });
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
    const rows = Array.prototype.map.call(checked, (cb) => cb.closest('tr.judge-row'));
    dropJudgeRows(rows.filter(Boolean));
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
      // 角色与工号优先取可搜索下拉的选中值，退回手输文本；组件未加载时退回原生 select
      const roleInst = tr._roleInstance;
      const roleVal = roleInst
        ? (String(roleInst.getValue() || '').trim() || searchableText(tr._roleKey, tr.querySelector('.judge-role')))
        : (() => {
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

  if (typeof window !== 'undefined') {
    window.SubscribeDialog = { open, close };
  }
})();
