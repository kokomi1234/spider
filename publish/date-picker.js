/**
 * 日期选择器
 *
 * 设计约定：可见 input 复用页面原始 input，外层只负责边框/箭头，
 * 日历面板宽度始终跟输入框一致；所有视觉样式由 theme.css 的 .dp-* 提供。
 */
(function () {
  'use strict';

  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
  const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  let pickerId = 0;

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

  function isSameDay(left, right) {
    return left.getFullYear() === right.getFullYear()
      && left.getMonth() === right.getMonth()
      && left.getDate() === right.getDate();
  }

  function createDatePicker(inputEl) {
    if (!inputEl || inputEl.dataset.datePickerReady === 'true') return null;

    const originalParent = inputEl.parentNode;
    const originalNextSibling = inputEl.nextSibling;
    const originalClassName = inputEl.className;
    const originalReadOnly = inputEl.readOnly;
    const pickerKey = 'date-picker-' + (++pickerId);

    let selectedDate = parseDate(inputEl.value);
    let viewDate = new Date(selectedDate || new Date());
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
      const today = new Date();

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
        selectDate(new Date());
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

    function openPanel() {
      if (disabled || isOpen) return;
      isOpen = true;
      panelView = 'days';
      focusDate = new Date(selectedDate || viewDate);
      render();
      updateOpenState();
      // 只让外层获得 focus-within，避免全局 .form-group input:focus 在输入框中间画出第二条高亮。
      inputEl.focus({ preventScroll: true });
    }

    function closePanel() {
      if (!isOpen) return;
      isOpen = false;
      updateOpenState();
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
      if (!wrapper.contains(event.target)) closePanel();
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
