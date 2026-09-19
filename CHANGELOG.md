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

### [2026-09-20 00:20] Agent-Dev（主会话，第四批）

**任务**：用户报「切换用户后常用查询不变、部门排行看不到刚存的那条」→ 定位两个根因并按其拍板改语义。

**改动面**：`js/ui/saved-query.js`（新增 `userKeyOf` / `listForUser` / `mineFromServer` / `ownerSuffix`，
`save()` 回传 `ownerMissing`）、`js/page/home.js`（主列表按人过滤 + 随身份一起刷）、
四个 HTML（三页补 `current-user.js`）、`js/core/bootstrap.js` PRESETS、三页 toast 补半句提示、
`tests/saved-query.test.js`(+9 用例)、`tests/home-page.test.js`(替身跟语义)、`tests/smoke-browser.js`。

**门禁原话**：`node tests/run.js` → `572/572 通过`；`node tests/smoke-browser.js` →
`==== 结果: ALL PASS (静态加载/接线无报错) ====`。

**关键结论（下一个 Agent 别重新判断）**
- 「谁存的」完全依赖 `current-user.js` 在**每一页**都加载。少引一处不报错，只让 `owner` 为空，
  那条记录就在「我的」和部门排行里永久隐形。**已有静态用例逐个 HTML 查这件事**，别再靠人记。
- 首页主列表**按当前用户过滤**（含 `?user=`，`mode` 必须是 `'user'` 才采用）；没身份时**空列表 + 指引**，
  不许退回"显示全部"。要看别人的走部门区。
- 清空团队库**不能只 `mv` 掉 `.db`**：客户端 localStorage 里的副本会在下一次推送时灌回服务端
  （实测发生了）。要么走 `SavedQuery.remove(id)` 让服务端立墓碑，要么连各客户端本地存储一起清。
- `pushToServer` 本来就用服务端全集覆盖本地，**不需要**再加一层"按墓碑 prune 本机"的逻辑（实测过）。

**当前状态**：开发团队库已清空（`items:0 people:0 deleted:4`）；代理跑在 **3011**（离线回放，
`PROXY_OFFLINE=1`），**3000 留给用户自己**；**本地提交一律未 push**（要不要推由用户说）。

**下一步**：无锁定。（本条原来留了一句"要确认同事身份里 `teamId` 是否恒有值"的猜测 —— **用户已否掉并核对过**：
缓存 + `analysis/har/userinfo.har` 的 12 条人员样本里，`userId/teamId/teamName/orgId/orgName`
**12/12 全部同时有值**，不存在"只有 teamName 没有 teamId"的情况，`deptKeyOf` 的兜底链只是防御、
不会拆键。别再查这件事。）

### [2026-09-19 23:25] Agent-Doc（主会话，第三批）

**任务**：用户指示「不希望记忆文件多处存档，只要一个」→ 查清散在几处 → 删重复副本 → 更正被写假的记录。

**改动面**：`.gitignore`（注释更正，入库）；`.workbuddy/memory/MEMORY.md` + `2026-09-19.md`（不入库）。

**唯一的存档现在是 `.workbuddy/memory/`**，删掉的两批重复副本在回收站
（`outer-workbuddy/memory/` 5 份 + `_merged-from-outer-20260919-214356/` 5 份，后者与前者的内容完全相同 ——
同一堆东西在回收站里还另有两份）。

**⚠️ 两件下一个 Agent 必须知道的**
1. **我今天写进 `.gitignore` 注释与当日流水的一条是假话**：「`.workbuddy-ai` 已换成真 symlink」。
   复核结果：它是 10 字节文本文件，mtime 还是 09-15 —— **那步从没落地**。两处都已更正为实况
   （`.opencode` 也不是 symlink，是个只含 `.gitignore` 的目录）。提交 `a992f33` 的信息里带着这句假话，
   历史不改写，以本条为准。**教训：声称做过的动作要当场 `ls -l` 验一次再说成功。**
