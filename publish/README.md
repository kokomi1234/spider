# 📋 服务发布数据查询

> 🧭 新人 / 新 AI 接手请先读根目录的 [ONBOARDING.md](../ONBOARDING.md)（上手入口 + 目录地图 + 铁律）。

基于真实接口数据的服务发布数据查询页面，支持筛选、订阅管理等功能。

## 🚀 快速开始

### 1. 本地打开（使用 Mock 数据）

```bash
# macOS
open index.html

# Windows
start index.html

# Linux
xdg-open index.html
```

### 2. 连接真实接口

启动代理服务器后访问真实后端：

```bash
node proxy.js
```

然后在浏览器中打开 `index.html`。代理默认在 `http://localhost:3000` 启动，自动把请求转发到后端系统。

### 3. 离线回放（内网录制，外网使用）

后端在内网，到外网就无法响应。代理会把真实响应**自动录制到本地**，之后离线时**自动回放**：

```bash
# ① 连内网时正常跑一遍，页面点一次查询即可，响应自动落入 cache/
node proxy.js

# ② 到外网后，用离线模式启动（完全不访问网络，直接读本地缓存）
PROXY_OFFLINE=1 node proxy.js
```

不指定 `PROXY_OFFLINE` 也可以：代理会先尝试真实转发，**后端不可达时自动回退到本地缓存**，
回放的响应会带 `X-Served-From: cache` 响应头，便于在 DevTools 里区分数据来源。

```bash
# 查看已录制了哪些请求
curl http://localhost:3000/cache/list

# 清空录制
curl http://localhost:3000/cache/clear
```

**缓存 key 规则**（决定了能不能命中）：

| 参与计算 | 说明 |
|---------|------|
| 请求方法 | POST / GET |
| 路径 | 不含查询参数 |
| 查询参数 | **已剔除 `?n=` 防缓存随机数**，否则每次都是新条目 |
| 请求体 | JSON 键顺序会被规范化；`getPublishDataList` 的不同 `pageNum` 各自独立成条目 |

> ⚠️ 只录制 **HTTP 200** 的响应。token 过期返回的 401、后端 500 都不会写入缓存，
> 否则离线时回放到的就是错误内容。若发现 token 失效，清掉缓存重录即可。
>
> ⚠️ `cache/` 里是**真实内网数据**，请勿外传或提交到仓库。

## 📁 项目结构

```
publish/
├── index.html            # 主页面
├── index.js              # 页面编排与查询状态
├── bootstrap.js          # 运行时依赖检查与启动入口
├── csv-export.js         # CSV 导出 feature
├── department-data.js    # 部门树加载与响应解析
├── subscribe-manager.js  # 订阅管理
├── subscribe-ui.js       # 订阅 UI
├── theme.css             # 主题样式
├── proxy.js              # 代理服务器（CORS 转发 + 本地录制/回放 + /health）
├── cache/                # 录制的真实响应（自动生成，含内网数据勿外传）
│
├── docs/                 # 文档目录
│   ├── design-system.md     # 页面设计规范
│   └── 导入说明.md          # 订阅导入功能说明
│
└── tools/                # 开发工具（不参与主页面加载）
    ├── mock-data.js         # Mock 数据
    ├── mock-proxy.js        # Mock 代理（离线调试）
    ├── my-subscribed-services.txt  # 测试数据
    └── legacy/              # 已隔离的旧备份/旧测试页，运行时不使用
```

> 根目录 `har2doc.py` 用于把抓包（*.har）转成接口文档/OpenAPI。
> 接口分析结论见 `output/ITAMP接口总览.md`。

## ✨ 功能特性

- 🔍 **多条件筛选**：支持组件编号、服务名称、接口名、状态等筛选
- 📊 **统计面板**：实时显示查询结果统计信息
- 📌 **订阅管理**：支持批量导入/导出、快速订阅
- 📱 **响应式设计**：适配不同屏幕尺寸
- 🎨 **美观界面**：现代化的 UI 设计

## 📖 使用说明

### 筛选条件

