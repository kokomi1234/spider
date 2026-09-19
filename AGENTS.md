# AGENTS.md — 多 Agent 协同协议

> 给所有进入本项目的 AI Agent（Qoder / Cursor / Copilot / WorkBuddy 等）：**启动即读本文件**。
> 这里只规定**协同、分工、防冲突、交付门禁**；项目自身的代码规范与踩坑记录不在这里重复一遍，
> 见下面「先读什么」。发现本文件与那些约定冲突时，以 `.workbuddy/memory/MEMORY.md` 为准，并把冲突写进 `CHANGELOG.md` 待评审。

## 0. 先读什么（顺序固定，别跳）

1. `CHANGELOG.md` —— 现在谁锁着哪些文件、上一个 Agent 做到哪、遗留什么。**动手前必读。**
2. `.workbuddy/memory/MEMORY.md` —— 跨会话长期约定与铁律（字段口径、控件契约、脚本顺序、时区、订阅语义…）。
3. `TODO.md` —— 待办与「刻意没做/做不了」的原因；每条都写了目标·卡点·需要什么，**别重复判断一遍**。
4. `ONBOARDING.md` / `publish/README.md` —— 上手与运行方式。
5. 当日流水 `.workbuddy/memory/YYYY-MM-DD.md` —— 今天的现场。

## 1. 基础原则

1. **同一时间只允许一个 Agent 改同一份文件**。要改之前先在 `CHANGELOG.md` 上锁；改完释放。
2. 需要动别人刚写的逻辑：先在 `CHANGELOG.md` 写清理由，锁住相关文件，改动面尽量小。
3. 不做「顺手大重构」。一次改动只服务一个可验证目的。
4. 未分配任务的 Agent，不碰职责范围外的文件（见第 2 节角色）。
5. 沟通只写进 `CHANGELOG.md`，**不要埋在代码注释里**（注释只解释代码本身为什么这样写）。

## 2. 角色（按需增删，但要先在 CHANGELOG 声明）

| 角色 | 职责 | 允许改 |
|---|---|---|
| `Agent-Architect` | 方案设计、目录结构、接口与字段口径定义 | 文档、`TODO.md`，不写实现细节 |
| `Agent-Dev` | 业务实现 + 单测 | `publish/js/**`、`publish/proxy.js`、`publish/lib/**`、`publish/tests/**` |
| `Agent-Doc` | README / ONBOARDING / 记忆文件 / 注释 | `*.md`、源码注释 |
| `Agent-Review` | 代码评审、门禁执行、逻辑校验 | 默认**只读**，只往 `CHANGELOG.md` 写结论 |
| `Agent-Probe` | 真浏览器 / 真接口实测与探针（本项目很重这一环） | `publish/tests/probes/**`、仓库根临时 `_*.js` |

## 3. 强制工作流（五步，一步都不能省）

1. **读上下文**：按第 0 节顺序，重点看锁定与遗留。
2. **列清单并上锁**：把要改的文件写进 `CHANGELOG.md`
   `【锁定】fileA, fileB —— 处理者：Agent-Dev/名称，任务：一句话`
3. **执行修改**：只碰清单内文件；遵守 `MEMORY.md` 的规范。
4. **自检门禁**（本项目的硬门禁，见第 4 节）：全绿才算「做完」。
5. **解锁 + 写记录**：删掉锁定行，追加一条交接记录（格式见 `CHANGELOG.md` 顶部模板）。

## 4. 交付门禁（本项目的真实命令）

```bash
cd publish
node tests/run.js            # 零依赖单测（当前 563 条），必须 100% 通过
node tests/smoke-browser.js  # 无头浏览器冒烟，必须打印 "ALL PASS"，不允许 [FAIL]
```
或一次跑完：`npm run test:all`。

新增单测文件**必须在 `publish/tests/run.js` 里 require 注册**，否则根本不会被跑。

两条本项目的特殊事实，决定「测试绿」不等于做完：
- 页面脚本与弹窗**没有假 DOM 可测**（`tests/harness.js` 只注入 window），
  所以任何改动到 `js/page/**`、组件、CSS 的人，**必须跑冒烟**，必要时写一次性探针实测。
  教训（2026-09-19）：`task.js` 调了一个本文件不存在的 `renderCount()`，563 条单测全绿，只有真浏览器一点才炸。
- 内网接口在开发机不可达（`itamp.bocsys.cn` 连 DNS 都解析不了），
  本地靠 `publish/cache/` 离线回放：**未命中会 404，报「接口地址不存在」**，那不是地址写错。

## 5. 文件保护清单（禁止修改 / 谨慎修改）

