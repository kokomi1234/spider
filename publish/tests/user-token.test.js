'use strict';
/**
 * 本机用户 token（js/core/user-token.js）用例。
 *
 * 2026-09-22 用户改口径：token **只存浏览器本机**、不上传后端。所以这一层的正确性
 * （存/取/清 + 每天 5:00 的过期边界）直接决定"查询会不会白用一次失效的 token"。
 */
const assert = require('assert');
const { loadScript, test } = require('./harness');

/** localStorage 替身 */
function fakeStorage(initial, opts = {}) {
  const data = { ...(initial || {}) };
  return {
    _data: data,
    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem(k, v) {
      if (opts.throwOnSet) throw new Error('QuotaExceededError');
      data[k] = String(v);
    },
    removeItem(k) { delete data[k]; },
  };
}

function load(storage) {
  // ⚠️ localStorage 要挂在 **win**（第三个参数）上，不是 globals ——
  // loadScript 的 globals 只用来取 document/Blob/URL/定时器这几个具名参数，
  // 挂进 globals 的 localStorage 模块根本看不到（实测踩过：一片 false !== true）。
  const win = {};
  if (storage) win.localStorage = storage;
  return loadScript('js/core/user-token.js', {}, win).UserToken;
}

/** 纯函数（不碰存储）单独拿一份，专门钉「每天 5:00」这条边界 */
const isExpired = loadScript('js/core/user-token.js', {}).UserToken.isExpired;

const KEY = 'spider.userToken.v1';
/**
 * 造「**北京时间** h:mm」的时间戳。
 * ⚠️ 原来这里用 `new Date(y,m,d,h)`（机器本地时刻），注释还写着"避免时区把边界算歪" ——
 * 恰恰相反：被测的是北京 5:00 的分界，用本地时刻造数据，在非 +8 的机器上必红
 * （2026-09-22 复测 D-21 顺带查出：`TZ=UTC node tests/run.js` 会挂这两条用例）。
 * 现在先按 UTC 拼出"北京读数"，再减去 8 小时得到真实时间戳，跑在哪台机器都一样。
 */
const at = (y, m, d, h, min) => Date.UTC(y, m - 1, d, h, min || 0, 0, 0) - 8 * 60 * 60 * 1000;

test('UserToken：未录入时没有可用 token（代理会回落管理员）', () => {
  const U = load(fakeStorage());
  assert.strictEqual(U.status().has, false);
  assert.strictEqual(U.get(), null);
  assert.strictEqual(U.active().token, '', '没录入就不该带 token 出去');
  assert.ok(/未录入/.test(U.active().reason));
});