2. **删重复副本前先做方向性 diff**：分别数 `'^<'`（副本独有）与 `'^>'`，**合在一起数会骗人**。
   这次 `MEMORY.md` 就查出 6 行副本独有，逐行读才确认全是被取代的旧说法（团队库还写 JSON、角标说"将来做"），
   不是因为"总数对得上"就下手。

**未动、等你表态的两处**：`~/.qoder-cn/**/memory`（Qoder 自带 auto-memory，4 个文件，里面只有指针）；
`~/.workbuddy/backups/aixcoding-20260916/`（退役工具 `.aixcoding/` 的配置备份，MEMORY 有指针指着它，
删了会变死链）。**本地 9 个提交仍未 push。**

### [2026-09-19 23:05] Agent-Dev / Agent-Doc（主会话，第二批）

**任务**：按用户「帮我提交，并清除冗余文件与记忆文件」的指示 —— 提交前一批全部改动，
再把 12 份早期日志压成一页并对源码核实/更正 MEMORY.md。

**上面那条 22:05 记录里的「全部未提交」已经作废**：那约 45 个路径按主题切成 **7 个提交**
（`a992f33` 结构 / `a1248bb` 首页角标+代理 / `b9b8709` 无障碍 / `8f021de` 任务单导出 /
`7c68fc0` 订阅纯函数 / `5054ad9` 冒烟+文档 / `17ac672` 文档归档）。**未 push**（用户没要求）。

**本批改动面**：`publish/js/page/subscription-batch-times.js` 一行注释（入库，故本次提交）；
`.workbuddy/memory/` 三个文件（**不入库，见下面第 3 条**）。

**门禁原话**：`node --check` 通过；`node tests/run.js` → `563/563 通过`；
`node tests/smoke-browser.js` → `==== 结果: ALL PASS (静态加载/接线无报错) ====`。

**下一个 Agent 必读的三件事**
1. **MEMORY.md 里有两处曾经写错，已对着源码更正**，别再照旧说法办事：
   第 10 节说「代理**不托管静态文件**」是错的（`proxy.js:746` `isStaticRequest()`→`serveStatic()`，
   带 ETag/304，默认 no-store）；第 6 节同一段里并存过**两个「批次时间行来源」口径**，
   含 `observedBatches()` 的那个已删（该符号全仓已不存在）。
2. **借压缩把 11 条只在日志里的约定提进了 MEMORY.md**，其中一条是「找回丢失的」：
   「给 `.outlined` 这类基础按钮加自定义 `.active` 必须同写 `:hover`」以前进过 MEMORY 又被删掉了，
   而 `theme.css` 里的活代码还在。别再造这种"改代码不改文档、文档丢了下个会话重踩"的循环。
3. `.workbuddy/` **从 `.gitignore:32` 起从不入库**（`git ls-files .workbuddy` = 0）。
   所以记忆文件**没有 git 兜底** —— 这条是本项目最容易忽略的事实：改 MEMORY.md 要像改生产代码一样谨慎。
4. **那 12 份原件已彻底删除**（23:20 用户明确「清空回收站里的旧日志文件」后，
   按显式文件名列表逐个 `rm` + `rmdir`，只删了那一个目录，没碰回收站里别的）。
   **`归档-2026-09-04至09-15.md` 现在是那 12 天的唯一副本**（含被推翻结论的裁定与【废】标记）。
   下次再压缩早期日志，**先给归档页找一个入库位置**（或让用户留异地副本）再谈删原件。

**下一步给谁**：无锁定。仍等外部条件的 5 条在 `TODO.md`（内网抓包 `sysServeNoList`、`callerBatch` 语义、
默认窗口大小、各下拉补「全部」项、跨机器 `PROXY_QUERIES_DB`）。
两件较大的结构活（`publish/server/` 分层、三份 `output/` 合并）用户未表态，别自己开工。

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
