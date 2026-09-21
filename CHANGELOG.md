# CHANGELOG.md — 多 Agent 协同看板

> 本文件是**唯一的跨 Agent 沟通介质**：文件锁定 + 交接记录。
> 改了什么不抄在这里（那看 `git log` 与 `.workbuddy/memory/YYYY-MM-DD.md`）；
> 这里只写**为什么、当前谁在改、遗留什么、下一步给谁**。
> 规则见 `AGENTS.md` 第 3 节：动手前上锁，收工后解锁并留记录。

## 📌 当前锁定

```
（无锁定）
```

> 上一轮锁定（2026-09-21 13:05 起：修复测试报告里仍存在的 8 个问题）
> **已于 2026-09-21 13:25 完成并解锁**，见下面第一条交接记录。

> 「常用查询过时文案」那一轮（2026-09-21 12:30 起）**已完成并解锁**，见下面第一条交接记录。

> 上一条锁定（2026-09-21 11:40 起：发布查询页结果行新增「接口明细」「操作记录」两个弹窗）
> **已于 2026-09-21 12:10 完成并解锁**，见下面第一条交接记录。
> ⚠️ 那一条是**上一路会话留下的半成品**（模型/两个弹窗/页面接线已写，但样式、脚本引入、
> bootstrap 登记、测试与实测都没做），本路是接着做完的，不是从头写的。

> **2026-09-20 决定：不做脱敏**（上一条锁定的结论）。本仓库是**内网自用**，
> 入库文件里的同事姓名/工号/部门码/任务单号**不算泄露**，不要主动去"帮忙脱敏"
> （我照错误假设改了 24 个文件、289 处，已整体撤回）。
> **仍然有效的红线只有一条：凭证类字面值 —— token / Cookie / ssopSessionId / Authorization
> 一律不得进入任何入库文件**（已扫过：233 个跟踪文件 0 命中，保持这样）。
> 另注意 `.env`、`publish/cache/`、`analysis/har/` 依然不入库，那是凭证与原始报文的问题，与姓名无关。

<!-- 锁定行格式（一次任务一条，改完删除）：
【锁定】publish/js/page/publish.js, publish/js/core/api-client.js
       —— 处理者：Agent-Dev / <会话名>；任务：导出支持中止；起于：2026-09-19 22:00
-->

## 🚫 禁止修改清单

见 `AGENTS.md` 第 5 节（`publish/vendor/`、`publish/cache/` 与 `*.har`、`shared/saved-queries.*`、
`.workbuddy/` 既有条目、`publish/tools/my-subscribed-services.txt`、`.env`）。

## 📝 交接记录（新在上）

### [2026-09-21 18:35] 主会话 —— 与 origin/dev 同步（合并，双方内容都保留）

**触发**：用户「远端刚推了一个到 dev，看看能否合并，保留两者」。

**差异**：本地领先 4（两份测试报告 + 13:25 那轮修复），远程领先 5
（`55f656c..b787120`，全是「操作记录」弹窗的 operationType 编码映射补全 37 → 50 条）。
`git merge origin/dev` → **只有 `CHANGELOG.md` 冲突**（双方都是往顶部追加记录，第三次同一原因）。

**冲突解决**：按「新在上」重排 —— 远程 17:10 / 16:47 在前，本机 13:25 在后，
其余条目一条不删。备份在 `%TEMP%/CHANGELOG.before-merge2.bak`。合并提交 `7b812e1`。

**验证（合并后逐个确认，不是"看着对"）**
- `git diff origin/dev HEAD --stat` 只列出**本机侧**改的 13 个文件 ——
  远程改的 `publish-dialog-model.js` / `op-record-dialog.js` / 两个 test / `memory.md`
  **不在差异里**，即与远端逐字节一致，远程改动完整保留；
  `publish-dialog-model.js` 里 operationType 映射实测 **50 条**。
- 本机侧改动也逐项确认在位：`query-feedback.js` 的 `isAuthError`、
  `proxy.js` 的 `truncated`、`shared/README.md` 的「备份与恢复」、
  `publish.html` 的 `#failBar`、`subscription.html` 的 `min(600px, 92vw)`、
  `theme.css` 死规则已删（仅剩说明注释）。

**门禁原话（合并后重跑，因为远程改了模型与冒烟脚本）**：
`node tests/run.js` → `614/615 通过`（唯一失败仍是 Windows `execFileSync` 的 `spawnSync EBUSY`
环境错误）；`node tests/smoke-browser.js` → `==== 结果: ALL PASS (静态加载/接线无报错) ====`。

**状态**：本分支领先 `origin/dev` **5 个提交、0 落后**，**未推送**。
若要回到 `dev`，需 `git push origin HEAD:dev`（本分支含 1 个 merge 提交，dev 会变成非线性但内容无损）。

**下一步**：无锁定。

### [2026-09-21 17:10] 主会话（承上条：反推补映射 37 → 50 条）

**分支**：`dev`。**用户答复**：上一条遗留 2 问的「要不要继续挖」→「反推的填上，标上注释就行」。

**反推规则（就一条，别放宽）**：用户给的 59 项名称总表基本按编码升序 →
**两个已实证编码之间只剩一个空位、且总表里恰好只有一个名字落在中间**才算唯一确定。
按这条筛出 **13 条**填进 `OP_TYPES`，每条行尾带 `// 推断`：

```
13 下线      19 订阅下线     29 删除接口与文档关系   35 订阅基线作废   36 订阅基线取消作废
41 服务发布-审核人审核        44 服务发布-手动归档
48 服务订阅-审核人审核        49 服务订阅-审核人审核退回   51 服务订阅-手动归档
56 取消订阅-审核人审核        59 取消订阅-手动归档        61 取消订阅-关闭
```

**反推不出来、故意留空的 9 个**（写进了 `OP_TYPES` 下面的注释块，别硬凑）：
- `删除` / `接口批量更新` / `发布` / `取消发布` —— 挤在 **22~25** 四个编码里，
  只能确定组内相对顺序（删除 < 接口批量更新、发布 < 取消发布），满足条件的排法有 6 种。
  最像的一种（22 删除 / 23 发布 / 24 取消发布 / 25 接口批量更新：20/21/22 像 CRUD 三连、
  发布↔取消发布与接口批量更新↔接口批量新增 各自成对且成对者相邻）**只是"最像"，没有证据**，没写。
- `取消订阅时上一批量新增订阅关系审批流程接口材料移除` / `UNCHECK` / `服务订阅-删除` ——
  落在 **64~74** 之间，顺序能定、编码定不了（后面还跟着 75）。
- `性能容量-修改` / `批量授权` —— 总表里排在 75 之后 → **编码 ≥ 76**。

**另**：总表里紧跟「订阅」的「取消订阅」与编码表的「取消订阅-申请人处理」（3）应是同一个东西的
简称，**没有另开一条**（否则会多出一个没有编码的名字）。

**改动**：`OP_TYPES` 37 → 50 条（13 条带 `// 推断`）+ 新增「反推方法与留空名单」注释块；
单测补 13 条的断言、并加了「反推不出来的 9 个名字**不许**有人填」的反向断言；
冒烟桩数据扩到 6 个编码（加入 13 与 999），实测渲染
`正式版基线,服务发布-审核人审核通过,服务订阅-归档,下线,服务订阅-审核人审核通过,999`。

**门禁**：`node tests/run.js` → **615/615 通过**；`node tests/smoke-browser.js` → **ALL PASS**。

**遗留**：上一条的 1（3 与 55 同名）仍然开着；22~25 那 4 个仍是本文件里唯一"名字知道、编码不知道"的
硬骨头，定案只要一次真实筛选（看回包 `operationType` 回来的是几）。

