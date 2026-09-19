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
 *
 * ── 键盘可达（清单 B10）──────────────────────────────
 * 原来只绑了 click：`.msel-display` 是只读 input，能 Tab 聚焦却什么都打不开，
 * 在订阅页 / task 页按 Enter 还会一路冒泡到「筛选区回车即查询」→ 面板没开、整页先查了一次。
 * 现在：
 *   display：Enter / 空格 / ↓ → 打开面板；Esc → 收起并把焦点还回 display
 *   panel  ：Esc 收起；↑↓ 在选项间移动焦点；Enter 勾选当前项；空格归复选框自己用
 * 这些都是自定义控件，键盘事件一律 stopPropagation，避免被页面的回车查询接手。
 */
(function () {
  'use strict';

  // 给每个实例分配唯一 id，供 aria-controls 使用（同一页有 5 个多选控件，不能撞）
  let mselSeq = 0;

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
    // 占位文案与「这栏叫什么」是两件事：原先第三个参数同时当两者用，读屏念出来的是
    // 「全部批次」而不是字段名「排期批次」。名字改成从宿主推（口径与可搜索下拉共用一份，
    // 见 searchable-select.js 的 accessibleNameOf），推不到才退回占位文案。
    const phText = (typeof placeholder === 'string' && placeholder.trim()) ? placeholder.trim() : '全部';
    const factory = window.createSearchableSelect;
    const hostName = (factory && typeof factory.accessibleNameOf === 'function')
      ? factory.accessibleNameOf(host) : '';
    // 页面上的 label 本身就写着「排期批次（可多选）」，再后缀一次会变成
    // 「排期批次（可多选）（可多选）」—— 先剥掉宿主名里已有的那层
    const label = String(hostName || phText).replace(/[（(]\s*可多选\s*[)）]\s*$/, '').trim() || phText;
    // 面板 id 唯一：aria-controls 要指向它（同页多个多选控件不能撞 id）
    const panelId = 'msel-panel-' + (++mselSeq);

    host.innerHTML = `
      <input type="text" class="msel-display" readonly placeholder="${esc(phText)}"
             role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="${panelId}"
             aria-label="${esc(label + '（可多选）')}"
             title="点击或按回车 / 空格选择（可多选）">
      <span class="msel-arrow" aria-hidden="true">▼</span>
      <div class="msel-panel" id="${panelId}" role="listbox" aria-multiselectable="true"
           aria-label="${esc(label + ' 选项')}">
        <input type="text" class="msel-search" placeholder="搜索" aria-label="搜索选项"
               autocomplete="off" spellcheck="false">
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
      display.setAttribute('aria-expanded', 'true');
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
      display.setAttribute('aria-expanded', 'false');
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

    /** 勾选 / 取消勾选一项（change 事件与键盘 Enter 共用同一套状态回写） */
    function applyToggle(cb) {
      if (cb.checked) selected.add(cb.value); else selected.delete(cb.value);
      paintLabel();
    }

    display.addEventListener('click', () => (isOpen() ? close() : open()));
    search.addEventListener('input', renderList);

    listEl.addEventListener('change', (e) => {
      const cb = e.target;
      if (!cb || cb.type !== 'checkbox') return;
      applyToggle(cb);
    });

    // ── 键盘可达（清单 B10）───────────────────────────
    // 面板里当前可见的复选框（方向键在它们之间移动焦点）
    function visibleBoxes() {
      return Array.prototype.slice.call(listEl.querySelectorAll('.msel-item input[type="checkbox"]'));
    }

    /** 焦点在选项间移动（首尾循环）；焦点还在搜索框里时，↓ 进第一项、↑ 进最后一项 */
    function moveFocus(delta) {
      const boxes = visibleBoxes();
      if (!boxes.length) return;
      const cur = boxes.indexOf(document.activeElement);
      let next = cur < 0 ? (delta > 0 ? 0 : boxes.length - 1) : cur + delta;
      if (next < 0) next = boxes.length - 1;
      if (next >= boxes.length) next = 0;
      boxes[next].focus();
    }

    function dismiss() {
      close();
      display.focus();
    }

    display.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'Escape') {
        if (!isOpen()) return;
        e.preventDefault(); e.stopPropagation();
        dismiss();
        return;
      }
      if (k === 'Enter' || k === ' ' || k === 'Spacebar' || k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();          // 别让页面的「筛选区回车即查询」接手
        if (!isOpen()) { open(); return; }
        if (k === 'ArrowDown' || k === 'ArrowUp') moveFocus(k === 'ArrowDown' ? 1 : -1);
      }
    });

    // open() 会把焦点放进搜索框，所以方向键必须在这里也接住
    panel.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        dismiss();
        return;
      }
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        moveFocus(k === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (k === 'Enter') {
        // 复选框原生只认空格，回车在这里手动 toggle；不拦冒泡的话页面会跟着发一次查询
        e.preventDefault(); e.stopPropagation();
        const cb = e.target;
        if (cb && cb.type === 'checkbox') { cb.checked = !cb.checked; applyToggle(cb); }
        return;
      }
      // 空格（勾选）与其它键归控件自己用，不往上冒泡
      e.stopPropagation();
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
      /**
       * 已选项的**人类可读文本**（label 数组），与 getValues() 一一对应。
       * 存常用查询摘要时要写 label（如「2611批次」）而不是 value（如「2611pc」）；
       * 选项里查不到的值回落到 value 本身（只有编号时就显示编号）。
       */
      getLabels() {
        return Array.from(selected).map((v) => {
          const o = list.find((x) => String(x.value) === String(v));
          return o ? o.label : String(v);
        });
      },
      clear() { selected.clear(); renderList(); paintLabel(); },
      /**
       * 回填已选值（常用查询恢复用）。
       * 与 searchable-select 的 setValue 对齐：传 string[] 即可。
       * 关键：当前选项里没有的值也补进 list（用 value 当 label），
       * 否则 paintLabel 只渲染 list 里命中的项、补的值会「选了却显示不出来」；
       * 选项本来就是 {value,label} 结构，缺失项补成 value===label 即可。
       */
      setValue(values) {
        const arr = Array.isArray(values) ? values.map(String) : [];
        arr.forEach((v) => {
          if (!list.some((o) => String(o.value) === v)) list.push({ value: v, label: v });
        });
        selected.clear();
        arr.forEach((v) => selected.add(v));
        renderList();
        paintLabel();
      },
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
