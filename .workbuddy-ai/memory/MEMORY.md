# spider 项目长期约定

> 2026-09-08 由 `.opencode/memory/MEMORY.md` 与 `.workbuddy-ai/memory/MEMORY.md`
> 合并而来（两份内容互补，不是互相覆盖）。`.opencode/` 已删除，今后只有这一处。

## 项目概况

- 路径 `/Users/a1/Desktop/spider/`，前端在 `publish/`，原生 HTML/CSS/JS，无框架无构建。
- 页面：`index.html` = 服务发布数据查询；`task.html` = 任务单查询（第二个页面，首页工具栏有入口）。
  两个页面共用 theme.css / runtime-config.js / api-client.js / searchable-select.js / date-picker.js。
- 抓包分析：`python3 har2doc.py <har> -o output --format md`；
  临时探查用 python 直接 `json.load` 遍历 `log.entries`。

## 抓包铁律（最高优先级）

**没有抓包就不要写接口代码。**

- 我**没有内网访问权**，`itamp.bocsys.cn` 的 DNS 都解析不了，无法 curl 验证任何真实接口。
  所有接口细节必须来自用户提供的 `.har`，一个字段都不能猜。
- 需要新接口而抓包里没有 → **停下来向用户要抓包**，不要凭经验拼 URL / 参数名 / 响应结构。
- 猜错的代价比报错高：2026-09-03 猜 `getOrgTreeList` 是 GET + children 树 + orgID/orgName，
  三个全错（实际 POST + 扁平数组 + value/key）。
- 需要预留时只写「适配层 + 空 endpoint + 本地兜底」：未配置 endpoint **不发起任何网络请求**，
  直接走本地数据。配置统一走 `window.__APP_CONFIG__`（`runtime-config.js`），
  路径放 `endpoints`，HTTP 方法放 `endpointMethods`（参考 `publish/service-api.js`）。

### 抓包文件清单

| 文件 | 内容 |
|---|---|
| `任务单查询.har`（根目录） | 任务单查询页：`taskFormSelectList` 等 7 个接口 |
| `har/进入请求.har` | 页面进入时的请求，含 **`getOrgTreeList`（部门树）** |
| `har/userinfo.har` | `getUserInfo` / `getUserList` |
| `har/查询接口.har` | 服务发布数据查询主接口 |
| `har/订阅.json` | 订阅相关报文 |

### 后端接口共性

- 统一响应封装 `{ code, msg, data }`，`code = 200`（有接口返回字符串 `"200"`）表示成功
- 分页：`pageNum`（从 1 开始）+ `pageSize`，响应 `data.total` + `data.rows`
- 所有接口都带 `?n=0.xxxx` 防缓存随机数，忽略即可
- 公共请求头：`systemId: itamp`、`token`、`ssopSessionId`、`authMethods: udp`、`Cookie`

### 已抓包接口的字段口径（改代码前先对照）

- `POST /itamp-tool/publish/setSubcription`：请求体 `{ documents:[...], publishSubcription:{...} }`
  - `prodSysServeNoList[0]` = `callerComponent` + `sysServeNo` 尾部的 `TO\d+`（`E00301TO1197` + `E00406` → `E00406TO1197`）
  - 别用 `serverCoding`（如 `ObsOpenAccountGetRedirectUrl`）去拼，去字母后是空的
  - `sysServeNo / serviceNumber / targetServeNo` 是**提供者编号**；`interfaceCode / sysEnName / sysServeEnName` 才是**接口编码**
  - 调用方必须传**整个 row** 给 `subscribeWithForm`，只传编码会丢 sysServeNo 等字段
- `POST /itamp-tool/intfcMgmt/docList`：响应 `{ code:'200', data:{ total, rows:[...] } }`
  - 数组字段是 **`rows`**（不是 records/list），记录 ID 是 **`value`**（不是 docInstId）
  - 取 ID 统一写 `d.value || d.docInstId || d.id`，别只写 `d.id`
- `POST /itamp-ems/.../taskFormSelectList`（任务单）：响应 `{ total, rows, code, msg, pageNum, pageSize, pageTotals }`
  - 接口文档里列了 `reviewerRole`，但两次抓包**都没带上** → 不发送
  - `selectDeptList` 是「无 body + `?deptName=` 查询参数」的 POST

### 真实字段名陷阱

