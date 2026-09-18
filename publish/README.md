# 📋 ITAMP 查询前端（publish/）

> 🧭 新人 / 新 AI 接手请先读根目录的 [ONBOARDING.md](../ONBOARDING.md)（上手入口 + 目录地图 + 铁律）。
> 本文只讲**怎么跑、怎么调、配置项、故障排除**。

原生 HTML/CSS/JS，无框架无构建。后端 `itamp.bocsys.cn` 在内网，本地经 `proxy.js` 转发。

## 四个页面（首页 + 三个查询页）

| 页面 | 用途 | 入口脚本 |
|---|---|---|
| `index.html` | **首页**：三个查询页入口 + 常用查询快捷卡片 | `js/page/home.js` |
| `publish.html` | 服务发布数据查询（含订阅管理、CSV 导出） | `js/page/index.js` |
| `task.html` | 任务单查询 | `js/page/task.js` |
| `subscription.html` | 服务订阅关系查询（投产优先级、列宽拖拽） | `js/page/subscription.js` |

四页共用 `theme.css` 与 `js/core`、`js/api`、`js/data`、`js/ui` 下的公共模块。

> 2026-09-18：`index.html` 由「服务发布数据查询」改为**首页**，原查询页迁到 `publish.html`。
> 干净路由 `/home`（首页）、`/publish`、`/task`、`/subscription` 在 `proxy.js` 的 `PAGE_ROUTES` 里维护；
> `bootstrap.js` 的 `currentPage()` 按路径判定页签，改路由时两处要一起看。

### 常用查询（保存到首页）

三个查询页的筛选区都有「⭐ 保存到首页」：把当前筛选条件存一份到 `localStorage`
（模块 `js/ui/saved-query.js`，**不上传、不参与请求**），首页渲染成卡片，
点卡片任意处即跳 `/publish?saved=<id>` 并自动回填条件 + 查一次（整块主体就是链接，
没有单独的打开按钮；右侧只留重命名 / 删除）。

摘要一律显示**人类可读文本**而不是编号：批次写「2611批次」、系统写「BOCNET-G-IFS」，
只有拿不到名称（选项未加载）时才回落编号 —— 编号只用于回填表单，不该给人看。
同名同页视为更新；上限 50 条；存储不可用时给出提示而不是崩。

### 当前用户 / 部门常用查询（本机口径）

首页有「当前用户」卡片：填**工号或姓名**即可（走已抓包的 `getUserInfo` / `getUserList`），
查到的人会被记住（localStorage），并在保存常用查询时写进记录作为查询人。

- **按姓名搜索在当前后端不生效**（2026-09-18 实测，重要）：
  `POST /itamp-ems/alaysis/approval/common/getUserList?userName=xxx` 会**忽略查询参数**，
  传任意关键字（甚至不存在的姓名、错误的参数名）都返回同一个人 —— token 对应的登录人。
  工号查询 `getUserInfo?userId=xxx` 是正常的（返回与输入一致）。
  所以首页只把**名字里真的含关键字**的结果当命中，否则提示「改用工号」，
  绝不把登录人当成搜索结果（那比查不到更糟）。**订阅弹窗的「评委信息」搜索用的是同一套
  接口**，同样受此影响，找评委建议直接填工号。
- **部门取 `teamName`，不是 `orgName`**：实测 `orgName` 是整个一级单位
  （“中国银行软件中心（深圳）”，几百人），`teamName` 才是口语里的部门
  （“…开发三部”）。用 orgName 分组等于没有维度，所以 `teamId/teamName` 优先、
  `orgId/orgName` 兜底。
- 首页「部门常用查询」= **本机口径**：只统计这台电脑上保存/打开过的记录，
  按打开次数（`hits`）降序、其次最近打开时间，条数可切 **5 / 10 / 20（默认 10）**，
  选择记在 localStorage。
- 后端**没有**对应接口（中间平台定位），所以没有任何上报请求；界面上明确标注
  「本机口径」，别让用户以为是全公司数据。
