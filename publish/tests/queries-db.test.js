'use strict';
/**
 * 常用查询的 SQLite 存储层（publish/lib/queries-db.js）用例。
 *
 * 这一层回答的是前端算不出来的问题：**同一份查询条件被几个人保存过**。
 * 它一旦算错，页面上的热度就是假的 —— 而且错得很隐蔽（数字看起来很正常）。
 * 所以这里钉死四件事：聚合成组、人头去重、部门隔离、删除不留残影。
 *
 * Node < 22.5 没有 node:sqlite：那种环境自动跳过（代理会降级到 JSON 文件存储）。
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('./harness');

const Mod = (() => {
  try { return require('../lib/queries-db.js'); } catch (_) { return null; }  // eslint-disable-line
})();

const A = { userId: '1001', userName: '张三', teamId: 'T01', teamName: '开发一部', orgId: 'O1', orgName: '软件中心（深圳）' };
const B = { userId: '1002', userName: '李四', teamId: 'T01', teamName: '开发一部', orgId: 'O1', orgName: '软件中心（深圳）' };
const C = { userId: '1003', userName: '王五', teamId: 'T02', teamName: '开发二部', orgId: 'O1', orgName: '软件中心（深圳）' };
const COND = { callerSystem: 'E00406', provideSystem: 'E00301' };

/** 每个用例一个独立库文件，跑完删掉 */
function freshStore() {
  const file = path.join(os.tmpdir(), `spider-qdb-${Date.now()}-${Math.floor(Math.random() * 1e6)}.db`);
  return Mod.open(file);
}

const testOrSkip = Mod && Mod.available() ? test : (name, fn) => {
  process.stdout.write(`  ⊘ ${name}（本机 Node 不支持 node:sqlite，跳过）\n`);
  void fn;
};

if (!(Mod && Mod.available())) {
  process.stdout.write('  ⚠️ 当前 Node 没有 node:sqlite（需 Node ≥ 22.5），SQLite 用例全部跳过；'
    + '代理在这种情况下会回落 JSON 文件存储\n');
}

testOrSkip('queries-db：同一份条件被两个人保存 → 合成一行，人数=2', () => {
  const s = freshStore();
  s.upsert([
    { id: 'q1', page: 'publish', name: '张三取的名', fields: { ...COND }, owner: A, at: 1000 },
    { id: 'q2', page: 'publish', name: '李四取的名', fields: { ...COND }, owner: B, at: 2000 },
  ], []);
  const top = s.deptTop('T01', 10);
  assert.strictEqual(top.length, 1, '同一份条件只占一行，不能按人头刷屏');
  assert.strictEqual(top[0].savers, 2);
  assert.deepStrictEqual([...top[0].saverNames].sort(), ['张三', '李四'], '名单要带上所有人，而不只是代表行的那位');
  s.close();
});

testOrSkip('queries-db：同一个人反复保存同一份条件 → 只算 1 人（热度刷不出来）', () => {
  const s = freshStore();
  for (let i = 0; i < 5; i += 1) {
    s.upsert([{ id: 'q' + i, page: 'publish', name: '重复' + i, fields: { ...COND }, owner: A, at: 1000 + i }], []);
  }
  assert.strictEqual(s.deptTop('T01', 10)[0].savers, 1, '一个人存五遍也不是五个人');
  s.close();
});

testOrSkip('queries-db：其它部门的人不算进本部门的人数', () => {
  const s = freshStore();
  s.upsert([
    { id: 'q1', page: 'publish', name: '本部门的', fields: { ...COND }, owner: A, at: 1000 },
    { id: 'q2', page: 'publish', name: '二部的同名条件', fields: { ...COND }, owner: C, at: 1100 },
  ], []);
  const t1 = s.deptTop('T01', 10);
  assert.strictEqual(t1[0].savers, 1, '二部的王五不该计进开发一部');
  assert.strictEqual(s.deptTop('T02', 10).length, 1, '二部也有自己那一行');
  s.close();
});

testOrSkip('queries-db：条件不同 / 页面不同 → 各自的组', () => {
  const s = freshStore();
  s.upsert([
    { id: 'q1', page: 'publish', name: '甲条件', fields: { callerSystem: 'E00406' }, owner: A, at: 1 },
    { id: 'q2', page: 'publish', name: '乙条件', fields: { callerSystem: 'E07701' }, owner: A, at: 2 },
    { id: 'q3', page: 'task', name: '甲条件在别的页', fields: { callerSystem: 'E00406' }, owner: A, at: 3 },
  ], []);
  assert.strictEqual(s.deptTop('T01', 10).length, 3, '不同条件/不同页面都不能并在一起');
  s.close();
});

