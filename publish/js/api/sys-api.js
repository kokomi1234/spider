/**
 * 进入系统外围接口层（window.SysApi）——公告 / 提醒 / 角色 / AS 组织
 *
 * ── 数据来源 ────────────────────────────────────────────────
 * 抓包文件 `har/进入请求.har`（2026-09-08）。基础域名
 * http://itamp.bocsys.cn，本地由 proxy.js 转发（前端发完整后端路径）。
 *
 * 抓包确认的接口（5 个）：
 *   AS 组织列表     → GET  /itamp-comm/iam/getAsOrgList?n=0.xx
 *   角色组角色列表  → GET  /itamp-comm/role/getRoleListByRoleGroupId?roleGroupId=xx&status=1&n=0.xx
 *                     抓包里 roleGroupId 出现过 HANDLED_GROUP（经办组）/ REVIEW_GROUP（复核组）
 *   建议/提醒信息   → POST /itamp-asset/advice/queryAdviceInfo
 *                     body { infoStatus:'01', infoUserId:'4711510', flushFlag:'1' }
 *   公告未读标记    → POST /itamp-asset/releaseNotice/batch/getNoticeReadFlag
 *                     body { latestFlag:1, status:2 }，data 为未读数（数字）
 *   公告分页列表    → POST /itamp-asset/releaseNotice/list/selectPage
 *                     body { pageNum:1, pageSize:10, status:2, keyword:'' }
 *
 * 注意：抓包时公告列表与建议信息均为空（data:[] / rows:[]），行字段结构
 * 未知，适配函数按常见命名做防御式取值（title/name/content 等）。
 * 拿到真实行数据后，在 adaptNoticeRow 里收敛字段即可。
 *
 * 约定：所有方法都不抛异常，失败一律返回 { ok:false, error }。
 */
