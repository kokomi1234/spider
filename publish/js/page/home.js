/* ============================================================
  首页 — 三个页面入口 + 常用查询快捷入口
  ------------------------------------------------------------
  本页只做两件事：
    · 渲染「常用查询」列表（数据来自 js/ui/saved-query.js，localStorage）
    · 提供重命名 / 删除 / 一键直达

  三个入口卡是静态 HTML（<a href>），不依赖 JS —— 即使脚本挂了也能进页面。
  用户填的名称与摘要全部走 textContent 写进 DOM，不用 innerHTML，
  从根上避免首页成为 XSS 面。
============================================================ */

(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  const savedListEl = $('#savedList');
  const savedEmptyEl = $('#savedEmpty');
  const savedCountEl = $('#savedCount');

  // 提示一律「调用时才取」：本页是最后一个脚本，但保持与其它页一致的惰性写法，
  // 免得将来调整顺序时静默降级（项目铁律，见 docs/模块化方案评估.md）。
  const showToast = (msg, ms, type) => {
    const fn = window.toast;
    if (typeof fn === 'function') fn(msg, ms, type);
    else console.log('[home] ' + msg);
  };

  function askText(title, current) {
    const D = window.DialogUtils;
    if (D && typeof D.promptText === 'function') {
      return D.promptText({ title, value: current || '' });
    }
    const v = window.prompt(title, current || '');
    return Promise.resolve(v == null ? '' : v);
  }

  function askConfirm(text) {
    const D = window.DialogUtils;
    if (D && typeof D.confirmBox === 'function') return D.confirmBox({ text });
    return Promise.resolve(window.confirm(text));
  }

  /** 清空列表容器（保留空态节点，它是 HTML 里的兄弟节点） */
  function clearList() {
    if (!savedListEl) return;
    while (savedListEl.firstChild) savedListEl.removeChild(savedListEl.firstChild);
  }

  function buildItem(item) {
    const li = document.createElement('div');
    li.className = 'saved-item';
    li.dataset.id = item.id;

    const main = document.createElement('div');
    main.className = 'saved-main';

    const nameRow = document.createElement('div');
    nameRow.className = 'saved-name';
    const badge = document.createElement('span');
    badge.className = 'saved-badge';
    badge.textContent = (window.SavedQuery && window.SavedQuery.PAGES[item.page]) || item.page;
    const nameText = document.createElement('span');
    nameText.textContent = item.name;
    nameRow.appendChild(badge);
    nameRow.appendChild(nameText);
    main.appendChild(nameRow);

    if (item.summary) {
      const sum = document.createElement('div');
      sum.className = 'saved-summary';
      sum.textContent = item.summary;
      main.appendChild(sum);
    }

    const open = document.createElement('a');
    open.className = 'saved-open outlined btn-xs';
    open.href = window.SavedQuery.hrefFor(item.page, item.id);
    open.textContent = '打 开';

    const ops = document.createElement('div');
    ops.className = 'saved-ops';

    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'outlined btn-xs';
    rename.textContent = '重命名';
    rename.addEventListener('click', () => doRename(item.id));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'outlined btn-xs danger';
    del.textContent = '删除';
    del.addEventListener('click', () => doRemove(item.id, item.name));

    ops.appendChild(open);
    ops.appendChild(rename);
    ops.appendChild(del);

    li.appendChild(main);
    li.appendChild(ops);
    return li;
  }

  async function doRename(id) {
    const cur = window.SavedQuery.get(id);
    if (!cur) { showToast('该查询已不存在', 2500, 'warn'); render(); return; }
    let name;
    try {
      name = await askText('给这条查询起个名字', cur.name);
    } catch (_) {
      name = '';
    }
    if (!name || !String(name).trim()) return; // 点取消 / 空输入：什么都不做
    const r = window.SavedQuery.rename(id, String(name).trim());
    if (!r.ok) { showToast(r.error || '重命名失败', 3000, 'error'); return; }
    showToast('已重命名', 1800, 'success');
    render();
  }

  async function doRemove(id, name) {
    let yes;
    try {
      yes = await askConfirm(`确定删除常用查询「${name}」？`);
    } catch (_) {
      yes = false;
    }
    if (!yes) return;
    const r = window.SavedQuery.remove(id);
    if (!r.ok) { showToast(r.error || '删除失败', 3000, 'error'); return; }
    showToast('已删除', 1800, 'success');
    render();
  }

  function render() {
    const S = window.SavedQuery;
    if (!S || !savedListEl) {
      // 存储层没加载：不能白屏，明确告诉用户原因
      showToast('常用查询模块未加载，快捷入口不可用', 3500, 'error');
      return;
    }

    let items = [];
    try {
      items = S.list();
    } catch (e) {
      console.error('[home] 读取常用查询失败：', e);
      showToast('读取常用查询失败（本地存储不可用？）', 3500, 'error');
    }

    clearList();
    items.forEach((it) => savedListEl.appendChild(buildItem(it)));

    const empty = items.length === 0;
    if (savedEmptyEl) savedEmptyEl.hidden = !empty;
    if (savedCountEl) savedCountEl.textContent = empty ? '' : `共 ${items.length} 条`;
  }

  // 别的标签页改了 localStorage 时同步过来（多开页面是常态）
  window.addEventListener('storage', (e) => {
    if (!e.key || e.key === window.SavedQuery.STORAGE_KEY) render();
  });

  // Token 管理浮窗（与查询页同款入口，免得用户为了设 token 先随便进一页）
  try {
    if (window.TokenManager && typeof window.TokenManager.init === 'function') {
      window.TokenManager.init();
    }
  } catch (e) {
    console.error('Token 管理初始化失败:', e);
  }

  render();

  // 暴露给冒烟测试：断言首页真的渲染出了列表（而不是只判脚本加载成功）
  window.HomePage = { render, count: () => (savedListEl ? savedListEl.children.length : -1) };
})();
