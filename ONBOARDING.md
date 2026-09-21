# 🚦 新人 / 新 AI 上手指南

> 想快速接手这个项目，按本文顺序读：先跑起来 → 认识目录 → 读对文档 → 记住三条铁律。
> 本文档是唯一入口，其余文档都从这里链接过去。

## 这个项目是什么

**ITAMP 服务发布数据查询 + 任务单查询 + 服务订阅关系查询 + 订阅管理**的前端（原生 HTML/CSS/JS，无框架无构建）。
后端 `itamp.bocsys.cn` 在内网，本地通过 `publish/proxy.js` 转发（可录制/离线回放）。

## 5 分钟跑起来

```bash
# 1. 启动代理（注入 token + CORS + 录制/回放）
cd publish && node proxy.js          # 端口 3000

# 2. 打开页面（代理同时提供静态服务）
open http://localhost:3000/                   # 首页：三个查询页入口 + 常用查询
open http://localhost:3000/publish.html       # 服务发布数据查询
open http://localhost:3000/task.html          # 任务单查询
open http://localhost:3000/subscription.html  # 服务订阅关系查询

# 3. 内网不可达时，离线回放已录制的响应
PROXY_OFFLINE=1 node proxy.js
```

注意：**不能直连 itamp.bocsys.cn**（跨域会被拦），一切请求走代理。
⚠️ **AI 请用 3010–3099，别占 3000**（3000 留给用户自己起的代理）；测本地端口加 `--noproxy '*'`。

## 目录地图

```
spider/
├── memory.md                ← **跨 Agent 共享约定**（入库，接手前先读这份）
├── AGENTS.md                ← 协同协议（分支 / 锁 / 门禁 / 保护清单）
├── ONBOARDING.md            ← 本文，上手入口
├── publish/                 ← 前端项目（唯一需要交付的代码目录；同事直接 git pull 即得）
│   ├── index.html           # 首页：三页入口 + 常用查询 + 当前用户 + 部门排行
│   ├── publish.html         # 页面①：服务发布数据查询（2026-09-18 起从 index.html 迁出）
│   ├── task.html            # 页面②：任务单查询（首页工具栏有入口）
│   ├── subscription.html    # 页面③：服务订阅关系查询
│   ├── theme.css            # 全站唯一样式来源（令牌 + 组件 + 弹窗；有**两个** :root 块）
│   ├── proxy.js             # 代理：转发/录制/离线回放（entry，勿挪）
│   ├── README.md            # 运行细节（离线回放 / 缓存管理 / 配置）
│   ├── API接入与上线指南.md   # 请求链路、生产部署、新接口接入流程
│   ├── lib/                 # 只给代理用的服务端库：queries-db.js（常用查询的 SQLite 存储层，
│   │                        #   Node 内置 node:sqlite，零 npm 依赖；不可用/打不开时回落 JSON）
│   ├── js/
│   │   ├── core/            # 运行时基建：runtime-config / api-client / bootstrap
│   │   ├── api/             # 接口层（每域一个文件，ENDPOINTS+METHODS 模式）
│   │   │                    #   task-api / service-api / user-api / tool-api
│   │   ├── data/            # 字典/兜底数据：batch / provider / department
│   │   ├── ui/              # 通用组件与弹窗：searchable-select / multi-select /
│   │   │                    #   priority（投产优先级规则）/ table-resize（列宽拖拽）/
│   │   │                    #   date-picker / csv-export / popup-position / query-feedback /
│   │   │                    #   subscribe-* / intf-detail-dialog / op-record-dialog / people-search
│   │   └── page/            # 页面主逻辑：home.js（首页）/ publish.js（服务发布数据查询）/
│   │                        #   task.js / subscription.js
│   ├── docs/                # 设计规范（design-system.md）、订阅导入说明
│   ├── tools/               # 开发工具：har-import（HAR→缓存）、backup-queries-db（团队库备份）
│   └── cache/               # 代理录制的离线响应（gitignore，勿提交）
├── shared/                  ← 跨机器共享库（**文件不入库**）：
│                              saved-queries.db（常用查询；SQLite 是唯一真相源）/
│                              降级用 saved-queries.json / batch-times.json（批次时间，
│                              2026-09-20 从 publish/config/ 搬来，避免重新部署被新包盖掉）；
│                              怎么配才算同一个团队库见 `shared/README.md`
├── analysis/                ← 抓包分析线（接口事实的唯一来源）
│   ├── har/                 # 原始抓包（gitignore，勿外发）
│   ├── har2doc.py           # HAR → 接口文档生成器
│   └── output/              # 生成的接口文档（接口文档.md / openapi.json 等）
└── .workbuddy/memory/       ← **WorkBuddy 本机**流水与细节（不入库；别的 Agent clone 后看不到，
                               跨 Agent 的约定一律写根目录 memory.md）
```

## 文档地图（哪份文档管什么）

| 想知道… | 读哪份 |
|---|---|
| 怎么跑 / 离线回放 / 缓存管理 | `publish/README.md` |
| 请求链路、生产上线、**怎么新增接口** | `publish/API接入与上线指南.md` |
| 颜色/字号/圆角令牌、组件样式 | `publish/docs/design-system.md` |
| 接口真实字段（抓包核实过） | `analysis/output/接口文档.md`、`analysis/output/openapi.json` |
| 订阅关系页的设计方案（含各字段设计意图） | `publish/docs/服务订阅关系查询页面设计.md` |
| 当前还欠什么、在等什么 | `TODO.md`（根目录） |
| 订阅列表导入测试数据 | `publish/docs/导入说明.md` |
| **跨机器共享怎么配**（常用查询的团队库、SQLite 与 JSON 降级、端点与合并规则） | `shared/README.md` |
| **跨 Agent 的长期约定与踩坑史** | **`memory.md`（根目录，入库）**；本机细节才看 `.workbuddy/memory/MEMORY.md` |