testOrSkip('queries-db：没填筛选条件的记录各自成组（不聚成一行）', () => {
  const s = freshStore();
  s.upsert([
    { id: 'q1', page: 'publish', name: '无条件的1', fields: {}, owner: A, at: 1 },
    { id: 'q2', page: 'publish', name: '无条件的2', fields: {}, owner: A, at: 2 },
  ], []);
  assert.strictEqual(s.deptTop('T01', 10).length, 2, '「什么都没填」不是同一份条件');
  s.close();
});

testOrSkip('queries-db：排行按人数优先，人多者压过点得多的', () => {
  const s = freshStore();
  const many = [
    { userId: '11', userName: '甲', teamId: 'T01' },
    { userId: '12', userName: '乙', teamId: 'T01' },
    { userId: '13', userName: '丙', teamId: 'T01' },
  ];
  many.forEach((o, i) => s.upsert([
    { id: 'm' + i, page: 'publish', name: '三人份的条件', fields: { q: 'popular' }, owner: { ...A, ...o }, at: 100 + i },
  ], []));
  s.upsert([{ id: 'solo', page: 'publish', name: '我的高频', fields: { q: 'mine' }, owner: A, at: 999, hits: 999 }], []);
  const top = s.deptTop('T01', 10);
  assert.strictEqual(top[0].savers, 3);
  assert.ok(/三人份/.test(top[0].name), `排头应是人多的那份，实际 ${top[0].name}`);
  s.close();
});

testOrSkip('queries-db：删除立墓碑，删掉的人不再算进热度', () => {
  const s = freshStore();
  s.upsert([
    { id: 'q1', page: 'publish', name: '张三那一份', fields: { ...COND }, owner: A, at: 1000 },
    { id: 'q2', page: 'publish', name: '李四那一份', fields: { ...COND }, owner: B, at: 2000 },
  ], []);
  assert.strictEqual(s.deptTop('T01', 10)[0].savers, 2);
  s.upsert([], ['q2']);
  const top = s.deptTop('T01', 10);
  assert.strictEqual(top.length, 1, '删掉的查询不能留在排行里');
  assert.strictEqual(top[0].savers, 1, '删掉的人不能继续算人头');
  assert.strictEqual(s.tombstones().length, 1, '要留墓碑，否则别人同步时又把它带回来');
  // 删掉之后同 id 再来一次，也不该复活
  s.upsert([{ id: 'q2', page: 'publish', name: '想复活', fields: { ...COND }, owner: B, at: 3000 }], []);
  assert.strictEqual(s.deptTop('T01', 10).length, 1, '墓碑期内不许复活（同事的旧副本一推送就回来的老毛病）');
  s.close();
});

testOrSkip('queries-db：byUser 只返回这个人保存过的（个人视图）', () => {
  const s = freshStore();
  s.upsert([
    { id: 'q1', page: 'publish', name: '张三的', fields: { a: '1' }, owner: A, at: 1000 },
    { id: 'q2', page: 'publish', name: '李四的', fields: { b: '2' }, owner: B, at: 2000 },
  ], []);
  assert.deepStrictEqual(s.byUser('1001', 10).map((x) => x.name), ['张三的']);
  assert.deepStrictEqual(s.byUser('1002', 10).map((x) => x.name), ['李四的']);
  assert.deepStrictEqual(s.byUser('查无此人', 10), []);
  s.close();
});

testOrSkip('queries-db：记录带 saverKeys —— 前端靠它认「我保存过」，不能只给 owner', () => {
  // owner 只是 savers[0]（最早保存的那位），第二个保存的人在 owner 上看不出来。
  // 2026-09-20 实测：少了 saverKeys，第二个用户的「我的常用查询」恒为空。
  const s = freshStore();
  s.upsert([
    { id: 'q1', page: 'publish', name: '共同条件', fields: { ...COND }, owner: A, at: 1000 },
    { id: 'q1', page: 'publish', name: '共同条件', fields: { ...COND }, owner: B, at: 2000 },
  ], []);
  const rec = s.all()[0];
  assert.strictEqual(rec.savers, 2);
  assert.deepStrictEqual([...rec.saverKeys].sort(), ['1001', '1002'], '两个人的 key 都要在');
  assert.strictEqual(rec.owner.userId, '1001', 'owner 仍是最早保存的那位（保持旧契约）');
  assert.deepStrictEqual(s.byUser('1002', 10).map((x) => x.name), ['共同条件'], '后保存的人个人视图里要有');
  s.close();
});

