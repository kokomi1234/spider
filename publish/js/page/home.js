/* ============================================================
  首页 — 三个页面入口 + 当前用户 + 常用查询 + 部门常用查询
  ------------------------------------------------------------
  本页做四件事：
    · 渲染「常用查询」列表（js/ui/saved-query.js；主存是代理的共享库，
      本机 localStorage 只是「我的」离线镜像）
    · 设置「当前用户」（工号/姓名 → js/ui/current-user.js → 部门）
    · 按当前用户的部门，渲染「部门常用查询」排行（5/10/20 条）
    · 重命名 / 删除 / 一键直达

  两条设计约束：
    1) 三个入口卡是静态 HTML（<a href>），不依赖 JS —— 即使脚本挂了也能进页面。
    2) 用户可控文本（查询名、摘要、人名、部门名）全部走 textContent 写进 DOM，
       不用 innerHTML，从根上避免首页成为 XSS 面。

  口径提醒：「部门常用查询」的排行口径 = **同一份查询条件被本部门几个人保存过**，
  数据来自共享库（`GET /local/saved-queries?dept=`，服务端按 savers 表算人数）；
  服务端不可用时退回本机镜像计算 —— 此时只反映本机这一份，界面不额外标注，
  因为顶部同步角标已经在说「仅本机」了，两处都说会变成噪音。
============================================================ */

