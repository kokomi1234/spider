/* ============================================================
  首页 — 三个页面入口 + 当前用户 + 常用查询 + 部门常用查询
  ------------------------------------------------------------
  本页做四件事：
    · 渲染「常用查询」列表（js/ui/saved-query.js，localStorage）
    · 设置「当前用户」（工号/姓名 → js/ui/current-user.js → 部门）
    · 按当前用户的部门，渲染本机口径的「部门常用查询」排行（5/10/20 条）
    · 重命名 / 删除 / 一键直达

  两条设计约束：
    1) 三个入口卡是静态 HTML（<a href>），不依赖 JS —— 即使脚本挂了也能进页面。
    2) 用户可控文本（查询名、摘要、人名、部门名）全部走 textContent 写进 DOM，
       不用 innerHTML，从根上避免首页成为 XSS 面。

  口径提醒：「部门常用查询」是**本机统计**（这台浏览器上存过/点开过的记录），
  后端没有对应接口，界面上必须如实标注，别让用户以为是全公司的数据。
============================================================ */

(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  const savedListEl = $('#savedList');
  const savedEmptyEl = $('#savedEmpty');
  const savedCountEl = $('#savedCount');

  const userSetEl = $('#userSet');
  const userLabelEl = $('#userLabel');
  const userFormEl = $('#userForm');
  const userKeywordEl = $('#userKeyword');
  const userCandsEl = $('#userCands');
  const userHintEl = $('#userHint');

  const deptTitleEl = $('#deptTitle');
  const deptListEl = $('#deptList');
  const deptEmptyEl = $('#deptEmpty');
  const deptTopNEl = $('#deptTopN');

  const TOPN_KEY = 'spider.deptTopN.v1';
  const DEFAULT_TOPN = 10;

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

  // ── 通用：清空容器 ──────────────────────────────────
  function clear(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // ══════════════════════════════════════════════════════
  // 常用查询卡片
  // ══════════════════════════════════════════════════════

  /**
   * @param {object} item 记录
   * @param {object} [opts]
   *   opts.meta     true = 多显示一行「查询人 · 打开 N 次」（部门排行用）
   *   opts.readonly true = 不渲染重命名/删除（部门排行是只读视图）
   */
  function buildItem(item, opts) {
    const o = opts || {};
    const li = document.createElement('div');
    li.className = 'saved-item';
    li.dataset.id = item.id;

    // 主体整块就是链接：点卡片任意处都能直达，不必去找一个小小的「打开」按钮。
    // 用 <a> 而不是给 div 挂 click，是为了保留键盘可达、右键「在新标签页打开」、
    // 以及鼠标悬停时地址栏能显示目标地址——这些是 div + onclick 给不了的。
    const main = document.createElement('a');
    main.className = 'saved-main';
    main.href = window.SavedQuery.hrefFor(item.page, item.id);
    main.title = `打开常用查询：${item.name}`;
    // 从首页点开一次就算一次「打开」，这是「高频」的判据（纯本地计数）
    main.addEventListener('click', () => {
      try { window.SavedQuery.hit(item.id); } catch (_) { /* 计数失败不该挡住跳转 */ }
    });

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

    if (o.meta) {
      // 部门排行的口径（2026-09-19 改）：显示「这份条件有多少人保存过」，
      // 而不是「某个人打开/保存了多少次」—— 后者排出来只是个人的重复劳动。
      const savers = Number(item.savers) || 0;
      const who = savers
        ? `${savers} 人保存${item.recentUser ? ` · 最近 ${item.recentUser}` : ''}`
        : '未记录查询人';
      const meta = document.createElement('div');
      // 与摘要分开一个类：两者外观相同，但归属信息要能被单独取到
      // （否则 querySelector('.saved-summary') 只会拿到摘要，取不到这行）。
      meta.className = 'saved-meta';
      meta.textContent = who;
      if (Array.isArray(item.saverNames) && item.saverNames.length) {
        meta.title = `保存过这份条件的人：${item.saverNames.join('、')}`;
      }
      main.appendChild(meta);
    }

    li.appendChild(main);

    if (!o.readonly) {
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

      ops.appendChild(rename);
      ops.appendChild(del);
      li.appendChild(ops);
    }

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

  function renderSaved() {
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

    clear(savedListEl);
    items.forEach((it) => savedListEl.appendChild(buildItem(it)));

    const empty = items.length === 0;
    if (savedEmptyEl) savedEmptyEl.hidden = !empty;
    if (savedCountEl) savedCountEl.textContent = empty ? '' : `共 ${items.length} 条`;
  }

  // ══════════════════════════════════════════════════════
  // 当前用户
  // ══════════════════════════════════════════════════════

  function renderUser() {
    const CU = window.CurrentUser;
    if (!CU) {
      showToast('当前用户模块未加载', 3000, 'error');
      return;
    }
    const u = CU.get();
    const has = !!u;
    if (userSetEl) userSetEl.hidden = !has;
    if (userFormEl) userFormEl.hidden = has;
    if (userLabelEl) userLabelEl.textContent = has ? CU.label(u) : '';
    if (userHintEl) userHintEl.textContent = has ? '已设置' : '未设置';
    if (userCandsEl) {
      userCandsEl.hidden = true;
      clear(userCandsEl);
    }
    renderDept();
  }

  function renderCandidates(list, onPick) {
    if (!userCandsEl) return;
    clear(userCandsEl);
    list.forEach((u) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cand';
      const name = document.createElement('span');
      name.textContent = `${u.userName || '（无名）'}　${u.orgName || '（无部门）'}`;
      const id = document.createElement('span');
      id.className = 'cand-id';
      id.textContent = u.userId ? `工号 ${u.userId}` : '';
      btn.appendChild(name);
      btn.appendChild(id);
      btn.addEventListener('click', () => onPick(u));
      userCandsEl.appendChild(btn);
    });
    userCandsEl.hidden = list.length === 0;
  }

  async function doUserSearch() {
    const CU = window.CurrentUser;
    if (!CU) { showToast('当前用户模块未加载', 3000, 'error'); return; }
    const kw = userKeywordEl ? userKeywordEl.value : '';
    if (!String(kw).trim()) { showToast('请输入工号或姓名', 2400, 'warn'); return; }

    if (userHintEl) userHintEl.textContent = '查询中…';
    let r;
    try {
      r = await CU.lookup(kw);
    } catch (e) {
      r = { ok: false, error: (e && e.message) || String(e) };
    }

    if (!r.ok) {
      if (userHintEl) userHintEl.textContent = '';
      showToast(`查询失败：${r.error || '未知错误'}`, 3600, 'error');
      return;
    }
    // 后端不按姓名过滤（返回的是登录人，实测见 js/ui/current-user.js 的注释）：
    // 与其把别人当成你，不如直接说清该怎么办。
    if (r.nameSearchUnsupported) {
      if (userHintEl) userHintEl.textContent = '未设置';
      showToast('接口当前不按姓名过滤，请改用工号（如 4711510）', 4200, 'warn');
      return;
    }
    if (!r.list.length) {
      if (userHintEl) userHintEl.textContent = '未设置';
      showToast(r.mode === 'id' ? `没有找到工号 ${String(kw).trim()}` : '没有找到匹配的人员', 3200, 'warn');
      return;
    }
    if (r.list.length === 1) {
      applyUser(r.list[0]);
      return;
    }
    // 同名多人：让用户自己点，别替他猜
    if (userHintEl) userHintEl.textContent = `匹配到 ${r.list.length} 人，请选择`;
    renderCandidates(r.list, applyUser);
  }

  function applyUser(u) {
    const CU = window.CurrentUser;
    const r = CU.set(u);
    if (!r.ok) { showToast(r.error || '保存失败', 3000, 'error'); return; }
    showToast(`已切换为 ${CU.label(r.user)}`, 2400, 'success');
    if (userKeywordEl) userKeywordEl.value = '';
    renderUser();
  }

  function switchUser() {
    const CU = window.CurrentUser;
    if (CU) CU.clear();
    renderUser();
    if (userKeywordEl) userKeywordEl.focus();
  }

  // ══════════════════════════════════════════════════════
  // 部门常用查询（本机口径）
  // ══════════════════════════════════════════════════════

  function readTopN() {
    try {
      const v = Number((window.localStorage || globalThis.localStorage).getItem(TOPN_KEY));
      return [5, 10, 20].includes(v) ? v : DEFAULT_TOPN;
    } catch (_) {
      return DEFAULT_TOPN;
    }
  }

  function writeTopN(n) {
    try {
      (window.localStorage || globalThis.localStorage).setItem(TOPN_KEY, String(n));
    } catch (_) { /* 记不住就用默认，不打扰用户 */ }
  }

  function renderDept() {
    const S = window.SavedQuery;
    const CU = window.CurrentUser;
    if (!S || !deptListEl) return;

    const topN = readTopN();
    if (deptTopNEl) deptTopNEl.value = String(topN);

    const u = CU ? CU.get() : null;
    clear(deptListEl);

    if (!u) {
      if (deptTitleEl) deptTitleEl.textContent = '部门常用查询';
      deptEmptyEl.hidden = false;
      deptEmptyEl.textContent = '先在「当前用户」里填工号或姓名，设置后就能看到本部门的常用查询。';
      return;
    }

    // 用 teamName 优先（真实报文里 orgName 是整个一级单位，teamName 才是部门）
    const deptName = (typeof CU.deptLabel === 'function' ? CU.deptLabel(u) : (u.teamName || u.orgName))
      || '（未识别部门）';
    if (deptTitleEl) deptTitleEl.textContent = `${deptName} 常用查询`;

    let items = [];
    try {
      items = S.listByDept(u, topN);
    } catch (e) {
      console.error('[home] 读取部门常用查询失败：', e);
    }

    items.forEach((it) => deptListEl.appendChild(buildItem(it, { meta: true, readonly: true })));

    const empty = items.length === 0;
    deptEmptyEl.hidden = !empty;
    if (empty) {
      deptEmptyEl.textContent = '本机还没有记录到本部门的常用查询：在任一查询页填好条件后点「⭐ 保存到首页」即可。';
    }

    // 本机数据先落地（离线也能看），再拿服务端的补充：
    // 「部门里几个人保存过」要凑齐所有人的记录才算得出来，那份数据在代理的 SQLite 里。
    if (u) loadDeptFromServer(u, topN);
  }

  /** 记录当前请求是针对谁的：慢请求回来时人已经换过不能覆盖（张冠李戴） */
  let deptReqSeq = 0;

  async function loadDeptFromServer(u, topN) {
    const S = window.SavedQuery;
    if (!S || typeof S.deptTopFromServer !== 'function') return;
    const seq = (deptReqSeq += 1);
    let r = null;
    try {
      r = await S.deptTopFromServer(u, topN);
    } catch (_) {
      return;   // 请求炸了不该影响已经渲染好的本机视图
    }
    if (seq !== deptReqSeq) return;                       // 已经有更新的请求了
    const CU = window.CurrentUser;
    const now = CU ? CU.get() : null;
    if (!now || String(now.userId || now.userName || '') !== String(u.userId || u.userName || '')) return;
    if (!r || !r.ok || !Array.isArray(r.items)) return;   // 失败就保留本机渲染的结果

    clear(deptListEl);
    r.items.forEach((it) => deptListEl.appendChild(buildItem(it, { meta: true, readonly: true })));
    const empty = r.items.length === 0;
    deptEmptyEl.hidden = !empty;
    if (empty) {
      deptEmptyEl.textContent = '这台机器上还没有本部门的常用查询记录。';
    }
  }

  // ══════════════════════════════════════════════════════
  // 导出 / 导入（跨浏览器、跨电脑的唯一通路）
  // ══════════════════════════════════════════════════════
  //
  // 为什么需要：记录在本机 localStorage。「同团队互相看到」在**同一台机器**上才自然成立，
  // 换电脑/换浏览器就是两份互不相干的数据（不是权限问题）。没有后端接口的前提下，
  // 只能靠文件交换：这边导出 JSON，那边导入合并。

  function exportQueries() {
    const S = window.SavedQuery;
    if (!S) { showToast('常用查询模块未加载', 2600, 'error'); return; }
    const items = S.list();
    if (!items.length) { showToast('还没有常用查询可以导出', 2600, 'warn'); return; }

    const blob = new Blob([S.exportJson()], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = (window.Fmt && typeof window.Fmt.stamp === 'function') ? window.Fmt.stamp() : '';
    a.href = url;
    a.download = `常用查询${stamp ? '_' + stamp : ''}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`已导出 ${items.length} 条，发给同团队的人让他「导 入」即可合并`, 3600, 'success');
  }

  function importQueries() {
    const S = window.SavedQuery;
    if (!S) { showToast('常用查询模块未加载', 2600, 'error'); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) { input.remove(); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const r = S.importJson(String(reader.result || ''));
        input.remove();
        if (!r.ok) { showToast(r.error || '导入失败', 3800, 'error'); return; }
        render();
        showToast(`已导入：新增 ${r.added} 条、合并 ${r.merged} 条，本机现有 ${r.total} 条`, 4000, 'success');
      };
      reader.onerror = () => { input.remove(); showToast('读取文件失败', 3000, 'error'); };
      reader.readAsText(file, 'utf-8');
    });
    document.body.appendChild(input);
    input.click();
  }

  // ══════════════════════════════════════════════════════
  // 装配
  // ══════════════════════════════════════════════════════

  function render() {
    renderSaved();
    renderUser();   // 内部会连带刷新部门排行
  }

  // 别的标签页改了 localStorage 时同步过来（多开页面是常态）
  window.addEventListener('storage', (e) => {
    const S = window.SavedQuery;
    if (!e.key) return;
    if (S && e.key === S.STORAGE_KEY) renderSaved();
    const CU = window.CurrentUser;
    if (CU && e.key === CU.STORAGE_KEY) renderUser();
  });

  if ($('#btnExportQueries')) $('#btnExportQueries').addEventListener('click', exportQueries);
  if ($('#btnImportQueries')) $('#btnImportQueries').addEventListener('click', importQueries);
  if ($('#btnUserSearch')) $('#btnUserSearch').addEventListener('click', doUserSearch);
  if ($('#btnUserChange')) $('#btnUserChange').addEventListener('click', switchUser);
  if (userKeywordEl) {
    userKeywordEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doUserSearch(); }
    });
  }
  if (deptTopNEl) {
    deptTopNEl.addEventListener('change', () => {
      writeTopN(Number(deptTopNEl.value) || DEFAULT_TOPN);
      renderDept();
    });
  }

  // Token 管理浮窗（与查询页同款入口，免得用户为了设 token 先随便进一页）
  try {
    if (window.TokenManager && typeof window.TokenManager.init === 'function') {
      window.TokenManager.init();
    }
  } catch (e) {
    console.error('Token 管理初始化失败:', e);
  }

  // 先把本机的渲染出来（不等网络），再与共享端点同步一次。
  //
  // 这里的 pushToServer 是**双向**的：它把本机记录提交上去，服务端与文件里的合并后
  // 返回全集，前端再用全集覆盖本地 —— 所以「我存的能给别人」「别人存的我也拿到」都靠它。
  // 没有端点（静态部署 / 离线 / 冒烟环境）时它安静失败，页面照旧只用本机数据。
  render();
  (async () => {
    const S = window.SavedQuery;
    if (!S || typeof S.pushToServer !== 'function') return;
    const r = await S.pushToServer();
    if (r && r.ok && !r.beacon) {
      renderSaved();
      renderDept();
    }
  })();

  // 离开页面前把本机记录（含刚才点开的那次计数）推回去：
  // 点卡片会立刻跳转，普通 fetch 会被卸载中断，所以用 sendBeacon。
  const flushToServer = () => {
    const S = window.SavedQuery;
    if (S && typeof S.pushToServer === 'function') S.pushToServer({ beacon: true });
  };
  window.addEventListener('pagehide', flushToServer);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushToServer();
  });

  // 暴露给冒烟测试：断言首页真的渲染出了列表（而不是只判脚本加载成功）
  window.HomePage = {
    render,
    renderDept,
    count: () => (savedListEl ? savedListEl.children.length : -1),
    deptCount: () => (deptListEl ? deptListEl.children.length : -1),
  };
})();
