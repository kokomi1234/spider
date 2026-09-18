/**
 * 当前用户（查询人）—— 首页「部门常用查询」的身份依据
 * ------------------------------------------------------------
 * 口径（2026-09-18 与用户确认）：
 *   · **不做部门下拉选择**，让用户填**自己的工号或姓名**；
 *     一次查询既拿到部门，又记录下「这条查询是谁存的」。
 *   · 数据源是已抓包确认的两个接口（js/api/user-api.js）：
 *       纯数字 → getUserInfo（按工号查详情）
 *       其它   → getUserList（按姓名模糊搜）
 *     返回里的 orgId / orgName 就是部门。
 *   · 选中结果存 localStorage，下次打开自动带上（用户明确要求记选择）。
 *   · 后端**没有**「部门常用查询」接口，本项目定位是本地中间平台，
 *     所以这里只负责身份，统计一律在本机完成，界面也要标注「本机口径」。
 *
 * 用法：
 *   CurrentUser.get()                  // {userId,userName,orgId,orgName,teamName} | null
 *   CurrentUser.lookup('4711510')      // → {ok, list:[user,...], error?}
 *   CurrentUser.set(user) / clear()
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'spider.currentUser.v1';

  const fail = (error) => ({ ok: false, error });

  function storage() {
    try {
      const s = window.localStorage || globalThis.localStorage;
      return s || null;
    } catch (_) {
      return null;   // 隐私模式下访问 localStorage 本身就抛
    }
  }

  /** 只保留会用到、且要渲染到页面上的字符串字段 */
  function normalize(u) {
    if (!u || typeof u !== 'object') return null;
    const pick = (k) => (typeof u[k] === 'string' ? u[k].trim() : String(u[k] == null ? '' : u[k]).trim());
    const out = {
      userId: pick('userId'),
      userName: pick('userName'),
      orgId: pick('orgId'),
      orgName: pick('orgName'),
      teamId: pick('teamId'),
      teamName: pick('teamName'),
      at: typeof u.at === 'number' ? u.at : Date.now(),
    };
    return (out.userId || out.userName) ? out : null;
  }

  function get() {
    const s = storage();
    if (!s) return null;
    try {
      const txt = s.getItem(STORAGE_KEY);
      if (!txt) return null;
      return normalize(JSON.parse(txt));
    } catch (_) {
      return null;   // 存量坏了就当没设置，不拖崩首页
    }
  }

  function set(user) {
    const u = normalize(user);
    if (!u) return fail('用户信息不完整');
    const s = storage();
    if (!s) return fail('浏览器存储不可用（隐私模式？），无法记住选择');
    try {
      s.setItem(STORAGE_KEY, JSON.stringify(u));
      return { ok: true, user: u };
    } catch (_) {
      return fail('保存失败：浏览器存储空间不足或被禁用');
    }
  }

  function clear() {
    const s = storage();
    if (!s) return fail('浏览器存储不可用');
    try {
      s.removeItem(STORAGE_KEY);
      return { ok: true };
    } catch (_) {
      return fail('清除失败');
    }
  }

  /** 纯数字当工号，其余当姓名（工号里不会出现字母/汉字） */
  function looksLikeId(kw) {
    return /^\d{3,}$/.test(String(kw).trim());
  }

  /**
   * 按「工号或姓名」查人。
   * @returns {Promise<{ok:boolean, list:Array, mode:'id'|'name'|'', error?:string, empty?:boolean}>}
   */
  async function lookup(keyword) {
    const kw = String(keyword || '').trim();
    if (!kw) return { ok: false, list: [], mode: '', error: '请输入工号或姓名' };

    const Api = window.UserApi;
    if (!Api) return { ok: false, list: [], mode: '', error: '人员查询模块未加载（user-api.js）' };

    if (looksLikeId(kw)) {
      if (typeof Api.fetchUserDetail !== 'function') {
        return { ok: false, list: [], mode: 'id', error: '人员查询接口不可用' };
      }
      const r = await Api.fetchUserDetail(kw);
      if (!r.ok) return { ok: false, list: [], mode: 'id', error: r.error || '查询失败' };
      const u = normalize(r.user);
      if (!u) return { ok: true, list: [], mode: 'id', empty: true };
      return { ok: true, list: [u], mode: 'id' };
    }

    if (typeof Api.fetchUserList !== 'function') {
      return { ok: false, list: [], mode: 'name', error: '人员查询接口不可用' };
    }
    const r = await Api.fetchUserList(kw);
    if (!r.ok) {
      // 抓包记录：同名多命中时后端会直接返回失败码，原样把原因透给用户
      return { ok: false, list: [], mode: 'name', error: r.error || '查询失败' };
    }
    const list = (r.list || []).map(normalize).filter(Boolean);
    return { ok: true, list, mode: 'name', empty: list.length === 0 };
  }

  /**
   * 「部门」的展示文本：**team 优先，org 兜底**。
   * 真实报文里 orgName 是整个一级单位（“中国银行软件中心（深圳）”，几百人），
   * teamName 才是用户口语里的部门（“…开发三部”）—— 拿 orgName 当部门，
   * 部门排行会把整个单位算成同一个部门，等于没有维度。
   */
  function deptLabel(u) {
    const user = normalize(u);
    if (!user) return '';
    return user.teamName || user.orgName || '';
  }

  /** 展示文案：「张三（4711510） · …开发三部」 */
  function label(u) {
    const user = normalize(u);
    if (!user) return '';
    const who = [user.userName, user.userId ? `（${user.userId}）` : ''].join('');
    const dept = deptLabel(user);
    return dept ? `${who} · ${dept}` : who;
  }

  window.CurrentUser = {
    STORAGE_KEY,
    get,
    set,
    clear,
    lookup,
    label,
    deptLabel,
    normalize,
    looksLikeId,
  };
})();