**（17:40 补，用户：「你标上注释，我之后确认一下」）** —— 3 处待确认全部按**注释形式**落进代码：
- ① 编码 `3` / `55` 两行各挂 `// ⚠️ 待确认：与 xx 同名`；
- ② 21 与 26 之间加了一段**注释掉的候选编码**（`22: '删除'` / `23: '发布'` /
  `24: '取消发布'` / `25: '接口批量更新'`，即"最像"的那种排法）—— **没有激活**，
  条数仍是 50，摘掉行首注释符即生效；
- ③ 另 5 个名字的已知范围（64~74 / ≥76）写在 75 行下面。
- 单测把 `22`/`25` 加进「未覆盖编码原样显示」那条断言：谁手滑摘了注释符，测试先炸。
  **反向验证过**：把 4 行注释符摘掉 → 映射变 54 条、候选值生效、那条断言确实会炸（不是空转）；
  同时证明注释块摘注释符后语法合法。
- 门禁：`node tests/run.js` → 615/615；`node tests/smoke-browser.js` → ALL PASS。

### [2026-09-21 16:47] 主会话（修正 operationType 编码映射：5 条 → 37 条）

**分支**：`dev`（`git branch --show-current` 确认过；未动 `main`）。
**改动清单**（单写者、单次会话内完成，锁定行随本轮一次性出入）：
`publish/js/ui/publish-dialog-model.js`、`publish/tests/publish-dialog-model.test.js`、
`publish/tests/smoke-browser.js`、`publish/js/ui/op-record-dialog.js`。
**文档同步**：本文件（上面那条旧口径已就地标作废）、`memory.md` §2（新增一条「编码 → 名称」口径）、
`.workbuddy/memory/MEMORY.md`（本机记忆同改）。
**动作**：用户给了抓包分析的完整编码表（38 行、37 行有名字），据此把 `OP_TYPES` 从 5 条扩到 37 条。
**没有新接口、没有新字段**，纯口径修正。

**为什么这次敢推翻旧值**（旧 5 条是上一路会话「找佐证」得到的；这次三条独立证据指向同一张表）：
1. 用户表里基线族是**两个整齐的三元组**：10/11/12 = 开发/功能测试/正式版基线、
   16/17/18 = 订阅开发/订阅功能测试/订阅正式版基线（偏移恰好 6）；
2. 抓包 `getOperationRecordList` 那 21 条里，`subscribeName` **有值的编码全是订阅类**
   （17/18/47/50/52）、**为空的全是发布类**（12/43/45）—— 与新表逐条吻合，与旧表反而对不上；
3. 43→45、50→52 在抓包里分别是同一秒 / 相邻 1 秒的两条，语义正好是「审核通过 → 归档」。
   用户表自身也用「旧名 → 编码 → 真名」的形式把那 5 条标了出来（例：`删除 12 正式版基线`
   读作「以为 12 是删除，其实是正式版基线」）。

**关键更正**：真正的 `CHECKOUT` / `CHECKIN` 是 **14 / 15**，不是旧表写的 52 / 50。

**具体改动**：
- `OP_TYPES` 写全 37 条（唯一来源，注释里留了上面的证据链）；**不写**编码 32 ——
  来源表里它是占位符「-」。筛选下拉随之由 5 项变 37 项。
- 单测：断言改盯新值，并**显式断言旧值一条都不许回来**；「未覆盖编码原样显示数字」
  改用表里没有的 `999`（原来用 17，17 现在有名字了）。
- 冒烟：桩数据换 `12/43/52/999/50`；筛选那步原来点「修改」期望 `43`，
  现在点「服务订阅-归档」期望 `52`。

**门禁**：`node tests/run.js` → **615/615 通过**；`node tests/smoke-browser.js` → **ALL PASS**
（实测渲染值 `正式版基线,服务发布-审核人审核通过,服务订阅-归档,999,服务订阅-审核人审核通过`，
筛选回传 `52/1`）。

**遗留 / 待确认（给下一位，别自己拍）**：
1. 表里 **3 与 55 同名**（都叫「取消订阅-申请人处理」）。可能是 3 = 订阅侧发起取消订阅、
   55 = 取消订阅流程的申请节点，也可能是用户抄表时重复了 —— **要问用户**，不要自己改其中一个。
2. 用户另外给了 **59 项的名称总表**（含 `删除 / 下线 / 发布 / 取消发布 / 订阅下线 / 订阅基线作废 /
   订阅基线取消作废 / 删除接口与文档关系 / UNCHECK / 服务订阅-删除 / 性能容量-修改 / 批量授权` 等
   本轮**没进映射**的名字）。按名称在总表里的位置能**推出**一批编码（13 下线、19 订阅下线、
   29 删除接口与文档关系、35 订阅基线作废、36 订阅基线取消作废、41/44/48/49/51/56/59/61 …），
   但那是**排序推断、不是抓包实证**，本轮一条都没写进去。
   → **2026-09-21 17:10 已办**：用户回复「反推的填上，标上注释就行」，已按上面的推断填了 13 条
   （每条带 `// 推断` 注释）、9 条定不了的留空，详见上一条交接记录。
3. `接口批量更新` 落在 22~25 之间**定不了**（这几个编码在两张表里都没有名字）。
   编码填错会让筛选静默查错数据 → 保持现状（不映射、原样显示数字）。
   要定案最省事的办法：在真实环境按某个类型筛一次、看回包里的 `operationType`。

### [2026-09-21 13:25] Agent-Dev（主会话，分支 `workbuddy/dev-e2d2ccd2`）—— 同步 + 修复测试报告遗留

**任务**：用户要求「拉取最新，看前端和代理端还有这些问题吗，有的话进行修复」。

**同步**：本地 2 个报告提交 vs 远程 6 个提交（`47c4d49..aa0edbe`）已分叉 →
`git merge origin/dev`，**只在 `CHANGELOG.md` 冲突**（双方都是往顶部追加交接记录），
按「新在上」重排保留全部条目（远程 12:50/12:45/12:10 在前，我的 01:55/01:45 在后），
合并提交 `a38e03d`。备份留在 `%TEMP%/CHANGELOG.local.bak`。

**复核结论（下一个 Agent 别重新判断）**
- **P1-1（首页导出崩溃）已被远程 `19a39f6` 修掉**，别再改。
- **三条是我此前误报，不是缺陷**，别去"修"：
  1. P2-3 已订阅面板「选择文件」—— `label[for=importFile]` 正常拉起 filechooser，导入成功；
     当初我点错了元素。
  2. P3-3 任务单页 `#pageJump` 无 max —— `task.js:336` 查询后**会**设 `jump.max`；
     当初我在**无数据状态**下测的，所以是空串。
  3. P3-4 导入脏数据文案 —— 实测正确（「文件里没有可用的常用查询」）；
     当初读到的是上一条 toast 的残留。
  **教训：断言 toast 时要等它刷新（>4s）或先清干净；断言 DOM 属性前先把它驱动到"有数据"状态。**

**本轮改动（8 处，均已实测验证）**
| 文件 | 改动 |
|---|---|
| `shared/README.md` | 新增「备份与恢复」节（WAL 坑 + `tools/backup-queries-db.js` + 恢复三步）；顺带把已删除的 `PROXY_ADMIN_TOKEN` 过时指引改成现状 |
| `publish/README.md` | 团队共享节加「别直接 cp .db」警告，指向 shared/README |
| `publish/subscription.html` | `.batch-time-dialog` 的 `min-width` 600px → `min(600px, 92vw)` |
| `publish/theme.css` | 删 `th.col-name` / `th.col-coding` 死规则（thead 里确实没有这两个 class） |
| `publish/publish.html` | 删 `#fileImport` 死元素；`href="/"` → `/home`；补 `#failBar` + `#failText` |
| `publish/js/page/publish.js` | 加 `showQueryFail` / `hideFail` 薄封装并注入 ctx |
| `publish/js/page/publish-query.js` | 查询开始 `hideFail()`；catch 里 `showQueryFail(errorMsg)` |
| `publish/js/ui/query-feedback.js` | `shortError` 支持对象型错误（原来对 `{response}` 只吐 `[object Object]`）；新增 `isAuthError` + 401 引导 |
| `publish/js/page/subscription.js` | 两个字典加载函数失败时 toast（原先只 `console.warn`） |
| `publish/proxy.js` | `/local/saved-queries` 超 2000 条截断**回传 `truncated`** |