test('UserToken：录入 → 能取到明文、状态给脱敏预览、记下是谁录的', () => {
  const s = fakeStorage();
  const U = load(s);
  const r = U.set('  abcdefghijklmnop  ', { userId: '6464402', userName: '吴树海' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(U.get().token, 'abcdefghijklmnop', '要 trim 后存');
  const st = U.status();
  assert.strictEqual(st.has, true);
  assert.strictEqual(st.preview, 'abcd...mnop', '预览只留头尾');
  assert.strictEqual(st.ownerName, '吴树海');
  assert.strictEqual(U.active(at(2026, 9, 22, 10, 0)).token, 'abcdefghijklmnop');
  // 明文只在这一个键里，别的地方不该有
  assert.deepStrictEqual(Object.keys(s._data), [KEY]);
});

test('UserToken：没登录也能录（owner 为空，token 照样可用）', () => {
  // 用户明确要求：没登录也要能输入 token —— 本机就是本机，不绑身份。
  const U = load(fakeStorage());
  assert.strictEqual(U.set('token-without-user', null).ok, true);
  assert.strictEqual(U.get().ownerKey, '');
  assert.strictEqual(U.active().token, 'token-without-user');
});

test('UserToken：过期边界 —— 录入时间早于最近一次 5:00 就算失效', () => {
  const now = at(2026, 9, 22, 10, 0);          // 今天 10:00
  assert.strictEqual(isExpired(at(2026, 9, 22, 9, 0), now), false, '今天 9:00 录的还有效');
  assert.strictEqual(isExpired(at(2026, 9, 22, 4, 0), now), true, '今天 4:00 录的已过期');
  assert.strictEqual(isExpired(at(2026, 9, 21, 23, 0), now), true, '昨天录的过期');
  // 凌晨 3:00（今天 5:00 还没到）→ 分界线是**昨天**的 5:00
  const early = at(2026, 9, 22, 3, 0);
  assert.strictEqual(isExpired(at(2026, 9, 21, 6, 0), early), false, '昨天 6:00 录的，在今天凌晨仍有效');
  assert.strictEqual(isExpired(at(2026, 9, 21, 4, 0), early), true);
  assert.strictEqual(isExpired(0, now), true, '没有录入时间 = 不可信');
});

test('UserToken：过期的 token 不会被带出去（省掉必然 401 的那次请求）', () => {
  const now = at(2026, 9, 22, 10, 0);
  const s = fakeStorage({
    [KEY]: JSON.stringify({ token: 'stale-token', issuedAt: at(2026, 9, 22, 4, 0), ownerKey: '6464402', ownerName: '吴树海' }),
  });
  const U = load(s);
  assert.strictEqual(U.status(now).has, true, '记录还在');
  assert.strictEqual(U.status(now).expired, true, '但要标成已过期');
  assert.strictEqual(U.active(now).token, '', '过期的就不带出去了');
  assert.ok(/过期/.test(U.active(now).reason));
  // 5 点后重新录入 → 立刻可用（新录入的 issuedAt 晚于今天 5:00）
  U.set('fresh-token', null);
  assert.strictEqual(U.active(at(2026, 9, 22, 10, 5)).token, 'fresh-token');
});

test('UserToken：清除后回到「没有本机 token」', () => {
  const s = fakeStorage();
  const U = load(s);
  U.set('to-be-cleared', null);
  assert.strictEqual(U.clear().ok, true);
  assert.strictEqual(U.status().has, false);
  assert.strictEqual(U.get(), null);
  assert.strictEqual(s.getItem(KEY), null, '存储里也要清掉');
});

test('UserToken：过期截止点是**北京时间的 5:00**，与机器时区无关（2026-09-22 复测 D-21）', () => {
  const U = load(fakeStorage());
  const M = 60 * 1000; const H = 60 * M;
  // 全部用 Date.UTC 写死，断言里不出现任何本地时区语义：
  // 北京时间 2026-09-22 11:00（= UTC 03:00）→ 最近一次「北京 5:00」= 北京 09-22 05:00 = UTC 09-21 21:00
  assert.strictEqual(U.lastResetAt(Date.UTC(2026, 8, 22, 3, 0, 0)), Date.UTC(2026, 8, 21, 21, 0, 0),
    '北京 11:00 时，截止点应是北京当天 5:00');
  // 北京时间 04:00（= UTC 前一天 20:00）5:00 还没到 → 用昨天那一次 = 北京 09-21 05:00 = UTC 09-20 21:00
  assert.strictEqual(U.lastResetAt(Date.UTC(2026, 8, 21, 20, 0, 0)), Date.UTC(2026, 8, 20, 21, 0, 0),
    '5:00 之前应退回昨天那次');
  // 整点边界：北京 05:00 整 → 截止点就是它自己（这一刻录入的不算过期）
  assert.strictEqual(U.lastResetAt(Date.UTC(2026, 8, 21, 21, 0, 0)), Date.UTC(2026, 8, 21, 21, 0, 0));
  // isExpired 同口径：北京 04:30 录入的，到北京 11:00 已经算过期；05:10 录入的不算
  const cut = Date.UTC(2026, 8, 21, 21, 0, 0);
  const now = Date.UTC(2026, 8, 22, 3, 0, 0);
  assert.strictEqual(U.isExpired(cut - 30 * M, now), true, '北京 04:30 录入 → 早于当天 5:00，应判过期');
  assert.strictEqual(U.isExpired(cut + 10 * M, now), false, '北京 05:10 录入 → 应可用');
  // 偏移量固定为 8 小时：UTC 日界 + 5 小时 - 8 小时 = 北京 5:00（防止有人改回 setHours 读本地时区）
  assert.strictEqual(U.lastResetAt(Date.UTC(2026, 8, 22, 0, 0, 0)) - Date.UTC(2026, 8, 21, 0, 0, 0),
    (24 + 5 - 8) * H - 0, '跨过 5:00 前后的相对天数应是固定的北京时间口径');
});

test('UserToken：存储不可用 / 内容坏掉都不崩，一律当作「没有本机 token」', () => {
  const U1 = load(fakeStorage({}, { throwOnSet: true }));
  assert.strictEqual(U1.set('x', null).ok, false, '写失败要如实返回');
  assert.ok(U1.set('x', null).error);
  assert.strictEqual(U1.set('   ', null).ok, false, '空 token 不接受');

  assert.strictEqual(load(fakeStorage({ [KEY]: 'not-json' })).get(), null);
  assert.strictEqual(load(fakeStorage({ [KEY]: JSON.stringify({ token: '' }) })).get(), null);
  assert.strictEqual(load(fakeStorage({ [KEY]: JSON.stringify(null) })).get(), null);
  assert.strictEqual(load(null).get(), null, '连 localStorage 都没有也要安全');
});