`getPublishDataList` 响应里很多字段恒为 null，别拿它们当筛选条件：
- `serviceStatus` 全 null → 实际基线在 `offerServerState`
- `batch` 全 null → 实际批次在 `sheetProductBatch`
- `principal` / `principalName` / `implementationUnit` 全空

## 本地调试

- 代理：`cd publish && node proxy.js`（端口 3000，注入 token，加 CORS 头），转发任意完整后端路径到 itamp.bocsys.cn
- 页面直接开 `publish/index.html`，接口走 `http://localhost:3000`；**不能直连 itamp.bocsys.cn**（跨域会被拦）
- 离线回放：`PROXY_OFFLINE=1 node publish/proxy.js`，读 `publish/cache/`
- `node publish/tools/har-import.js <file.har>` 把抓包响应灌进 cache/，之后离线也能回放
  - 缓存按 method + path + 请求体精确匹配，前端请求体要和抓包一致才命中
  - 坑：缓存 `total` 必须与 `rows.length` 对齐，曾因测试残留 `total=400` 触发假「第 2 页获取失败」

## 样式铁律

**弹窗 / 模态类的样式只走 class + theme.css，不要在 index.html 里内联 ID 选择器。**

ID 选择器优先级 (0,1,0,0) 高于类选择器 (0,0,1,0)，一旦内联，theme.css 的同层规则就再也改不动 ——
表现为「我改了主题但弹窗不变」。9/7 那次弹窗挤在 860px 上限、字号偏小、控件偏矮，
根因就是 index.html 里残留了 `#subscribeOverlay / #subscribeDialog` 的死样式。

- 弹窗 DOM 用 `.sub-* / .doc-*` 类前缀，定义统一在 `theme.css` 末尾的「订阅弹窗」小节
- index.html 的 `<style>` 只放页面级微调（与弹窗无关的）
- z-index 全站约定：`< .overlay 1000 < 子弹窗 1050 < loading-mask 2000 < toast 3000`
- 不要再写 `#xxxId { ... }` 这类样式

## 控件外观单一来源

- 文本输入 / 下拉 / 标签跟 `.form-group` / `.result-table` 同一套：
  42px / padding `0 12px` / `--fs-md` / `--on-surface` / `--faint` 占位 / `--outline` 边框 / `--r-xs` 圆角
- **弹窗里的下拉全部统一走 `createSearchableSelect`**，即使是 2-4 项的字典。
  theme.css 的 `.sub-ctl` 虽然做了 appearance:none + 自定义箭头，但**点击展开的 popup 仍是系统原生的**，
  跟可搜索下拉的 div 面板观感不一致，用户会反馈「没套上主题样式」。所以：
  - 弹窗内不用 `<select class="sub-ctl">` 当最终控件，全部塞进 `SEARCHABLE_FIELDS`
  - source 取 `provider` / `batch` / `dict` / `none` 四种，字典字段写 `{ source:'dict', dict:'serviceMode' }`
- 表格：th `10px 9px` / `--fs-nano` / 600 / `--muted` / `.02em` 字距 / sticky；
  td `10px 9px` / `--fs-sm` / `--on-surface` / `line-height: 1.4`
- 按钮文案用「带空格 + 可选 emoji」风格（🔍 查 询 / 取 消 / 确 认 / 选 择）

## 间距 / 字号 / 圆角 / 颜色

一律走 `:root` 的 `--fs-* / --sp* / --r-* / --{color}` 令牌（`--fs-nano` 12 → `--fs-2xl` 24）；
改全局字号只调令牌，不逐处改 px。**项目里没有 `--fg` 这种变量**，别凭感觉用。

## 前端验证方式

本机 `~/Library/Caches/ms-playwright/` 已有 chromium 二进制，验证前端最直接的办法：

```bash
cd /Users/a1/.workbuddy-ai/binaries/node/workspace && npm i playwright-core
# launch 时指定 executablePath：
#   ~/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell
```

（playwright-core 默认找的 revision 可能和缓存里的不一致，显式传 executablePath 即可。）

坑：
- Chrome 可能把同一请求发两次（preconnect/retry），断言请求数要放宽到 `>=1`
- 瞬态 UI（加载中 spinner）用轮询而非单次快照，否则会漏判
- 想看弹窗就直接在页面里调 `window.SubscribeDialog.open(row)`，不用走完整业务流程
