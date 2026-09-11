/**
 * 轻量多选控件（window.createMultiSelect）
 *
 * ── 为什么需要它 ──────────────────────────────────────
 * searchable-select.js 只支持单选，而不少后端字段在报文里是数组
 * （任务单的 schedulingAgreeBatchList / taskClassifyList，
 *  订阅关系的 sysServeNoList / serverCodingList / prodSysServeNoList），
 * 所以这里做一个只读输入框 + 弹出面板的最小实现：搜索 / 全选 / 清空 / 确定。
 *
 * ── 外观 ──────────────────────────────────────────────
 * 输入框与 .form-group select 完全同款（同高度 / 边框 / 右侧箭头），
 * 样式在 theme.css 的「共享页级控件」小节，本文件只管 DOM 与行为。
 *
 * 对外 API：setOptions(list) / getValues() / clear()
 */
(function () {
  'use strict';

  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * @param {HTMLElement} host 容器（通常是 .form-group 里的 <div class="msel">）
   * @param {Array<{value:string,label:string}>} options 初始选项
   * @param {string} placeholder 未选中时的占位文案
   */
  function createMultiSelect(host, options, placeholder) {
    if (!host) throw new Error('createMultiSelect: 缺少宿主元素');

    const selected = new Set();
    let list = Array.isArray(options) ? options.slice() : [];

    host.innerHTML = `
      <input type="text" class="msel-display" readonly placeholder="${esc(placeholder || '全部')}"
             title="点击选择（可多选）">
      <span class="msel-arrow" aria-hidden="true">▼</span>
      <div class="msel-panel">
        <input type="text" class="msel-search" placeholder="搜索">
        <div class="msel-list"></div>
        <div class="msel-foot">
          <button type="button" class="outlined btn-xs" data-act="all">全 选</button>
          <button type="button" class="outlined btn-xs" data-act="clear">清 空</button>
          <button type="button" class="filled btn-xs" data-act="ok">确 认</button>
        </div>
      </div>`;

    const display = host.querySelector('.msel-display');
    const panel = host.querySelector('.msel-panel');
    const search = host.querySelector('.msel-search');
    const listEl = host.querySelector('.msel-list');

    function paintLabel() {
      const picked = list.filter((o) => selected.has(o.value)).map((o) => o.label);
      display.value = picked.length ? picked.join('、') : '';
      display.title = display.value;
    }

    function renderList() {
      const kw = search.value.trim().toLowerCase();
      const shown = kw ? list.filter((o) => String(o.label).toLowerCase().includes(kw)) : list;
      listEl.innerHTML = shown.length
        ? shown.map((o) => `
            <label class="msel-item">
              <input type="checkbox" value="${esc(o.value)}" ${selected.has(o.value) ? 'checked' : ''}>
              <span title="${esc(o.label)}">${esc(o.label)}</span>
            </label>`).join('')
        : '<div class="msel-empty">没有匹配项</div>';
    }

    function open() {
      panel.classList.add('show');
      host.classList.add('is-open');   // 箭头旋转 + 变主色（与可搜索下拉一致）
      search.value = '';
      renderList();
      search.focus();
    }
    function close() {
      panel.classList.remove('show');
      host.classList.remove('is-open');
    }
    function isOpen() { return panel.classList.contains('show'); }

    display.addEventListener('click', () => (isOpen() ? close() : open()));
    search.addEventListener('input', renderList);

    listEl.addEventListener('change', (e) => {
      const cb = e.target;
      if (!cb || cb.type !== 'checkbox') return;
      if (cb.checked) selected.add(cb.value); else selected.delete(cb.value);
      paintLabel();
    });

    panel.querySelector('.msel-foot').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'all') {
        const kw = search.value.trim().toLowerCase();
        (kw ? list.filter((o) => String(o.label).toLowerCase().includes(kw)) : list)
          .forEach((o) => selected.add(o.value));
      } else if (act === 'clear') {
        const kw = search.value.trim().toLowerCase();
        if (kw) {
          list.filter((o) => String(o.label).toLowerCase().includes(kw)).forEach((o) => selected.delete(o.value));
        } else {
          selected.clear();
        }
      } else {
        close();
        return;
      }
      renderList();
      paintLabel();
    });

    // 点击面板外关闭（不改变已选）
    document.addEventListener('mousedown', (e) => { if (!host.contains(e.target)) close(); });

    renderList();
    paintLabel();

    return {
      setOptions(next) {
        list = Array.isArray(next) ? next.slice() : [];
        renderList();
        paintLabel();
      },
      getValues() { return Array.from(selected); },
      clear() { selected.clear(); renderList(); paintLabel(); },
    };
  }

  if (typeof window !== 'undefined') {
    window.createMultiSelect = createMultiSelect;
  }
})();