**两个实现上的坑（别踩回去）**
- 发布页这条链路抛出的错误对象里**没有后端 msg**，`shortError` 只能压出「HTTP 500」。
  所以 `showQueryFail` 传的是 `errorMsg`（`parseApiError` 已翻译的话），不是原始 `err`。
- `showQueryFail` 的 401 引导做了去重：文案里已含「Token」就不追加，免得同一句说两遍
  （`publish-response.js` 的 401 文案本身就写了「请检查 Token 是否有效」）。

**门禁原话**：`node tests/run.js` → `614/615 通过`（唯一失败是 Windows `execFileSync`
的 `spawnSync EBUSY`，环境问题，时区逻辑已手工验证正确）；
`node tests/smoke-browser.js` → `==== 结果: ALL PASS (静态加载/接线无报错) ====`。
修复专项验证 **12/12 通过**（含首页导出、发布页正常查询等回归）。

**下一步**：无锁定。剩余未做的只有**可选**项：发布页 `#failBar` 我没加重试按钮
（另两页有），需要的话照 `task.html` 补一个 `#btnRetryQuery` 并接 `doQuery`。


### [2026-09-21 12:50] 主会话（发布 stable-20260921）

**动作**：dev 跑全门禁（`615/615 通过` + 冒烟 `ALL PASS`）→ `git checkout main && git merge dev`
（产出合并提交 `762f97b`；核对 `main^{tree}` == `dev^{tree}`，逐字节相同）→ `git tag stable-20260921`
（标签信息里抄了门禁原话 + 已知未验证项）→ `main` / `dev` / 标签各自 push，**三条已同步**。
交付包在外层 `/Users/a1/Desktop/spider/`。

**这一版包含**（相对 `stable-20260920-4` = `f4b2f7e`，5 个提交）：
1. `feat(发布查询页)`：结果行新增「接口明细」「操作记录」两个弹窗（接口明细 5 个 tab、
   一次请求拿全；操作记录服务端分页 + 按操作类型筛选）。
2. `fix(首页常用查询)`：点「导 出」必抛 `ReferenceError`（`items` 取不到）→ 用户看到的是
   「⚠️ 页面出现异常」而不是「已导出 N 条」。来源 `23ad36e`，**一直没暴露是因为测试从没点过这个按钮**。
3. 清掉「常用查询存在本机 localStorage」时代的过时文案（可见的两处在空态，其余是注释与 README）。

**⚠️ 发布流程更正（AGENTS.md 0.5、`MEMORY.md` 同改，别再照旧写法办事）**：
原先写的 `git merge --ff-only dev` **在这个仓库上必然失败** —— `main` 上每次发布都留一个 merge
commit，那些 commit 不在 `dev` 里，所以 `main` 永远不是 `dev` 的祖先。但 `git log main --not dev`
列出的**全是合并提交、没有一行内容改动**，`main^{tree}` 与上一版 `dev` 的树逐字节相同：
**内容一致，只是历史形状不同**。恢复快进形状只能 force-push `main`（同事 clone 的正是这条线）→ 不许。
现改为 `git merge dev`，并把「发版记录先落 `dev`、下次发布才带进 `main`」这个既有事实写进 AGENTS.md。

**打包（按约定，别用 `git archive`）**：`git checkout-index -a -f --prefix=/tmp/pkg_src/`
铺出工作树 → Python `zipfile` 打包（非 ASCII 名自动置 UTF-8 标志）：
- `spider-stable-762f97b-20260921.zip`（248 个文件，4.1 MB）
- `spider-history-762f97b-20260921.bundle`（4.9 MB）
**验收**：真解压到 `/tmp/pkg_verify` → 核对 10 个中文文件名无乱码 → **在解压目录里跑全套门禁**
（`615/615 通过` + 冒烟 `ALL PASS`）。两条都过了才算交付。

**已知未验证项（写进标签信息了，用户说"小问题、等下抓包"）**：「接口明细」请求体的 `sysServeNo`
形态未证实（HAR 里是 `E00306MG0001-queryPreviousTransaction`，发布列表 35 行却是纯编号）
→ 形态若错，弹窗整表为空或拿到别的服务的数据且不报错。定案只差一次「先查发布列表、
再点开该行接口明细」的连续抓包。

**下一步给谁**：无锁定。

### [2026-09-21 12:45] Agent-Dev（主会话）—— 清掉「常用查询存在本机」的过时文案 + 修掉导出必报错

**任务**：用户「把一些过时的页面文本删除，比如常用查询的那个文本提醒，我已经不在 localStorage
里存常用查询了」。起因是 2026-09-20 的架构改版（共享库成唯一真相源），一批文案还停在旧口径。

**审计结论（先把全部候选捞出来再动手，别只改用户举的那一处）**：
- **真正可见的过时文案只有两处**（都在 `js/page/home.js` 的空态）：
  · 「我的常用查询」空态那三条 `这台浏览器里存着 N 条…` → 去掉存储位置的说法，
    但**保留三分支诊断**（①真没有 ②没归属人 ③有别人的）—— 那是 2026-09-20 用户报
    「给郑梓辉存了却还是空」时加的，还有用；过时的只是「存在浏览器里」这个说法。
  · 「部门常用查询」空态两条 `本机还没有记录到本部门…` / `这台机器上还没有…`
    → 「本部门还没有常用查询记录」。
- 其余都是**注释/文档**（`home.js` 头注释、`index.html` 三处注释、`README.md` 三处），
  一并更正 —— 这类不改就会出现「照着注释又写一遍旧口径」的循环。
- **故意没动**（两条都写在这儿，免得下个人纠结）：
  · 首页角标 `已同步 / 仅本机 / 同步失败` —— 它是**连接状态**，不是「数据存在浏览器里」；
    2026-09-21 用户刚拍板「只留状态词」。删了就没有任何非静默信号了。
  · 三个查询页保存后那句 `（仅本机，连上共享库后会自动补上去）` + `syncSuffix()`
    —— 这是**服务端没连上时**的真实状态说明，不是「我们存在浏览器里」。
    删掉会把「保存了却没进库」变成静默，正是本文件反复强调不许做的事。

**顺手发现的真 bug（与文案同一处，必须一起说）**：
`home.js` 的 `exportQueries()` 里 `showToast(\`已导出 ${items.length} 条…\`)` ——
`items` 是 `renderSaved`/`deptRender` 的**函数局部变量**，这一层根本取不到（`ReferenceError`）。
症状很难查：**文件照常下载**，紧随其后抛异常被全局兜底接走，于是用户看到的是
「⚠️ 页面出现异常，请刷新重试」，而不是「已导出 N 条」 —— 看着像导出失败。
来源是 `23ad36e`（加导出/导入那次），**一直没被发现是因为测试从没点过这个按钮**：
冒烟只调 `S.exportJsonAsync()` 验 JSON 合法。现改为从导出内容里读条数。

**门禁原话**：`node tests/run.js` → **615/615 通过**；
`node tests/smoke-browser.js` → **ALL PASS**（`[FAIL]` 0）。

