/**
 * 关联文档选择子弹窗（从 subscribe-dialog.js 抽出的整块）
 *
 * ── 职责 ──────────────────────────────────────────────
 * 1. 主弹窗「关联文档 → 选择」打开的子弹窗：按调用方系统拉全量文档，
 *    前端内存分页 + 编号/批次筛选 + 多选
 * 2. 「文档投产批次」下拉按当前文档去重生成（下拉里有的批次一定能查到东西）
 * 3. 只有成员文档（isMember === '1'）可勾选，非成员压暗并给出 title 说明
 * 4. 确认时把「名称 / id / 6 字段明细」交回调用方，由调用方回写主弹窗
 *
 * ── 与主弹窗的边界（重要）────────────────────────────
 * 本模块不读主弹窗的任何私有状态：调用方系统 / 主弹窗批次 / 已选文档
 * 全部由 open() 的入参传入，选中结果由 open() 的 onConfirm 回调交回。
 * 弹窗通用行为（锁滚动 / 标题栏拖拽）复用 js/ui/dialog-utils.js；
 * 纯函数与字典复用 js/ui/subscribe-model.js。
 *
 * ── 对外 ──────────────────────────────────────────────
 *   window.DocPicker.init({ toast, batchOptions, esc, getPickedIds })
 *   await window.DocPicker.open({ callerSystem, mainBatch, pickedIds, onConfirm })
 *   window.DocPicker.close()
 *   window.DocPicker.isOpen()
 *   window.DocPicker.resetSelection()
 */

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  /** 拉全量文档行（后端分页 → 前端内存分页）。
   *  原先写死 pageSize: 9999 一次要全量：后端若按自己的上限截断（常见 200/500），
   *  本地 docAllRows 就偏小，总页数与「共 N 条」跟着偏小，而且没有任何提示。
   *  现在按后端返回的 total 逐页拉，并给出上限，拉不全时明确记录 docTruncated。 */
  const DOC_FETCH_SIZE = 500;    // 单页请求条数（后端真实上限未抓包确认，宁可多轮）
  const DOC_MAX_ROWS = 5000;     // 文档列表上限，防止一次点开拉爆内存

  // ═══════════════════════════════════════════════════
  // 状态
  // ═══════════════════════════════════════════════════

  let M = null;                 // window.SubscribeModel：init 时取，避免依赖 <script> 顺序
  let deps = {};                // { toast, batchOptions, esc, getPickedIds }
  let dom = null;               // 本文档子弹窗的 DOM 引用集合
  let selectInstances = {};     // id -> searchable-select 实例（只有 docFilterBatch / docPageSize）
  let typedValues = {};         // id -> 用户手输的文本（与主弹窗同口径：手输不计入 getValue）
  let dragHandle = null;        // dialog-utils 的拖拽句柄（含 reset）
  let inited = false;           // init 只生效一次

  let docAllRows = [];          // 当前调用方系统下的全部文档行（前端内存分页的数据源）
  let docBackendTotal = 0;      // 后端声明的总数（可能大于实际拿到的，用于提示截断）
  let docTruncated = false;     // 是否因上限没拉全
  let docLoadedFor = '';        // 已成功拉过文档的调用方系统编号（空结果也算拉过，避免每次打开重复请求）
  let docFiltered = [];
  let docSelected = new Set();
  let docPage = 1;
  let docSize = 10;
  let activeCallerSystem = '';  // 本次打开时的调用方系统编号（文档列表按它拉取）
  let activeOnConfirm = null;   // 本次打开的确认回调

  // ═══════════════════════════════════════════════════
  // 小工具
  // ═══════════════════════════════════════════════════

  function toast(msg, duration, type) {
    if (typeof deps.toast === 'function') deps.toast(msg, duration, type);
  }

  /** HTML 转义：优先用注入的实现，其次用 js/core/format.js 的 Fmt.esc；
      两者都没有时用内置兜底 —— 原来这里会 `f(v)` 直接抛错，把整段渲染打断。
      字符集与 Fmt.esc 一致（& < > " '）。 */
  function esc(v) {
    const f = deps.esc || (window.Fmt && window.Fmt.esc);
    if (f) return f(v);
    return String(v ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function batchOptions() {
    return typeof deps.batchOptions === 'function' ? deps.batchOptions() : [];
  }

  /** 读取「可搜索下拉」手输的文本（与主弹窗同口径，挂在父节点捕获阶段） */
  function bindTypedCapture(key, el) {
    const host = el && el.parentElement;
    if (!host) return;
    host.addEventListener('input', () => {
      const box = host.querySelector('.searchable-select .searchable-select-input');
      if (box) typedValues[key] = String(box.value || '').trim();
    }, true);
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
  // 初始化
  // ═══════════════════════════════════════════════════

  /**
   * 注入依赖并接管文档子弹窗的 DOM / 下拉 / 事件。可重复调用（只生效一次）。
   * @param {{toast?:Function, batchOptions?:Function, esc?:Function, getPickedIds?:Function}} d
   */
  function init(d) {
    if (inited) return;
    inited = true;
    deps = d || {};
    M = window.SubscribeModel;
    typedValues = {};

    if (!collectDom()) {
      console.warn('[DocPicker] 文档子弹窗 DOM 不存在，模块未启用');
      return;
    }
    buildDocSelects();
    bindEvents();
    const du = window.DialogUtils;
    if (du) dragHandle = du.makeDraggable(dom.docDialog, dom.docDialog.querySelector('.sub-head'));
  }

  function collectDom() {
    dom = {
      docOverlay:  $('#docSelectOverlay'),
      docDialog:   $('#docSelectDialog'),
      btnDocClose: $('#btnDocClose'),
      btnDocCancel:$('#btnDocCancel'),
      btnDocConfirm:$('#btnDocConfirm'),
      btnDocSearch:$('#btnDocSearch'),
      btnDocReset: $('#btnDocReset'),
      docFilterNo: $('#docFilterNo'),
      docFilterBatch: $('#docFilterBatch'),
      docBody:     $('#docTableBody'),
      docCheckAll: $('#docCheckAll'),
      docTotal:    $('#docTotalInfo'),
      docPageInfo: $('#docPageInfo'),
      docPageSize: $('#docPageSize'),
      docPageJump: $('#docPageJump'),
      btnDocPrev:  $('#btnDocPrev'),
      btnDocNext:  $('#btnDocNext'),
    };
    return dom.docOverlay && dom.docDialog;
  }

  /**
   * 建本弹窗自己的两个可搜索下拉。
   * 注意：createSearchableSelect 不幂等（每次调用都会往父节点插一套容器），
   * 所以 SEARCHABLE_FIELDS 里属于本模块的 id 必须由这里独占创建，主弹窗会跳过它们。
   */
  function buildDocSelects() {
    const fields = M.SEARCHABLE_FIELDS.filter((f) => M.DOC_SEARCHABLE_IDS.indexOf(f.id) >= 0);
    if (typeof window.createSearchableSelect !== 'function') {
      console.warn('[DocPicker] searchable-select 未加载，带搜索下拉退化为普通下拉');
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

  function resolveOptions(f) {
    if (f.source === 'batch') return batchOptions();
    if (f.source === 'dict') return (M.DICT && M.DICT[f.dict]) || [];
    return [];
  }

  function bindEvents() {
    dom.btnDocClose.addEventListener('click', close);
    dom.btnDocCancel.addEventListener('click', close);
    dom.btnDocConfirm.addEventListener('click', confirmDocument);
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
    dom.docOverlay.addEventListener('click', (e) => { if (e.target === dom.docOverlay) close(); });

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
  }

  // ═══════════════════════════════════════════════════
  // 打开 / 关闭
  // ═══════════════════════════════════════════════════

  /**
   * 打开子弹窗。
   * @param {{callerSystem?:string, mainBatch?:string, pickedIds?:string[],
   *          onConfirm?:Function}} o
   *        callerSystem 调用方系统编号（文档按它拉取，必填）
   *        mainBatch    主弹窗已选的批次，打开时同步到本弹窗的批次筛选
   *        pickedIds    主弹窗已选的文档 id（不给则回退 init 注入的 getPickedIds）
   *        onConfirm    ({ids, names, details}) => void，确认选择后回调
   */
  async function open(o) {
    o = o || {};
    // DOM 未就绪（主弹窗 boot 未跑 / 弹窗 DOM 不存在）→ 与原 openDocDialog 一样无操作
    if (!dom) return;

    // 校验：必须先选择调用方系统
    const callerVal = o.callerSystem;
    if (!callerVal) {
      toast('⚠️ 请先选择调用方系统', 2500, 'warn');
      return;
    }
    activeCallerSystem = callerVal;
    activeOnConfirm = typeof o.onConfirm === 'function' ? o.onConfirm : null;

    // 文档列表是按「调用方系统」拉取的：换了调用方系统必须重新拉，
    // 否则会把上一个系统能看的文档列表当成当前系统的（原实现不失效缓存）。
    if (docLoadedFor !== callerVal) {
      const res = await loadDocRows();
      // 只有真的拉成功（含「确实没有文档」）才记缓存；失败/空值下次打开再试
      if (res.ok) docLoadedFor = callerVal;
    }

    // 再次打开时沿用上次已选的文档（可继续勾选/取消），而不是每次从头再来
    const picked = (o.pickedIds != null)
      ? o.pickedIds
      : (typeof deps.getPickedIds === 'function' ? deps.getPickedIds() : []);
    docSelected = new Set((picked || []).map((s) => String(s).trim()).filter(Boolean));
    docPage = 1;

    // 将主弹窗已选的批次同步到文档弹窗（如果用户已在主弹窗选了批次）
    const mainBatchVal = String(o.mainBatch || '');
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
    if (dragHandle) dragHandle.reset();

    dom.docOverlay.style.display = 'flex';
    requestAnimationFrame(() => dom.docOverlay.classList.add('show'));
  }

  function close() {
    if (!dom) return;
    dom.docOverlay.classList.remove('show');
    setTimeout(() => { dom.docOverlay.style.display = 'none'; }, 200);
    if (window.DialogUtils) window.DialogUtils.unlockScroll();
  }

  /** 子弹窗是否开着（主弹窗关闭时要据此决定是否顺手关掉它，别无条件 unlockScroll） */
  function isOpen() {
    return !!(dom && dom.docOverlay && dom.docOverlay.classList.contains('show'));
  }

  /** 清空已勾选（主弹窗每次打开都回到干净状态） */
  function resetSelection() {
    docSelected = new Set();
  }

  /**
   * 清空本弹窗的两个下拉（主弹窗 resetForm 会一并归零所有 searchable-select）。
   * clear() 不派发 change，所以 docSize 不受影响（与原实现一致）。
   */
  function resetSelects() {
    Object.keys(selectInstances).forEach((id) => {
      try { selectInstances[id].clear(); } catch (_) { /* 忽略未初始化实例 */ }
    });
    typedValues = {};
  }

  // ═══════════════════════════════════════════════════
  // 文档列表
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
      // 调用方系统编号（文档归属到调用方）：取本次打开时校验过的那个，
      // 保证同一次装载的每一页都查同一个系统（多页之间用户改了主弹窗系统也不串数据）
      const callerCompNum = activeCallerSystem;
      if (!callerCompNum) {
        console.warn('[DocPicker] 调用方系统编号为空，无法查询文档');
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
      console.warn('[DocPicker] 获取文档列表失败:', e);
      return { ok: false, total: 0, records: [], error: (e && e.message) || String(e) };
    }
  }

  /** 加载文档列表（分页 + 筛选）：逐页拉全量，后续翻页直接过滤内存数据 */
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
   * 「文档投产批次」下拉按当前文档去重生成：
   * 下拉里有的批次，列表里一定有文档，不会出现「选了批次却查不到东西」。
   */
  function refreshDocBatchOptions() {
    const inst = selectInstances.docFilterBatch;
    if (!inst) return;
    inst.updateOptions(M.buildDocBatchOptions(docAllRows, batchOptions()));
  }

  function applyDocFilter() {
    const kw = (dom.docFilterNo.value || '').trim().toLowerCase();
    const batch = selectInstances.docFilterBatch
      ? String(selectInstances.docFilterBatch.getValue() || '')
      : (dom.docFilterBatch.value || '');
    docFiltered = M.sortDocs(M.filterDocs(docAllRows, { kw, batch }), docSelected);
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
          const n = M.normalizeDoc(d);
          // 已选文档高亮，不可勾选的非成员文档压暗 —— 一眼看出哪些能操作
          const cls = [docSelected.has(n.id) ? 'is-picked' : '', n.member ? '' : 'is-nonmember']
            .filter(Boolean).join(' ');
          return `<tr class="${cls}" data-id="${esc(n.id)}" data-is-member="${n.member}"` +
            (n.member ? '' : ' title="非成员文档，不可勾选"') + `>
            <td class="c-chk"><label class="chk-hit"><input type="checkbox" class="doc-check" data-id="${esc(n.id)}"` +
            (n.member ? '' : ' disabled') + (docSelected.has(n.id) ? ' checked' : '') + `></label></td>
            <td>${esc(n.docNo)}</td>
            <td title="${esc(n.docName)}">${esc(n.docName)}</td>
            <td title="${esc(n.batchNum)}">${esc(M.displayBatch(n.batchNum))}</td>
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
      if (!M.isMemberDoc(d)) return;   // 只勾选成员文档（isMember === '1'）
      const id = M.docId(d);
      if (on) docSelected.add(id);
      else docSelected.delete(id);
    });
    renderDocTable();
  }

  function syncDocAllState() {
    const start = (docPage - 1) * docSize;
    const pageRows = docFiltered.slice(start, start + docSize);
    if (!pageRows.length) { dom.docCheckAll.checked = false; dom.docCheckAll.indeterminate = false; return; }
    const on = pageRows.filter((d) => docSelected.has(M.docId(d))).length;
    dom.docCheckAll.checked = on === pageRows.length;
    dom.docCheckAll.indeterminate = on > 0 && on < pageRows.length;
  }

  /**
   * 确认选择：把结果交回调用方（主弹窗负责回写关联文档输入框 / 明细 / 服务编号联动），
   * 然后关窗。顺序与原实现一致（先交结果、再关窗）。
   */
  function confirmDocument() {
    if (!docSelected.size) {
      toast('⚠️ 请至少选择一个文档', 2200, 'warn');
      return;
    }
    const picked = docAllRows.filter((d) => docSelected.has(M.docId(d)));
    if (activeOnConfirm) {
      activeOnConfirm({
        ids:     picked.map((d) => M.docId(d)),
        names:   picked.map((d) => d.docName || d.name || ''),
        details: M.toPickedDetails(picked),
      });
    }
    close();
  }

  window.DocPicker = {
    init,
    open,
    close,
    isOpen,
    resetSelection,
    resetSelects,
  };
})();