| 字段 | 说明 | 必填 | 示例值 |
|------|------|------|--------|
| 提供方系统 | 组件编号（映射到 `compNum`） | ✅ | E00301 |
| 服务名称 | 模糊搜索 | ❌ | 查询 |
| 接口名 | 接口编码（映射到 `serverCodingList`） | ❌ | PsnGlobal |
| 系统服务编码 | 服务编号 | ❌ | E00301TP0999 |
| 服务状态 | 发布基线（映射到 `serviceStatus`） | ❌ | 正式版基线 |
| 是否发送行外 | 是/否（映射到 `isSendOutsideSystem`） | ❌ | 否 |
| 负责人姓名 | 模糊搜索 | ❌ | 张三 |
| 部门名称 | 下拉选部门，精确到 `deptId` | ❌ | 中国银行软件中心（西安）开发一部 |
| 产品实施单元 | 模糊搜索（映射到 `implementationUnit`） | ❌ | 数据中心 |

> 注意：`CHECKOUT/IN 状态` 与 `变更时间` 后端暂无对应字段——前者界面已禁用并标注原因，后者改为前端按 `offerEffectiveTime` 兜底过滤。
> 字段与后端的真实映射以 `output/ITAMP接口总览.md` 为准。

### 统计面板

查询后会自动显示以下统计信息：

- **总数**：查询结果总条数
- **已发布**：正式版基线数量
- **待发布**：编辑中 + 功能测试基线 + 开发基线数量
- **失败**：已下线数量
- **组件编号**：当前查询的组件信息

### 订阅管理

- **📌 已订阅按钮**：点击打开订阅管理面板
- **批量导入**：支持从 TXT/CSV 文件导入服务编码
- **批量导出**：导出已订阅的服务编码列表
- **快速订阅**：在表格中直接点击 [订阅] 按钮

## 🐛 故障排除

**问题 1：筛选条件不生效**
- 代理服务器未启动，或后端地址/Token 配置错误
- 解决方案：确认代理正在运行 `node proxy.js`；检查浏览器控制台报错；核对 `index.js` 中字段映射是否与最新抓包一致（参考 `output/ITAMP接口总览.md`）

**问题 2：部门下拉加载不出**
- 代理转发后端失败时，旧版代理的 502 响应不带 CORS 头，浏览器只会报一句跨域错误
- 解决方案：确认代理存活 `curl http://localhost:3000/health`；检查 `proxy.js` 的 `TARGET` 是否可达

**问题 3：订阅功能异常**
- localStorage 被禁用，或浏览器兼容性问题
- 解决方案：允许 localStorage → 清除缓存重试 → 换浏览器

**问题 4：离线时提示「本地缓存中没有这条记录」（404）**
- 该请求的参数组合在内网时没被录制过（缓存 key 含请求体，
  `pageNum` / 筛选条件不同都会算作不同条目）
- 解决方案：连上内网，用**完全相同的筛选条件**跑一次查询完成录制，再离线访问
- 若之前录到过期的错误响应：token 只有 12 小时有效期，重新登录拿到新 token 后
  `curl http://localhost:3000/cache/clear` 清空重录

## 🧪 开发工具

把抓包转成接口文档（根目录 `har2doc.py`）：

```bash
python3 har2doc.py 进入请求.har -o output --format md
```

本地 Mock 调试（无需后端）：

```bash
node tools/mock-proxy.js
```

## ⚙️ 配置说明

优先用环境变量（本地可复制 `publish/.env.example` 为 `publish/.env`，代理启动时自动加载），不必改代码；真实 `.env` 不应提交：

| 环境变量 | 默认值 | 说明 |
|---------|-------|------|
| `PROXY_PORT` | `3000` | 代理端口 |
| `PROXY_TARGET` | `http://itamp.bocsys.cn` | 后端基地址 |
| `PROXY_TOKEN` | — | 认证令牌（**有效期仅 12 小时**，详见接口总览） |
| `PROXY_OFFLINE` | 不设置 | 设为 `1` → 纯离线回放，完全不访问网络 |
| `PROXY_RECORD` | 开启 | 设为 `0` → 关闭录制 |
| `PROXY_CACHE_DIR` | `./cache` | 缓存目录 |

```bash
# 示例：换端口 + 指定 token
PROXY_PORT=4000 PROXY_TOKEN=xxxx-xxxx node proxy.js
```

## 📝 接口文档

- `output/ITAMP接口总览.md` — **权威接口文档**（功能、参数、响应结构、坑、尚未抓到的接口）
- `output/接口文档.md` / `output/进入请求接口文档.md` — 抓包字段级明细（har2doc 生成）
- `docs/导入说明.md` — 订阅导入测试步骤
