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
      // missing 如实带回这份身份缺什么（见 missingOf）—— 调用方要据此提醒用户，
      // 不能设完就报「成功」，残缺的身份存进共享库的东西换台机器会查不到。
      return { ok: true, user: u, missing: missingOf(u) };
    } catch (_) {
      return fail('保存失败：浏览器存储空间不足或被禁用');
    }
  }

  /**
   * 这份身份**缺什么**（决定它写进共享库的记录换台机器、换个人还查不查得到）。
   *   'userId' —— 没工号：归属键退化成姓名（saved-query.js 的 userKeyOf = 工号 ‖ 姓名），
   *     而库里存的是工号，换台机器拿姓名去查就是 0 条（2026-09-23 实测），还可能撞同名。
   *   'team' —— 没有 team 级部门：部门榜的键会退到 orgId/orgName（整个一级单位），
   *     和别人存的 teamId 对不上，榜单看着就是空的（同日实测）。
   * 返回空数组 = 该有的都有。
   */
  function missingOf(u) {
    const user = normalize(u);
    if (!user) return ['identity'];
    const out = [];
    if (!user.userId) out.push('userId');
    if (!(user.teamId || user.teamName)) out.push('team');
    return out;
  }

  /** 残缺身份要说的那句话 —— 措辞只这一处：设上时的 toast 与首屏加载的提醒都走它 */
  const MISSING_LABEL = { userId: '工号', team: '部门', identity: '信息' };
  function incompleteWarning(u) {
    const miss = missingOf(u);
    if (!miss.length) return '';
    const what = miss.map((m) => MISSING_LABEL[m] || '信息').join('和');
    return `当前用户缺${what}：这样存进共享库的常用查询，换台机器或换浏览器可能查不到`
      + '（归属按工号记、部门榜按部门键聚合）。在「当前用户」里重新查一次工号或姓名补全。';
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
      // 核对返回的工号与输入是否一致。
      // ⚠️ 2026-09-20 更正：这里原先写的是「实测后端会忽略查询参数、直接返回 token 对应的
      // 登录人」—— 那是把**离线回放的宽松匹配**当成了后端行为（精确 key 未命中时，
      // 代理会把同 path 的最近一条返回，看起来就像参数没生效）。
      // 接到手里的报文其实证明接口**按参数返回**：getUserList?userName=李胜 一次回了
      // 11 个不同分行的李胜；同一会话相隔 9 秒的两条，getUserInfo?userId=4711510 → 郑梓辉、
      // getUserList?userName=吴树海 → 吴树海。
      // 核对本身仍然留着：离线回放 / 接口异常时，它挡的是「把别人当成你」这个更坏的后果。
      if (u.userId && u.userId !== kw) {
        return {
          ok: false, list: [], mode: 'id',
          error: `接口返回的是工号 ${u.userId}（不是 ${kw}），后端可能忽略了查询参数`,
        };
      }
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
    if (!list.length) return { ok: true, list: [], mode: 'name', empty: true };

    // 只认「名字里真的含这个关键字」的结果：接口是模糊匹配，多命中时（如「郑梓」）会直接
    // 返回失败码；万一它返回了不相关的人，宁可当「没查到」，也不能让用户选错人。
    // ⚠️ 2026-09-20 更正：原先这里写着「实测传任意姓名都会返回同一个登录人」——
    // 与上面工号那段同源，都是离线回放宽松匹配造成的假象；真实报文里按姓名**是**能过滤的。
    const matched = list.filter((u) => u.userName && u.userName.includes(kw));
    if (!matched.length) {
      // 返回了人、但没一个名字含关键词 —— 当「没查到」处理。
      // （字段名 nameSearchUnsupported 是历史遗留，它曾经表示「接口不按姓名过滤」；
      //   那个结论已被报文推翻，但改名要牵动 home.js 的调用点，这里只收窄语义。）
      return {
        ok: true, list: [], mode: 'name', empty: true, nameSearchUnsupported: true,
        returned: list.map((u) => u.userName).filter(Boolean),
      };
    }
    return { ok: true, list: matched, mode: 'name' };
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

  /**
   * 身份残缺时**自己补一次**：拿姓名去人员接口查，只有「姓名完全相等且唯一命中」才认。
   *
   * 为什么必须在首屏做：归属键是工号优先（`SavedQuery.userKeyOf`），缺工号的那台机器
   * 存进共享库的记录，键就成了**姓名**；另一台用完整身份（工号）的机器按工号查不到它 ——
   * 反向也一样查不到（2026-09-23 深度矩阵里唯一没通的那格）。补上工号，两边才认得彼此。
   * 查不到 / 同名多命中一律**不动**：宁可继续提示「身份不全」，也不能把别人当成你。
   *
   * @returns {Promise<{ok:boolean, completed?:boolean, user?:object, missing?:string[], reason?:string, error?:string}>}
   */
  async function autoComplete() {
    const cur = get();
    if (!cur) return { ok: false, reason: 'nouser' };
    const miss = missingOf(cur);
    if (!miss.length) return { ok: true, completed: false, user: cur, missing: [] };
    const name = cur.userName;
    if (!name) return { ok: false, reason: 'noname', missing: miss };   // 连姓名都没有，无从查起
    let r = null;
    try {
      r = await lookup(name);
    } catch (e) {
      return { ok: false, reason: 'error', error: (e && e.message) || String(e), missing: miss };
    }
    if (!r || !r.ok) return { ok: false, reason: 'error', error: (r && r.error) || '人员查询失败', missing: miss };
    const exact = (r.list || []).filter((u) => u && u.userName === name);
    if (exact.length !== 1) {
      return { ok: false, reason: exact.length > 1 ? 'ambiguous' : 'notfound', missing: miss };
    }
    // 只**填空**，不覆盖已有值（接口偶尔回残缺对象，别把本机已有的字段抹成空串）
    const found = exact[0];
    const patch = {};
    Object.keys(found).forEach((k) => { if (!cur[k] && found[k]) patch[k] = found[k]; });
    const merged = normalize(Object.assign({}, cur, patch));
    if (!merged) return { ok: false, reason: 'bad', missing: miss };
    const w = set(merged);
    if (!w.ok) return { ok: false, reason: 'storage', error: w.error, missing: miss };
    return { ok: true, completed: missingOf(merged).length < miss.length, user: merged, missing: missingOf(merged) };
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
    missingOf,
    incompleteWarning,
    autoComplete,
  };
})();