- **跨浏览器 / 跨电脑看不到别人的记录**（2026-09-19 用户实测反馈）：数据在各自的
  localStorage 里，是两份互不相干的数据，不是权限问题。同一台机器上换号才自然共享。
  跨机要对齐用首页「导 出 / 导 入」交换 JSON：导入按 id 或「同页面同名」合并，
  计数取 max（**反复导入同一个文件幂等**，不会把高频排行刷上去）。
  想做真正的自动共享，需要把几台机器指向同一个共享文件（可给 proxy.js 加端点），
  或等后端提供接口 —— 两者都还没做。

## 🚀 快速开始

```bash
cd publish && node proxy.js        # 端口 3000，注入 token + CORS，并同时提供静态服务
```

然后打开 `http://localhost:3000/`（自动跳 `/home`，即首页）；
也可直接进 `http://localhost:3000/publish.html`（`task.html` / `subscription.html` 同理）。

- **不能直连 `itamp.bocsys.cn`**（跨域会被拦），页面所有请求都走代理。
- 直接用 `file://` 打开页面只能看静态界面，接口会失败——必须经代理。

### 离线回放（内网录制，外网使用）

代理会把真实响应**自动录制**到 `cache/`，离线时**自动回放**：

```bash
# ① 连内网时正常跑一遍，页面点一次查询即可，响应自动落入 cache/
node proxy.js

# ② 到外网后，用离线模式启动（完全不访问网络，直接读本地缓存）
PROXY_OFFLINE=1 node proxy.js
```

不指定 `PROXY_OFFLINE` 也可以：代理会先尝试真实转发，**后端不可达时自动回退到本地缓存**，
回放的响应带 `X-Served-From: cache` 响应头，便于在 DevTools 里区分数据来源。

```bash
curl http://localhost:3000/cache/list    # 查看已录制了哪些请求
curl http://localhost:3000/cache/clear   # 清空录制
```

**缓存 key 规则**（决定了能不能命中）：

| 参与计算 | 说明 |
|---------|------|
| 请求方法 | POST / GET |
| 路径 | 不含查询参数 |
| 查询参数 | **已剔除 `?n=` 防缓存随机数**，否则每次都是新条目 |
| 请求体 | JSON 键顺序会被规范化；`pageNum` / 筛选条件不同各自独立成条目 |

> ⚠️ 只录制 **HTTP 200** 的响应。token 过期返回的 401、后端 500 都不写入缓存，
> 否则离线时回放到的就是错误内容。
>
> ⚠️ `cache/` 里是**真实内网数据**（服务名、组件编号、订阅关系等），请勿外传或提交到仓库
> （`.gitignore` 已忽略）。
>
> 凭据方面可以放心一步：代理**只记录响应**，不记录请求头 —— 实测 267 个缓存文件里
> `token` / `Cookie` / `ssopSessionId` 均为 0 命中；token 只在转发时从 `.env` 注入。
> 但缓存文件默认 0644 且含真实业务数据，同机其他用户可读，共享机器上注意。
>
> ⚠️ `cache/` 是**全站共用**的。按单个页面清理会连带删掉别的页面的离线数据，
> 清完要重新导入全部抓包（见下方 `tools/har-import.js`）。

## 📁 项目结构