testOrSkip('queries-db：重复 upsert 幂等（条数不涨、人数不涨、hits 取 max）', () => {
  const s = freshStore();
  const item = { id: 'q1', page: 'publish', name: '一条', fields: { ...COND }, owner: A, at: 1000, hits: 2 };
  s.upsert([item], []);
  s.upsert([{ ...item, hits: 9 }], []);
  assert.strictEqual(s.all().length, 1);
  assert.strictEqual(s.all()[0].hits, 9, '打开次数取较大值');
  assert.strictEqual(s.peopleCount(), 1);
  s.close();
});

testOrSkip('queries-db：fingerprintOf 与前端同口径（键顺序、空值、page）', () => {
  assert.strictEqual(
    Mod.fingerprintOf({ page: 'publish', fields: { x: '1', y: ['b', 'a'] } }),
    Mod.fingerprintOf({ page: 'publish', fields: { y: ['a', 'b'], x: '1' } }),
    '同一份条件换个写法仍是同一份',
  );
  assert.strictEqual(Mod.fingerprintOf({ page: 'publish', fields: { x: '' } }), '', '空值字段不算条件');
  assert.notStrictEqual(
    Mod.fingerprintOf({ page: 'publish', fields: { x: '1' } }),
    Mod.fingerprintOf({ page: 'task', fields: { x: '1' } }),
    '不同页面是两个入口',
  );
  assert.strictEqual(Mod.deptKeyOf({ teamId: 'T01', teamName: 'X', orgId: 'O1', orgName: 'Y' }), 'T01');
  assert.strictEqual(Mod.deptKeyOf({ orgId: 'O1', orgName: 'Y' }), 'O1', 'team 缺失时用 org 兜底');
  assert.strictEqual(Mod.userKeyOf({ userId: '1001', userName: '张三' }), '1001');
  assert.strictEqual(Mod.userKeyOf({ userName: '张三' }), '张三', '没有工号时用姓名');
});

testOrSkip('queries-db：库文件可复用（重开后数据还在，WAL 模式不丢）', () => {
  const file = path.join(os.tmpdir(), `spider-qdb-reopen-${Date.now()}.db`);
  const s1 = Mod.open(file);
  s1.upsert([{ id: 'q1', page: 'publish', name: '持久的一条', fields: { ...COND }, owner: A, at: 1000 }], []);
  s1.close();
  const s2 = Mod.open(file);
  assert.strictEqual(s2.all().length, 1, '重开要能读到上次的数据');
  assert.strictEqual(s2.deptTop('T01', 10)[0].savers, 1);
  s2.close();
  [file, file + '-wal', file + '-shm'].forEach((f) => { try { fs.unlinkSync(f); } catch (_) { /* 已删 */ } });
});

testOrSkip('queries-db：markUsed 记「谁用过」—— 与「谁保存过」分开，且幂等（时间取 MAX）', () => {
  const s = freshStore();
  s.upsert([{ id: 'q1', page: 'publish', name: '一份条件', fields: { ...COND }, owner: A, at: 1000 }], []);
  // 李四没保存过，只是打开用了一次 —— 这正是单独建 uses 表的理由
  s.markUsed([{ queryId: 'q1', userKey: '1002', deptKey: 'T01', at: 5000 }]);
  s.markUsed([{ queryId: 'q1', userKey: '1002', deptKey: 'T01', at: 3000 }]);   // 更旧的时间
  const uses = s.db.prepare('SELECT * FROM saved_query_uses').all();
  assert.strictEqual(uses.length, 1, '同一个人只占一行（幂等）');
  assert.strictEqual(Number(uses[0].at), 5000, '重复上报取 MAX，不会被更旧的时间往回拨');
  assert.strictEqual(uses[0].user_key, '1002');
  // 「用过」不等于「保存过」：部门人数不能被刷上去（现在榜单还按人数兜底排序）
  assert.strictEqual(s.deptTop('T01', 10)[0].savers, 1, 'markUsed 不该把保存人数刷成 2');
  s.close();
});