## 安全与保密（务必遵守）

这个仓库里有多份**含真实内网数据与凭证的文件**，处理原则：

- 项目根目录 `.env` 存 `PROXY_TOKEN`（由 `publish/proxy.js` 启动时读取并注入请求头）；`.env` 永远不进仓库（`.gitignore` 已覆盖）。
- 抓包 `*.har`（根目录与 `analysis/har/`）与 `publish/cache/` 里含 **token / Cookie / ssopSessionId / 内网地址**，
  `.gitignore` 已全部忽略：`*.har`、`analysis/har/`、`publish/cache/`。
  **不要提交、外传或贴到外部工具**；需要分享时另做脱敏副本。
- token 只有 12 小时有效期；过期后页面报 401，重新取 token 后
  `curl http://localhost:3000/cache/clear` 清缓存重录。

## 已知架构债（接手时心里有数）

- 模块之间靠隐式全局变量通信（`window.API` / `window.ServiceApi` / `window.SubscribeDialog` /
  `window.Priority` 等）。新增模块请沿用 `window.Xxx = {...}` 的显式导出，
  不要再新增 `window._私有桥`。
- **依赖一律「调用时才取 `window.*`」，不要写在 IIFE 顶层。**
  顶层捕获（`const toast = window.toast || fallback`）在脚本顺序变化后会**静默降级**成兜底实现、
  且不报错（表现是「点了没反应」）。写法、理由与已改造清单见 `publish/docs/模块化方案评估.md`；
  回归用例在 `tests/module-order.test.js`（含静态扫描，加了新的顶层捕获会直接报错）。
  例外：少数**命名空间对象**（`PublishModel` / `PublishView` / `SubscriptionModel` …）有意留在顶层——
  它们下面紧跟着就解引用成员，错序会当场抛 `TypeError`（有声失败），不算隐患。
- `publish/js/core/bootstrap.js` 是**四页共用**的启动检查（按页 `PRESETS` 点名报缺失 + 全局异常兜底），
  改它要同时照顾 `home` / `publish` / `subscription` / `task` 四页；页签由 `currentPage()` 按路径判定，
  新增页面时 `PRESETS`、`currentPage()`、`proxy.js` 的 `PAGE_ROUTES` 三处要一起改。

## 三条铁律（违反过，代价很高）

1. **没有抓包就不要写接口代码。** 接口字段一律来自 `analysis/har/` 的真实报文，一个字段都不能猜。
   没有抓包就先建「预留层 + 空 endpoint + 本地兜底」，或直接向用户要抓包。
2. **样式只用 theme.css 的令牌与类。** 弹窗样式禁用 ID 选择器内联；控件外观单一来源
   （下拉一律 searchable-select；间距/字号/圆角用 `--sp* / --fs-* / --r-*`）。
3. **所有请求走 `window.API.call()`**，接口层统一 `ENDPOINTS + METHODS + isEnabled` 模式，
   失败返回 `{ok:false, error}` 不抛异常。

## 常见任务配方

- **接入一个新接口**：先在 `analysis/har/` 找（或让用户提供）抓包 → 在 `publish/js/api/` 对应域文件
  （或新建 `<域>-api.js`）加 ENDPOINT + fetch 方法 → 页面调用。详见 `publish/API接入与上线指南.md`。
- **离线验证页面**：`node publish/tools/har-import.js <file.har>` 把抓包灌进缓存，
  再 `PROXY_OFFLINE=1 node proxy.js`。请注意 `publish/cache/` 是**全站共用**的，
  清缓存要连带重新导入所有抓包（进入请求 / userinfo / 查询接口 / 任务单查询 / 服务订阅关系查询），
  否则别的页面会一起失效；离线时缓存没命中的请求会返回 404，
  页面上表现为「查询失败」或「数据没变」，先查缓存再查代码。
- **改主题**：只改 `publish/theme.css` 的 `:root` 令牌，不要逐处改 px。
- **改投产优先级规则**（批次 → 基线里程碑 / 逾期标红）：只改 `publish/js/ui/priority.js`
  顶部的 `MILESTONES`（状态机）和 `LEVELS`（紧急阈值）两个常量，页面代码不用动。
  当前规则：批次月 − 1 个月的 15 日转功能测试基线，批次月的 15 日转正式版基线
  （与「批量修改批次时间」选择栏的默认值口径一致：功测 = 批次月的上一个月）。
- **前端自动化验证**：用 `publish/vendor/playwright-core`（**故意入库的 vendored 依赖，别清理**）
  显式传 executablePath 即可，无需下载浏览器。浏览器缓存的默认位置**按平台不同**：
  macOS `~/Library/Caches/ms-playwright/`、Windows `%USERPROFILE%\AppData\Local\ms-playwright`。
  冒烟脚本也可用 `SMOKE_CHROME_PATH` 显式指定。

## 给 AI 接手者的说明

- **跨 Agent 的长期约定写在根目录 `memory.md`**（入库、随仓库走，接手前必读）；
  `.workbuddy/memory/` 只是 **WorkBuddy 本机**的流水与细节（`MEMORY.md` 细节 /
  `YYYY-MM-DD.md` 日志），**不入库**，别的 Agent clone 后看不到。
- 本机可能另有 `.opencode`、`.workbuddy-ai` 这类**单行文本指针文件**（内容就是字符串
  `.workbuddy`，给 OpenCode 之类 CLI 指路用，不是软链）；它们在 `.gitignore` 里，
  **clone 下来不会有**，别把它们当成必然存在的东西。
- 提交信息用中文；`publish/cache/`、`*.har`、`analysis/har/` 永远不入库。