(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  const savedListEl = $('#savedList');
  const savedTitleEl = $('#savedTitle');
  const savedEmptyEl = $('#savedEmpty');
  const savedCountEl = $('#savedCount');
  const savedSyncEl = $('#savedSync');

  const userSetEl = $('#userSet');
  const userAvatarEl = $('#userAvatar');
  const userLabelEl = $('#userLabel');
  const userDeptEl = $('#userDept');
  const userFormEl = $('#userForm');
  // 「当前用户」的可搜索下拉：这个 <select> 是**宿主**，会被 js/ui/searchable-select.js
  // 隐藏并接管（组件在它的父节点里插入 .searchable-select 结构，输入框/✕/▼/面板都是组件建的）。
  const userKeywordEl = $('#userKeyword');
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
    // ⚠️ 字段名是 `message` 不是 `text`：传错不报错、正文静默变空，
    //   于是「确定删除常用查询『X』？」在页面上只剩一个「请确认」（2026-09-22 复测 D-1，阻塞级）。
    if (D && typeof D.confirmBox === 'function') return D.confirmBox({ message: text });
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
    // 从首页点开一次就算一次「打开」，这是「高频」的判据（纯本地计数）
    main.addEventListener('click', () => {
      // hit 已 async 化（服务端优先）：失败也绝不挡跳转 —— 同步异常与 Promise 拒绝都要吞掉
      try { Promise.resolve(window.SavedQuery.hit(item.id)).catch(() => {}); } catch (_) { /* 计数失败不该挡住跳转 */ }
    });

    const nameRow = document.createElement('div');
    nameRow.className = 'saved-name';
    const badge = document.createElement('span');
    badge.className = 'saved-badge';
    badge.textContent = (window.SavedQuery && window.SavedQuery.PAGES[item.page]) || item.page;
    const nameText = document.createElement('span');
    // 部门榜（titleFromLabels）的标题**只认筛选条件**，不认个人起的名字：
    // 否则有人改个名，整个部门的榜单都跟着变（2026-09-22 用户报）。
    // labels 为空（没填任何条件）时退回 name —— 那种记录本来就没"条件"可拼。
    const condTitle = o.titleFromLabels && window.SavedQuery
      && typeof window.SavedQuery.condNameOf === 'function'
      ? window.SavedQuery.condNameOf(item) : '';
    // 截断只作用于**条件生成的默认名**（condNameOf 内部已经过 shortCode）。
    // ⚠️ 这里不得再过一遍 shortCode，否则会连用户自己起的名字一起截：
    //   他改成「发布查询-2」，卡片上就只剩一个「2」（2026-09-22 复测 D-2）。
    nameText.textContent = condTitle || item.name || '';
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
    const cur = await window.SavedQuery.getAsync(id);
    if (!cur) { showToast('该查询已不存在', 2500, 'warn'); render(); return; }
    let name;
    try {
      name = await askText('给这条查询起个名字', cur.name);
    } catch (_) {
      name = '';
    }
    if (!name || !String(name).trim()) return; // 点取消 / 空输入：什么都不做
    const r = await window.SavedQuery.rename(id, String(name).trim());
    if (!r.ok) { showToast(r.error || '重命名失败', 3000, 'error'); return; }
    markLocalWrite();   // 本地刚改过：别让紧接着的 ?user= 旧响应把新名字刷回去
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
    const r = await window.SavedQuery.remove(id);
    if (!r.ok) { showToast(r.error || '删除失败', 3000, 'error'); return; }
    markLocalWrite();   // 同上：别让旧响应把已经删掉的卡片又画回来
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

    const CU = window.CurrentUser;
    const u = CU ? CU.get() : null;
    if (savedTitleEl) savedTitleEl.textContent = u ? `我的常用查询（${u.userName || u.userId}）` : '常用查询';

    if (!u) {
      // 没设「当前用户」也**不再空着**：把本机那些「无人认领」的记录列出来 ——
      // 也就是没登录时保存的查询。以前这里直接清空、只留一句"先设当前用户"，
      // 用户看到的是"我明明存了却什么都没有"（2026-09-22 报）。
      // 别人的记录依然不会出现：过滤口径见 SavedQuery.listForUser 的注释。
      let anon = [];
      try {
        anon = S.listForUser(null);
      } catch (e) {
        console.error('[home] 读取本机常用查询失败：', e);
      }
      paintSaved(anon, null);
      return;
    }

    // ⚠️ 只有**真的认领到了**才标「本地写过」：认领会改镜像 + 推服务端，
    //    随后的 ?user= 拉取可能是认领前的旧数据，得挡住那一次。
    //    没认领到（claimAnonymous 返回 claimed: 0）**千万别标** —— 标了会把正常的
    //    「从服务端刷新我的列表」也一起挡掉，表现就是「我的常用查询」永远是空的，
    //    而部门榜因为直接读服务端还有数据（2026-09-22 真踩到）。
    try {
      if (typeof S.claimAnonymous === 'function') {
        const cl = S.claimAnonymous(u);
        if (cl && cl.claimed > 0) markLocalWrite();
      }
    } catch (e) {
      console.error('[home] 认领本机常用查询失败：', e);
    }

    let items = [];
    try {
      items = S.listForUser(u);
    } catch (e) {
      console.error('[home] 读取常用查询失败：', e);
      showToast('读取常用查询失败（本地存储不可用？）', 3500, 'error');
    }
    paintSaved(items, u);

    // 本机先落地（离线也能看），再用服务端按工号捞的那份覆盖：
    // 换浏览器 / 换电脑时本机是空的，但记录在共享库里。
    loadMineFromServer(u);
  }

  /**
   * 空列表时说什么。
   *
   * 2026-09-21 用户要求删掉「这台浏览器里存着 N 条…」那几条 —— 那套话是
   * 「本机 localStorage 是主存」时代的产物，现在记录在共享库（代理的 SQLite）、
   * 本机那份只是「我的」离线镜像，拿它的条数解释空列表既不准确也误导人。
   *
   * 但**三种「空」要分清**这件事仍然成立（2026-09-20 用户报「给郑梓辉存了却还是空」，
   * 光看旧文案分不清是哪种），所以保留三分支、只去掉「存在浏览器里」这个说法：
   *   ① 真的一条都没有            → 去查询页存一条
   *   ② 有记录但**没带归属人**      → 这些记录谁的「我的」都看不到，得先设好当前用户再重存
   *   ③ 有归属人的记录但都不是"我"的 → 那就是还没存过，或存的时候身份不是现在这个
   */
  function emptyHintFor(u) {
    const S = window.SavedQuery;
    const who = (u && (u.userName || u.userId)) || '当前用户';
    let total = 0;
    let orphan = 0;
    try {
      const all = S.list();
      total = all.length;
      // 无归属 = owner 取不到 key（存的时候页面没设当前用户，或那页没加载 current-user.js）
      orphan = all.filter((it) => !S.userKeyOf(it.owner)).length;
    } catch (_) { /* 读不出来就按 0 说 */ }

    if (!total) {
      return '你还没有保存过常用查询：到任一查询页填好筛选条件后，点「⭐ 保存到首页」，这里就会出现一键直达的入口。';
    }
    // ⚠️ 这两条分支现在只在**认领失败**时才会走到（正常情况下 renderSaved 会先把
    // 无人认领的记录认领给当前用户，见 SavedQuery.claimAnonymous）。
    // 2026-09-22 之前它们说的是"再去查询页重新保存一次" —— 那等于承认用户白存了一次，
    // 现在改成指向"认领"，别再写回旧口径。
    if (orphan === total) {
      return `这 ${total} 条是本机保存的、还没有归属人（存的时候还没设「当前用户」）。`
        + '在上面填好工号或姓名它们就会归到你名下（没归上时刷新一次页面即可）。';
    }
    if (orphan > 0) {
      return `属于「${who}」的还没有；另有 ${orphan} 条是本机保存的、还没有归属人`
        + '（填好当前用户后会自动归到你名下）。';
    }
    return `你还没有保存过常用查询（「${who}」名下一条都没有）：`
      + '到任一查询页填好条件后点「⭐ 保存到首页」就会出现。';
  }

  function paintSaved(items, u) {
    clear(savedListEl);
    items.forEach((it) => savedListEl.appendChild(buildItem(it)));
    const empty = items.length === 0;
    if (savedEmptyEl) {
      savedEmptyEl.hidden = !empty;
      if (empty) savedEmptyEl.textContent = emptyHintFor(u);
    }
    if (savedCountEl) savedCountEl.textContent = empty ? '' : `共 ${items.length} 条`;
  }

  /** 记录「我的列表」这次请求是针对谁的：慢响应回来时人已经换过就不能覆盖（与部门区同一手法） */
  let mineReqSeq = 0;

  /**
   * 本地最近一次**写操作**的时间（重命名 / 删除 / 导入）。
   *
   * 为什么要它：这些操作写本地之后，`SavedQuery` 里的同步推送是 fire-and-forget 的
   * （`autoPush()` 不 await），而首页这边 `renderSaved()` 每次渲染又会去 `?user=` 拉一份
   * 服务端数据覆盖 DOM —— **GET 经常跑赢 POST**，拿回来的是"改之前"的旧数据，
   * 于是刚改好的名字被刷回去，而且之后不会再有重渲染来纠正，看起来就像"改名没生效"。
   * （2026-09-20 子代理真点 UI 才发现；调 API 的测法看不到。）
   */
  let lastLocalWriteAt = 0;

  /** 记一次本地写操作，供上面的陈旧响应判断使用 */
  function markLocalWrite() { lastLocalWriteAt = Date.now(); }

  async function loadMineFromServer(u) {
    const S = window.SavedQuery;
    if (!S || typeof S.mineFromServer !== 'function') return;
    const seq = (mineReqSeq += 1);
    let r = null;
    try {
      r = await S.mineFromServer(u);
    } catch (_) {
      return;   // 请求炸了不该影响已经渲染好的本机视图
    }
    if (seq !== mineReqSeq) return;                            // 已经有更新的请求了
    // 本地刚写过（重命名/删除/导入）的 5 秒内，?user= 拉回来的都可能是旧数据 ——
    // 那次写操作的 POST 还在路上，服务端返回的是"改之前"的全集，拿它覆盖 DOM
    // 就会表现成「改名后名字弹回旧名 / 导入的东西看不见」。
    // 本地才是最新的真相：窗口期内以本地为准。（2026-09-20 子代理真点 UI 发现。）
    if (Date.now() - lastLocalWriteAt < 5000) return;
    const CU = window.CurrentUser;
    const now = CU ? CU.get() : null;
    if (!now || String(now.userId || now.userName || '') !== String(u.userId || u.userName || '')) return;
    if (!r || !r.ok || !Array.isArray(r.items)) return;        // 失败就留着本机渲染的结果
    paintSaved(r.items, u);
  }

  // ══════════════════════════════════════════════════════
  // 同步状态角标（「现在看的是团队库，还是只有本机这一份」）
  // ══════════════════════════════════════════════════════
  //
  // 同步本来就是静默的：成功就合并、失败就退回本机，页面上看不出差别。
  // 角标只如实转达存储层记下的那一次结果，自己不做任何判断 ——
  // 判断（哪个状态、算不算故障）留在 js/ui/saved-query.js 的 recordSync 里，
  // 这样三个查询页和本机视图看到的是同一套口径。

  function renderSync() {
    if (!savedSyncEl) return;
    const S = window.SavedQuery;
    const st = (S && typeof S.lastSyncState === 'function') ? S.lastSyncState() : null;
    // 还没同步过：不显示，免得首屏闪一个「仅本机」的假信号。
    // 'nouser'（没设「当前用户」）同样隐藏 —— 那次只是探了个端点活着没，
    // 根本没有「我的列表」可同步，显示「已同步」是空话（2026-09-21 用户拍板）。
    if (!st || st.state === 'pending' || st.state === 'nouser') {
      savedSyncEl.hidden = true;
      savedSyncEl.textContent = '';
      savedSyncEl.title = '';
      return;
    }

    // 2026-09-21 用户拍板：角标只留状态词。
    // · 提示文字（title 长串）全删 —— 悬停就弹一大坨，干扰大于帮助；
    // · 「库内 N 条」计数也删 —— 它只在写操作后更新，常常是旧的（用户报「刷新不及时」），
    //   而且架构改版后同步响应里的 total 已经变成「我的条数」，再标「库内」就是错口径。
    savedSyncEl.hidden = false;
    savedSyncEl.className = `sync-state is-${st.state}`;
    savedSyncEl.textContent = st.state === 'shared' ? '已同步' : (st.state === 'fail' ? '同步失败' : '仅本机');
    savedSyncEl.title = '';
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
    if (has) {
      // 拆成三段填：头像用姓名首字，正文只放「姓名（工号）」，部门单独一行小字。
      // 每个节点都判空 —— 单测用的是精简假 DOM，不判空会直接抛。
      const name = u.userName || '（未填姓名）';
      if (userAvatarEl) userAvatarEl.textContent = name.slice(0, 1);
      if (userLabelEl) userLabelEl.textContent = u.userId ? `${name}（${u.userId}）` : name;
      if (userDeptEl) userDeptEl.textContent = CU.deptLabel(u) || '（未识别部门）';
    } else {
      if (userAvatarEl) userAvatarEl.textContent = '';
      if (userLabelEl) userLabelEl.textContent = '';
      if (userDeptEl) userDeptEl.textContent = '';
      if (userSetEl) userSetEl.removeAttribute('title');
    }
    if (userHintEl) userHintEl.textContent = has ? '已设置' : '未设置';
    resetUserSearch();   // 身份一变（设好 / 切换 / 清空）就把候选与搜索词一起清掉
    // 「我的常用查询」和部门排行都随身份变，所以在这里一起刷；
    // render() 那边就不再单独调 renderSaved()，免得一次首屏发两遍请求
    renderSaved();
    renderDept();
  }

  // ── 「当前用户」的可搜索下拉：复用 js/ui/searchable-select.js ──────────
  //
  // 为什么用组件而不是自己写一套：下拉的键盘、焦点、aria（combobox / listbox /
  // aria-activedescendant）以及「可访问名称」全项目只该有**一份口径** —— 组件里那套
  // 已经被冒烟与无障碍用例钉住了（tests/a11y-name.test.js、smoke 的控件语义段）。
  // 这个 <select> 只是**宿主**：组件会把它藏起来，接管成「输入框 + ✕ + ▼ + 面板」。
  const USER_SEARCH_DEBOUNCE_MS = 250;
  let userInst = null;      // 组件实例
  let userCandMap = {};     // userId → 用户对象（选中后按宿主的 value 反查，与评委工号同一手法）
  let userSearchTimer = null;
  let userSearchSeq = 0;    // 防竞态：只认最后一次搜索的结果

  /** 宿主容器（组件把 .searchable-select 插在 <select> 的原位置，也就是父节点里） */
  function userHost() {
    return (userKeywordEl && userKeywordEl.parentElement) || null;
  }

  /** 组件里那个真正给用户打字的输入框 */
  function userSearchBox() {
    const host = userHost();
    return host ? host.querySelector('.searchable-select .searchable-select-input') : null;
  }

  /**
   * 现在该拿什么当搜索词。
   *
   * 判据：**输入框里的内容是不是"已选中那一项的展示文本"**——
   * 选中过之后组件会把 label 回填进输入框，那时它是展示文本、不是用户想搜的东西，
   * 要改用组件的 freeText（用户手打、没选中任何项的内容）。
   * 不直接只读 freeText 的原因：它只在组件自己的 input 事件里更新，
   * 而测试 / 探针常常是"直接写 value 再驱动一次"，那条路径下它是空的。
   */
  function userSearchKeyword() {
    // 以组件的 freeText 为准：它是「用户手打、还没选中任何一项」的内容，由组件自己在
    // input 事件里维护 —— 比读输入框的 value 可靠：选中一项后组件会把 label 回填进输入框、
    // 清空时又会把 value 抹掉（2026-09-20 真浏览器实测踩过：读 value 拿到空串，搜索永远不触发）。
    if (userInst && typeof userInst.getFreeText === 'function') {
      const t = String(userInst.getFreeText() || '').trim();
      if (t) return t;
    }
    // 兜底：组件没提供 freeText 时（老版本 / 测试替身）退回读输入框
    const box = userSearchBox();
    return box ? String(box.value || '').trim() : '';
  }

  /** 一条候选怎么念给用户看：「张三（4711510） · 中国银行软件中心（深圳）开发三部」 */
  function userOptionLabel(u) {
    const who = [u.userName || '（无名）', u.userId ? `（${u.userId}）` : ''].join('');
    const dept = u.teamName || u.orgName || '';
    return dept ? `${who} · ${dept}` : who;
  }

  /** 值不值得发请求：空的不发；纯数字不足 3 位不是工号（与 current-user 的 looksLikeId 同口径） */
  function shouldSearchUser(kw) {
    const s = String(kw || '').trim();
    if (!s) return false;
    if (/^\d+$/.test(s)) return s.length >= 3;
    return true;
  }

  /** 清掉候选与在途请求（身份变化 / 切换用户时走它） */
  /** 只清候选，**不动输入框** —— 「这次输入还不到能搜的长度」时走它 */
  function clearUserCands() {
    userSearchSeq += 1;
    if (userSearchTimer) { clearTimeout(userSearchTimer); userSearchTimer = null; }
    userCandMap = {};
    if (userInst) {
      try { userInst.updateOptions([]); userInst.close(); } catch (_) { /* 实例已销毁 */ }
    }
  }

  /**
   * 连输入一起清 —— **只在身份变化**（设好 / 切人 / 清空）时用。
   *
   * ⚠️ 别拿它当"输入不合格"的处理：`setValue('')` 会把输入框内容抹掉，
   * 而工号的前 1~2 位本来就不满足长度要求 —— 那样每敲一个数字都被清掉，
   * 表现成「**根本没法输入工号**」（2026-09-20 用户实测报的，我把它当清候选用了）。
   */
  function resetUserSearch() {
    clearUserCands();
    if (userInst) {
      try { userInst.setValue(''); } catch (_) { /* 实例已销毁 */ }
    }
  }

  /**
   * 建组件并接线。组件没加载时**降级**成原生下拉（功能少「输入即搜」，
   * 但不至于变成"什么都没有"，也不抛错打断首页其它部分）。
   */
  function initUserSelect() {
    if (userInst || !userKeywordEl) return;
    if (typeof window.createSearchableSelect !== 'function') {
      console.warn('[home] createSearchableSelect 未加载（js/ui/searchable-select.js），「当前用户」降级为原生下拉');
      return;
    }
    userInst = window.createSearchableSelect(userKeywordEl, [], {
      label: '当前用户',
      placeholder: '输入工号或姓名',
    });
    // 选中：宿主 <select> 的 value 就是我们灌进候选的 userId
    userKeywordEl.addEventListener('change', () => {
      const u = userCandMap[String(userKeywordEl.value || '')];
      if (u) applyUser(u);   // 空值（组件清空时）不进这里
    });
    // 输入即搜：**直接绑组件内部那个输入框**。
    // （原来抄的是评委行的写法 —— 绑在宿主容器上用 capture 兜，因为那边的行会被重建；
    //   首页没有这种场景，而且 capture 那条路在真浏览器里实测没送达，
    //   绑在真输入框上更直接、也少一层对组件内部结构的依赖。）
    const box = userSearchBox();
    if (!box) return;
    box.addEventListener('input', (e) => {
      if (e && e.isComposing) return;   // 中文输入法组字中的中间态不搜
      scheduleUserSearch();
    });
    box.addEventListener('compositionend', () => scheduleUserSearch());
  }

  /** 输入变化后延迟搜一次；表单收着（身份已设置）就不搜 —— 那时输入框用户看不见 */
  function scheduleUserSearch() {
    if (userFormEl && userFormEl.hidden) return;
    if (userSearchTimer) { clearTimeout(userSearchTimer); userSearchTimer = null; }
    const kw = userSearchKeyword();
    if (!shouldSearchUser(kw)) {
      clearUserCands();   // 只清候选 —— 绝不动输入框（否则工号敲第一个数字就被抹掉）
      return;
    }
    userSearchTimer = setTimeout(() => {
      userSearchTimer = null;
      doUserSearch({ auto: true });
    }, USER_SEARCH_DEBOUNCE_MS);
  }

  /**
   * 这个输入值值不值得发一次请求：空的不发；纯数字不足 3 位不是工号
   * （与 js/ui/current-user.js 的 looksLikeId 同口径），发了也白搭。
   */
  // （2026-09-20）这里原来是 shouldSearch / cancelSearch / scheduleSearch 三个自写函数。
  // 「当前用户」改用 searchable-select 组件后，防抖与竞态处理搬到了上面的
  // shouldSearchUser / resetUserSearch / scheduleUserSearch，旧的已删。

  /**
   * 查人并处理结果。
   *
   * @param {{auto?:boolean}} [opts] auto=true = 「边打边搜」触发的：
   *   安静（不弹「请输入」这类 toast），且**一律只出下拉、不自动套用** ——
   *   用户还没确认就把身份改掉太激进。手动点「查 询」时保持原语义（唯一命中直接设上）。
   */
  async function doUserSearch(opts) {
    const o = opts || {};
    const auto = !!o.auto;
    const CU = window.CurrentUser;
    if (!CU) { showToast('当前用户模块未加载', 3000, 'error'); return; }
    const kw = userSearchKeyword();
    if (!kw) {
      if (!auto) showToast('请输入工号或姓名', 2400, 'warn');
      return;
    }
    if (auto && !shouldSearchUser(kw)) return;

    const seq = (userSearchSeq += 1);
    if (userInst) userInst.setBusy('查询中…');
    let r;
    try {
      r = await CU.lookup(kw);
    } catch (e) {
      r = { ok: false, error: (e && e.message) || String(e) };
    }
    if (seq !== userSearchSeq) return;   // 期间又输入了：这份结果作废，不许覆盖新的

    if (!r.ok) {
      if (userInst) userInst.setBusy('');
      // 这是真故障（接口挂了 / 离线回放没这条缓存），两种模式都要说出来
      showToast(`查询失败：${r.error || '未知错误'}`, 3600, 'error');
      return;
    }
    // 返回的人里没有一个名字含关键词：与其把不相关的人当结果用，不如说清。
    // （措辞不再断言「后端不按姓名过滤」—— 那是把离线回放的宽松匹配当成了后端行为，
    //   2026-09-20 用抓到报文更正过，见 current-user.js 的注释。）
    if (r.nameSearchUnsupported) {
      if (userInst) userInst.setBusy('没有名字含这个关键词的人');
      showToast('返回的结果里没有名字含这个关键词的人，换个完整姓名或改用工号再试', 4200, 'warn');
      return;
    }
    if (!r.list.length) {
      if (userInst) userInst.setBusy(r.mode === 'id' ? '没有找到这个工号' : '没有找到匹配的人');
      if (!auto) showToast(r.mode === 'id' ? `没有找到工号 ${kw}` : '没有找到匹配的人员', 3200, 'warn');
      return;
    }
    // 手动点「查 询」且只命中一个 → 直接设上（沿用旧语义）；
    // 自动搜索一律只出下拉，等用户自己挑 —— 还没确认就把身份改掉太激进。
    if (!auto && r.list.length === 1) {
      applyUser(r.list[0]);
      return;
    }
    // 把候选灌进组件（value 用 userId；选中后靠 userCandMap 反查完整的人）
    userCandMap = {};
    const options = r.list.map((u) => {
      const val = String(u.userId || u.userName || '');
      userCandMap[val] = u;
      return { value: val, label: userOptionLabel(u) };
    });
    if (userInst) {
      userInst.updateOptions(options);
      userInst.open();   // 只有输入框还聚焦着它才展开（组件自己判断，不抢焦点）
    }
  }

  function applyUser(u) {
    const CU = window.CurrentUser;
    const r = CU.set(u);
    if (!r.ok) { showToast(r.error || '保存失败', 3000, 'error'); return; }
    showToast(`已切换为 ${CU.label(r.user)}`, 2400, 'success');
    resetUserSearch();   // 选完了就把候选与搜索词清掉，下次重新搜
    renderUser();
  }

  function switchUser() {
    const CU = window.CurrentUser;
    if (CU) CU.clear();
    resetUserSearch();
    renderUser();
    // 清掉登录态后「常用查询」列表必须跟着重渲染：镜像里还残留着上一个人的记录
    //（清除登录态不清镜像），不重渲染的话屏幕上会一直挂着别人的列表。
    // renderSaved 在没身份的分支里会把镜像收敛成只剩本机匿名的、并列出它们。
    renderSaved();
    const box = userSearchBox();
    if (box) box.focus();   // 焦点回到组件内部那个真正的输入框（宿主 <select> 是隐藏的）
  }

  // （2026-09-20）原来这里有个 clearKeyword + #btnUserClear「清空输入」按钮。
  // 改用 searchable-select 组件后，组件自带的 ✕ 就是干这个的（只清值、不动「当前用户」），
  // 那个按钮和它的样式一并删了。

  // ══════════════════════════════════════════════════════
  // 部门常用查询（排行口径：同一份条件被本部门几个人保存过，数据来自共享库）
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

    items.forEach((it) => deptListEl.appendChild(buildItem(it, { meta: true, readonly: true, titleFromLabels: true })));

    const empty = items.length === 0;
    deptEmptyEl.hidden = !empty;
    if (empty) {
      // 不写「本机还没有…」：主存是共享库，本机那份只是先渲染出来的离线镜像
      deptEmptyEl.textContent = '本部门还没有常用查询记录：在任一查询页填好条件后点「⭐ 保存到首页」即可。';
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
    r.items.forEach((it) => deptListEl.appendChild(buildItem(it, { meta: true, readonly: true, titleFromLabels: true })));
    const empty = r.items.length === 0;
    deptEmptyEl.hidden = !empty;
    if (empty) {
      deptEmptyEl.textContent = '本部门还没有常用查询记录。';
    }
  }

  // ══════════════════════════════════════════════════════
  // 导出 / 导入（跨机器搬运用）
  // ══════════════════════════════════════════════════════
  //
  // 2026-09-21 更正：以前这里写的是「记录在本机 localStorage，同一台机器才自然共享」——
  // 那是**架构改版前**的口径，现在团队的记录都在代理的共享库（SQLite）里，
  // 同一份代理下大家本来就互相看得到，导出/导入不再是「唯一通路」。
  // 它现在的用途是**搬运/备份**：换一台机器、或者把自己的一批查询挪到别处。
  // **范围（2026-09-21 用户拍板）**：导出导的是**当前用户自己的**记录
  // （此前误取团队库全集，实测 12 条跨了 6 个人）；导入进来的记录**归当前用户**
  // （按 id / 同页面同名合并）。没设「当前用户」时，两侧都只走本机镜像 ——
  // 那时常用查询本来就保存在 localStorage、不进共享库。

  async function exportQueries() {
    const S = window.SavedQuery;
    if (!S) { showToast('常用查询模块未加载', 2600, 'error'); return; }
    // 2026-09-21 用户拍板：导出**只导当前用户自己的**（此前 exportJsonAsync 拉的是
    // 团队库全集）。它内部已按「当前用户」问服务端，连不上/没设用户才退本机镜像。
    // 所以这里不再用本机条数拦人 —— 本机镜像只有「我的」，条数少不代表服务端没有。
    const text = await S.exportJsonAsync();
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = (window.Fmt && typeof window.Fmt.stamp === 'function') ? window.Fmt.stamp() : '';
    a.href = url;
    a.download = `常用查询${stamp ? '_' + stamp : ''}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    // 条数从**导出内容**里读（导出的是「我的」那份，可能来自服务端、也可能来自本机镜像，
    // 这一层没有现成的 items 变量）。
    // 2026-09-21 修：原先写的是 `${items.length}` —— `items` 是 renderSaved/deptRender 里的
    // **函数局部变量**，这一层根本取不到，点导出必抛 ReferenceError。表现很隐蔽：
    // 文件照常下载，但成功提示永不出现，反被全局兜底弹一句「⚠️ 页面出现异常」，看着像导出失败。
    // 之前的测试只调 S.exportJsonAsync() 验 JSON 合法，**从没点过这个按钮**，所以一直没暴露。
    let n = 0;
    try {
      const parsed = JSON.parse(text);
      n = Array.isArray(parsed && parsed.items) ? parsed.items.length : 0;
    } catch (_) { /* 解析不了就只说「已导出」，不编一个数 */ }
    showToast((n ? `已导出你的 ${n} 条常用查询` : '已导出你的常用查询')
      + '，发给同团队的人让他「导 入」即可合并', 3600, 'success');
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
      reader.onload = async () => {
        // importJson 已 async 化：连得上代理时直接把合并结果写进**服务端**，
        // 本机镜像只刷「我的」那份 —— 刚导入的别人的记录不会再被空同步盖掉，
        // 因为真相源在服务端，首页渲染也是从服务端拉的。
        const r = await window.SavedQuery.importJson(String(reader.result || ''));
        input.remove();
        if (!r.ok) { showToast(r.error || '导入失败', 3800, 'error'); return; }
        markLocalWrite();
        render();
        // 导入的合并结果写在**共享库**，r.total 是库里的条数（不再说「本机现有」）
        // ⚠️ 一条都没新增时不许报「已导入」：那多半是文件里全是自己已有的条件，
        //   或被上限/字段不全丢弃了（2026-09-22 复测 D-4、D-5 —— 原来这种情形也报成功）。
        const dropped = (Number(r.dropped) || 0) + (Number(r.skipped) || 0);
        const head = r.added === 0 && r.merged === 0
          ? '没有可导入的新查询'
          : (r.added === 0
            ? `这些查询你已经有了：合并 ${r.merged} 条`
            : `已导入：新增 ${r.added} 条、合并 ${r.merged} 条`);
        showToast(head + `，库内现有 ${r.total} 条`
          + (dropped ? `，另有 ${dropped} 条未入库（超上限或字段不全）` : ''),
        4000, dropped ? 'warn' : 'success');
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
    renderSync();
    renderUser();   // 内部会连带刷新「我的常用查询」与部门排行（两块都按身份过滤）
  }

  // 别的标签页改了 localStorage 时同步过来（多开页面是常态）
  window.addEventListener('storage', (e) => {
    const S = window.SavedQuery;
    if (!e.key) return;
    // 登录段与**匿名段**都要监听：没设当前用户时数据全在匿名段，只认 STORAGE_KEY 的话
    // 未登录保存的记录在另一个标签页里永远不重绘，必须刷新（2026-09-22 复测 D-15）。
    if (S && (e.key === S.STORAGE_KEY || (S.ANON_STORAGE_KEY && e.key === S.ANON_STORAGE_KEY))) renderSaved();
    const CU = window.CurrentUser;
    if (CU && e.key === CU.STORAGE_KEY) renderUser();
  });

  // 同步状态一变（首屏那次、以及每次「写完本地顺手推一次」回来）就刷新角标。
  // 不在各个写入口分别接线：那样只要有人新增一条写路径就会漏掉，角标又变成旧的。
  if (window.SavedQuery && typeof window.SavedQuery.onSyncStateChange === 'function') {
    window.SavedQuery.onSyncStateChange(renderSync);
  }
  // 首屏主动同步一次：角标和「我的」列表要及时反映共享库现状，
  // 不能等第一次写操作才有状态（2026-09-21 用户报「刷新不及时」）。
  if (window.SavedQuery && typeof window.SavedQuery.syncFromServer === 'function') {
    window.SavedQuery.syncFromServer();
  }

  if ($('#btnExportQueries')) $('#btnExportQueries').addEventListener('click', exportQueries);
  if ($('#btnImportQueries')) $('#btnImportQueries').addEventListener('click', importQueries);
  if ($('#btnUserSearch')) $('#btnUserSearch').addEventListener('click', doUserSearch);
  if ($('#btnUserChange')) $('#btnUserChange').addEventListener('click', switchUser);
  // 「当前用户」：建可搜索下拉并接上「输入即搜」。
  // 键盘（↑↓ / Enter / Esc）、焦点、aria、✕ 的显隐、点外部收起 —— 全由组件负责，
  // 这里不再自己接一套（那正是「复用组件」的意义：口径只有一份）。
  initUserSelect();
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
    renderSync,
    /**
     * 走「显式查询」那条路（等同点「查 询」）：传 kw 就先写进输入框再查一次。
     * 唯一命中会直接设上当前用户（旧语义）。
     */
    searchUser: (kw) => {
      const box = userSearchBox();
      if (box && kw !== undefined) box.value = kw;
      return doUserSearch();
    },
    /** 走「输入即搜」那条路（绕过防抖，供冒烟 / 探针直接 await；一律只出下拉不自动套用） */
    searchUserAuto: (kw) => {
      const box = userSearchBox();
      if (box && kw !== undefined) box.value = kw;
      return doUserSearch({ auto: true });
    },
    /** 下拉开着没有（组件自己的状态；要数选项就直接查 DOM 的 .searchable-select-option） */
    candsOpen: () => !!(userInst && typeof userInst.isOpen === 'function' && userInst.isOpen()),
    /** 组件实例（冒烟要读它内部的输入框 / 面板时用；没建起来是 null） */
    userSelect: () => userInst,
    /** 「输入即搜」的监听挂在哪个节点上（诊断用：应当等于宿主 <select> 的父节点） */
    searchHost: () => userHost(),
    count: () => (savedListEl ? savedListEl.children.length : -1),
    deptCount: () => (deptListEl ? deptListEl.children.length : -1),
  };
})();
