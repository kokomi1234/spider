/**
 * 用户搜索 / 用户详情 的接口层（window.UserApi）
 *
 * ── 数据来源 ────────────────────────────────────────────────
 * 抓包文件 `har/userinfo.har`（2026-09-08），对应
 * `output/接口文档.md` 里的 alaysis 段落。基础域名
 * http://itamp.bocsys.cn，本地由 proxy.js 转发（前端发完整后端路径）。
 *
 * 抓包确认的两个接口：
 *   按姓名搜用户 → POST /itamp-ems/alaysis/approval/common/getUserList?userName=xx&n=0.xx
 *   按工号查详情 → POST /itamp-ems/alaysis/approval/common/getUserInfo?userId=xx&n=0.xx
 * 两个都是「POST + 纯查询参数 + 无请求体」的形态，`n` 是防缓存随机数。
 *
 * ── 与 task-api.js 的关系 ───────────────────────────────────
 * 同一套写法：ENDPOINTS + METHODS + isEnabled + request。
 * 想临时关掉某个能力，在 window.__APP_CONFIG__.userEndpoints 里把
 * 对应路径置空即可，页面降级为空数据而不是报错。
 *
 * 约定：所有方法都不抛异常，失败一律返回 { ok:false, error }。
 */
(function () {
  'use strict';

  const CONFIG = (typeof window !== 'undefined' && window.__APP_CONFIG__) || {};

  /** 抓包确认的接口路径（留空 = 关闭该能力） */
  const ENDPOINTS = Object.assign(
    {
      userList: '/itamp-ems/alaysis/approval/common/getUserList',
      userInfo: '/itamp-ems/alaysis/approval/common/getUserInfo',
    },
    CONFIG.userEndpoints || {}
  );

  const METHODS = Object.assign(
    {
      userList: 'POST',
      userInfo: 'POST',
    },
    CONFIG.userEndpointMethods || {}
  );

  function isEnabled(name) {
    return Boolean(ENDPOINTS[name]);
  }

  /** 防缓存随机数：抓包里每个请求都带 ?n=0.xxx，原样保留 */
  function cacheBuster() {
    return Math.random().toString().slice(2);
  }

  /** 统一解析响应：非 2xx / 非 JSON / 业务码非 0|200 都算失败 */
  async function request(name, query) {
    const resp = await window.API.call(ENDPOINTS[name], {
      method: METHODS[name] || 'POST',
      query,
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

  /** 报文行 → 统一的用户对象（字段名与抓包响应一致） */
  function adaptUser(u) {
    if (!u || typeof u !== 'object') return null;
    return {
      userId:      String(u.userId ?? ''),
      userName:    u.userName || '',
      orgId:       u.orgId || '',
      orgName:     u.orgName || '',
      teamId:      u.teamId || '',
      teamName:    u.teamName || '',
      userStatus:  u.userStatus ?? '',
      userType:    u.userType ?? '',
      userLeave:   u.userLeave || '',
      email:       u.email || '',
      phoneNumber: u.phoneNumber || '',
    };
  }

  /**
   * 按姓名模糊搜索用户。
   * 接口: POST /itamp-ems/alaysis/approval/common/getUserList?userName=xx&n=0.xx
   * 响应: { code:200, msg:'操作成功', data:[{ userId, userName, orgName, teamName, ... }] }
   * 注意：抓包里同名多命中时后端会返回「查询失败」码 500（如 userName=郑梓），
   *       属于接口自身的模糊匹配限制，这里原样把错误抛给调用方。
   *
   * @param {string} userName 姓名（支持模糊，抓包示例：李胜）
   * @returns {Promise<{ok:boolean, local?:boolean, list:Array, error?:string}>}
   */
  async function fetchUserList(userName) {
    if (!isEnabled('userList')) return { ok: true, local: true, list: [] };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, list: [], error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('userList', {
        userName: String(userName || '').trim(),
        n: cacheBuster(),
      });
      const arr = (json && (json.data || json.rows)) || [];
      const list = (Array.isArray(arr) ? arr : [])
        .map(adaptUser)
        .filter((u) => u && (u.userId || u.userName));
      return { ok: true, local: false, list };
    } catch (e) {
      return { ok: false, list: [], error: e.message || String(e) };
    }
  }

  /**
   * 按工号查用户详情。
   * 接口: POST /itamp-ems/alaysis/approval/common/getUserInfo?userId=xx&n=0.xx
   * 响应: { code:200, msg:'操作成功', data:{ userId, userName, orgId, orgName, ... } }
   *
   * @param {string} userId 用户工号（如 4711510）
   * @returns {Promise<{ok:boolean, local?:boolean, user?:object|null, error?:string}>}
   */
  async function fetchUserDetail(userId) {
    if (!isEnabled('userInfo')) return { ok: true, local: true, user: null };
    if (!window.API || typeof window.API.call !== 'function') {
      return { ok: false, user: null, error: 'API 客户端未就绪' };
    }
    try {
      const json = await request('userInfo', {
        userId: String(userId || '').trim(),
        n: cacheBuster(),
      });
      return { ok: true, local: false, user: adaptUser(json && json.data) };
    } catch (e) {
      return { ok: false, user: null, error: e.message || String(e) };
    }
  }

  if (typeof window !== 'undefined') {
    window.UserApi = {
      endpoints: ENDPOINTS,
      isEnabled,
      fetchUserList,
      fetchUserDetail,
    };
  }
})();
