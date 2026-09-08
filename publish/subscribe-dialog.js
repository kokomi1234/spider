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
 * ── 对外 ──────────────────────────────────────────────
 *   window.SubscribeDialog.open(row)   // row 为当前行的服务数据
 *   window.SubscribeDialog.close()
 *
 * ── 数据来源约定（重要）────────────────────────────────
 * 调用方系统        → 复用提供方系统选项 window.loadProviderList()
 * 调用方投产/变更批次 → window._batchOptions（295 条，来自 conditions/subscribe 的 batchList）
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

  /** 字典没配时给个明示的占位项，避免下拉看起来像坏了 */
  const PLACEHOLDER = [{ label: '（待抓包补全）', value: '' }];

  /**
   * 需要包成「可搜索下拉」的字段。
   *
   * source 决定选项来源：
   *   'provider'  → 调用方系统选项（与提供方共用同一次接口响应）
   *   'batch'     → window._batchOptions（295 条批次，来自 conditions/subscribe）
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
  let returnFocus = null;      // 关闭后要还原的焦点
  let judgeSeq = 0;            // 评委行自增 id

  // 文档选择子弹窗状态
  let docAllRows = [];
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
    if (typeof window._showToast === 'function') {
      window._showToast(msg, duration, type);
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

  /** 给原生 <select> 灌选项；空字典时补一个占位项 */
  function fillSelect(sel, list) {
    if (!sel) return;
    const arr = (list && list.length) ? list : PLACEHOLDER;
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

      judgeBody:  $('#judgeTableBody'),
      judgeAll:   $('#judgeCheckAll'),
      btnAddJudge:$('#btnAddJudge'),
      btnDelJudge:$('#btnRemoveJudge'),

      docOverlay: $('#docSelectOverlay'),
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
      selectInstances[f.id] = window.createSearchableSelect(el, resolveOptions(f), {});
      bindTypedCapture(f.id, el);
    });
  }

  function resolveOptions(f) {
    if (f.source === 'provider') return callerOptions;
    if (f.source === 'batch') return window._batchOptions || [];
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

    // 评委信息
    dom.btnAddJudge.addEventListener('click', () => { addJudgeRow(); renderJudgeTable(); });
    dom.btnDelJudge.addEventListener('click', removeSelectedJudges);
    dom.judgeAll.addEventListener('change', toggleJudgeAll);

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
    returnFocus = document.activeElement;
    resetForm();

    dom.overlay.style.display = 'flex';
    requestAnimationFrame(() => dom.overlay.classList.add('show'));
    if (dom.dialog) dom.dialog.focus();
  }

  function close() {
    if (!dom || !dom.overlay) return;
    dom.overlay.classList.remove('show');
    setTimeout(() => { dom.overlay.style.display = 'none'; }, 200);
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
    dom.remark.value = '';
    dom.relDoc.value = '';
    dom.relDocIds.value = '';

    docSelected = new Set();
    judgeSeq = 0;
    dom.judgeBody.innerHTML = '';
    dom.judgeAll.checked = false;
    renderJudgeTable();

    // 用当前行的信息预填：服务中文名 / 编号类字段
    $('#sub_serviceCnName').value = row.sysServeName || row.serverName || row.serviceName || '';
    const taskNo = row.taskNo || row.sheetNo || '';
    if (taskNo) $('#sub_taskNo').value = taskNo;
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

    const api = window.ServiceApi;
    let res = { ok: true, local: true };
    if (api && typeof api.subscribeWithForm === 'function') {
      res = await api.subscribeWithForm(currentRow, form);  // 传整个 row
    } else if (api && typeof api.subscribe === 'function') {
      res = await api.subscribe(serverCoding);
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
    } else if (typeof window._afterSubscribeChanged === 'function') {
      try { window._afterSubscribeChanged(); } catch (e) { console.error(e); }
    }
  }

  // ═══════════════════════════════════════════════════
  // 评委信息表格
  // ═══════════════════════════════════════════════════

  function addJudgeRow() {
    const emptyRow = dom.judgeBody.querySelector('.judge-empty-row');
    if (emptyRow) emptyRow.remove();

    const tr = document.createElement('tr');
    tr.className = 'judge-row';
    tr.dataset.id = ++judgeSeq;
    tr.innerHTML = `
      <td class="c-chk"><input type="checkbox" class="judge-check" aria-label="选择该行"></td>
      <td class="c-idx judge-idx">—</td>
      <td><select class="judge-role sub-ctl"></select></td>
      <td><select class="judge-no sub-ctl" placeholder="请输入姓名或EHR号"></select></td>
      <td><input type="text" class="judge-name sub-input" placeholder="请输入或选择"></td>
      <td><input type="text" class="judge-dept sub-input" placeholder="请输入或选择"></td>
    `;
    dom.judgeBody.appendChild(tr);

    const roleSel = tr.querySelector('.judge-role');
    // 评委角色：选项来自 DICT.judgeRole；走可搜索下拉与「服务方式」等保持外观一致
    if (typeof window.createSearchableSelect === 'function') {
      const roleKey = 'judge-role-' + judgeSeq;
      tr._roleKey = roleKey;
      tr._roleInstance = window.createSearchableSelect(roleSel, DICT.judgeRole || PLACEHOLDER, { placeholder: '请选择' });
      bindTypedCapture(roleKey, roleSel);
    } else {
      fillSelect(roleSel, DICT.judgeRole);
    }

    // 评委工号：可搜索下拉，暂无人员接口 → 允许直接手输
    const noSel = tr.querySelector('.judge-no');
    const noKey = 'judge-no-' + judgeSeq;
    tr._noKey = noKey;
    if (typeof window.createSearchableSelect === 'function') {
      tr._noInstance = window.createSearchableSelect(noSel, [], {});
      bindTypedCapture(noKey, noSel);
    } else {
      fillSelect(noSel, PLACEHOLDER);
    }
    tr.querySelector('.judge-check').addEventListener('change', syncJudgeAllState);
    return tr;
  }

  function renderJudgeTable() {
    const rows = dom.judgeBody.querySelectorAll('tr.judge-row');
    rows.forEach((tr, i) => { tr.querySelector('.judge-idx').textContent = i + 1; });
    if (!rows.length) {
      dom.judgeBody.innerHTML =
        '<tr class="judge-empty-row"><td colspan="6" class="sub-empty">暂无评委信息，请点击「新增」添加</td></tr>';
    }
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
        return { total: 0, records: [] };
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
        total: json?.data?.total || json?.total || records.length,
        records,
      };
    } catch (e) {
      console.warn('[SubscribeDialog] 获取文档列表失败:', e);
      return { total: 0, records: [] };
    }
  }

  /**
   * 加载文档列表（分页 + 筛选）
   * 首次打开时加载第一页，后续翻页直接过滤内存数据
   */
  async function loadDocRows(pageNum, pageSize, docNo, batchNum) {
    const result = await fetchDocList(pageNum, pageSize, docNo, batchNum);
    docAllRows = result.records || [];
    return docAllRows;
  }

  /**
   * 获取文档列表（统一入口）
   * 如果数据未加载则先请求，否则返回缓存数据
   */
  async function getDocRows(forceReload = false) {
    if (!forceReload && docAllRows.length > 0) return docAllRows;
    return await loadDocRows(1, 9999, '', '');
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

    // 重置选中状态
    docSelected = new Set();
    // 首次打开时加载文档数据（后续使用缓存）
    if (docAllRows.length === 0) {
      await loadDocRows(1, 9999, '', '');
    }
    docPage = 1;
    applyDocFilter();
    dom.docOverlay.style.display = 'flex';
    requestAnimationFrame(() => dom.docOverlay.classList.add('show'));
  }

  function closeDocDialog() {
    dom.docOverlay.classList.remove('show');
    setTimeout(() => { dom.docOverlay.style.display = 'none'; }, 200);
  }

  function applyDocFilter() {
    const kw = (dom.docFilterNo.value || '').trim().toLowerCase();
    const batch = selectInstances.docFilterBatch
      ? String(selectInstances.docFilterBatch.getValue() || '')
      : (dom.docFilterBatch.value || '');
    docFiltered = docAllRows.filter((d) => {
      // 适配接口返回的字段名
      const docNo = d.docNo || d.no || '';
      const docName = d.docName || d.name || '';
      const docBatch = d.batchNum || d.batch || '';
      const m1 = !kw || docNo.toLowerCase().includes(kw) || docName.toLowerCase().includes(kw);
      const m2 = !batch || docBatch === batch;
      return m1 && m2;
    });
    renderDocTable();
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
          const id = d.value || d.docInstId || d.id || '';
          const no = d.docNo || d.no || '';
          const name = d.docName || d.name || '';
          const batch = d.batchNum || d.batch || '';
          return `<tr data-id="${esc(id)}">
            <td class="c-chk"><input type="checkbox" class="doc-check" data-id="${esc(id)}" ${docSelected.has(id) ? 'checked' : ''}></td>
            <td>${esc(no)}</td>
            <td title="${esc(name)}">${esc(name)}</td>
            <td>${esc(batch)}</td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="4" class="sub-empty">没有匹配的文档</td></tr>';

    dom.docBody.querySelectorAll('.doc-check').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) docSelected.add(cb.dataset.id);
        else docSelected.delete(cb.dataset.id);
        syncDocAllState();
      });
    });

    dom.docTotal.textContent = `共 ${docFiltered.length} 条`;
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
      const id = d.value || d.docInstId || d.id || '';
      if (on) docSelected.add(id);
      else docSelected.delete(id);
    });
    renderDocTable();
  }

  function syncDocAllState() {
    const start = (docPage - 1) * docSize;
    const pageRows = docFiltered.slice(start, start + docSize);
    if (!pageRows.length) { dom.docCheckAll.checked = false; dom.docCheckAll.indeterminate = false; return; }
    const on = pageRows.filter((d) => docSelected.has(d.value || d.docInstId || d.id || '')).length;
    dom.docCheckAll.checked = on === pageRows.length;
    dom.docCheckAll.indeterminate = on > 0 && on < pageRows.length;
  }

  function confirmDocSelection() {
    if (!docSelected.size) {
      toast('⚠️ 请至少选择一个文档', 2200, 'warn');
      return;
    }
    const picked = docAllRows.filter((d) => {
      const id = d.value || d.docInstId || d.id || '';
      return docSelected.has(id);
    });
    dom.relDoc.value = picked.map((d) => d.docName || d.name || '').join('、');
    dom.relDocIds.value = picked.map((d) => d.value || d.docInstId || d.id || '').join(',');
    closeDocDialog();
  }

  // ═══════════════════════════════════════════════════

  if (typeof window !== 'undefined') {
    window.SubscribeDialog = { open, close };
  }
})();
