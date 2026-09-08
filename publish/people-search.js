/**
 * 人员查询（任务单查询页 task.html 用）
 *
 * ── 数据来源 ────────────────────────────────────────────────
 * har/userinfo.har，接口层在 user-api.js：
 *   按姓名搜用户 → UserApi.fetchUserList(userName)
 *   按工号查详情 → UserApi.fetchUserDetail(userId)
 *
 * 交互：
 *   输入姓名（≥1 个字）→ 搜索 → 表格列出 工号/姓名/部门/团队；
 *   点击行 → 拉取该工号详情，在行下方展开详情块。
 * 接口未启用 / 加载失败时静默提示，不影响页面其它功能。
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const STATUS_TEXT = { '1': '在职', '2': '试用期', '3': '在职' };

  let searchSeq = 0;   // 防竞态：只认最后一次搜索的结果
  let expandedId = null;

  function setMsg(text) {
    const box = $('psResult');
    if (box) box.innerHTML = `<div class="ps-empty">${esc(text)}</div>`;
  }

  function rowHtml(u, idx) {
    const status = u.userStatus ? (STATUS_TEXT[u.userStatus] || `状态${u.userStatus}`) : '';
    return `
      <tr class="ps-row" data-user-id="${esc(u.userId)}">
        <td class="ps-idx">${idx}</td>
        <td class="ps-no">${esc(u.userId) || '—'}</td>
        <td>${esc(u.userName) || '—'}</td>
        <td>${esc(u.orgName) || '—'}</td>
        <td>${esc(u.teamName) || '—'}</td>
        <td>${esc(status) || '—'}</td>
      </tr>`;
  }

  function renderList(list) {
    const box = $('psResult');
    if (!box) return;
    box.innerHTML = `
      <table class="ps-table">
        <thead>
          <tr><th class="ps-idx-h">#</th><th class="ps-no-h">工号</th><th>姓名</th><th>部门</th><th>团队</th><th>状态</th></tr>
        </thead>
        <tbody>${list.map(rowHtml).join('')}</tbody>
      </table>
      <div class="ps-hint">点击行查看详情</div>`;
  }

  async function doSearch() {
    const input = $('psKeyword');
    if (!input || !window.UserApi) return;
    const kw = String(input.value || '').trim();
    if (!kw) { setMsg('请输入姓名关键字'); return; }

    const seq = ++searchSeq;
    setMsg('搜索中…');
    const r = await window.UserApi.fetchUserList(kw);
    if (seq !== searchSeq) return;   // 已有更新的搜索，丢弃旧结果

    if (!r.ok) {
      setMsg(`⚠️ 搜索失败：${r.error || '未知错误'}`);
      return;
    }
    if (!r.list.length) {
      setMsg(`未找到姓名包含「${kw}」的用户${r.local ? '（接口未启用）' : ''}`);
      return;
    }
    renderList(r.list);
  }

  /** 行点击 → 拉详情 → 行下展开 */
  async function toggleDetail(tr) {
    const userId = tr && tr.dataset.userId;
    if (!userId || !window.UserApi) return;

    // 已展开 → 收起
    const old = $('psDetailRow');
    if (old) {
      const oldId = old.dataset.forUserId;
      old.remove();
      if (oldId === userId) { expandedId = null; return; }
    }

    const tbody = tr.parentElement;
    const detailRow = document.createElement('tr');
    detailRow.id = 'psDetailRow';
    detailRow.dataset.forUserId = userId;
    detailRow.innerHTML = '<td colspan="6" class="ps-detail">详情加载中…</td>';
    tbody.insertBefore(detailRow, tr.nextSibling);
    expandedId = userId;

    const r = await window.UserApi.fetchUserDetail(userId);
    if (expandedId !== userId) return;   // 已切到别的行
    const cell = detailRow.querySelector('td');
    if (!r.ok) {
      cell.innerHTML = `⚠️ 详情加载失败：${esc(r.error || '')}`;
      return;
    }
    const u = r.user || {};
    const items = [
      ['工号', u.userId], ['姓名', u.userName],
      ['部门', u.orgName], ['团队', u.teamName],
      ['用户类型', u.userType ? `类型${u.userType}` : ''],
      ['人员状态', u.userStatus ? (STATUS_TEXT[u.userStatus] || u.userStatus) : ''],
      ['人员类别', u.userLeave], ['邮箱', u.email], ['电话', u.phoneNumber],
    ].filter(([, v]) => v);
    cell.innerHTML = items.length
      ? items.map(([k, v]) => `<span class="ps-kv"><b>${esc(k)}</b>：${esc(v)}</span>`).join('')
      : (r.local ? '接口未启用，无详情' : '未查到详情');
  }

  function init() {
    // 卡片折叠
    const toggle = $('peopleToggle');
    const body = $('peopleBody');
    if (toggle && body) {
      toggle.addEventListener('click', () => {
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : 'block';
        toggle.style.transform = open ? 'rotate(-90deg)' : '';
        toggle.setAttribute('aria-expanded', String(!open));
      });
    }

    const btn = $('psSearchBtn');
    const input = $('psKeyword');
    if (btn) btn.addEventListener('click', doSearch);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

    const box = $('psResult');
    if (box) {
      box.addEventListener('click', (e) => {
        const tr = e.target.closest('tr.ps-row');
        if (tr) toggleDetail(tr);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