**新增回归（含反向验证）**：冒烟加「点一次 `#btnExportQueries`」，断言
`window.toast` 探针收到 `已导出 1 条…` 且 `AppRuntime.uncaughtCount()` 不涨。
**反向验证做过**：把 `exportQueries` 临时改回旧写法再跑，探针抓到的正是
`⚠️ 页面出现异常，请刷新重试` 且 uncaught +1 → 这条断言真的能拦住它，不是空转。
两个容易写错的点记一下：① **不要读 `#toast` 的文本** —— toast 是串行队列
（`js/ui/toast.js` 的 `QUEUE`），前面压着几条没播完时固定 sleep 只会读到旧文案，
是假警报；直接给 `window.toast` 挂探针。② 那段 `ioCheck` 结尾有 `S.clear()` 清理现场，
所以点导出前要先存一条，条数才是确定的 1（并在 finally 里 `clear()` 复原现场，
别影响后面 task / subscription 两页的断言）。

**遗留**：无新增。上一轮那两条仍在（`sysServeNo` 形态待一次连续抓包定案；
「文档级修订记录」列名待真机核对）—— 用户说「等下抓下包」。

### [2026-09-21 12:10] Agent-Dev（主会话）—— 发布查询页结果行两个弹窗

**任务**：用户给了 `操作记录和接口明细.har` + 两份开发提示词 + 4 张参考截图，要求按本项目风格
做发布查询页结果行的「接口明细」「操作记录」两个弹窗。

**起点不是零**：上一路会话 11:40 起写了 `publish-dialog-model.js` / `intf-detail-dialog.js` /
`op-record-dialog.js` + 页面接线，**11:52 中断且没留交接**（`ps` 里已无那个进程、文件 mtime 停在那一刻）。
本次先读现场判断「哪些做完了」，再补齐缺的，没有推翻它的数据口径（数组名/列名逐条对过 HAR，是对的）。
⚠️ 但**只核了「字段存在」，没核「值对不对」** —— `sysServeNo` 的形态问题（遗留 1）就是漏在这条上：
35 行缓存里那个字段**确实存在**，所以我当时判成"已核对"，其实两边形态并不一样。

**这一轮补的（前一路留下的缺口，全部是「不补就点不动/看不见」的）**：
1. **样式整块缺失**：markup 用到的 `.dlg-tabs/.dlg-tab/.dlg-table/.dlg-pager/.intf-body/
   .op-record-body/.op-record-filter/.c-mono/.c-center/.c-long` 在仓库里**一个都没有**
   （表格最终改成复用弹窗表 `.sub-tbl`，与「关联文档」子弹窗同一套线型，少维护一份）。
   新增 `theme.css` 一节（页签条 / 高度分配 / 筛选行 / 单元格辅助类），选择器带 `.sub-dialog`
   前缀 —— 页面 `<style>` 在 theme.css 之后加载，同权重会盖掉 theme（本文件末尾「台账纸」层同一手法）。
2. **三个脚本没引入** `publish.html`（页面里一个 `<script>` 都没加，弹窗模块根本没加载）。
3. **`bootstrap.js` PRESETS 未登记** → 现在登记了：少了它们页面不白屏，只是点「接口明细」**毫无反应**，
   没有登记就只能靠人肉发现。
4. **操作类型下拉改走 `createSearchableSelect`**：原实现是原生 `<select>`。本项目铁律是
   「弹窗下拉看起来像原生只能换组件、不能改样式」（展开面板是系统原生渲染，CSS 碰不到）。
   组件不幂等 → 只在首次开窗挂一次，之后 `clear()/getValue()`；没有组件时降级成原生下拉。
5. **滚动锁口径**：`close()` 从 `unlockScroll()` 改成 `forceUnlockAll()`（顶层弹窗、内无子层，
   与 `detail-dialog.js` 同口径），避免重复 `open()` 时计数漂移把整页锁死。
6. **测试**：新增 `tests/publish-dialog-model.test.js`（12 条，模型纯逻辑 + 用抓包真实行逐列断言），
   `run.js` 注册；冒烟加两段（`PAGES[].globals` 补 3 个全局）——① 两个弹窗端到端接线（桩数据形态照抄 HAR）
   ② 接口明细分页/每 tab 记页码（真实抓包每 tab 只有 1~8 行，走不到第 2 页，只能靠桩数据守）。

**门禁原话**：`node tests/run.js` → **615/615 通过**（603 + 新增 12）；
`node tests/smoke-browser.js` → **ALL PASS**（`[FAIL]` 0）。

**真实数据实测**（离线代理 3100 + 真实缓存，探针用完已移入回收站）：
`接口明细` 10 列宽 56/104/99/151/42/62/67/197/352/140，表宽 1270 = 视口宽 → **无横向溢出、无一格被截断**，
表头 `position:sticky`、弹窗主体 `overflow-y:hidden`；`操作记录` 真实 21 条 / 第 1 页 10 行，
筛选下拉确为统一组件（宿主 `display:none`、占位「请选择操作类型」）。
截图已归到 `publish/output/弹窗实拍-2026-09-21/`（该目录 gitignore）。
⚠️ **这次实测验的是「渲染」，不是「请求参数对不对」**：两个新接口在离线代理里都是**宽松匹配**回放的
（请求体与录制时不同，代理会回同接口最近一条并打警告），所以「表渲染出来了」不等于「我传的参数是对的」——
遗留第 1 条就是这么被盖住的。

**两个口径（用户 2026-09-21 拍板，别再"补全"）**：
- ⚠️ **本条的 `operationType` 那一半已作废**（原文：「只映射有证据的 5 个 ——
  12 删除 / 43 修改 / 45 新增 / 50 CHECKIN / 52 CHECKOUT，其余原样显示数字」）。
  2026-09-21 16:47 用户补了抓包分析的完整编码表，那 5 条**全错**：真名依次是
  正式版基线 / 服务发布-审核人审核通过 / 服务发布-归档 / 服务订阅-审核人审核通过 /
  服务订阅-归档；真正叫 CHECKOUT / CHECKIN 的是 **14 / 15**。现已落成 37 条，
  详见下面那条交接记录。**仍然成立的部分**：仍是「唯一来源 `OP_TYPES`、下拉项由它派生」，
  仍是 **未覆盖的编码原样显示数字、不猜中文、也不进筛选下拉**
  （编码填错会让筛选静默查错数据，比少一个选项更坏）。
- **弹窗里不放水印、不做红色主按钮**：参考截图是**原系统**的样子；用户明确「风格按我这个项目」，
  所以主按钮走 `.filled`（动作蓝）、无水印、弹窗宽度走 `.dialog--*` + 类选择器。

**接口要点（抓包确认；唯一没有证据的是 `sysServeNo` 的形态，见遗留 1）**：
- `POST /itamp-tool/intfcMgmt/serviceChildList` body `{ dataId, sysServeNo }` → 一次回 5 张表
  `childReqList / childRespList / revisionList / interfaceModifyList / deployList`；
  `dataId` = 发布行 `publishId`（该字段在发布行里真实存在，且抓包里两个接口传的是同一个 UUID）。
- `POST /itamp-tool/operation/getOperationRecordList` body `{ operationType, pageNum, pageSize, publishId }`，
  **服务端分页**（真实 total=21 → 3 页）。这条的参数口径是**实打实**的：
  同一次会话的对照就在 HAR 里（请求体三个字段与响应 total 都能对上）。