```
publish/
├── index.html（首页） / publish.html / task.html / subscription.html
├── theme.css            # 全站唯一样式来源（令牌 + 组件 + 弹窗）
├── proxy.js             # 代理：转发 / 录制 / 离线回放（entry，勿挪）
├── README.md            # 本文
├── API接入与上线指南.md   # 请求链路、生产部署、新接口接入流程
├── cache/               # 录制的真实响应（自动生成，含内网数据勿外传）
├── package.json         # npm test（单测）/ test:browser（浏览器冒烟）
├── js/
│   ├── core/            # runtime-config / api-client / bootstrap / debug / format /
│   │                    #   publish-response（响应解析与校验）/ app-navigator
│   ├── api/             # task-api / service-api / user-api / tool-api
│   ├── data/            # batch / provider / department（字典与兜底数据）
│   ├── ui/              # searchable-select / multi-select / priority / table-resize /
│   │                    #   date-picker / dialog-utils / csv-export / table-utils /
│   │                    #   detail-dialog / dict-selects / toast / subscribe-* / people-search /
│   │                    #   saved-query（常用查询存储：首页快捷入口的数据源）
│   └── page/            # home.js（首页）/ index.js（服务发布数据查询）/ task.js /
│                        #   subscription.js / subscription-batch-times.js（批量改批次时间）
├── docs/                # design-system.md（设计规范）、导入说明.md（订阅导入测试）、
│                        #   模块化方案评估.md（ESM/注册表的结论与顺序约定）
├── tests/               # 零依赖单测（run.js）+ 浏览器冒烟（smoke-browser.js）
│                        #   + live-probe-saved-query.js（联调诊断，需代理与后端可达）
├── vendor/              # vendored playwright-core（13MB 零依赖，离线冒烟用，随仓库走）
└── tools/               # 开发工具，不参与页面加载
    ├── har-import.js        # HAR → cache/（离线回放的数据来源）
    ├── mock-data.js         # 手写 Mock 数据（调试用）
    ├── mock-proxy.js        # Mock 代理，端口 3001（调试用）
    └── my-subscribed-services.txt  # 订阅导入的测试数据
```

接口分析（抓包 → 文档）在仓库根目录的 `analysis/`：
`analysis/har2doc.py` 是生成器，`analysis/output/` 是产物，`analysis/har/` 是原始抓包。

## ✨ 页面功能与字段映射

### index.html（服务发布数据查询）

筛选条件与后端字段的对应关系定义在 `js/page/index.js` 的 `FIELDS`：

| 页面字段 | 后端 key | 模式 | 备注 |
|---|---|---|---|
| 提供方系统 | `compNum` | api | |
| 变更批次 | `batch` | both | 后端有效值需抓包确认，前端兜底读 `sheetProductBatch` 等 |
| 提供方应用系统服务编号 | `sysServeNoList` + `sysServeNo` | api | **多选**（2026-09-18 从手输单值改过来），选项由「提供方系统」联动带出，与订阅页同一口径（`ToolApi.fetchInformationProdBatch`）；`sysServeNoList` 承载多选、`sysServeNo` 保持旧行为取第一个 |
| 服务名称 | `serviceName` | api | |
| 接口名 | `serverCodingList` | both | 前端兜底匹配 `interfaceCode` / `sysEnName` / `sysServeEnName` |
| 是否发送行外 | `isSendOutsideSystem` | api | |
| 负责人姓名 | `principalName` | api | |
| 服务状态 | `serviceStatus` | both | **后端该字段恒为 null**，实际靠前端按 `offerServerState` 过滤 |
| 部门名称 | `deptId` | both | 精确匹配；下拉没建起来时退化为按 `deptName` 模糊过滤 |
| 产品实施单元 | `implementationUnit` | api | |
| 变更时间（起始 / 结束） | —（纯本地） | local | 后端无对应字段，前端按 `offerEffectiveTime` 兜底；**两个日期框的区间**（2026-09-18 从单值改过来），日历里用虚线连出中间那段（`createDatePicker` 的 `rangeHighlight` 钩子），起止填反了按大小自动交换 |

> `CHECKOUT/IN 状态` 后端无对应字段，界面上已禁用并标注原因。
> 完整的字段口径与坑见 `analysis/output/ITAMP接口总览.md`。

其他功能：统计面板（总数 / 已发布 / 待发布 / 失败）、订阅管理（📌 已订阅面板、批量导入导出、
表格内快速订阅）、CSV 导出。

### task.html（任务单查询）

多条件查询 + 结果表格 + 详情弹窗；筛选项集中在「更多筛选项」折叠区。

### subscription.html（服务订阅关系查询）

- 常用筛选只露 3 项（调用方系统/分行 + 两个批次），其余 10 项收在「更多筛选项」
- 22 列结果表：左侧固定「优先级 + 基线状态 + 审核流程状态 + 服务中文名 + 接口编码」5 列，
  右侧固定操作列；列宽可拖（双击恢复）