testOrSkip('queries-db：部门排行按衰减分数 —— 1 人刚用的压过 3 人 200 天没用的', () => {
  const s = freshStore();
  const now = Date.now();
  const DAY = 86400000;
  // 老查询：同 fingerprint，3 个人都在 200 天前保存过
  [A, B, { ...A, userId: '1003', userName: '王五' }].forEach((u, i) => {
    s.upsert([{ id: 'old' + i, page: 'publish', name: '老查询', fields: { ...COND }, owner: u, at: now - 200 * DAY }], []);
  });
  // 新查询：1 个人刚保存（条件不同 → 另一组）
  const COND2 = { callerSystem: 'E00499', provideSystem: 'E00399' };
  s.upsert([{ id: 'new', page: 'publish', name: '新查询', fields: { ...COND2 }, owner: A, at: now }], []);

  const top = s.deptTop('T01', 10);
  assert.strictEqual(top.length, 2, '两组各一行');
  assert.strictEqual(top[0].name, '新查询', `1 人刚用的应排第一，实际第一是「${top[0].name}」`);
  assert.ok(top[0].score > top[1].score, '新查询分数要更高');
  // 200 天 ≈ 6.7 个半衰期 → 3 × 2^(-6.67) ≈ 0.03
  assert.ok(top[1].score < 0.05, `3 人但 200 天没用的分数应趋近 0，实际 ${top[1].score}`);

  // 关键回归：老查询只要有人重新用一次，就该重新浮上来（衰减是「降权」不是「判死」）
  s.markUsed([{ queryId: 'old0', userKey: '1009', deptKey: 'T01', at: now }]);
  const top2 = s.deptTop('T01', 10);
  assert.strictEqual(top2[0].name, '老查询', '有人再用一次就该回到第一（半衰期内恢复）');
  assert.ok(top2[0].score > 1, `用了一次应有约 1 票的加分，实际 ${top2[0].score}`);
  s.close();
});

testOrSkip('queries-db：同一份条件 + 同一个人只留一条（改名/认领攒的重复会被归并）', () => {
  // 2026-09-22 用户报：改个名同条件就多出一条；匿名保存被认领后也多一条。
  // 旧判重比的是名字，库里已经攒下重复 —— 服务端在这一层兜住并顺手归并。
  const s = freshStore();
  const mk = (id, name, owner) => ({
    id, page: 'publish', name, summary: '', fields: COND, labels: {}, owner,
    at: Date.now(), hits: 0, saves: 1,
  });
  s.upsert([mk('a', '原名', A)], []);
  assert.strictEqual(s.all().length, 1);
  s.upsert([mk('b', '改过的名', A)], []);
  const rows = s.all();
  assert.strictEqual(rows.length, 1, '同一份条件 + 同一个人只该有一条');
  assert.strictEqual(rows[0].name, '改过的名', '名字用最新提交的那份');
  s.close();
});

testOrSkip('queries-db：归并不误伤别人 —— 别人也存过的行不动', () => {
  const s = freshStore();
  const mk = (id, owner) => ({
    id, page: 'publish', name: '同一条件', summary: '', fields: COND, labels: {}, owner,
    at: Date.now(), hits: 0, saves: 1,
  });
  s.upsert([mk('a', A)], []);
  s.upsert([mk('b', B)], []);
  assert.strictEqual(s.all().length, 2, '不同人各自一条（部门榜靠聚合，不靠共用一条）');
  // A 又提交同条件（换了 id、名字）→ 只并进 A 自己那条，B 那条不许动
  s.upsert([{ ...mk('c', A), name: 'A 改的名字' }], []);
  const rows = s.all();
  assert.strictEqual(rows.length, 2, '还是两条');
  assert.ok(rows.some((r) => r.name === 'A 改的名字'), 'A 那条被更新');
  s.close();
});

testOrSkip('queries-db：没有归属人的记录不入库（未登录保存的不该在服务端变孤儿）', () => {
  // 2026-09-22 用户报「未登录保存 → 登录，就多出一条」：
  // 匿名记录被前端推上服务端，而服务端的用户视图是按 savers 表 join 的 ——
  // 没有 saver 的行走进去就是**孤儿行**，谁的用户视图都看不见它，
  // 但它占着 id、镜像刷新后还以"重复的一条"冒出来。现在直接不收。
  const s = freshStore();
  const anon = {
    id: 'anon1', page: 'publish', name: '未登录存的', summary: '',
    fields: COND, labels: {}, owner: null, at: Date.now(), hits: 0, saves: 1,
  };
  s.upsert([anon], []);
  assert.strictEqual(s.all().length, 0, '没归属人的记录不该落库');
  assert.strictEqual(s.peopleCount(), 0, '也不该留下任何 savers 关系');
  // 同一条认领之后（带上归属）就该正常入库
  s.upsert([{ ...anon, owner: A }], []);
  assert.strictEqual(s.all().length, 1, '认领后要能存进去');
  assert.strictEqual(s.byUser('1001', 10).length, 1, '并且出现在这个人的列表里');
  s.close();
});
