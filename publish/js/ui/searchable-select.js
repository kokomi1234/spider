/**
 * 可搜索下拉选择器 v3（combobox 行为）
 *
 * ── 交互契约（与 v2 的关键差异）──────────────────────────
 * 1. 再次点击输入框 / 点箭头 → 收起（v2 只能点外部或 ESC 才能关，表现为「收不回去」）
 * 2. 输入框关闭态显示已选 label，展开态清空为搜索框 —— 二者分离，
 *    v2 直接用 input.value 当过滤词，选完再点开就被自己的 label 过滤成 1 条
 * 3. 「无匹配结果」放进下拉面板内部（v2 挂在容器上，面板关了它还杵在页面上）
 * 4. 选项超过 100 条只渲染前 100 + 提示，避免 889 个提供方系统一次性建 DOM 卡死
 * 5. 键盘 Enter / Esc / ↑↓ 全部 stopPropagation，不再冒泡到 index.js 的
 *    全局回车查询（v2 里用回车选个批次会顺带触发一次查询）
 * 6. 支持「清除选择」行：选中后想置空不再只能靠整表重置
 *
 * 对外 API：updateOptions / getValue / setValue / clear / isOpen / destroy
 */

(function () {
  'use strict';

  /** 首屏最多渲染的选项数，超出给提示；滚到底再追加一批 */
  const MAX_RENDER = 100;
  const RENDER_STEP = 100;

  let instanceSeq = 0;

  function createSearchableSelect(targetEl, options = [], opts = {}) {
    const isSelect = targetEl.tagName === 'SELECT';
    const disabled = !!(opts && opts.disabled);
    const basePlaceholder = targetEl.getAttribute('placeholder') || '请输入或选择';

    // SELECT 分支：未显式传选项时，从原 <select> 的静态 options 读取（单一数据源）
    let list = [];
    if (isSelect && (!options || options.length === 0)) {
      list = Array.from(targetEl.options || []).map((o) => ({
        value: o.value,
        label: o.textContent.trim(),
      }));
    } else {
      list = Array.isArray(options) ? options.slice() : [];
    }

    // 隐藏原始元素
    targetEl.style.display = 'none';

    // ── DOM ───────────────────────────────────────────
    const container = document.createElement('div');
    container.className = 'searchable-select';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'searchable-select-input';
    input.placeholder = basePlaceholder;
    input.autocomplete = 'off';
    input.spellcheck = false;
    if (disabled) input.disabled = true;

    const arrow = document.createElement('span');
    arrow.className = 'searchable-select-arrow';
    arrow.textContent = '▼';
    arrow.setAttribute('aria-hidden', 'true');

    // 清除按钮：输入栏内的 ✕，与 ▼ 并列；仅有选中值时显示
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'searchable-select-clear-btn';
    clearBtn.textContent = '✕';
    clearBtn.setAttribute('aria-label', '清除选择');
    clearBtn.setAttribute('title', '清除选择');
    clearBtn.style.display = 'none';

    const dropdown = document.createElement('div');
    dropdown.className = 'searchable-select-dropdown';
    dropdown.id = `searchable-select-${++instanceSeq}`;
    dropdown.setAttribute('role', 'listbox');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-haspopup', 'listbox');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', dropdown.id);

    container.appendChild(input);
    container.appendChild(clearBtn);
    container.appendChild(arrow);
    container.appendChild(dropdown);
    targetEl.parentNode.insertBefore(container, targetEl.nextSibling);

    // ── 状态 ──────────────────────────────────────────
    let selectedValue = isSelect ? (targetEl.value || '') : '';
    let query = '';        // 展开态的搜索词，与「已选 label」分开存
    let freeText = '';     // 未选中任何选项时保留的用户输入，不因失焦/回车丢失
    let isComposing = false; // 中文/日文输入法组合态，组合期间不能按 Enter 收起
    let isOpen = false;
    let activeIdx = -1;    // 键盘高亮在 rendered 中的下标
    let rendered = [];     // 当前渲染出来的选项对象，按渲染顺序
    let limit = MAX_RENDER; // 当前渲染上限，滚动到底会放大
    let allMatched = [];   // 本次搜索命中的全部选项（渲染的只是前 limit 个）
    let busyText = '';     // 远程搜索进行中给用户的提示（只在没有可渲染选项时显示）

    /**
     * 把选中值写回原生元素。
     * 选项是接口动态给的，原生 <select> 里压根没有对应的 <option>，
     * 直接 targetEl.value = '2608' 会被浏览器静默丢成 '' —— 补一个镜像 option。
     */
    function syncTargetEl(value) {
      if (!isSelect) {
        targetEl.value = value;
        return;
      }
      const exists = Array.prototype.some.call(targetEl.options, (o) => o.value === value);
      if (!exists && value !== '') {
        let mirror = targetEl.querySelector('option[data-mirror]');
        if (!mirror) {
          mirror = document.createElement('option');
          mirror.setAttribute('data-mirror', '1');
          mirror.hidden = true;
          targetEl.appendChild(mirror);
        }
        const opt = findOpt(value);
        mirror.value = value;
        mirror.textContent = opt ? opt.label : value;
      }
      try {
        targetEl.value = value;
      } catch (_) { /* 忽略：某些浏览器对动态 option 的时序敏感 */ }
    }

    // ── 工具 ──────────────────────────────────────────
    function findOpt(value) {
      return list.find((o) => o.value === value) || null;
    }

    function selectedLabel() {
      const opt = findOpt(selectedValue);
      return opt ? opt.label : selectedValue || '';
    }

    /** 关闭态：优先显示已选 label；没有选中项时保留用户刚输入的自由文本 */
    function paintClosed() {
      const lbl = selectedLabel();
      const display = lbl || freeText;
      input.value = display;
      input.placeholder = basePlaceholder;
      input.classList.toggle('has-value', !!display);
      updateClearBtnVisibility();
    }

    /** 展开态：输入框变搜索框，已选 label 降级为 placeholder */
    function paintOpen() {
      input.value = query;
      input.placeholder = selectedLabel() || basePlaceholder;
      input.classList.remove('has-value');
    }

    /**
     * X 和下拉箭头共用一个图标槽位：
     *   · 关闭态且已有选择 → 显示 X，方便清除
     *   · 展开态 → 隐藏 X，显示下拉箭头
     * 这样输入文字不会同时被两个图标挤占右侧空间。
     */
    function updateClearBtnVisibility() {
      const hasValue = !!selectedValue && !disabled;
      const show = hasValue && !isOpen;
      clearBtn.style.display = show ? '' : 'none';
      container.classList.toggle('has-clear', hasValue);
    }

    /** 清除选中值（用户点 ✕ 触发）：保留下拉打开状态、派发 change 事件 */
    function doClear() {
      if (disabled || !selectedValue) return;
      selectedValue = '';
      syncTargetEl('');
      query = '';
      freeText = '';
      updateClearBtnVisibility();
      if (isOpen) {
        renderDropdown();
        paintOpen();
      } else {
        paintClosed();
      }
      targetEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // ── 渲染 ──────────────────────────────────────────
    function renderDropdown() {
      const frag = document.createDocumentFragment();
      rendered = [];
      activeIdx = -1;

      const kw = query.trim().toLowerCase();
      const matched = kw
        ? list.filter((o) =>
            String(o.label).toLowerCase().includes(kw) ||
            String(o.value).toLowerCase().includes(kw)
          )
        : list;

      allMatched = matched;
      // 渲染上限要跟着命中数「双向」调整：
      //   收：不能超过命中数，否则滚动到底会一直追加空批次；
      //   放：命中数涨回来也要放回去。这里的坑是——
      //       上一轮命中 0 条会把上限压到 0，下一批结果明明有数据却一条都渲染不出来，
      //       面板上只剩底部「共 X 项」的计数条（异步搜索下拉必踩）。
      if (limit > matched.length) limit = matched.length;
      const floor = Math.min(MAX_RENDER, matched.length);
      if (limit < floor) limit = floor;

      if (!matched.length) {
        const empty = document.createElement('div');
        empty.className = 'searchable-select-empty';
        // 远程搜索（如评委工号）在结果回来之前给个提示，别让用户盯着「无匹配结果」发呆。
        // 本地已经能匹配到选项时优先显示选项，所以 busyText 只在没有命中时才露出来。
        empty.textContent = busyText || (kw ? `无匹配结果：${query.trim()}` : '暂无可选项');
        frag.appendChild(empty);
      } else {
        // 「已选择数据」section — 仅在无搜索词且已有选中时显示，
        // 把当前选中提到面板顶部作为高亮区，与下方列表用分割线隔开
        if (!kw && selectedValue) {
          const selOpt = findOpt(selectedValue);
          if (selOpt) {
            const section = document.createElement('div');
            section.className = 'searchable-select-selected-section';

            const header = document.createElement('div');
            header.className = 'searchable-select-selected-header';
            header.textContent = '已选择数据';
            section.appendChild(header);

            const item = document.createElement('div');
            item.className = 'searchable-select-selected-item';
            const chk = document.createElement('span');
            chk.className = 'searchable-select-check';
            chk.textContent = '✓';
            const text = document.createElement('span');
            text.className = 'searchable-select-option-text';
            text.textContent = selOpt.label;
            item.append(chk, text);
            section.appendChild(item);

            frag.appendChild(section);

            const divider = document.createElement('div');
            divider.className = 'searchable-select-divider';
            frag.appendChild(divider);
          }
        }

        const shown = matched.slice(0, limit);
        shown.forEach((opt) => frag.appendChild(renderItem(opt, kw)));
        rendered = shown;
      }

      // 底部常驻计数条：大列表（如 889 个提供方系统）打开时给出总量/命中量反馈
      const footer = document.createElement('div');
      footer.className = 'searchable-select-footer';
      const total = list.length;
      footer.textContent = kw && matched.length !== total
        ? `匹配 ${matched.length} / 共 ${total} 项`
        : `共 ${total} 项`;
      frag.appendChild(footer);

      dropdown.replaceChildren(frag);
    }

    /** 滚到底自动追加一批，避免 889 条一次性建 DOM 卡住首屏 */
    function maybeLoadMore() {
      if (!isOpen || rendered.length >= allMatched.length) return;
      if (dropdown.scrollTop + dropdown.clientHeight < dropdown.scrollHeight - 24) return;
      const keep = dropdown.scrollTop;
      limit += RENDER_STEP;
      renderDropdown();
      dropdown.scrollTop = keep;      // 重建后要把滚动位置还回去
    }

    function renderItem(opt, kw) {
      const item = document.createElement('div');
      item.className = 'searchable-select-option';
      item.dataset.value = opt.value;
      item.id = `${dropdown.id}-option-${rendered.length}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(opt.value === selectedValue));

      const textSpan = document.createElement('span');
      textSpan.className = 'searchable-select-option-text';
      const label = String(opt.label);
      if (kw && label.toLowerCase().includes(kw)) {
        const regex = new RegExp('(' + escapeRegex(kw) + ')', 'gi');
        let last = 0;
        let match;
        while ((match = regex.exec(label))) {
          if (match.index > last) textSpan.appendChild(document.createTextNode(label.slice(last, match.index)));
          const mark = document.createElement('mark');
          mark.textContent = match[0];
          textSpan.appendChild(mark);
          last = match.index + match[0].length;
          if (!regex.global) break;
        }
        if (last < label.length) textSpan.appendChild(document.createTextNode(label.slice(last)));
      } else {
        textSpan.textContent = label;
      }
      item.appendChild(textSpan);

      if (opt.value === selectedValue) {
        const chk = document.createElement('span');
        chk.className = 'searchable-select-check';
        chk.textContent = '✓';
        item.insertBefore(chk, textSpan);
        item.classList.add('is-selected');
      }

      item.addEventListener('click', () => selectOption(opt));
      return item;
    }

    // ── 开合 ──────────────────────────────────────────
    function openDropdown() {
      if (disabled || isOpen) return;
      isOpen = true;
      query = '';
      limit = MAX_RENDER;
      container.classList.add('is-open');
      input.setAttribute('aria-expanded', 'true');
      updateClearBtnVisibility();
      paintOpen();
      renderDropdown();
      // 弹窗滚动容器 / 贴近视口底部时，把面板升到 body + fixed 避免被裁（见 js/ui/popup-position.js）。
      // 必须在面板 display:block 之后调用，offsetHeight 才量得到真实高度。
      if (window.PopupPosition && window.PopupPosition.place) {
        window.PopupPosition.place(input, dropdown, { wrapper: container, gap: 4, fallbackHeight: 288 });
      }
      // 每次打开都从列表最顶端开始；即使上次滚到了底部，也不保留旧滚动位置。
      dropdown.scrollTop = 0;
      activeIdx = -1;
      input.removeAttribute('aria-activedescendant');
      input.focus();
    }

    function closeDropdown() {
      if (!isOpen) return;
      isOpen = false;
      query = '';
      activeIdx = -1;
      container.classList.remove('is-open');
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      paintClosed();
      // 关闭时把可能升到 body 的面板还回 wrapper，清掉浮动定位残留
      if (window.PopupPosition && window.PopupPosition.reset) {
        window.PopupPosition.reset(dropdown, container);
      }
    }

    function toggleDropdown() {
      if (isOpen) closeDropdown();
      else openDropdown();
    }

    // ── 选中 ──────────────────────────────────────────
    function selectOption(opt) {
      const changed = selectedValue !== opt.value;
      selectedValue = opt.value;
      freeText = '';
      syncTargetEl(opt.value);
      updateClearBtnVisibility();
      closeDropdown();                  // 内部会 paintClosed 回填 label
      if (changed) {
        targetEl.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    // ── 键盘 ──────────────────────────────────────────
    function highlight() {
      const items = dropdown.querySelectorAll('.searchable-select-option');
      items.forEach((el, i) => {
        const active = i === activeIdx;
        el.classList.toggle('is-active', active);
        el.setAttribute('aria-selected', String(el.dataset.value === selectedValue));
        if (active) input.setAttribute('aria-activedescendant', el.id);
      });
      if (activeIdx >= 0 && items[activeIdx]) ensureVisible(items[activeIdx]);
    }

    /** 面板内滚动，不用 scrollIntoView —— 那个会把整个页面也带着滚 */
    function ensureVisible(el) {
      const top = el.offsetTop;
      const bottom = top + el.offsetHeight;
      if (top < dropdown.scrollTop) {
        dropdown.scrollTop = top;
      } else if (bottom > dropdown.scrollTop + dropdown.clientHeight) {
        dropdown.scrollTop = bottom - dropdown.clientHeight;
      }
    }

    function handleKeyDown(e) {
      if (disabled) return;

      // 中文输入法正在组字时，Enter 是“确认汉字”，不是“选中/查询”。
      // 阻止它冒泡到 index.js，但不要 preventDefault，否则候选词无法提交。
      if (e.key === 'Enter' && (isComposing || e.isComposing || e.keyCode === 229)) {
        e.stopPropagation();
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          e.stopPropagation();
          if (!isOpen) { openDropdown(); return; }
          activeIdx = Math.min(activeIdx + 1, rendered.length - 1);
          highlight();
          break;

        case 'ArrowUp':
          e.preventDefault();
          e.stopPropagation();
          if (!isOpen) { openDropdown(); return; }
          activeIdx = Math.max(activeIdx - 1, 0);
          highlight();
          break;

        case 'Enter':
          // 不冒泡：否则会触发 index.js 里「回车即查询」的全局监听
          e.preventDefault();
          e.stopPropagation();
          if (!isOpen) { openDropdown(); return; }
          const firstOption = rendered[0];
          if (activeIdx >= 0 && rendered[activeIdx]) {
            selectOption(rendered[activeIdx]);
          } else if (firstOption) {
            // 没有键盘高亮时，Enter 默认选择当前匹配列表的第一项。
            selectOption(firstOption);
          } else {
            // 没有可选项时，保留当前输入；只关闭面板，不回填旧 label。
            freeText = query.trim();
            closeDropdown();
          }
          break;

        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          if (isOpen) { closeDropdown(); input.blur(); }
          break;

        case 'Tab':
          closeDropdown();   // 不拦截，保留原生跳焦
          break;

        default:
          break;
      }
    }

    // ── 事件绑定 ──────────────────────────────────────
    // 关闭态：接管 mousedown，自己控制聚焦时机。
    // 若放任浏览器默认行为，会变成 mousedown→focus(展开)→click(又收起) 的空转。
    // 展开态则不拦，把 mousedown 交还给浏览器以保留光标定位，关闭交给 click。
    input.addEventListener('mousedown', (e) => {
      if (disabled || isOpen) return;
      e.preventDefault();
      openDropdown();
    });

    // 整个 input 点击都展开下拉（需求：点输入框就要看到列表，不要点一下又收起）
    input.addEventListener('click', () => {
      if (disabled) return;
      openDropdown();
    });

    arrow.addEventListener('mousedown', (e) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      toggleDropdown();
    });

    // ✕ 清除按钮：mousedown 拦截避免抢焦点，click 也拦避免穿透到外部关闭逻辑
    clearBtn.addEventListener('mousedown', (e) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      doClear();
    });
    clearBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    // 面板内按下不夺走输入焦点，否则 click 还没到就已经 blur 了
    dropdown.addEventListener('mousedown', (e) => e.preventDefault());

    input.addEventListener('focus', () => {
      // 只有「用户主动聚焦」（Tab / 程序 focus）才展开；
      // 鼠标点击走 mousedown 分支，避免同一次交互里开关各触发一次
      if (disabled) return;
      if (!isOpen) openDropdown();
    });

    input.addEventListener('compositionstart', () => {
      isComposing = true;
    });
    input.addEventListener('compositionend', () => {
      isComposing = false;
      // compositionend 后浏览器会补发 input；这里不主动改值，避免中文被重复渲染。
    });

    input.addEventListener('input', () => {
      if (!isOpen) openDropdown();
      query = input.value;
      // 这是用户明确输入的文本；如果随后不选下拉项，也要在收起后保留。
      if (!selectedValue) freeText = query;
      limit = MAX_RENDER;               // 换了关键字，重新从第一批开始
      renderDropdown();
      dropdown.scrollTop = 0;
    });

    dropdown.addEventListener('scroll', maybeLoadMore);

    input.addEventListener('keydown', handleKeyDown);

    // 失焦即收起（Tab 走这里；点面板内已 preventDefault 不会触发）
    input.addEventListener('blur', () => {
      // 失焦前以 DOM 当前值为准，兼容输入法刚提交中文但 input 事件尚未完成的时序。
      if (!selectedValue && isOpen) freeText = input.value.trim();
      closeDropdown();
    });

    // 点击组件外部收起：捕获阶段执行，先于其它元素的 mousedown 逻辑。
    // 面板可能被升到 body（浮动模式），已不在 container 内，所以 container 和 dropdown
    // 都不包含目标时才关，否则点面板内部会被误判为「点外面」而收起。
    function onDocMouseDown(e) {
      if (!container.contains(e.target) && !dropdown.contains(e.target)) closeDropdown();
    }
    document.addEventListener('mousedown', onDocMouseDown, true);

    // 视口尺寸变化 / 容器或页面滚动时，锚点相对视口的位置变了，面板要跟着重定位。
    // scroll 用捕获阶段才能收到容器内部（overflow:auto）的滚动；列表自身滚动（加载更多）
    // 要忽略，否则会反复重定位、把用户滚到的位置冲掉。
    function onWindowResize() {
      if (isOpen) {
        window.PopupPosition.place(input, dropdown, { wrapper: container, gap: 4, fallbackHeight: 288 });
      }
    }
    function onDocScroll(e) {
      if (e && e.target === dropdown) return;
      if (isOpen) {
        window.PopupPosition.place(input, dropdown, { wrapper: container, gap: 4, fallbackHeight: 288 });
      }
    }
    window.addEventListener('resize', onWindowResize);
    document.addEventListener('scroll', onDocScroll, true);

    paintClosed();

    // ── 公开 API ──────────────────────────────────────
    return {
      updateOptions(newOptions) {
        list = Array.isArray(newOptions) ? newOptions.slice() : [];
        busyText = '';      // 新选项到了，占位提示自动失效
        if (isOpen) renderDropdown();
        else paintClosed();
      },

      /**
       * 占位提示文案（远程搜索在途用）。传空字符串清除。
       * 只在当前没有任何可渲染选项时显示，不会盖住已经能匹配上的结果。
       */
      setBusy(text) {
        busyText = String(text || '');
        if (isOpen) renderDropdown();
      },

      /** 从外部展开面板（输入仍聚焦时才往下拉，避免抢焦点） */
      open() {
        if (disabled || isOpen) return;
        openDropdown();
      },

      getValue() {
        return selectedValue;
      },

      /**
       * 返回用户手输但未选中任何选项时的文本。
       * 选中项后该值会被清空（selectOption/setValue 都会重置 freeText），
       * 所以它与 getValue() 互补：有选中看 getValue()，没选中看 getFreeText()。
       * 用途：部门下拉建好但用户手输未选时，把这段文本退回给上层做前端兜底过滤，
       * 而不是让手输条件被静默丢弃。
       */
      getFreeText() {
        return freeText || '';
      },

      setValue(value) {
        const opt = findOpt(value);
        selectedValue = opt ? value : '';
        if (selectedValue) freeText = '';
        syncTargetEl(selectedValue);
        updateClearBtnVisibility();
        if (isOpen) renderDropdown();
        else paintClosed();
      },

      clear() {
        selectedValue = '';
        syncTargetEl('');
        query = '';
        freeText = '';
        updateClearBtnVisibility();
        if (isOpen) renderDropdown();
        else paintClosed();
      },

      isOpen() {
        return isOpen;
      },

      close() {
        closeDropdown();
      },

      destroy() {
        document.removeEventListener('mousedown', onDocMouseDown, true);
        window.removeEventListener('resize', onWindowResize);
        document.removeEventListener('scroll', onDocScroll, true);
        // 浮动模式下面板已被 PopupPosition 挂到 document.body，container.remove() 带不走它，
        // 会留下孤立面板。先把面板收回 container，再整体删除。
        // 这条路径是生产可达的：订阅弹窗的评委行反复重建时会对每个实例 destroy()
        // （subscribe-dialog.js 的 resetJudges()/重建行），而它们位于 .sub-body（overflow:auto）内 → 必走浮动分支。
        if (window.PopupPosition && window.PopupPosition.reset) {
          window.PopupPosition.reset(dropdown, container);
        }
        targetEl.style.display = '';
        container.remove();
      },
    };
  }

  function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  if (typeof window !== 'undefined') {
    window.createSearchableSelect = createSearchableSelect;
  }
})();
