/**
 * 日期选择器
 *
 * 设计约定：可见 input 复用页面原始 input，外层只负责边框/箭头，
 * 日历面板宽度始终跟输入框一致；所有视觉样式由 theme.css 的 .dp-* 提供。
 *
 * 面板方向：默认在输入框下方；若处在滚动容器（弹窗主体等 overflow:auto）里且下方放不下，
 * 会给 wrapper 加 `is-dropup` 翻到上方（样式在 theme.css），避免被容器裁掉。
 */
(function () {
  'use strict';

  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
  const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  let pickerId = 0;

  /** 当前面板开着的实例（各存自己的 closePanel）。
      togglePanel 里的 stopPropagation 会挡住其它实例的 document click，所以从 A 点到 B 时
      A 的面板不会自己收起 —— 会留下两个叠着的浮动面板（批次时间弹窗里连点两列实测）。
      打开新的之前在这里统一把别的关掉。 */
  const openPickers = new Set();

  function pad(value) {
    return value < 10 ? '0' + value : String(value);
  }

  function formatDate(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function parseDate(value) {
    if (!value) return null;
    const parts = String(value).split('-');
    if (parts.length !== 3) return null;
    const year = Number(parts[0]);
    const month = Number(parts[1]) - 1;
    const day = Number(parts[2]);
    const date = new Date(year, month, day);
    return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
      ? date
      : null;
  }

  /**
   * "今天"：与优先级计算同源（Fmt.businessToday，业务时区 UTC+8）。
   * 直接用 new Date() 的话，机器时区不是 +8 时日历的"今天"高亮和「今天」按钮
   * 会比优先级里用的今天差一天（北京时间 00:00~08:00 尤其明显）。
   */
  function now() {
    const Fmt = (typeof window !== 'undefined') ? window.Fmt : null;
    if (Fmt && typeof Fmt.businessToday === 'function') return Fmt.businessToday();
    return new Date();
  }

  function isSameDay(left, right) {
    return left.getFullYear() === right.getFullYear()
      && left.getMonth() === right.getMonth()
      && left.getDate() === right.getDate();
  }

  function createDatePicker(inputEl, opts) {
    if (!inputEl || inputEl.dataset.datePickerReady === 'true') return null;
    const options = (opts && typeof opts === 'object') ? opts : {};
    // 面板初次打开（还没选过值）时定位到的月份。批次时间弹窗按「批次月」传：
    // 功测 = 批次月 −1、上线 = 批次月，用户不用在日历里来回翻年份。
    // 不传维持原行为 = 今天；输入框已有值时仍以值为准（selectedDate 优先）。
    const fallbackViewDate = (options.fallbackViewDate instanceof Date && !isNaN(options.fallbackViewDate.getTime()))
      ? options.fallbackViewDate
      : null;

    const originalParent = inputEl.parentNode;
    const originalNextSibling = inputEl.nextSibling;
    const originalClassName = inputEl.className;
    const originalReadOnly = inputEl.readOnly;
    const pickerKey = 'date-picker-' + (++pickerId);

    let selectedDate = parseDate(inputEl.value);
    let viewDate = new Date(selectedDate || fallbackViewDate || now());
    let focusDate = new Date(viewDate);
    let panelView = 'days'; // days -> months -> years
    let isOpen = false;
    const disabled = inputEl.disabled;

    const wrapper = document.createElement('div');
    wrapper.className = 'dp-wrapper';
    wrapper.dataset.pickerId = pickerKey;

    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'dp-input-wrapper';

    const arrowButton = document.createElement('button');
    arrowButton.type = 'button';
    arrowButton.className = 'dp-arrow';
    arrowButton.setAttribute('aria-label', '打开日期选择器');
    arrowButton.setAttribute('aria-expanded', 'false');
    arrowButton.textContent = '▼';

    const panel = document.createElement('div');
    panel.className = 'dp-panel';
    panel.id = pickerKey + '-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '日期选择器');
    panel.hidden = true;

    // 用原始 input，不再克隆。这样页面筛选器的 value、focus 和样式只有一个来源。
    inputEl.classList.add('dp-input');
    inputEl.dataset.datePickerReady = 'true';
    inputEl.readOnly = true;
    inputEl.setAttribute('aria-haspopup', 'dialog');
    inputEl.setAttribute('aria-controls', panel.id);

    originalParent.insertBefore(wrapper, inputEl);
    wrapper.appendChild(inputWrapper);
    inputWrapper.appendChild(inputEl);
    inputWrapper.appendChild(arrowButton);
    wrapper.appendChild(panel);

    function updateDisplay() {
      const value = selectedDate ? formatDate(selectedDate) : '';
      inputEl.value = value;
      inputEl.placeholder = selectedDate ? '' : '选择日期';
      arrowButton.setAttribute('aria-label', selectedDate ? '重新选择日期' : '打开日期选择器');
    }

    function updateOpenState() {
      wrapper.classList.toggle('is-open', isOpen);
      panel.hidden = !isOpen;
      arrowButton.setAttribute('aria-expanded', String(isOpen));
    }

    function changeMonth(offset) {
      viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + offset, 1);
      focusDate = new Date(viewDate);
      render();
    }

    function changeYear(offset) {
      viewDate = new Date(viewDate.getFullYear() + offset, viewDate.getMonth(), 1);
      focusDate = new Date(viewDate);
      render();
    }

    function selectMonth(monthIndex) {
      viewDate = new Date(viewDate.getFullYear(), monthIndex, 1);
      focusDate = new Date(viewDate);
      panelView = 'days';
      render();
    }

    function selectYear(year) {
      viewDate = new Date(year, viewDate.getMonth(), 1);
      focusDate = new Date(viewDate);
      panelView = 'months';
      render();
    }

    function selectDate(date) {
      selectedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      viewDate = new Date(selectedDate);
      focusDate = new Date(selectedDate);
      updateDisplay();
      closePanel();
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function makeNavButton(text, label, onClick) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dp-nav';
      button.textContent = text;
      button.setAttribute('aria-label', label);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        onClick();
      });
      return button;
    }

    function renderHeader() {
      const header = document.createElement('div');
      header.className = 'dp-header';

      const previous = makeNavButton('‹', panelView === 'years' ? '上十年' : panelView === 'months' ? '上一年' : '上个月', () => {
        if (panelView === 'years') changeYear(-10);
        else if (panelView === 'months') changeYear(-1);
        else changeMonth(-1);
      });

      const title = document.createElement('button');
      title.type = 'button';
      title.className = 'dp-title';
      title.textContent = panelView === 'years'
        ? `${viewDate.getFullYear() - 4} - ${viewDate.getFullYear() + 5}年`
        : `${viewDate.getFullYear()}年${panelView === 'months' ? '' : ` ${viewDate.getMonth() + 1}月`}`;
      title.setAttribute('aria-label', panelView === 'days' ? '选择月份' : panelView === 'months' ? '选择年份' : '返回日期');
      title.addEventListener('click', (event) => {
        event.stopPropagation();
        if (panelView === 'days') panelView = 'months';
        else if (panelView === 'months') panelView = 'years';
        else panelView = 'days';
        render();
      });

      const next = makeNavButton('›', panelView === 'years' ? '下十年' : panelView === 'months' ? '下一年' : '下个月', () => {
        if (panelView === 'years') changeYear(10);
        else if (panelView === 'months') changeYear(1);
        else changeMonth(1);
      });

      header.append(previous, title, next);
      return header;
    }

    function renderWeekdays() {
      const weekdays = document.createElement('div');
      weekdays.className = 'dp-weekdays';
      WEEKDAYS.forEach((day) => {
        const cell = document.createElement('span');
        cell.textContent = day;
        cell.setAttribute('aria-hidden', 'true');
        weekdays.appendChild(cell);
      });
      return weekdays;
    }

    function renderMonths() {
      const grid = document.createElement('div');
      grid.className = 'dp-month-grid';
      MONTHS.forEach((month, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dp-month-cell';
        button.textContent = month;
        button.setAttribute('aria-label', `${viewDate.getFullYear()}年${month}`);
        if (index === viewDate.getMonth()) button.classList.add('is-selected');
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          selectMonth(index);
        });
        grid.appendChild(button);
      });
      return grid;
    }

    function renderYears() {
      const grid = document.createElement('div');
      grid.className = 'dp-year-grid';
      const startYear = viewDate.getFullYear() - 4;
      for (let index = 0; index < 12; index += 1) {
        const year = startYear + index;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dp-year-cell';
        button.textContent = `${year}年`;
        button.setAttribute('aria-label', `${year}年`);
        if (year === viewDate.getFullYear()) button.classList.add('is-selected');
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          selectYear(year);
        });
        grid.appendChild(button);
      }
      return grid;
    }

    function renderDays() {
      const grid = document.createElement('div');
      grid.className = 'dp-grid';
      grid.setAttribute('role', 'grid');

      const year = viewDate.getFullYear();
      const month = viewDate.getMonth();
      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const today = now();

      for (let i = 0; i < firstDay; i += 1) {
        const blank = document.createElement('span');
        blank.className = 'dp-cell dp-blank';
        blank.setAttribute('aria-hidden', 'true');
        grid.appendChild(blank);
      }

      // 使用 let 保证每个按钮闭包绑定自己的日期；旧实现使用 var，点击总是选月末日期。
      for (let day = 1; day <= daysInMonth; day += 1) {
        const date = new Date(year, month, day);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dp-cell';
        button.textContent = String(day);
        button.setAttribute('role', 'gridcell');
        button.setAttribute('aria-label', formatDate(date));
        button.setAttribute('aria-pressed', String(selectedDate ? isSameDay(date, selectedDate) : false));
        if (isSameDay(date, today)) button.classList.add('is-today');
        if (selectedDate && isSameDay(date, selectedDate)) button.classList.add('is-selected');
        if (isSameDay(date, focusDate)) button.classList.add('is-focus');
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          selectDate(date);
        });
        grid.appendChild(button);
      }
      return grid;
    }

    function renderFooter() {
      const footer = document.createElement('div');
      footer.className = 'dp-foot';

      const todayButton = document.createElement('button');
      todayButton.type = 'button';
      todayButton.className = 'dp-today';
      todayButton.textContent = '今天';
      todayButton.addEventListener('click', (event) => {
        event.stopPropagation();
        selectDate(now());
      });

      const clearButton = document.createElement('button');
      clearButton.type = 'button';
      clearButton.className = 'dp-clear';
      clearButton.textContent = '清除';
      clearButton.addEventListener('click', (event) => {
        event.stopPropagation();
        const hadValue = Boolean(selectedDate);
        selectedDate = null;
        updateDisplay();
        render();
        if (hadValue) inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      });

      footer.append(todayButton, clearButton);
      return footer;
    }

    function render() {
      const body = panelView === 'days'
        ? [renderWeekdays(), renderDays()]
        : [panelView === 'months' ? renderMonths() : renderYears()];
      panel.replaceChildren(renderHeader(), ...body, ...(panelView === 'days' ? [renderFooter()] : []));
    }

    /** 向上找最近的滚动容器（如弹窗的 .batch-time-body 这类 overflow:auto 元素）；没有则返回 null */
    function scrollParentOf(el) {
      let node = el.parentElement;
      while (node && node !== document.body && node !== document.documentElement) {
        const style = window.getComputedStyle(node);
        const scrollable = /(auto|scroll|overlay)/;
        if (scrollable.test(style.overflowY) || scrollable.test(style.overflowX)) return node;
        node = node.parentElement;
      }
      return null;
    }

    /** 面板是否已脱离滚动容器（fixed + 直接挂在 body 上） */
    let floating = false;

    /** 把面板升到 body 上并改成视口定位 —— 只有这样才能彻底不被容器的 overflow 裁掉 */
    function enterFloat() {
      if (floating) return;
      floating = true;
      // 挂到 body：祖先里没有 overflow / transform，fixed 才真正相对视口，
      // 也不会被弹窗的拖拽（transform）改写包含块
      document.body.appendChild(panel);
      panel.classList.add('is-floating');
    }

    /** 关面板时把面板放回 wrapper 原位，恢复纯 CSS 定位 */
    function leaveFloat() {
      if (!floating) return;
      floating = false;
      panel.classList.remove('is-floating');
      panel.style.position = '';
      panel.style.left = '';
      panel.style.width = '';
      panel.style.top = '';
      panel.style.bottom = '';
      panel.style.maxHeight = '';
      wrapper.appendChild(panel);
    }

    /**
     * 给面板定位。两种模式：
     *   ① 输入框在滚动容器里（弹窗主体）→ 面板 fixed 挂到 body，按视口算坐标。
     *      必须在容器外渲染：容器 `overflow: auto` 会按可视区裁剪绝对定位的后代，
     *      面板超出部分要滚动才看得见（点最后一行时最明显，下方只剩几十像素、面板却要 ~300px）。
     *   ② 普通文档流（页面筛选区）→ 保持纯 CSS 定位，放不下时翻到输入框上方。
     * 两种模式都在「上下都放不下」时给面板压一个 max-height，让日历自己滚，而不是被切一截。
     */
    function layoutPanel() {
      const GAP = 4;                                    // 与 .dp-panel 的 calc(100% + 4px) 保持一致
      // ⚠️ 量的是「可见的输入框外框」.dp-input-wrapper，不是内层 <input>：
      // 内层 input 是 flex:1，右侧箭头（.dp-arrow）会挤掉它 36px，height 也少 2px 边框。
      // 拿内层 input 当基准 → 浮动面板比可见输入框窄 36px、还右偏 1px，
      // 跟文档流内那条路径（.dp-panel 靠 left:0;right:0 撑满 .dp-wrapper）宽度对不上。
      const inputRect = inputWrapper.getBoundingClientRect();
      const container = scrollParentOf(inputEl);

      panel.style.maxHeight = '';                       // 先清掉上一轮的限制，量的才是真实高度
      const panelHeight = panel.offsetHeight || 300;    // 面板未渲染完时按常态高度估

      // ① 需要脱离滚动容器
      if (container) {
        enterFloat();
        const viewportHeight = window.innerHeight || 0;
        const spaceBelow = viewportHeight - inputRect.bottom - GAP;
        const spaceAbove = inputRect.top - GAP;
        const openUp = panelHeight > spaceBelow && spaceAbove > spaceBelow;

        panel.style.left = Math.round(inputRect.left) + 'px';
        panel.style.width = Math.round(inputRect.width) + 'px';
        panel.style.top = openUp ? 'auto' : Math.round(inputRect.bottom + GAP) + 'px';
        panel.style.bottom = openUp ? Math.round(viewportHeight - inputRect.top + GAP) + 'px' : 'auto';

        const room = Math.max(spaceBelow, spaceAbove);
        if (panelHeight > room) panel.style.maxHeight = Math.max(180, room) + 'px';
        return;
      }

      // ② 文档流内：靠 CSS 定位，必要时翻到上面
      leaveFloat();
      const containerRect = { top: 0, bottom: window.innerHeight || 0 };
      const spaceBelow = containerRect.bottom - inputRect.bottom - GAP;
      const spaceAbove = inputRect.top - containerRect.top - GAP;

      wrapper.classList.toggle('is-dropup', panelHeight > spaceBelow && spaceAbove > spaceBelow);

      const room = Math.max(spaceBelow, spaceAbove);
      if (panelHeight > room) panel.style.maxHeight = Math.max(180, room) + 'px';
    }

    function onWindowResize() {
      if (isOpen) layoutPanel();
    }

    /** 容器滚动 / 页面滚动时输入框相对视口的位置变了，面板要跟着重定位 */
    function onScroll() {
      if (isOpen) layoutPanel();
    }

    function openPanel() {
      if (disabled || isOpen) return;
      openPickers.forEach((close) => close());   // 同页多个日期控件：同时只开一个
      openPickers.add(closePanel);
      isOpen = true;
      panelView = 'days';
      focusDate = new Date(selectedDate || viewDate);
      render();
      updateOpenState();
      // 必须在面板可见（hidden=false）之后算，否则量不到真实高度
      layoutPanel();
      // 只让外层获得 focus-within，避免全局 .form-group input:focus 在输入框中间画出第二条高亮。
      inputEl.focus({ preventScroll: true });
    }

    function closePanel() {
      if (!isOpen) return;
      isOpen = false;
      openPickers.delete(closePanel);
      updateOpenState();
      leaveFloat();
    }

    function togglePanel(event) {
      if (event) event.stopPropagation();
      isOpen ? closePanel() : openPanel();
    }

    function onWrapperClick(event) {
      if (event.target.closest('button')) return;
      togglePanel(event);
    }

    function onDocumentClick(event) {
      // 面板可能被升到 body 上（浮动模式），所以不能只判断 wrapper
      if (!wrapper.contains(event.target) && !panel.contains(event.target)) closePanel();
    }

    function onDocumentKeydown(event) {
      if (!isOpen) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closePanel();
        inputEl.focus({ preventScroll: true });
      }
    }

    function onInputKeydown(event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        togglePanel(event);
      }
    }

    inputWrapper.addEventListener('click', onWrapperClick);
    arrowButton.addEventListener('click', togglePanel);
    inputEl.addEventListener('keydown', onInputKeydown);
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onDocumentKeydown);
    // 面板浮动时按视口定位，任何滚动（弹窗主体内 / 页面）都要重定位；用 capture 才能收到容器滚动
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onWindowResize);

    updateDisplay();

    return {
      getValue() {
        return selectedDate ? formatDate(selectedDate) : '';
      },
      setValue(value) {
        selectedDate = parseDate(value);
        panelView = 'days';
        if (selectedDate) {
          viewDate = new Date(selectedDate);
          focusDate = new Date(selectedDate);
        }
        updateDisplay();
        if (isOpen) render();
      },
      clear() {
        const hadValue = Boolean(selectedDate);
        selectedDate = null;
        updateDisplay();
        if (isOpen) render();
        if (hadValue) inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      },
      isOpen() {
        return isOpen;
      },
      close: closePanel,
      destroy() {
        closePanel();
        document.removeEventListener('click', onDocumentClick);
        document.removeEventListener('keydown', onDocumentKeydown);
        inputWrapper.removeEventListener('click', onWrapperClick);
        arrowButton.removeEventListener('click', togglePanel);
        inputEl.removeEventListener('keydown', onInputKeydown);
        document.removeEventListener('scroll', onScroll, { capture: true });
        window.removeEventListener('resize', onWindowResize);

        inputEl.className = originalClassName;
        inputEl.readOnly = originalReadOnly;
        delete inputEl.dataset.datePickerReady;
        inputEl.removeAttribute('aria-haspopup');
        inputEl.removeAttribute('aria-controls');
        if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
          originalParent.insertBefore(inputEl, originalNextSibling);
        } else {
          originalParent.appendChild(inputEl);
        }
        wrapper.remove();
      },
    };
  }

  if (typeof window !== 'undefined') {
    window.createDatePicker = createDatePicker;
  }
})();