**遗留（按「该先验」的顺序排）**：
1. ⚠️ **`sysServeNo` 该传什么形态，没有证实**（12:19 用户问「最没把握的是什么」时复核发现的，
   比下面两条都严重）：HAR 里 `serviceChildList` 收到的是 **`E00306MG0001-queryPreviousTransaction`**
   （**带短横线、后半段是方法名**），而发布列表 35 行真实数据的 `sysServeNo` **全是纯编号**
   （`E00301TO1200` 这种，无短横线）—— 两边**不是同一种形态**；而那份 HAR **没有发布列表请求**，
   无法把「某一行」与「随后的 body」对上，所以判定不了该传什么。两种可能都成立：
   ① 后端要「编号-接口编码」拼接（那行该拼 `E00301TO1200-ObsSDTotalTransQuotaQry`）；
   ② 那个服务的 `sysServeNo` 本身就带后缀（那原值就是对的）。**现按「原值」传。**
   若错了，表现是**打开弹窗后整表为空、或拿到别的服务的数据，且不报错** ——
   而我的离线实测会被**宽松匹配**掩盖成「看起来对了」。
   **一次抓包即可定案**：同一次会话里先查发布列表、再点开那一行的「接口明细」，两个请求一起抓。
   `tool-api.js` 与 `intf-detail-dialog.js` 的注释已按此标注（别再把这条读成"已核对"）。
2. 「文档级修订记录」这次抓包里是**空数组**，列名按兄弟表 `interfaceModifyList` 的键口径取；
   `revisionList` 有数据后要**再对一次字段**（写错只会整列显示「—」，不报错）。
3. `serviceChildList` **没有进** `analysis/output/接口文档.md`（那份只覆盖 getOperationRecordList），
   字段以 `publish-dialog-model.js` 的列定义为准 —— 已在模型文件头注明，别去文档里找。
4. 抓包已归档到 `analysis/har/操作记录和接口明细.har`（该目录 gitignore，本地留档）。

**下一步给谁**：无锁定。`TODO.md` 里仍等外部条件的那几条没动。

### [2026-09-21 01:55] Agent-Review（代理端只读测试，分支 `workbuddy/dev-e2d2ccd2`）

**性质：只读任务，未改任何业务代码。** 用户要求「再测试一下代理端」。

**交付物**：`docs/代理端测试报告-20260921.md`（约 65 项被测项 + 3 个问题）。

**结论摘要（下一个 Agent 别重新判断）**
- **代理功能面无缺陷**：路由、静态服务（含 3 种编码的目录穿越防护）、管理端点、
  `/local/batch-times` 按键合并、`/local/saved-queries`（?user= / ?dept= / 墓碑防复活 / 幂等）、
  离线回放 exact/loose/404、内网不可达 502、并发 20 写不丢、原子写无 `.tmp` 残留 —— 全绿。
- **唯一值得动手的是文档**：`shared/README.md` 与 `publish/README.md` 都没写 WAL 这个坑。
  实测 `q3057.db` 主库 4KB、`-wal` 1.79MB，**只拷 `.db` 打开是 `no such table: saved_queries`**
  （连表都没有，数据 100% 丢）。代理被 kill 后 WAL 也还在、主库仍未 checkpoint。
  **已有正确兜底**：`tools/backup-queries-db.js` 走 `VACUUM INTO`，产出 836KB 自包含文件
  （孤立拷贝仍读到 4023 行 + 1 墓碑 + 10 人）—— 脚本是对的，**缺的是文档没引导人去用它**。
- 另外两个：`/local/saved-queries` 超 2000 条截断**静默**（响应无 truncated 字段，前端 toast 会偏大）；
  `/admin/token/status` 回显 `.env` 绝对路径（内网自用可接受，仅记录、不建议改）。

**测试姿势（下次照抄，省时间）**
- 起两个实例对比：A=`PROXY_OFFLINE=1` + 真实缓存；B=非离线 + 空缓存（专测 502 与 `/cache/clear`）。
- **必须设 `PROXY_ENV_PATH` 指向临时文件**：`POST /admin/token` 会写 `.env`，默认路径就是项目根 `.env`。
- **`PROXY_QUERIES_DB` / `PROXY_BATCH_TIMES_FILE` / `PROXY_QUERIES_FILE` 都要指到临时目录**，
  否则会写脏 `shared/saved-queries.db`。
- `/cache/clear` 只对空缓存实例打，别对着真实录制的那台。

**下一步**：**等用户确认后再动手**。建议只做 P1（补文档），P2 可选，P3 不动。无锁定。

### [2026-09-21 01:45] Agent-Review（只读全量测试，分支 `workbuddy/dev-e2d2ccd2`）

**性质：只读任务，未改任何业务代码。** 用户要求「先拉最新 → 全量测前端 → 只报问题，等我确认再改」。

**同步**：起点 `1d785ad` 落后 `origin/dev` 4 个提交，工作区干净 → `git merge --ff-only origin/dev` 到
`47c4d49`，**无冲突、未产生提交**。

**交付物**：`docs/前端全量测试报告-20260921.md`（53 项被测项 + 10 个问题，含复现步骤与修复建议）。

**结论摘要（下一个 Agent 别重新判断）**
- **唯一会抛异常的缺陷**：`home.js:731` `exportQueries()` 的 toast 引用了不存在的 `items`
  → 首页点「导 出」抛 `ReferenceError`（文件其实下载成功，但没有成功提示）。
  根因是 2026-09-20 改版后导出主体变成服务端团队库，本机 `items` 数组没了、toast 那行没跟着改。
  修法建议从 `exportJsonAsync()` 的文本里解析条数，**别在导出路径上再引入第二个异常**。
- 门禁基线：`602/603 通过` + 冒烟 `ALL PASS`。那 1 条失败是 `业务时区…` 报 `spawnSync EBUSY`，
  **已确认是环境错误**：手工跑 `tests/probes/tz-probe.js`（4 个时区）输出全是
  `today=2026-10-01` / 窗口起点 `2608批次`，逻辑正确。Windows 下 `execFileSync` 连续 spawn 被拒。
- 真实缺陷集中在「用户不知道发生了什么」：订阅页 3 个多选选项为空却显示「没有匹配项」
  （`subscription.js:668-671` 不判 `res.ok`）；401 无任何 Token 过期引导。
- 响应式 **11 个视口 0 横向溢出**，唯一破口是 `subscription.html:261`
  `.batch-time-dialog{min-width:600px}` 在 390px 下右溢出 98px。

**测试环境的三个硬限制（下次别重复踩）**
1. **任务单查询接口 `taskFormSelectList` 在缓存里 0 命中** → 离线该页查询必然失败，
   成功态测不了（失败态已完整验证）。
2. **缓存目录不在本 worktree**：`publish/cache/` 是空的，真实的 82 条录制在
   `C:/Users/10669/Desktop/spider/publish/cache/`。跑代理要显式 `PROXY_CACHE_DIR` 指过去。
3. 订阅页必填校验会拦下查询，**route 注入 500/401 也进不了请求阶段**；
   它的错误态只能靠同构的任务单页佐证（两页共用 `query-feedback` + `#failBar`）。

**下一步**：**等用户确认后再动手改**。建议顺序 P1-1 → P2-2/P2-1 → P2-3/P2-4 → P3 一批清理。
无锁定。

### [2026-09-21 00:05] 主会话（发布 stable-20260920-4）

**动作**：dev 跑全门禁（`603/603 通过` + 冒烟 `ALL PASS`）→ `git checkout main && git merge --ff-only dev`
→ `git tag stable-20260920-4` → 两条线 + 标签各自 push。**`main` / `dev` / 该标签现已同步**。

**这一版包含**（相对上一个稳定版 `stable-20260920-3` = `4c9886e`，3 个提交，全是用户实测报的）：
- `refactor(常用查询)`：**架构改版，服务端数据库为唯一真相源**（`b2be876`）
  —— 增/删/改直接写服务端，localStorage 降级为「我的」离线镜像，
  严禁把团队全集写回本机（那是「第二个人存了看不到 / 改名弹回 / 导入被盖」的共同根源）