- 投产优先级：批次 → 基线里程碑，逾期整行标红；规则集中在 `js/ui/priority.js`
- 默认按优先级排序（结果 ≤1000 条时整批拉回前端排序分页）；「查 看」跳转 ITAMP 真实系统
- 批量修改批次时间弹窗：日期统一走 `js/ui/date-picker.js`，落盘到 `config/batch-times.json`

## ⚙️ 配置说明

优先用环境变量（复制根目录 `.env.example` 为 `.env`，代理启动时自动加载），不必改代码：

| 环境变量 | 默认值 | 说明 |
|---------|-------|------|
| `PROXY_PORT` | `3000` | 代理端口 |
| `PROXY_TARGET` | `http://itamp.bocsys.cn` | 后端基地址 |
| `PROXY_TOKEN` | — | 认证令牌（**有效期仅 12 小时**） |
| `PROXY_OFFLINE` | 不设置 | 设为 `1` → 纯离线回放，完全不访问网络 |
| `PROXY_RECORD` | 开启 | 设为 `0` → 关闭录制 |
| `PROXY_CACHE_DIR` | `./cache` | 缓存目录 |
| `PROXY_API_CACHE_TTL` | `300000` | API 内存缓存 TTL（毫秒），`0` 关闭。目前只缓存订阅条件字典 `/conditions/subscribe`（后端 3~4s）：命中响应带 `X-Cache: HIT`，订阅写接口（setSubcription 等）会使它立即失效 |

```bash
PROXY_PORT=4000 PROXY_TOKEN=xxxx-xxxx node proxy.js
```

> `.env` 含真实令牌，权限应保持 `600`，**不要提交**（`.gitignore` 已覆盖）。

## 🐛 故障排除

**筛选条件不生效**
- 代理未启动或 token 失效。确认 `node proxy.js` 在跑、`curl http://localhost:3000/health` 正常，
  再看浏览器控制台报错；字段映射以 `analysis/output/ITAMP接口总览.md` 为准。

**部门下拉加载不出**
- 代理转发失败时旧版代理的 502 不带 CORS 头，浏览器只报一句跨域错误。
  确认代理存活、`proxy.js` 的 `TARGET` 可达。

**订阅功能异常**
- localStorage 被禁用。允许 localStorage → 清除缓存重试 → 换浏览器。

**离线时提示「本地缓存中没有这条记录」（404）**
- 该请求的参数组合在内网时没被录制过（key 含请求体，`pageNum` / 筛选条件不同都算不同条目）。
- 解决：连内网用**完全相同的条件**跑一次完成录制；或 `node tools/har-import.js <har>` 导入抓包。

**页面上「查询失败」或「数据没变」**
- 先怀疑**缓存没命中**，而不是代码有问题（离线模式下缓存未命中就是 404）。

## 🧪 开发工具

```bash
# 把抓包导入缓存（离线回放的数据来源）
node tools/har-import.js ../analysis/har/进入请求.har

# 从 HAR 生成接口文档 / OpenAPI
python3 ../analysis/har2doc.py ../analysis/har/进入请求.har -o ../analysis/output --format md

# 本地 Mock 调试（不需要后端，端口 3001）
node tools/mock-proxy.js
```

## 📝 接口文档

- `analysis/output/ITAMP接口总览.md` — **权威接口文档**（功能、参数、响应结构、坑、尚未抓到的接口）
- `analysis/output/接口文档.md` / `analysis/output/进入请求接口文档.md` — 抓包字段级明细（har2doc 生成，勿手改）
- `analysis/output/openapi.json` — OpenAPI 描述
- `docs/design-system.md` — 颜色/字号/圆角令牌与组件规范
- `docs/导入说明.md` — 订阅列表导入测试步骤
- `docs/模块化方案评估.md` — 为什么**不**上 ESM / 模块注册表；「调用时才取 `window.*`」的约定与顺序回归防线
