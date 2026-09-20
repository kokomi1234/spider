'use strict';
/**
 * 常用查询库的备份
 * ------------------------------------------------------------
 * 为什么需要它：这个库现在是**一份代理给全团队用**，数据只落在服务器上这一个文件里。
 * 而它是 WAL 模式 —— 「直接 cp 那个 .db」是不够的：最近的写入可能还在 -wal 里，
 * 只拷主文件会**静默丢掉**它们。正解是让 SQLite 自己导出一份自洽快照：
 *
 *     VACUUM INTO '<目标文件>'
 *
 * 产出单个文件、已经 checkpoint 过，可以直接拿去当库用（SQLite 3.27+；
 * node:sqlite 内置的版本满足）。
 *
 * 用法：
 *   node tools/backup-queries-db.js                        # 备份到默认位置，保留 14 份
 *   node tools/backup-queries-db.js --keep 30              # 保留 30 份
 *   node tools/backup-queries-db.js --out /data/backups    # 换目录
 *   node tools/backup-queries-db.js --db /path/to.db       # 换源库（默认吃 PROXY_QUERIES_DB）
 *
 * 服务器上定时（crontab 示例，每天 2:00）：
 *   0 2 * * * cd /path/to/publish && /usr/bin/node tools/backup-queries-db.js >> /var/log/spider-backup.log 2>&1
 *
 * 恢复（重要，按顺序）：
 *   1) 停掉代理
 *   2) 把选定的 saved-queries-*.db 覆盖回 shared/saved-queries.db
 *   3) **删掉同目录的 -wal / -shm** —— 那是旧库的残页，留着会被当成新库的一部分
 *   4) 重新启动代理
 *
 * 退出码：0 成功；1 源库不存在 / 目标已存在 / 备份失败（放到 crontab 里能报警）。
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const args = process.argv.slice(2);
/** 取 --name value 形式的参数，没有就用默认值 */
function opt(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}

const ROOT = path.resolve(__dirname, '..');
const PROJECT = path.resolve(ROOT, '..');
const SRC = path.resolve(opt('db', process.env.PROXY_QUERIES_DB || path.join(PROJECT, 'shared', 'saved-queries.db')));
const OUT_DIR = path.resolve(opt('out', path.join(PROJECT, 'shared', 'backups')));
const KEEP = Math.max(1, parseInt(opt('keep', '14'), 10) || 14);

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

if (!fs.existsSync(SRC)) {
  console.error(`❌ 源库不存在：${SRC}`);
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

const dst = path.join(OUT_DIR, `saved-queries-${stamp(new Date())}.db`);
if (fs.existsSync(dst)) {
  // VACUUM INTO 要求目标文件不存在；同一秒跑两遍就撞上，直接报出来别覆盖
  console.error(`❌ 目标已存在（同一秒内跑了两遍？）：${dst}`);
  process.exit(1);
}

const db = new DatabaseSync(SRC);
try {
  // 这里刻意**不加 readOnly**：VACUUM INTO 会用到临时结构，只读连接会失败。
  // 它本身不会改动源库（数据是导出到新文件的）。
  db.exec(`VACUUM INTO '${dst.replace(/'/g, "''")}'`);
} catch (e) {
  try { db.close(); } catch (_) { /* 已关 */ }
  console.error(`❌ 备份失败：${e.message}`);
  process.exit(1);
} finally {
  try { db.close(); } catch (_) { /* 已关 */ }
}

const sizeKb = (fs.statSync(dst).size / 1024).toFixed(1);
console.log(`✅ 已备份：${dst}（${sizeKb} KB）`);

// 只留最近 KEEP 份。文件名里是时间戳，字典序即时间序 —— 不依赖 mtime
// （备份目录被同步工具搬过之后 mtime 会变，名字不会）。
const all = fs.readdirSync(OUT_DIR)
  .filter((f) => /^saved-queries-\d{8}-\d{6}\.db$/.test(f))
  .sort();
const drop = all.slice(0, Math.max(0, all.length - KEEP));
drop.forEach((f) => {
  try {
    fs.unlinkSync(path.join(OUT_DIR, f));
    console.log(`  已清理旧备份：${f}`);
  } catch (e) {
    console.warn(`  ⚠️ 清理失败（不影响本次备份）：${f} — ${e.message}`);
  }
});
console.log(`现存备份 ${Math.min(all.length, KEEP)} 份（保留上限 ${KEEP}）`);
