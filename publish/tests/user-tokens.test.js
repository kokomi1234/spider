'use strict';
/**
 * 用户 token 存储（publish/lib/user-tokens.js）用例。
 *
 * 这里最要紧的是**过期边界**：内网 token 每天 5:00 失效，判错一天就会让用户
 * 早上用着一个已经失效的 token 到处报错，或者该回落管理员 token 时没回落。
 *
 * Node < 22.5 没有 node:sqlite：那种环境自动跳过。
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('./harness');

const Mod = (() => {
  try { return require('../lib/user-tokens.js'); } catch (_) { return null; }  // eslint-disable-line
})();

/** 每个用例一个独立库文件，跑完删掉 */
function freshStore() {
  const file = path.join(os.tmpdir(), `spider-tok-${Date.now()}-${Math.floor(Math.random() * 1e6)}.db`);
  return Mod.open(file);
}

const testOrSkip = Mod && Mod.available() ? test : (name, fn) => {
  process.stdout.write(`  ⊘ ${name}（本机 Node 不支持 node:sqlite，跳过）\n`);
  void fn;
};

/** 本地时间的某个时刻（用例里都用本地时刻，避免时区把边界算歪） */
const at = (y, m, d, h, min) => new Date(y, m - 1, d, h, min || 0, 0, 0).getTime();

if (!(Mod && Mod.available())) {
  process.stdout.write('  ⚠️ 当前 Node 没有 node:sqlite（需 Node ≥ 22.5），token 存储用例全部跳过\n');
}

testOrSkip('user-tokens：录入 / 覆盖 / 移除', () => {
  const s = freshStore();
  assert.strictEqual(s.get('1001'), null, '没录入过就是 null');
  s.set({ userKey: '1001', userName: '张三', token: 'tok-a', issuedAt: 1000 });
  assert.strictEqual(s.get('1001').token, 'tok-a');
  assert.strictEqual(s.get('1001').userName, '张三');
  // 同一个人再录一次：覆盖，不新增
  s.set({ userKey: '1001', userName: '张三', token: 'tok-b', issuedAt: 2000 });
  assert.strictEqual(s.get('1001').token, 'tok-b');
  assert.strictEqual(s.count(), 1, '同一个人只占一条');
  // 移除 → 回到「用管理员 token」的兜底
  s.remove('1001');
  assert.strictEqual(s.get('1001'), null);
  s.close();
});

testOrSkip('user-tokens：set 缺工号 / 缺 token 都要拒绝（不能存出无主的凭证）', () => {
  const s = freshStore();
  assert.strictEqual(s.set({ userKey: '', token: 't' }).ok, false);
  assert.strictEqual(s.set({ userKey: '1001', token: '   ' }).ok, false);
  assert.strictEqual(s.count(), 0);
  s.close();
});

testOrSkip('user-tokens：过期边界 —— 每天 5:00 分界（内网 token 的失效点）', () => {
  const now = at(2026, 9, 22, 10, 0);          // 今天 10:00
  // 今天 09:00 录的：晚于今天 05:00 → 还有效
  assert.strictEqual(Mod.isExpired(at(2026, 9, 22, 9, 0), now), false);
  // 今天 04:00 录的：早于今天 05:00 → 已过期
  assert.strictEqual(Mod.isExpired(at(2026, 9, 22, 4, 0), now), true);
  // 昨天录的 → 过期
  assert.strictEqual(Mod.isExpired(at(2026, 9, 21, 23, 0), now), true);

  // 凌晨 3:00（今天 5:00 还没到）→ 分界线是**昨天**的 5:00
  const early = at(2026, 9, 22, 3, 0);
  assert.strictEqual(Mod.isExpired(at(2026, 9, 21, 6, 0), early), false, '昨天 6:00 录的，在今天凌晨仍然有效');
  assert.strictEqual(Mod.isExpired(at(2026, 9, 21, 4, 0), early), true, '昨天 4:00 录的，早就过期了');

  // 没有录入时间 = 不可信，一律算过期
  assert.strictEqual(Mod.isExpired(0, now), true);
});

testOrSkip('user-tokens：5:00 之后重新录入立刻生效（不用等到第二天）', () => {
  const now = at(2026, 9, 22, 9, 30);
  const before = at(2026, 9, 22, 4, 0);        // 早上 4 点录的（已过期）
  const after = at(2026, 9, 22, 6, 0);         // 5 点之后重录
  assert.strictEqual(Mod.isExpired(before, now), true);
  assert.strictEqual(Mod.isExpired(after, now), false, '5 点后重录的要能立刻用');
});

testOrSkip('user-tokens：list 只回脱敏预览，绝不回明文 token', () => {
  const s = freshStore();
  s.set({ userKey: '1001', userName: '张三', token: 'abcdefghijklmnop', issuedAt: at(2026, 9, 22, 9, 0) });
  const rows = s.list(at(2026, 9, 22, 10, 0));
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].preview, 'abcd...mnop', '只留头尾');
  assert.ok(!rows[0].token, '脱敏结果里不能带 token 字段');
  assert.ok(!JSON.stringify(rows).includes('abcdefghijklmnop'), '整份结果里都不能出现明文');
  assert.strictEqual(rows[0].expired, false);
  s.close();
});

testOrSkip('user-tokens：库文件可复用（重开后 token 还在）', () => {
  const file = path.join(os.tmpdir(), `spider-tok-reopen-${Date.now()}.db`);
  const s1 = Mod.open(file);
  s1.set({ userKey: '1002', userName: '李四', token: 'tok-persist', issuedAt: 5000 });
  s1.close();
  const s2 = Mod.open(file);
  assert.strictEqual(s2.get('1002').token, 'tok-persist', '重开要能读到');
  s2.close();
  [file, file + '-wal', file + '-shm'].forEach((f) => { try { fs.unlinkSync(f); } catch (_) { /* 已删 */ } });
});
