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
      // 弹窗滚动容器 / 贴近视口底部时，把面板升到 body + fixed 避免被裁（见 js/ui/popup-position.js）
      if (window.PopupPosition && window.PopupPosition.place) {
        window.PopupPosition.place(display, panel, { wrapper: host, gap: 4, fallbackHeight: 320 });
      }
      // 监听器随开合注册 / 移除，避免多次打开叠加重复绑定
      if (!listenersBound) {
        document.addEventListener('mousedown', onDocMouseDown);
        window.addEventListener('resize', onWindowResize);
        document.addEventListener('scroll', onDocScroll, true);
        listenersBound = true;
      }
    }
    function close() {
      panel.classList.remove('show');
      host.classList.remove('is-open');
      if (listenersBound) {
        document.removeEventListener('mousedown', onDocMouseDown);
        window.removeEventListener('resize', onWindowResize);
        document.removeEventListener('scroll', onDocScroll, true);
        listenersBound = false;
      }
      // 关闭时把可能升到 body 的面板还回 wrapper，清掉浮动定位残留
      if (window.PopupPosition && window.PopupPosition.reset) {
        window.PopupPosition.reset(panel, host);
      }
    }
    function isOpen() { return panel.classList.contains('show'); }

    // 点击面板外关闭：面板可能被升到 body（浮动模式），已不在 host 内，
    // 所以 host 和 panel 都不包含目标时才关，否则点面板内部会被误判为「点外面」而收起。
    function onDocMouseDown(e) {
      if (!host.contains(e.target) && !panel.contains(e.target)) close();
    }
    // 视口变化 / 容器或页面滚动时重定位；面板自身滚动要忽略（e.target === panel）。
    function onWindowResize() {
      if (isOpen()) {
        window.PopupPosition.place(display, panel, { wrapper: host, gap: 4, fallbackHeight: 320 });
      }
    }
    function onDocScroll(e) {
      if (e && e.target === panel) return;
      if (isOpen()) {
        window.PopupPosition.place(display, panel, { wrapper: host, gap: 4, fallbackHeight: 320 });
      }
    }
    let listenersBound = false;

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
      /**
       * 销毁：解绑监听、把可能已浮动到 body 的面板收回 host、再移除自身。
       * 与 createSearchableSelect.destroy() 对齐 —— 两个组件都要有回收口，
       * 否则在面板打开时移除 host，面板会孤零零留在 body 里。
       * 注意：close() 内部负责解绑与 reset，复用它避免两处逻辑不一致。
       */
      destroy() {
        close();
        host.remove();
      },
    };
  }

  if (typeof window !== 'undefined') {
    window.createMultiSelect = createMultiSelect;
  }
})();