| 路径 | 规则 | 原因 |
|---|---|---|
| `publish/vendor/` | ❌ 不改、不删、不「清理」 | vendored `playwright-core`（13MB）**故意入库**，为的是零 npm 依赖也能跑冒烟 |
| `publish/cache/`、`*.har`、`analysis/har/` | ❌ 不手改、不外发、**内容不得抄进任何入库文件** | 真实内网报文，含 `token` / `Cookie` / `ssopSessionId` |
| `shared/saved-queries.db*`、`shared/saved-queries.json` | ❌ 不入库、不当测试靶子 | 「常用查询」团队库运行时数据（含人名/部门）。探针必须用 `PROXY_QUERIES_DB=/tmp/...` 指到临时文件 |
| `.workbuddy/` | ⚠️ 只能**追加**，不重写别人的既有条目 | 跨会话记忆；重写会让别的会话丢上下文 |
| `publish/tools/my-subscribed-services.txt` | ❌ 不改不提交 | 真实订阅数据 |
| `publish/config/batch-times.json` | ⚠️ 随包为空文件，别往里写本机值 | 页面靠「取有数据的来源」逻辑合并，塞值会盖住用户自己的设置 |
| `.env`、`publish/.env` | ❌ 绝不提交、绝不打印 | 凭据 |

## 6. 本项目最容易踩的硬规则（细节以 `MEMORY.md` 为准）

1. **抓包铁律**：没有抓包不写接口代码，一个字段都不猜。缺接口就写「适配层 + 空 endpoint + 本地兜底」，未配置直接抛错、不发请求。
2. **改脚本要三处同步登记**：四个页面 HTML 的 `<script>` 顺序 → `js/core/bootstrap.js` 的 PRESETS → `tests/smoke-browser.js` 的 `PAGES[].globals`。漏一处就静默漏报警。
3. **业务日期一律 `Fmt.businessToday()`（UTC+8）**，别 `new Date()` 算「今天/本月」。
4. **弹窗/遮罩要 `.show` 才可见**（`.overlay` 本身 `opacity:0; pointer-events:none`）：截图/命中测试忘了加 `.show`，量到的是底下的页面，会被误判成「弹窗没打开」。
5. `SavedQuery.clear()` **删的是整个团队库**（本机视图已是共享全集），不要接成 UI 上的「清空」按钮。
6. 表格：`colgroup` 的 `<col>` 数必须等于 `thead` 的 `<th>` 数，否则拖拽把手静默不挂；改列宽/列序要同时升 `itamp.subq.colWidths.vN` 存档版本。
7. 样式只走 `theme.css` 的 `:root` 令牌（有**两个** `:root` 块，扫色值要扫全部）；弹窗宽度用 `.dialog--sm/md/lg`，别用 `#id` 覆盖。
8. 可访问名称只认一份口径：`js/ui/searchable-select.js` 的 `accessibleNameOf()`（`createMultiSelect` 也复用它）。取名规则改了，`tests/a11y-name.test.js` 要跟上。

## 7. 并发资源约定（多个 Agent 同时跑时）

- **端口**：`3000` 是代理默认端口，留给用户自己起的代理，**Agent 一律不要占用**。每个会话自选互不相同的端口（建议 3010–3099），探针用 `server.listen(0)` 更稳。
- **测本地端口一律加 `--noproxy '*'`**：环境里有 `HTTP_PROXY=127.0.0.1:49850`，服务没起时会返回**假 502**，极易误判。
- `grep` 一律加 `-E`（`\|` 静默返回空，踩过多次）。
- 后台服务用工具的 `run_in_background` 起（`nohup … & disown` 会被杀），**结束必须停掉并释放端口**。
- 一次性实测脚本写在**仓库根、命名 `_<主题>.js`、不进 `publish/`**，跑完用 `mv` 进 `~/.Trash/<带时间戳目录>`（约定：**不用 `rm`**，保证可回退）。
- 探针/冒烟同时跑时浏览器实例较多，超时给足（60s 级）。

## 8. 提交与记录

- 提交前先看 `CHANGELOG.md` 有没有别人的锁定；有就别提交。
- 按主题 `git add`（**别 `git add -A`**，避免把 `.env`、缓存报文、临时探针带进去），中文提交信息：`feat:/fix:/chore:/docs:` + 摘要，正文列要点，不署 AI 名。
- 新文件容易漏：`git add -u` **不含未跟踪新文件**（如新增测试文件），要么显式 `git add <路径>`。
- 仓库根**不维护第二份变更史**：改了什么以 git 提交与 `.workbuddy/memory/YYYY-MM-DD.md` 为准；`CHANGELOG.md` 只做**锁定与交接看板**，写清楚「为什么/遗留/下一步」即可，不要抄 diff。

## 9. 每次任务结束，向用户输出

1. 本次改动的文件清单（含新增/删除）；
2. 改动摘要（做了什么、为什么这样做）；
3. 门禁结果原话（`563/563 通过`、`ALL PASS` 这类，不能只说「测过了」）；
4. `CHANGELOG.md` 新增记录的预览；
5. 遗留问题与下一步（需要用户决策的要单独列出来，别自己替用户拍板）。

## 10. 禁止行为

- ❌ 不看 `CHANGELOG.md` 直接动手；
- ❌ 两个 Agent 改同一文件；
- ❌ 删/重写别人的业务逻辑或记忆条目而不说明理由；
- ❌ 改 `publish/vendor/`、缓存报文、团队库、`.env` 等第 5 节清单内文件；
- ❌ 把「测试全绿」当成「已验证」——页面行为要实测证据；
- ❌ 不写 `CHANGELOG.md` 就结束任务。
