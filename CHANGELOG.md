# CHANGELOG.md — 多 Agent 协同看板

> 本文件是**唯一的跨 Agent 沟通介质**：文件锁定 + 交接记录。
> 改了什么不抄在这里（那看 `git log` 与 `.workbuddy/memory/YYYY-MM-DD.md`）；
> 这里只写**为什么、当前谁在改、遗留什么、下一步给谁**。
> 规则见 `AGENTS.md` 第 3 节：动手前上锁，收工后解锁并留记录。

## 📌 当前锁定

```
【状态：无锁定】任何 Agent 可认领文件。
```

<!-- 锁定行格式（一次任务一条，改完删除）：
【锁定】publish/js/page/publish.js, publish/js/core/api-client.js
       —— 处理者：Agent-Dev / <会话名>；任务：导出支持中止；起于：2026-09-19 22:00
-->

## 🚫 禁止修改清单

见 `AGENTS.md` 第 5 节（`publish/vendor/`、`publish/cache/` 与 `*.har`、`shared/saved-queries.*`、
`.workbuddy/` 既有条目、`publish/tools/my-subscribed-services.txt`、`.env`）。

## 📝 交接记录（新在上）

### [2026-09-19 22:05] Agent-Dev（主会话）

**任务**：收 TODO 四条 → 多路实测纠偏 → 按用户决策收紧安全默认 → 结构整理。

**改动面**：**全部未提交**（约 45 个路径，含 2 个删除、2 个重命名、1 个新增测试文件）。
主题分四批，细节看 `git diff` 与 `.workbuddy/memory/2026-09-19.md`。

**门禁原话**：`node tests/run.js` → `563/563 通过`；`node tests/smoke-browser.js` → `==== 结果: ALL PASS ...`（`[FAIL]` 计数 0）。

**关键结论（下一个 Agent 别重新判断）**
- 同步不再是静默的：判定只在 `js/ui/saved-query.js` 的 `recordSync()` 一处，页面靠 `lastSyncState()` + `onSyncStateChange()`；**别再往各页面复制一份状态判断**。
- 表单可访问名称唯一口径 = `searchable-select.js` 的 `accessibleNameOf()`，`createMultiSelect` 也走它。改它要同步 `tests/a11y-name.test.js`。
- `js/page/index.js` 已改名 `js/page/publish.js`；历史日志与某天评估报告里的旧名是**当时的现场**，不要照着找文件。
- 代理默认只绑 `127.0.0.1`（`PROXY_HOST` 放开）；`/local/*` 与 `/cache/*` 在设了 `PROXY_ADMIN_TOKEN` 时才强制校验。
- 团队库写入形态已定：**只跑一份代理，大家连它**；多进程开同一个 SQLite 文件实测会丢记录，别往那个方向做。

**遗留问题**
1. `TODO.md` 剩 5 条，全部**需要外部条件**：`sysServeNoList` 要一次真机抓包；`callerBatch` 要业务口径 + 抓包；订阅页默认窗口体量要业务口径；字典下拉是否加「全部」要逐页拍板；跨机器共享要不要配 `PROXY_QUERIES_DB`。
2. 两件结构改动我**故意留着没做**（收益中等、踩坑面大，建议单独一轮）：
   `proxy.js` + `lib/` 收进 `publish/server/`；三个 `output/` 归一。
3. 冒烟还有一处盲区：可访问名称统计跑在弹窗打开之后（已补），但**评委搜索的 `opts.label` 只在订阅弹窗打开时才可测**，反证靠一次性探针做，未入库。
4. 外层 `/Users/a1/Desktop/spider/.workbuddy/` 的内容已合并进仓库内记忆（备份：`spider/.workbuddy/_merged-from-outer-20260919-214356/`），可以删；但「把仓库上提一层去掉重复 `spider/`」需要**在会话外执行**（会断开当前会话的工作目录与记忆归属）。

**给下一个 Agent 的提醒**
- 提交用 `git add <显式路径>`；`git add -u` 会漏掉未跟踪的 `publish/tests/a11y-name.test.js` 与 `AGENTS.md`/本文件。
- 别占 `3000` 端口；测本地端口一律 `--noproxy '*'`；临时探针放仓库根 `_*.js`，用完 `mv` 进 `~/.Trash/<时间戳>/`，**不要 `rm`**。
- 有并发会话正在跑：动 `publish/tests/smoke-browser.js`、`.workbuddy/**` 之前先确认没人在改（本次合并记忆时就发现过另一路会话写的外层记忆树）。