- `fix(保存提示/输入法)`（`0925f58`）：task/subscription 页保存误报「保存失败」（漏 await）；
  搜索框中文输入法组字时拼音被踢成裸英文（组合态程序化改 value 打断 IME）
- `fix(订阅关系)`（`ca667bb`）：提供方/调用方批次两列绑定反了（数据实证修正）；
  顺带查实后端 `putBatch` 是死字段，「按提供方批次筛」此前从未生效，改前端本地过滤

**口径钉子（别再改回去）**：订阅响应里 `prodBatch`=提供方最新变更批次、`prodBatchList`=调用方投产/变更批次；
请求体 `prodBatch`=调用方批次筛选。三条回归测试在 `publish/tests/subscription-model.test.js` 里锁着。

**已知遗留**：提供方批次筛选是前端本地过滤，结果超 5000 条时无法完整过滤（会提示）；
`putBatch` 后端将来若支持可改回服务端过滤。

**下一步**：无锁定。

### [2026-09-20 16:10] 主会话（发布 stable-20260920-3）

**动作**：dev 跑全门禁（`596/596 通过` + 冒烟 `ALL PASS`）→ `git checkout main && git merge --ff-only dev`
→ `git tag stable-20260920-3`（打在本条之后的 HEAD 上）→ 两条线 + 标签各自 push。
**`main` / `dev` / 该标签现已同步**。交付包在外层 `/Users/a1/Desktop/spider/`，文件名带实际 HEAD 哈希。

**这一版包含**（相对上一个交付包 `0b33aa5`，3 个提交）——**全部是真实 UI 自测抓出来的修复**：
- `fix(下拉)`：输入即搜时第一个字符被吞、工号根本敲不进去（`73c676d`）
- `fix(首页)`：「我的常用查询」空态改成诊断式；更正「不支持姓名查询」过时文案（`76ace6f`）
- `fix(常用查询)`：重命名/删除/导入后不再被服务端旧响应盖掉（本地写 5 秒时间窗）；
  导入补 `autoPush()`——之前导入的东西永远只留在那台机器（`89ff841`）
- 新增 3 个真页面探针（部门高频 / 首页用户流 / 切换用户），门禁从 595 涨到 596

**遗留（如实说）**：「有身份 + 空服务端」导入的组合修复了但没单独实测；其余场景均有真页面证据。

**下一步**：无锁定。

### [2026-09-20 13:51] 主会话（交付包重出：0b33aa5）

**动作**：用户要求「重出一版交付包，把前两份删了」。

**当前状态**：`dev` 的 HEAD = `0b33aa5`（**未合并到 `main`**，也没打新 tag —— 用户这次只说了出包，
没说发布；要不要并到 `main` 等他表态）。

**交付包**（外层 `/Users/a1/Desktop/spider/`，不入库）：
- `spider-stable-0b33aa5-20260920.zip` 4.1M / **236 文件** = HEAD 精确快照
- `spider-history-0b33aa5-20260920.bundle` 4.6M（`git bundle verify` → complete history）
- `spider-workbuddy-memory-20260920-1351.tar.gz` 87K（`.workbuddy/` 的唯一离线备份）
- **验证**（解压副本里真跑）：`595/595 通过`、`ALL PASS`、236 个文件与 `git ls-tree -r HEAD` 一致、
  中文名正常解出；并抽查了本轮改动确实在包里（`proxy.js` 的按键合并、`queries-db.js` 的
  `BEGIN IMMEDIATE`、`tools/backup-queries-db.js`）。

**删掉的旧两批**（`ae66258` 与 `3bc7a19` 各 3 件，共 6 个文件）：用 Finder 的「移到废纸篓」
（`osascript … delete`），**不是 `rm`** —— 可回退。
⚠️ **它们不在本地 `~/.Trash/`，而在 iCloud 废纸篓**：`~/Library/Mobile Documents/.Trash/`
（这台机器的桌面走 iCloud 同步）。以后要确认"删掉的东西能不能找回来"，去这个路径看。

**下一步**：无锁定。

### [2026-09-20 13:45] Agent-Dev（主会话，第八批）

**当前分支**：`dev`。

**任务**：用户拍板「安全面的不用管、之前加的安全方面的考虑也可以去掉」→ ① 修 `/local/batch-times`
的三个问题；② 去掉 `PROXY_ADMIN_TOKEN` 鉴权。

**改动面**：`publish/proxy.js`（batch-times 重写 + 删 7 处 token 检查 + 顶部注释 / 启动日志）、
`publish/js/page/subscription-batch-times.js`、`publish/js/ui/priority.js`（注释）、
`publish/README.md`、`AGENTS.md`（保护清单）、`publish/tests/token-manager.test.js`（测试名）、`.gitignore`。

**门禁原话**：`595/595 通过`；`==== 结果: ALL PASS (静态加载/接线无报错) ====`。

**关键结论（下一个 Agent 别重新判断）**
- **`/local/batch-times` 以前是"整份覆盖"**：页面发的是它手上那份完整 `batchTimes`，而多个人
  可能同时在改**不同批次** —— 后保存的那份会把先保存的整份盖掉，甲的改动凭空消失。
  现在改成**按键合并**（读旧文件铺底 + 本次的键覆盖同名键）。
  实测：甲改 2609、乙改 2611 → 读回来**两条都在**（旧实现只剩 2611）。
- **落盘文件从 `publish/config/` 搬到 `shared/batch-times.json`**（+ `PROXY_BATCH_TIMES_FILE`
  环境变量、首次使用时自动迁移旧文件）。`config/` 在**代码目录**里，重新部署会被新包里的
  空文件盖掉。老文件保留当备份（与 `saved-queries.json` 的迁移同一手法）。
- 写入改 **`.tmp` + rename 原子写**，与 saved-queries 的 JSON 分支口径对齐。
- ⛔ **`PROXY_ADMIN_TOKEN` 已整体删除，别再恢复**：7 处检查全去掉、启动日志同步。
  前提是「一台部署 + 内网自用」，用户明确要求去掉。想收窄只能设 `PROXY_HOST=127.0.0.1`。
- **保留**目录穿越防护（`serveStatic` 里那条）—— 那是**基本正确性**，不属于"收紧安全默认"。

**下一步**：无锁定。

### [2026-09-20 13:07] 主会话（发布 stable-20260920-2）

**动作**：dev 上跑全门禁（`595/595 通过` + `ALL PASS`）→ `git checkout main && git merge --ff-only dev`
→ `git tag stable-20260920-2` → 两条线各自 push。**`main` / `dev` / 该标签现已全部同步（`0 0`）**。

**这一版包含**（相对上一个稳定版 `stable-20260920` = `ae66258`，共 14 个提交）：
- `fix(常用查询)`：第二个用户的记录不再被吞 —— 同名判重带上保存人、归属改认 `saverKeys`
- `feat/refactor(首页)`：「当前用户」从「必须点查询才出」→ 输入即出，并最终**改用统一的
  `js/ui/searchable-select.js` 组件**（与评委栏同一套，不再自写）
- `feat(代理)`：默认改绑 `0.0.0.0`；`.env` 的 `PROXY_*` 不再静默失效
- 一批按抓到报文更正的错误结论（「后端忽略查询参数 / 不按姓名过滤」那条）
- 协作规则改为**单写者**（用户拍板，见 `AGENTS.md` §1）

**⚠️ 标签名为什么带 `-2`**：`stable-20260920` 已被上午那一版占用（仓库第一个标签）。
同一天再发就往后加 `-2` / `-3` —— **别把旧标签挪走**，同事手里的旧包还要对得上。

