j/**
 * 日期选择器 v1（combobox + 日历弹层）
 *
 * 与 searchable-select 同一套交互契约：
 *   · 点输入框任意位置 / 点箭头 → 展开日历
 *   · 点外部 / 点箭头 / Esc / 选中 → 收起
 *   · 只读输入框（不让手输，强制走日历，避免脏数据）
 *   · 点击日历标题可切换到月份 / 年份选择，直接定位年月
 *
 * 选中后把 YYYY-MM-DD 写回原 <input>.value，filter 逻辑无需改动。
 * 对外 API：getValue / setValue / clear / isOpen / close / destroy
 */

(function () {
  'use strict';

  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  function pad(n) { return String(n).padStart(2, '0'); }
  function fmt(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addMonths(d, n) {
    return new Date(d.getFullYear(), d.getMonth() + n, 1);
  }

  // 日期字符串按本地日历解析，避免 new Date('YYYY-MM-DD') 的 UTC 跨时区偏移。
  function parseDateOnly(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return d.getFullYear() === Number(match[1]) &&
      d.getMonth() === Number(match[2]) - 1 &&
      d.getDate() === Number(match[3]) ? startOfDay(d) : null;
  }

  let pickerSeq = 0;

  function createDatePicker(inputEl, opts = {}) {
    const disabled = !!(opts && opts.disabled);
    const basePlaceholder = inputEl.getAttribute('placeholder') || '选择日期';
    inputEl.setAttribute('readonly', 'readonly');
    inputEl.classList.add('searchable-select-input');

    const container = document.createElement('div');
    container.className = 'searchable-select date-picker';

    // 把原 input 收进容器
    inputEl.parentNode.insertBefore(container, inputEl);
    container.appendChild(inputEl);

    const arrow = document.createElement('span');
    arrow.className = 'searchable-select-arrow';
    arrow.textContent = '▼';
    arrow.setAttribute('aria-hidden', 'true');

    const dropdown = document.createElement('div');
    dropdown.className = 'searchable-select-dropdown';
    dropdown.id = `date-picker-${++pickerSeq}`;
    dropdown.setAttribute('role', 'dialog');
    dropdown.setAttribute('aria-label', '日期选择器');
    inputEl.setAttribute('role', 'combobox');
    inputEl.setAttribute('aria-haspopup', 'dialog');
    inputEl.setAttribute('aria-expanded', 'false');
    inputEl.setAttribute('aria-controls', dropdown.id);

    container.appendChild(arrow);
    container.appendChild(dropdown);

    // ── 状态 ──────────────────────────────────────────
    let selectedValue = parseDateOnly(inputEl.value) ? inputEl.value : ''; // 'YYYY-MM-DD'
    let isOpen = false;
    let viewDate = parseDateOnly(selectedValue) || startOfDay(new Date());
    let focusDate = startOfDay(viewDate);
    let viewMode = 'days'; // days | months | years

    function syncDisplay() {
      inputEl.value = selectedValue;
      inputEl.placeholder = selectedValue || basePlaceholder;
    }
    syncDisplay();

    // ── 渲染日历 ──────────────────────────────────────
    function makeHeader(titleText, prevDir, nextDir, titleMode) {
      const header = document.createElement('div');
      header.className = 'dp-header';

      const prev = document.createElement('button');
      prev.type = 'button';
      prev.className = 'dp-nav';
      prev.textContent = '‹';
      prev.dataset.dir = String(prevDir);

      const title = document.createElement('button');
      title.type = 'button';
      title.className = 'dp-title';
      title.dataset.mode = titleMode;
      title.textContent = titleText;
      title.setAttribute('aria-label', '切换年月选择');
      title.title = '点击选择年月';

      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'dp-nav';
      next.textContent = '›';
      next.dataset.dir = String(nextDir);

      header.append(prev, title, next);
      return header;
    }

    function makeActionButton(className, text) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.textContent = text;
      return button;
    }

    function renderDayCalendar(frag) {
      const y = viewDate.getFullYear();
      const m = viewDate.getMonth();
      frag.appendChild(makeHeader(`${y} 年 ${pad(m + 1)} 月`, -1, 1, 'months'));

      const week = document.createElement('div');
      week.className = 'dp-weekdays';
      WEEK.forEach((w) => {
        const s = document.createElement('span');
        s.textContent = w;
        week.appendChild(s);
      });

      const grid = document.createElement('div');
      grid.className = 'dp-grid';
      const firstDow = new Date(y, m, 1).getDay();
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const today = startOfDay(new Date());
      const sel = selectedValue ? fmt(parseDateOnly(selectedValue)) : '';
      const fcs = fmt(focusDate);

      for (let i = 0; i < firstDow; i++) {
        const blank = document.createElement('span');
        blank.className = 'dp-cell dp-blank';
        grid.appendChild(blank);
      }
      for (let d = 1; d <= daysInMonth; d++) {
        const cellDate = new Date(y, m, d);
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'dp-cell';
        cell.textContent = d;
        cell.dataset.date = fmt(cellDate);
        if (fmt(cellDate) === sel) cell.classList.add('is-selected');
        if (fmt(cellDate) === fmt(today)) cell.classList.add('is-today');
        if (fmt(cellDate) === fcs) cell.classList.add('is-focus');
        grid.appendChild(cell);
      }
      frag.appendChild(week);
      frag.appendChild(grid);

      const foot = document.createElement('div');
      foot.className = 'dp-foot';
      foot.append(makeActionButton('dp-today', '今天'), makeActionButton('dp-clear', '清除'));
      frag.appendChild(foot);
    }

    function renderMonthPicker(frag) {
      const y = viewDate.getFullYear();
      frag.appendChild(makeHeader(`${y} 年`, -1, 1, 'years'));
      const grid = document.createElement('div');
      grid.className = 'dp-month-grid';
      for (let m = 0; m < 12; m++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'dp-month-cell';
        cell.dataset.month = String(m);
        cell.textContent = `${m + 1} 月`;
        if (m === viewDate.getMonth()) cell.classList.add('is-selected');
        if (m === new Date().getMonth() && y === new Date().getFullYear()) cell.classList.add('is-current');
        grid.appendChild(cell);
      }
      frag.appendChild(grid);
    }

    function renderYearPicker(frag) {
      const y = viewDate.getFullYear();
      const startYear = Math.floor(y / 12) * 12;
      const endYear = startYear + 11;
      frag.appendChild(makeHeader(`${startYear}–${endYear} 年`, -12, 12, 'months'));
      const grid = document.createElement('div');
      grid.className = 'dp-year-grid';
      const currentYear = new Date().getFullYear();
      for (let year = startYear; year <= endYear; year++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'dp-year-cell';
        cell.dataset.year = String(year);
        cell.textContent = year;
        if (year === y) cell.classList.add('is-selected');
        if (year === currentYear) cell.classList.add('is-current');
        grid.appendChild(cell);
      }
      frag.appendChild(grid);
    }

    function renderCalendar() {
      const frag = document.createDocumentFragment();
      if (viewMode === 'months') renderMonthPicker(frag);
      else if (viewMode === 'years') renderYearPicker(frag);
      else renderDayCalendar(frag);
      dropdown.replaceChildren(frag);
    }

    // ── 开合 ──────────────────────────────────────────
    function open() {
      if (disabled || isOpen) return;
      isOpen = true;
      viewDate = parseDateOnly(selectedValue) || startOfDay(new Date());
      focusDate = startOfDay(viewDate);
      viewMode = 'days';
      container.classList.add('is-open');
      inputEl.setAttribute('aria-expanded', 'true');
      renderCalendar();
      inputEl.focus();
    }
    function close() {
      if (!isOpen) return;
      isOpen = false;
      container.classList.remove('is-open');
      inputEl.setAttribute('aria-expanded', 'false');
    }
    function toggle() { isOpen ? close() : open(); }

    function selectDate(d) {
      selectedValue = fmt(d);
      focusDate = startOfDay(d);
      syncDisplay();
      close();
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function clear() {
      const had = !!selectedValue;
      selectedValue = '';
      syncDisplay();
      if (isOpen) renderCalendar();
      if (had) inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // ── 事件 ──────────────────────────────────────────
    inputEl.addEventListener('mousedown', (e) => {
      if (disabled || isOpen) return;
      e.preventDefault();
      open();
    });
    // 整个 input 点击都展开（与下拉一致：点输入框就要看到面板）
    inputEl.addEventListener('click', () => {
      if (disabled) return;
      open();
    });
    arrow.addEventListener('mousedown', (e) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });
    dropdown.addEventListener('mousedown', (e) => e.preventDefault());   // 点日历不丢焦点

    // 翻月 / 选年月 / 今天 / 清除（事件委托，渲染后也有效）
    dropdown.addEventListener('click', (e) => {
      const title = e.target.closest('.dp-title');
      if (title) {
        // 日期视图标题 -> 月份视图；月份视图标题 -> 年份视图
        viewMode = viewMode === 'days' ? 'months' : 'years';
        renderCalendar();
        return;
      }

      const nav = e.target.closest('.dp-nav');
      if (nav) {
        const dir = Number(nav.dataset.dir);
        if (viewMode === 'days') viewDate = addMonths(viewDate, dir);
        else if (viewMode === 'months') viewDate = new Date(viewDate.getFullYear() + dir, viewDate.getMonth(), 1);
        else viewDate = new Date(viewDate.getFullYear() + dir, viewDate.getMonth(), 1);
        focusDate = startOfDay(viewDate);
        renderCalendar();
        return;
      }

      const month = e.target.closest('.dp-month-cell');
      if (month) {
        const nextMonth = Number(month.dataset.month);
        viewDate = new Date(viewDate.getFullYear(), nextMonth, 1);
        focusDate = new Date(viewDate.getFullYear(), nextMonth, 1);
        viewMode = 'days';
        renderCalendar();
        return;
      }

      const year = e.target.closest('.dp-year-cell');
      if (year) {
        const nextYear = Number(year.dataset.year);
        viewDate = new Date(nextYear, viewDate.getMonth(), 1);
        focusDate = new Date(nextYear, viewDate.getMonth(), 1);
        viewMode = 'months';
        renderCalendar();
        return;
      }

      const day = e.target.closest('.dp-cell[data-date]');
      if (day) {
        selectDate(parseDateOnly(day.dataset.date));
        return;
      }
      if (e.target.closest('.dp-today')) { selectDate(new Date()); return; }
      if (e.target.closest('.dp-clear')) { clear(); return; }
    });

    inputEl.addEventListener('focus', () => {
      if (disabled) return;
      if (!isOpen) open();
    });

    // 失焦即收起（Tab 走这里；点面板内已 preventDefault 不会触发）
    inputEl.addEventListener('blur', () => {
      close();
    });

    inputEl.addEventListener('keydown', (e) => {
      if (disabled) return;
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); e.stopPropagation();
          if (!isOpen) return open();
          focusDate = new Date(focusDate.getFullYear(), focusDate.getMonth(), focusDate.getDate() + 7); break;
        case 'ArrowUp': e.preventDefault(); e.stopPropagation();
          focusDate = new Date(focusDate.getFullYear(), focusDate.getMonth(), focusDate.getDate() - 7); break;
        case 'ArrowLeft': e.preventDefault(); e.stopPropagation();
          focusDate = new Date(focusDate.getFullYear(), focusDate.getMonth(), focusDate.getDate() - 1); break;
        case 'ArrowRight': e.preventDefault(); e.stopPropagation();
          focusDate = new Date(focusDate.getFullYear(), focusDate.getMonth(), focusDate.getDate() + 1); break;
        case 'Enter': e.preventDefault(); e.stopPropagation();
          if (!isOpen) return open();
          selectDate(focusDate); return;
        case 'Escape': e.preventDefault(); e.stopPropagation();
          if (isOpen) { close(); inputEl.blur(); } return;
        default: return;
      }
      // 翻到 focusDate 所在月并刷新高亮
      if (focusDate.getMonth() !== viewDate.getMonth() || focusDate.getFullYear() !== viewDate.getFullYear()) {
        viewDate = new Date(focusDate.getFullYear(), focusDate.getMonth(), 1);
      }
      renderCalendar();
    });

    // 点击组件外部收起：捕获阶段执行，先于其它元素的 mousedown 逻辑
    function onDocMouseDown(e) {
      if (!container.contains(e.target)) close();
    }
    document.addEventListener('mousedown', onDocMouseDown, true);

    // 箭头按钮在打开态再次点击 → 收起
    arrow.addEventListener('click', (e) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      if (isOpen) close();
    });

    return {
      getValue() { return selectedValue; },
      setValue(v) {
        const parsed = parseDateOnly(v);
        selectedValue = parsed ? fmt(parsed) : '';
        if (selectedValue) {
          viewDate = parsed;
          focusDate = startOfDay(parsed);
        }
        syncDisplay();
        if (isOpen) renderCalendar();
      },
      clear,
      isOpen() { return isOpen; },
      close,
      destroy() {
        document.removeEventListener('mousedown', onDocMouseDown, true);
        inputEl.classList.remove('searchable-select-input');
        inputEl.removeAttribute('readonly');
        container.replaceWith(inputEl);
      },
    };
  }

  if (typeof window !== 'undefined') {
    window.createDatePicker = createDatePicker;
  }
})();
