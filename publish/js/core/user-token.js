'use strict';
/**
 * 本机的用户 token（**只存在自己这台机器的 localStorage 里**）。
 *
 * 为什么不用代理侧数据库（2026-09-22 用户改口径）：
 * 有的同事 token 权限较高，不愿意把它交给后端存 —— 那就只留在本机，
 * **发请求时带给代理**转发即可。代理因此完全不需要保存任何用户凭证。
 *
 * 过期：内网 token **每天早上 5:00** 失效，判定就是「录入时间早于最近一次 5:00」，
 * 所以 5 点之后重新录入立刻生效（新录入的 issuedAt 晚于今天 5:00）。
 * 判定放在前端：token 就在本地，发请求前先算一次就知道该不该带 ——
 * 带一个必然失效的 token 只会换来一次 401。
 *
 * 与身份的关系：**不强绑**。本机可以没有当前用户就录入（内网自用、一人一机为主），
 * 只顺带记下录入时是谁（ownerKey/ownerName），换人用时在界面上提示一句，不阻止使用。
 */
(function () {
  var storageKey = 'spider.userToken.v1';
  var expiryHour = 5;

  function storage() {
    try {
      return window.localStorage;
    } catch (_) {
      return null;   // 隐私模式等：当作没有本机 token，一律回落管理员
    }
  }

  /** 读原始记录（没存 / 坏了都回 null） */
  function get() {
    var s = storage();
    if (!s) return null;
    try {
      var raw = s.getItem(storageKey);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || typeof o.token !== 'string' || !o.token) return null;
      return {
        token: o.token,
        issuedAt: Number(o.issuedAt) || 0,
        ownerKey: String(o.ownerKey || ''),
        ownerName: String(o.ownerName || ''),
      };
    } catch (_) {
      return null;
    }
  }

  /**
   * 「最近一次 5:00」的时间戳：早于它的 token 都算过期（5 点后录入的天然不算）。
   *
   * ⚠️ 内网那句「每天早上 5:00 失效」指的是**北京时间**，与跑浏览器那台机器的时区无关。
   *   原来写成 `new Date(t).setHours(5,0,0,0)`，读的是**机器本地时区** ——
   *   你在 +8 机器上无感，换一台非 +8 的机器（或系统时区被改过）就会整体偏移：
   *   偏早判过期 = 明明能用却提示重录，偏晚 = 明明过期了还照发、换来一次 401。
   *   口径同 `AGENTS.md` §6.3「业务日期一律 UTC+8」（2026-09-22 复测 D-21）。
   */
  var BUSINESS_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;   // 北京时间 = UTC+8
  var DAY_MS = 24 * 60 * 60 * 1000;
  var HOUR_MS = 60 * 60 * 1000;

  function lastResetAt(now) {
    var t = Number.isFinite(now) ? now : Date.now();
    // 先把时间轴平移到「按北京时间读数」，日界就能直接用 UTC 算法，最后再平移回真实时间戳
    var shifted = t + BUSINESS_TZ_OFFSET_MS;
    var cut = Math.floor(shifted / DAY_MS) * DAY_MS + expiryHour * HOUR_MS;   // 北京时间今天 5:00
    if (cut > shifted) cut -= DAY_MS;                                        // 今天 5:00 还没到 → 用昨天那一次
    return cut - BUSINESS_TZ_OFFSET_MS;
  }

  /** 这个 token 是不是已经过期（issuedAt 早于最近一次 5:00） */
  function isExpired(issuedAt, now) {
    var at = Number(issuedAt) || 0;
    if (!at) return true;                  // 没有录入时间 = 不可信
    return at < lastResetAt(now);
  }

  /** 脱敏预览：只留头尾 */
  function previewOf(token) {
    var s = String(token || '');
    if (!s) return '';
    if (s.length <= 8) return s.slice(0, 2) + '...';
    return s.slice(0, 4) + '...' + s.slice(-4);
  }

  /**
   * 本机 token 的状态（界面显示用，不回明文）。
   * @returns {{has:boolean, expired:boolean, preview:string, issuedAt:number,
   *            ownerKey:string, ownerName:string}}
   */
  function status(now) {
    var r = get();
    if (!r) return { has: false, expired: false, preview: '', issuedAt: 0, ownerKey: '', ownerName: '' };
    return {
      has: true,
      expired: isExpired(r.issuedAt, now),
      preview: previewOf(r.token),
      issuedAt: r.issuedAt,
      ownerKey: r.ownerKey,
      ownerName: r.ownerName,
    };
  }

  /**
   * 这次请求该不该带本机 token。
   * @returns {{token:string, reason:string}} token 为空 = 没有可用的本机 token（代理会回落管理员）
   */
  function active(now) {
    var r = get();
    if (!r) return { token: '', reason: '本机未录入 token' };
    if (isExpired(r.issuedAt, now)) return { token: '', reason: '本机 token 已过期' };
    return { token: r.token, reason: '本机 token' };
  }

  /**
   * 录入 / 覆盖本机 token。
   * @param {string} token 明文
   * @param {object} [owner] 录入时的当前用户（可空 —— 没登录也允许录入）
   */
  function set(token, owner) {
    var t = String(token || '').trim();
    if (!t) return { ok: false, error: '请填写 token' };
    var s = storage();
    if (!s) return { ok: false, error: '浏览器存储不可用（隐私模式？），无法保存' };
    try {
      s.setItem(storageKey, JSON.stringify({
        token: t,
        issuedAt: Date.now(),
        ownerKey: String((owner && (owner.userId || owner.userName)) || ''),
        ownerName: String((owner && owner.userName) || ''),
      }));
      return { ok: true };
    } catch (_) {
      return { ok: false, error: '保存失败：浏览器存储空间不足或被禁用' };
    }
  }

  /** 清除本机 token（回到回落管理员 token） */
  function clear() {
    var s = storage();
    if (!s) return { ok: false, error: '浏览器存储不可用' };
    try {
      s.removeItem(storageKey);
      return { ok: true };
    } catch (_) {
      return { ok: false, error: '清除失败' };
    }
  }

  if (typeof window !== 'undefined') {
    window.UserToken = {
      storageKey, expiryHour,
      get, set, clear, status, active,
      isExpired, lastResetAt, previewOf,
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { storageKey, expiryHour, isExpired, lastResetAt, previewOf };
  }
})();
