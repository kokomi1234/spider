# 🚦 新人 / 新 AI 上手指南

> 想快速接手这个项目，按本文顺序读：先跑起来 → 认识目录 → 读对文档 → 记住三条铁律。
> 本文档是唯一入口，其余文档都从这里链接过去。

## 这个项目是什么

**ITAMP 服务发布数据查询 + 任务单查询 + 订阅管理**的前端（原生 HTML/CSS/JS，无框架无构建）。
后端 `itamp.bocsys.cn` 在内网，本地通过 `publish/proxy.js` 转发（可录制/离线回放）。

## 5 分钟跑起来

```bash
# 1. 启动代理（注入 token + CORS + 录制/回放）
cd publish && node proxy.js          # 端口 3000

# 2. 打开页面（代理同时提供静态服务）
open http://localhost:3000/index.html   # 服务发布数据查询
open http://localhost:3000/task.html    # 任务单查询

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
│   ├── theme.css            # 全站唯一样式来源（令牌 + 组件 + 弹窗）
│   ├── proxy.js             # 代理：转发/录制/离线回放（entry，勿挪）
│   ├── README.md            # 运行细节（mock/离线/缓存管理）
│   ├── API接入与上线指南.md   # 请求链路、生产部署、新接口接入流程
│   ├── js/
│   │   ├── core/            # 运行时基建：runtime-config / api-client / bootstrap
│   │   ├── api/             # 接口层（每域一个文件，ENDPOINTS+METHODS 模式）
│   │   │                    #   task-api / service-api / user-api / tool-api / sys-api
│   │   ├── data/            # 字典/兜底数据：batch / provider / department
│   │   ├── ui/              # 通用组件与弹窗：searchable-select / date-picker /
│   │   │                    #   csv-export / subscribe-* / people-search
│   │   └── page/            # 页面主逻辑：index.js / task.js
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
| 接口真实字段（抓包核实过） | `analysis/output/接口文档.md`、`analysis/openapi.json` |
| 订阅列表导入测试数据 | `publish/docs/导入说明.md` |
| 项目长期约定与踩坑史 | `.workbuddy/memory/MEMORY.md` |

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
- **离线验证页面**：`node publish/tools/har-import.js ../../analysis/任务单查询.har` 把抓包灌进缓存，
  再 `PROXY_OFFLINE=1 node proxy.js`。
- **改主题**：只改 `publish/theme.css` 的 `:root` 令牌，不要逐处改 px。
- **前端自动化验证**：本机已有 chromium（`~/Library/Caches/ms-playwright/`），用 playwright-core
  显式传 executablePath 即可，无需下载浏览器。

## 给 AI 接手者的说明

- 工作记忆在 `.workbuddy/memory/`（`MEMORY.md` 是长期约定，`YYYY-MM-DD.md` 是日志），
  项目里 `.workbuddy-ai`、`.opencode` 是指向它的软链，所有 AI 共享这一份。
- 提交信息用中文；`publish/cache/`、`*.har`、`analysis/har/` 永远不入库。