(function () {
  'use strict';

  const CONFIG = (typeof window !== 'undefined' && window.__APP_CONFIG__) || {};

  /** 抓包确认的接口路径（留空 = 关闭该能力） */
  const ENDPOINTS = Object.assign(
    {
      asOrgList:      '/itamp-comm/iam/getAsOrgList',
      roleList:       '/itamp-comm/role/getRoleListByRoleGroupId',
      adviceInfo:     '/itamp-asset/advice/queryAdviceInfo',
      noticeReadFlag: '/itamp-asset/releaseNotice/batch/getNoticeReadFlag',
      noticePage:     '/itamp-asset/releaseNotice/list/selectPage',
    },
    CONFIG.sysEndpoints || {}
  );

  const METHODS = Object.assign(
    {
      asOrgList:      'GET',
      roleList:       'GET',
      adviceInfo:     'POST',
      noticeReadFlag: 'POST',
      noticePage:     'POST',
    },
    CONFIG.sysEndpointMethods || {}
  );

  function isEnabled(name) {
    return Boolean(ENDPOINTS[name]);
  }

  /** 防缓存随机数：抓包里每个请求都带 ?n=0.xxx */
  function cacheBuster() {
    return Math.random().toString().slice(2);
  }

  /** 统一解析响应：非 2xx / 非 JSON / 业务码非 0|200 都算失败 */
  async function request(name, body, query) {
    const resp = await window.API.call(ENDPOINTS[name], {
      method: METHODS[name] || 'POST',
      ...(body !== undefined ? { body } : {}),
      ...(query ? { query } : {}),
    });

    if (!resp.ok) {
      let detail = '';
      try { detail = (await resp.text()).slice(0, 200); } catch (_) { /* ignore */ }
      throw new Error(`HTTP ${resp.status} ${detail}`.trim());
    }

    let json;
    try {
      json = await resp.json();
    } catch (e) {
      throw new Error(`接口返回的不是 JSON：${e.message}`);
    }

    if (json.code != null) {
      const bizCode = Number(json.code);
      if (bizCode !== 0 && bizCode !== 200) {
        throw new Error(json.msg || json.message || `业务错误：代码 ${json.code}`);
      }
    }
    return json;
  }

  function pickArray(json) {
    if (!json) return [];
    if (Array.isArray(json.data)) return json.data;
    if (json.data && Array.isArray(json.data.rows)) return json.data.rows;
    if (Array.isArray(json.rows)) return json.rows;
    return [];
  }

  /**
   * 公告行防御式适配：抓包时列表为空、行结构未知，
   * 按常见命名兜底取标题 / 日期 / 内容，拿到真实报文后在收敛到这里。
   */
  function adaptNoticeRow(r) {
    if (!r || typeof r !== 'object') return null;
    const title = r.title || r.noticeTitle || r.name || r.noticeName || '';
    const date = r.createTime || r.publishTime || r.updateTime || r.releaseTime || '';
    const content = r.content || r.noticeContent || r.text || '';
    if (!title && !content) return null;
    return { id: r.id || r.noticeId || '', title, date, content, raw: r };
  }

  // ── AS 组织 ──────────────────────────────────────────────

  /** GET /itamp-comm/iam/getAsOrgList?n=0.xx（抓包时 data 为空数组） */
  async function fetchAsOrgList() {
    if (!isEnabled('asOrgList')) return { ok: true, local: true, list: [] };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, list: [], error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('asOrgList', undefined, { n: cacheBuster() });
      const arr = (json && json.data) || [];
      return { ok: true, local: false, list: Array.isArray(arr) ? arr : [] };
    } catch (e) {
      return { ok: false, list: [], error: e.message || String(e) };
    }
  }

  // ── 角色组 ───────────────────────────────────────────────

  /**
   * 角色组角色列表。
   * GET /itamp-comm/role/getRoleListByRoleGroupId?roleGroupId=xx&status=1&n=0.xx
   * 响应 data: [{ roleName, roleCode, remark, status, ... }]
   * @param {string} roleGroupId 抓包确认值：HANDLED_GROUP（经办组）/ REVIEW_GROUP（复核组）
   */
  async function fetchRoleList(roleGroupId) {
    if (!isEnabled('roleList')) return { ok: true, local: true, list: [] };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, list: [], error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('roleList', undefined, {
        roleGroupId: roleGroupId || 'HANDLED_GROUP',
        status: 1,
        n: cacheBuster(),
      });
      const arr = (json && json.data) || [];
      const list = (Array.isArray(arr) ? arr : [])
        .map((r) => ({
          roleName: (r && r.roleName) || '',
          roleCode: (r && r.roleCode) || '',
          remark:   (r && r.remark) || '',
        }))
        .filter((r) => r.roleName || r.roleCode);
      return { ok: true, local: false, list };
    } catch (e) {
      return { ok: false, list: [], error: e.message || String(e) };
    }
  }

  // ── 建议 / 提醒 ──────────────────────────────────────────

  /**
   * 建议/提醒信息。
   * body 与抓包一致：{ infoStatus:'01', infoUserId:'4711510', flushFlag:'1' }
   * @param {string} infoUserId 当前用户工号（可从 TaskApi.fetchUserInfo 拿）
   * @param {string} infoStatus 抓包固定值 01
   */
  async function fetchAdviceInfo(infoUserId, infoStatus) {
    if (!isEnabled('adviceInfo')) return { ok: true, local: true, list: [] };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, list: [], error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('adviceInfo', {
        infoStatus: infoStatus || '01',
        infoUserId: String(infoUserId || ''),
        flushFlag: '1',
      });
      const arr = (json && json.data) || [];
      return { ok: true, local: false, list: Array.isArray(arr) ? arr : [] };
    } catch (e) {
      return { ok: false, list: [], error: e.message || String(e) };
    }
  }

  // ── 发布公告 ─────────────────────────────────────────────

  /**
   * 公告未读数。
   * body 与抓包一致：{ latestFlag:1, status:2 }，响应 data 为数字（0 = 全部已读）
   */
  async function fetchNoticeReadFlag() {
    if (!isEnabled('noticeReadFlag')) return { ok: true, local: true, count: null };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, count: null, error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('noticeReadFlag', { latestFlag: 1, status: 2 });
      const n = json && json.data;
      return { ok: true, local: false, count: Number.isFinite(Number(n)) ? Number(n) : 0 };
    } catch (e) {
      return { ok: false, count: null, error: e.message || String(e) };
    }
  }

  /**
   * 公告分页列表。
   * body 与抓包一致：{ pageNum, pageSize, status:2, keyword:'' }
   * 响应：{ total, rows:[...], code:200, msg:'查询成功', pageNum, pageSize, pageTotals }
   */
  async function fetchNoticePage(pageNum, pageSize, keyword) {
    if (!isEnabled('noticePage')) return { ok: true, local: true, total: 0, rows: [] };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, total: 0, rows: [], error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('noticePage', {
        pageNum:  Number(pageNum) || 1,
        pageSize: Number(pageSize) || 10,
        status: 2,
        keyword: String(keyword || ''),
      });
      const rows = pickArray(json).map(adaptNoticeRow).filter(Boolean);
      const total = Number((json && json.total) || rows.length);
      return { ok: true, local: false, total, rows };
    } catch (e) {
      return { ok: false, total: 0, rows: [], error: e.message || String(e) };
    }
  }

  if (typeof window !== 'undefined') {
    window.SysApi = {
      endpoints: ENDPOINTS,
      isEnabled,
      fetchAsOrgList,
      fetchRoleList,
      fetchAdviceInfo,
      fetchNoticeReadFlag,
      fetchNoticePage,
    };
  }
})();
