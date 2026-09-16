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
open http://localhost:3000/index.html         # 服务发布数据查询
open http://localhost:3000/task.html          # 任务单查询
open http://localhost:3000/subscription.html  # 服务订阅关系查询

# 3. 内网不可达时，离线回放已录制的响应
PROXY_OFFLINE=1 node proxy.js
```

注意：**不能直连 itamp.bocsys.cn**（跨域会被拦），一切请求走代理。

## 目录地图

```
spider/
├── ONBOARDING.md            ← 本文，上手入口
├── publish/                 ← 前端项目（唯一交付物）
│   ├── index.html           # 页面①：服务发布数据查询
│   ├── task.html            # 页面②：任务单查询（首页工具栏有入口）
│   ├── subscription.html    # 页面③：服务订阅关系查询
│   ├── theme.css            # 全站唯一样式来源（令牌 + 组件 + 弹窗）
│   ├── proxy.js             # 代理：转发/录制/离线回放（entry，勿挪）
│   ├── README.md            # 运行细节（mock/离线/缓存管理）
│   ├── API接入与上线指南.md   # 请求链路、生产部署、新接口接入流程
│   ├── js/
│   │   ├── core/            # 运行时基建：runtime-config / api-client / bootstrap
│   │   ├── api/             # 接口层（每域一个文件，ENDPOINTS+METHODS 模式）
│   │   │                    #   task-api / service-api / user-api / tool-api / sys-api
│   │   ├── data/            # 字典/兜底数据：batch / provider / department
│   │   ├── ui/              # 通用组件与弹窗：searchable-select / multi-select /
│   │   │                    #   priority（投产优先级规则） / table-resize（列宽拖拽） /
│   │   │                    #   date-picker / csv-export / subscribe-* / people-search
│   │   └── page/            # 页面主逻辑：index.js / task.js / subscription.js
│   ├── docs/                # 设计规范（design-system.md）、订阅导入说明
│   ├── tools/               # 开发工具：har-import（HAR→缓存）、mock-proxy
│   └── cache/               # 代理录制的离线响应（gitignore，勿提交）
├── analysis/                ← 抓包分析线（接口事实的唯一来源）
│   ├── har/                 # 原始抓包：进入请求/查询接口/userinfo/任务单查询 + 订阅.json
│   ├── har2doc.py           # HAR → 接口文档生成器
│   ├── output/              # 生成的接口文档（接口文档.md / openapi.json 等）
│   ├── 任务单查询.har        # 任务单页抓包
│   └── 任务单查询接口文档.md
└── .workbuddy/memory/       ← AI 工作记忆（长期约定必读：抓包铁律/样式铁律）
```

## 文档地图（哪份文档管什么）

| 想知道… | 读哪份 |
|---|---|
| 怎么跑 / mock / 离线 / 缓存管理 | `publish/README.md` |
| 请求链路、生产上线、**怎么新增接口** | `publish/API接入与上线指南.md` |
| 颜色/字号/圆角令牌、组件样式 | `publish/docs/design-system.md` |
| 接口真实字段（抓包核实过） | `analysis/output/接口文档.md`、`analysis/output/openapi.json` |
| 订阅关系页的设计方案（含各字段设计意图） | `publish/docs/服务订阅关系查询页面设计.md` |
| 当前还欠什么、在等什么 | `TODO.md`（根目录） |
| 订阅列表导入测试数据 | `publish/docs/导入说明.md` |
| 项目长期约定与踩坑史 | `.workbuddy/memory/MEMORY.md` |

## 安全与保密（务必遵守）

这个仓库里有多份**含真实内网数据与凭证的文件**，处理原则：

- `publish/.env` 存 `PROXY_TOKEN`，权限必须是 `600`（已设置）；`.env` 永远不进仓库（`.gitignore` 已覆盖）。
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
- `publish/js/core/bootstrap.js` 是**三页共用**的启动检查（按页 `PRESETS` 点名报缺失 + 全局异常兜底），
  改它要同时照顾 `index` / `subscription` / `task` 三页。

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
- **前端自动化验证**：本机已有 chromium（`~/Library/Caches/ms-playwright/`），用 playwright-core
  显式传 executablePath 即可，无需下载浏览器。

## 给 AI 接手者的说明

- 工作记忆在 `.workbuddy/memory/`（`MEMORY.md` 是长期约定，`YYYY-MM-DD.md` 是日志），
  项目根目录的 `.opencode`、`.workbuddy-ai` 是两个**单行文本指针文件**（内容就是字符串
  `.workbuddy`，给 OpenCode 之类的 CLI 指路用 —— 不是软链），所有 AI 共享这一份；
  这两个指针文件已在 `.gitignore` 里（属本地约定，不入库）。
- 提交信息用中文；`publish/cache/`、`*.har`、`analysis/har/` 永远不入库。