**交付包**（放在外层 `/Users/a1/Desktop/spider/`，那里不是 git 仓库、刻意不入库）：
- `spider-stable-3bc7a19-20260920.zip` 4.1M / **235 文件** = HEAD 的精确快照
- `spider-history-3bc7a19-20260920.bundle` 4.6M（`git bundle verify` → complete history）
- `spider-workbuddy-memory-20260920-1307.tar.gz` 85K（`.workbuddy/` 不在 git 里，这是它唯一的离线备份）
- **验证**（在解压出来的副本里真跑，不是只看包列表）：`595/595 通过`、`ALL PASS`、
  235 个文件与 `git ls-tree -r HEAD` 一致、中文名文件（`analysis/output/ITAMP接口总览.md` 等）正常解出。
- 📌 打包姿势固定：`git checkout-index` 铺树 + Python `zipfile`（自动置 UTF-8 标志）。
  **别用 `git archive --format=zip`** —— macOS `unzip` 解中文名会写盘失败（踩过）。

**下一步**：无锁定。

### [2026-09-20 12:35] Agent-Dev（主会话，第七批）

**当前分支**：`dev`。

**任务**：按用户要求，把首页「当前用户」从上一轮自写的下拉**改成复用** `js/ui/searchable-select.js`
（与评委栏同一套组件）—— 用户原话：「用 `as="searchable-select"` 的自定义元素……原生 select 的那种下拉」。

**改动面**：`index.html`（宿主换 `<select>`、补 `<script>`、清掉旧的输入框/候选样式）、
`js/page/home.js`（删自写下拉，改走组件的 `updateOptions` / `setBusy` / `open` + 宿主 `change`）、
`js/core/bootstrap.js`（PRESETS 登记）、`tests/home-page.test.js`（假 DOM 补能力 + 组件替身 + 用例重写）、
`tests/smoke-browser.js`（改用真实键盘驱动 + 部门那段跟着改）。

**门禁原话**：`node tests/run.js` → `595/595 通过`；`node tests/smoke-browser.js` →
`==== 结果: ALL PASS (静态加载/接线无报错) ====`。

**踩到的三个坑（下一个 Agent 别重踩）**
1. **输入即搜的监听要绑组件内部那个输入框**（`.searchable-select .searchable-select-input`），
   别照抄评委行「绑宿主容器 + capture」的写法 —— 那套在**真浏览器里实测没送达**：
   面板会被打开、但候选永远是空的。评委那边能用，是因为它的行会被动态重建。
2. **搜索词别读输入框的 `value`**：组件会在「选中回填 label / 清空」时动它，实测读到过空串，
   于是搜索永远不触发。要用组件的 `getFreeText()`。
3. **冒烟驱动组件必须用真实键盘**（`page.type`）：`evaluate` 里 `dispatchEvent('input')`
   到不了组件内部那条路径。而且**清场（`HomePage.render()`）必须放在打字之前** ——
   `renderUser → resetUserSearch` 会把输入和候选一起重置，放后面就等于把刚敲的字清掉
   （本轮在这上面绕了好几轮排查）。

**下一步**：无锁定。

### [2026-09-20 02:55] 主会话：协作方式改成单写者

**规则**（已写进 `AGENTS.md` §1）：同一时间整个仓库只允许一路 Agent 写，另一路只读；不许 `git checkout`/`switch`、不许跑全量门禁。分支不隔离工作树，所以"再开一条分支"没用；真要并行用 `git worktree`，但那会让本看板变成两份、锁失效 —— 用户选了单写者。
**触发这件事的事实**：02:3x 我（另一路会话并行期间）用 `git checkout -- .` 撤回自己那批脱敏改动，差点连带吞掉对方的未提交改动，只因对方先提交了才没出事。
**因此**：`dev` 上 `69bb48a` 之后我停手；要再动，等用户明确派单。


### [2026-09-20 02:40] Agent-Dev（主会话，分支 `dev`）

**任务**：用户决定「内网自用，代理直接绑全网卡，不做限制」。

**改动面**：`publish/proxy.js`（HOST 默认 `127.0.0.1` → `0.0.0.0`，banner 改成如实播报绑定与鉴权状态）、
`publish/tests/proxy-env-order.test.js`（那条策略断言跟着翻转 + 删掉一句我自己写的恒真假断言）、
`.env.example`、`publish/README.md`。

**这是知情的选择，别回退**：`/local/*`、`/cache/*` 不鉴权且 CORS 是 `*` —— 内网自用、一台部署，
这是用户拍板的。
**2026-09-20 13:45 进一步：`PROXY_ADMIN_TOKEN` 那层 token 校验已整体删除**（`/cache/*`、`/admin/*`、
`/local/*` 的 7 处检查全去掉，启动日志同步）—— 也就是说**现在没有任何"收紧开关"了**，
要收窄只能设 `PROXY_HOST=127.0.0.1`（只绑本机）。
**下一个 Agent 不要"顺手加回安全默认"**，也别去恢复 token 机制。
防线已把"默认必须是 `0.0.0.0`"钉进单测（变异检验过：改回回环即变红）。

**门禁原话**：`595/595 通过`；`==== 结果: ALL PASS (静态加载/接线无报错) ====`。实测过启动横幅与端口绑定。


### [2026-09-20 12:05] Agent-Dev（主会话，第六批）

**当前分支**：`dev`。

**任务**：① 按用户要求把首页「当前用户」改成**输入即出候选下拉**（不必再点「查 询」）；
② 用户提示「不是有工号查询的请求吗」→ 复核后**更正一条被写进代码 / 文档 / 测试的错误结论**。

**改动面**：`index.html`（候选改浮层 + combobox 语义）、`js/page/home.js`（防抖搜索 + 键盘导航 +
统一的关闭出口 + `HomePage.searchUser / searchUserAuto / candCount / candsOpen`）、
`js/ui/current-user.js`（注释更正）、`js/ui/subscribe-model.js`（注释 + 3 处文案）、
`tests/harness.js`（注入 `clearTimeout` + 定时器兜底宿主实现）、`tests/home-page.test.js`(+4)、
`tests/current-user.test.js`、`tests/subscribe-model.test.js`、`tests/user-api.test.js`（注释）、
`tests/smoke-browser.js`（+1 段真浏览器断言、1 处文案断言）。

**门禁原话**：`node tests/run.js` → `595/595 通过`；`node tests/smoke-browser.js` →
`==== 结果: ALL PASS (静态加载/接线无报错) ====`。

**关键结论（下一个 Agent 别重新判断）**
- ⛔ **「后端会忽略查询参数 / 不按姓名过滤」是错的，别再引用**。那是把**离线回放的宽松匹配**
  当成了后端行为（`PROXY_LOOSE_MATCH`：精确 key 未命中就回同 path 的最近一条，看着像参数没生效）。
  报文证据：`getUserList?userName=李胜` 一次回了 **11 个不同分行的李胜**（登录人不可能是一群人）；
  同一会话相隔 9 秒的两条，`getUserInfo?userId=4711510` → 郑梓辉、`getUserList?userName=吴树海` → 吴树海。
  → **工号能换身份、姓名也能搜到人**；接口唯一的坑是「同名多命中时直接回失败码」（如 `userName=郑梓`）。
  核对逻辑（`u.userId !== kw`、`matched` 过滤）**继续保留**，依据换成「返回了不相关的人就不许当结果用」。
- 首页候选下拉的**自动搜索不自动套用身份**（只出下拉，等用户确认）；手动点「查 询」才沿用旧语义。
- ⚠️ `tests/harness.js` 的 `loadScript` 现在**把定时器默认兜底成宿主实现**。改这里要意识到一件事：
  把某个全局**列进 `new Function` 的形参**，会让脚本里的同名标识符从「借到宿主全局」变成「undefined」——
  今天就是这么把 `api-client` 的超时取消打挂的（2 条 user-api 用例当场红）。

