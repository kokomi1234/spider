# memory.md — 跨 Agent 共享记忆（用户直接拍板的约定都在这里）

> **跨 Agent 记忆的唯一入口**：任何 Agent（WorkBuddy / Qoder / Cursor / 人）接手前先读一遍。
> 它**随仓库走**（入库；同事 `git pull` 即得）。分工：本文件 = **长期约定与铁律**；
> `AGENTS.md` = 协同流程；`CHANGELOG.md` = 锁定与交接看板；
> `.workbuddy/memory/` = WorkBuddy 本机流水（不入库）。冲突以本文件为准。

## 0. 用户工作习惯

- 简体中文；直接给结论和关键细节，不堆客套话。需求边界清晰就**直接执行**，含糊才问、一次问清。
- 一段自成体系的改动（新功能 / 修 bug / 文档）就**主动提交并推送**，不用每次问；
  按主题拆、中文提交信息（`feat:`/`fix:` + 摘要）、不加 AI 署名。
- UI 反馈常一句带过（"这个反了""提示没用删掉"）——先按业务常识定位，再用数据/抓包验证，
  别拿"注释里是这么写的"当挡箭牌；注释错了就改注释。
- **不要交付包**（2026-09-21）：不生成 zip / bundle / tar。要给同事代码就让他 `git pull`。

## 1. 界面铁律（2026-09-21 拍板）

- **不写提示文字**：`title` 悬停提示、说明段落（"提示：""口径：…"这类）一律不写（已全删）。
  要看全文的需求用 **`aria-label`** 承担。
- 只保留三种反馈：**空态一行**、**校验/toast**（操作失败必须说原因）、**必填标记**。
  新增 UI 前先自问：这句不写，用户会不会卡住？不会就不写。

## 2. 数据口径（钉死，别再翻案）

- **实时性与 token 回落都是刻意口径（2026-09-22 用户逐条拍板，别再翻）**：全站**没有**轮询与推送
  （`setInterval|EventSource|WebSocket` 0 命中），常用查询与部门高频榜的一致性就是「到下一次刷新为止」——
  **别加 `setInterval`/SSE/WebSocket，也别为此改角标文案**（该功能不高频，刷新慢可接受）。
  没录入自己的 token 时**就该**回落管理员 token（只有查询权限），那是设计不是故障：401 只在常驻失败条
  给一句「请点右上角『🔑 Token』更新」，**不自动弹 Token 弹窗**（防线在 `tests/user-token.test.js` 之外那条
  `query-feedback.test.js`，加回来会红）。一份代理独占一个 SQLite 文件是**部署前提**，不在代码里拦；
  但代理启动时会自检 `<库文件>.proxy-lock` 并**把另一份的端口报出来**（只报不拦，2026-09-22 用户拍板）。

- **订阅关系响应**：`prodBatch` = **提供方**最新变更批次；`prodBatchList` = **调用方**投产/变更批次
  （556 行 × 缓存交叉验证 99.1%）。请求体 `prodBatch` = 调用方批次筛选（后端认）；
  `putBatch` = 死字段（筛 2609 返回全量 550 实证）→ 提供方批次筛选只能**前端本地过滤**。
- **常用查询存储**：**服务端 SQLite 是唯一真相源**。localStorage 只做「我的」离线镜像，
  **严禁把团队全集写回本机**（回归测试锁着）。镜像未命中一律走服务端：保存/删除/改名直写服务端；
  `?saved=<id>` 深链与部门卡回填**必须用 `getAsync`**（同步 `get(id)` 只查镜像，同事的查询会静默拿空）。
- **不做脱敏**：内网自用，姓名/工号/部门码/任务单号入库不算泄露。
  **唯一红线**：token / Cookie / ssopSessionId / Authorization 绝不入库。
- **抓包铁律**：没有抓包不写接口代码，一个字段都不猜。要报文先搜 `analysis/har/` 与
  `publish/cache/`（`requestBody` 即真实请求体），别让用户重抓。
- **`operationType` 编码 → 名称**：**50 条**，唯一来源在 `publish/js/ui/publish-dialog-model.js`
  的 `OP_TYPES`，筛选下拉由它派生；**37 条实证 + 13 条带 `// 推断`**。
  真正叫 `CHECKOUT` / `CHECKIN` 的是 **14 / 15**。判订阅还是发布看响应 `subscribeName`
  （有值 = 订阅类、为空 = 发布类）。**定不了的名字一律不激活**（22~25 的 4 个候选已按**注释形式**
  写在 `OP_TYPES` 里等确认，摘掉行首注释符即生效，单测会拦一道）。
  **其余没覆盖的编码原样显示数字、不进筛选下拉**（编码填错会让筛选静默查错数据，比少一个选项更坏）。
  ⛔ **不要再改这张表**（2026-09-21 用户裁决）：外部资料写的 7 项属另一套体系，
  且那张截图**没截全**，不构成项数证据。

## 3. 控件契约（searchable-select，踩过 4 次，别改回去）

- **IME 组字中（composition）绝不程序化改写 `input.value`、不跑过滤** —— 改了会把输入法踢出去，
  拼音变裸英文字母。`compositionend` 后补跑一次（兼容 Safari 顺序）。
- 可访问名 = 字段名，初始化时写一次（`aria-label`，兜底「搜索选择」），paint 阶段**不许改**；
  组件输入框永远非无名（冒烟「可访问名称」检查会抓）。
- 输入即搜：**先读 value 再展开**（openDropdown 会清 value）；`title` 已删，别加回来。

## 4. 流程与工具

- **分支**：`main` = 稳定线（只放能跑的）；`dev` = 开发线（**所有 Agent 在这提交**）。
  ⚠️ `main` 上有 merge commit，**`--ff-only` 必然失败**（详见 `AGENTS.md` §0.5），正确姿势：
  `checkout main` → `reset --hard origin/main` → `merge <工作分支> --no-edit`
  → 在 `main` 上跑门禁 → `push origin main` → 切回工作分支。
  **不许 force-push**；push 前先 `git fetch`（GitHub 上可能有 PR 合并提交，历史会和本地分叉）。
  合完 `git diff origin/dev origin/main` 应为空。
- **Bash 坑**：`grep` 一律加 `-E`；测本地端口加 `--noproxy '*'`；zsh 下没匹配的 glob 直接报错退出。
- **验证 UI 必须真点真打字**（playwright 探针），调 API 的探针测不出交互 bug —— 四个真 bug 全是真页面抓的。
- **门禁** = `node tests/run.js` 全过 + `node tests/smoke-browser.js` ALL PASS，**以实跑输出为准**；
  失败先修再提交，**别把验证和提交塞进同一条 `&&` 链**（真放过过一个 FAIL）。

## 5. 其他长期约定

- 详细踩坑与「为什么」在 `.workbuddy/memory/`；与本文件重复的以本文件为准，
  发现冲突 → 写进 `CHANGELOG.md` 待评审。
- 弹窗/样式铁律见 `AGENTS.md` §8 与 `theme.css`（弹窗走 class + theme.css，不写内联 ID 选择器）。
- **修改本文件 = 用户直接拍板的约定变更，要在 `CHANGELOG.md` 留一条交接记录。**