**关于评委栏（2026-09-20 12:03 用户澄清）**：评委行的 `.judge-role` / `.judge-no`
**保持现状、不要动** —— 用 `createSearchableSelect` 接管本来就是对的。
上一版记录把它读成了「要改的对象」，是理解偏了：用户那句话指的是**首页「当前用户」**那块
（已按「输入即出候选下拉」改完，见上一条）。

### [2026-09-20 02:20] Agent-Dev（主会话，分支 `dev`）

**任务**：用户报「第二个用户怎么搞都存不进常用查询，且条数看着还是第一个用户的」。

**两个独立缺陷，都修了**
1. **`.env` 里写 `PROXY_HOST`/`PROXY_PORT`/`PROXY_TARGET`/`PROXY_TIMEOUT` 完全无效**（另一路会话报了诊断，
   我核实后**范围比它写的窄**：只有排在 `refreshConfig()` 之前的这 4 个顶层 const 坏；
   `PROXY_RECORD`/`LOOSE_MATCH`/`CACHE_DIR` 实测生效）。根因是加载顺序，不是 const/let。
   **关键区别：shell 传参有效、`.env` 文件无效，而文档教的偏偏是写 `.env`** ——
   所以"按文档配了 PROXY_HOST=0.0.0.0，同事还是连不上这份代理"。
   实测双向验证过：改前 `.env` 写 3056/0.0.0.0 → 仍绑 `127.0.0.1:3000`；改后 → `*:3056`。
   修法是把 `FIRST_LOAD` + `loadEnv()` 定义与调用**一起**提前（只搬调用会撞 TDZ；
   也别靠函数声明提升"碰巧能跑"）。防线新增 `tests/proxy-env-order.test.js`，**做过变异检验**。
2. **首页角标「已同步 N 条」的 N 一直是全库条数**，而主列表刚改成按当前用户过滤 →
   "列表 1 条 / 角标 3 条"被读成"条数还是上一个用户的"。文案改为「已同步 · 库内 N 条」+ title 说明。

**⚠️ 更正我上面写的一句"最可能是缺陷 1"**：那是**错的**（我在自己那条记录里一度写"没能复现"）。
真正根因由**同一天另一路会话**先定位并已修复（提交 `8800199`，它的记录在下面那条 11:05 里）：
`save()` 按 `page + name` 判重，而**两个人从同一份筛选条件保存时默认名必然相同** →
第二个人复用第一个人的 `id` → 服务端 `ON CONFLICT(id)` 覆盖 → 返回全集覆盖本机 → `listForUser(B)` 恒空。
**我复现失败的原因就是我特意取了两个不同的名字**（`A-批次2611` / `B-刚存的`），刚好绕开了同名路径 ——
教训：**复现用户报的 bug 时不许自己改输入，尤其别"顺手起个不冲突的名字"**。
我这边补上的两件仍然有效、且不重叠：缺陷 1（`.env` 的 `PROXY_HOST/PORT/TARGET/TIMEOUT` 曾静默失效）
与角标「库内 N 条」的文案（它解决的是"条数看着还是第一个人的"那半句）。

**独立复验**（跑了那路会话留的探针 `tests/probes/live-probe-two-users.js`，真浏览器 + 真代理 3012 +
临时库 `PROXY_QUERIES_DB=/tmp/probe-two-users.db`）：同名两条记录现在拿到**不同 id**、
各自 `saverKeys` 只含自己；B 的首页标题「我的常用查询（…）」+ `共 2 条`；
`?user=<B>` 回 2 条；`?dept=K4229` 回 1 条且 `savers:[2]`（同一条件两人保存）。**修复成立。**

**门禁原话**：`591/591 通过`；`==== 结果: ALL PASS (静态加载/接线无报错) ====`。
**状态**：提交 `f67c092` 在 `dev`；**未推远端**（`dev` 领先 2、`main` 停在 `8e9d88d`）。

### [2026-09-20 11:05] Agent-Dev（主会话，第五批）

**当前分支**：`dev`。

**任务**：用户报「常用查询用了一个用户，第二个用户怎么搞都没法保存，显示的条数还是第一个用户的」。

**改动面**：`js/ui/saved-query.js`（`save()` 判重带上归属人、`listForUser` 改认 `saverKeys`、
`mergeItems` 合并键带上归属人并合并 saverKeys、`sanitize` 保留 `saverKeys`、新增 `saverKeysOf`）、
`lib/queries-db.js`（`toRecord` 回传 `saverKeys`）、`tests/saved-query.test.js`(+5 改写 2)、
`tests/queries-db.test.js`(+1)、**新增** `tests/probes/live-probe-two-users.js`。

**门禁原话**：`node tests/run.js` → `589/589 通过`；`node tests/smoke-browser.js` →
`==== 结果: ALL PASS (静态加载/接线无报错) ====`。

**根因（下一个 Agent 别重新判断）**
- **一条记录只能带一个 `owner`，而 `owner` 是 `savers[0]`（最早保存的那位）**。前端却拿它当
  「这条是不是我的」的判据 —— 于是第二个人保存过的记录永远判成第一个人的。
- `save()` 原来按 `page + name` 判重：两个人从**同一份筛选条件**保存时默认名一样（必然同名），
  第二个人会**复用第一个人的 id** → 服务端 `ON CONFLICT(id)` 把第二人的条件写进第一人那条 →
  返回全集覆盖本机 → `listForUser(B)` 恒为空。表现就是「怎么存都存不进去、条数还是第一个人的」。
- 实测证据（真浏览器 + 真代理 + 临时库）：修复前 B 存同名返回 `id` 与 A 相同、`mine(B)` 为 `[]`；
  修复后 B 拿到新 id、`mine(B)` 有值、首页标题跟着换人。探针留在
  `tests/probes/live-probe-two-users.js`（**必须用 `PROXY_QUERIES_DB` 指临时库**）。

**仍然存在、但不是代码 bug（用户需知情）**
- `current-user.js` 按**工号**查人时后端会忽略查询参数、返回 token 对应的登录人；前端核对后**拒绝**
  （宁可拒绝也不认错人）。离线回放的「宽松匹配」同样会命中同 path 的最近一条。
  **在内网真环境里，用工号基本只能设成「你自己」**；要换别人（如自测两个身份）请用**姓名**搜索。
- `proxy.js` 的 **JSON 兜底分支**（Node < 22.5 才走）合并键仍是 `page+name`，同一类问题还在。
  它和墓碑 key 耦合、本机走不到，**本轮故意没改**；哪天要在老 Node 上跑，先补它的用例再改。

**下一步**：无锁定。

### [2026-09-20 01:50] 主会话（分支改制）

**当前分支**：`dev`（`main` 已对齐到同一个提交 `8e9d88d`，两条线现在等价，分叉从下一次改动开始）。

**任务**：按用户决定改成两条线 —— `main` 只放稳定版、`dev` 走日常开发，并要求 Agent 只能在 `dev` 提交。
规则写在 `AGENTS.md` 第 0.5 节与第 8 节。

**给下一个 Agent 的一句话**：动手前先 `git branch --show-current`，**不是 `dev` 就别改**；
在 `main` 上写代码等于把没验完的东西直接推给同事（他们是各自 clone、默认落在 `main`）。

**未推的东西**：`main` 领先 `origin/main` 4 个提交、`dev` 还没有远端；标签 `stable-20260920` 只在本地。
**下一步**：在 `dev` 上接着做脱敏（范围见上面的锁定条目）与「硬编码枚举且不进报文」那条。


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
