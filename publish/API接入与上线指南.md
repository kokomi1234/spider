# API 接入与上线指南

本项目的页面请求统一经过 `publish/js/core/api-client.js` 的 `window.API.call()`。新增接口时，优先只增加业务模块和字段解析，不要在页面里重复编写 `fetch`、token、代理地址或缓存逻辑。

## 一、当前请求链路

### 开发 / 内网调试

```text
浏览器页面
  -> http://localhost:3000/<完整后端路径>
  -> publish/proxy.js
  -> 内网后端 TARGET + <完整后端路径>
```

`proxy.js` 可以负责 CORS、认证头、真实请求录制和离线缓存回放。当前离线调试方式仍然是：

```bash
cd /Users/a1/Desktop/spider/publish
PROXY_OFFLINE=1 node proxy.js     # proxy 自带静态服务，页面也从这个端口打开
```

### 生产 / 上线

生产环境不应继续依赖本地 proxy。推荐使用同源 API 网关或后端 BFF：

```text
浏览器页面
  -> https://<站点>/api/<完整后端路径>
  -> 网关 / BFF
  -> 内网后端
```

生产网关负责：

- 保存和注入后端 token / Cookie / 服务账号
- 处理 CORS（最好同源，不开放 `*`）
- 限制允许转发的路径和 HTTP 方法
- 设置超时、重试、日志脱敏和权限校验
- 不把认证信息返回给浏览器

前端已预留运行时配置：`publish/js/core/runtime-config.js`。

```js
window.__APP_CONFIG__ = {
  mode: 'production',
  apiBase: '/api'
};
```

生产模式不会从浏览器配置读取 token，也不会暴露 `window.API.token`。网关应根据 `/api` 前缀转发到真实后端。

## 二、新增一个接口的最短流程

### 1. 先确认接口契约

记录以下信息：

- HTTP 方法：GET / POST / PUT / DELETE
- 完整后端路径（含模块），例如 `/itamp-tool/publish/getPublishDataList`
- Query 参数及是否需要随机参数
- JSON 请求体字段、类型、必填项
- 成功状态码和业务码
- 响应 JSON 的实际数据路径
- 分页字段：`total`、`rows` / `records` / `list`
- 认证要求和权限范围
- 是否允许离线缓存；响应是否包含敏感数据

### 2. 在业务模块中调用统一客户端

```js
const resp = await window.API.call('/module/example/list', {
  method: 'POST',
  query: { requestId: '固定可复现的参数' },
  body: { pageNum: 1, pageSize: 50 },
  signal: controller.signal
});

if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
const payload = await resp.json();
```

不要在业务文件中：

- 拼接 localhost 或生产域名
- 直接写 token
- 手工增加 CORS 头
- 复制一套缓存 key 逻辑

### 3. 统一解析业务错误

推荐先检查 HTTP 状态，再检查业务码：

```js
const code = Number(payload.code);
if (code !== 0 && code !== 200) {
  throw new Error(payload.msg || payload.message || `业务错误: ${payload.code}`);
}
```

数据路径不确定时，明确写兼容顺序并记录接口实际结构：

```js
const data = payload.data || payload.body || payload;
const rows = data.rows || data.records || data.list || [];
```

### 4. 新增下拉字典时

将接口解析放在独立文件，例如 `js/data/xxx-data.js`，对外暴露：

```js
window.loadExampleList = async function () { ... };
```

输出统一格式：

```js
[{ label: '显示名称', value: '后台值' }]
```

再交给 `createSearchableSelect()`。后台只认选择值时，可以保留手动输入文本用于展示，但不要把它写入 API 请求体。

### 5. 新增本地过滤字段时

在 `publish/js/page/index.js` 的 `FIELDS` 中声明：

- `key`：后台字段名；后台不支持则为 `null`
- `mode`：`api` / `both` / `local`
- `local`：前端兜底匹配的真实响应字段
- `date` / `exact` / `array`：匹配规则

并确认真实响应字段，而不是只根据页面表头命名猜测。

## 三、缓存和测试要求

每个新增接口至少验证：

1. 正常成功响应
2. HTTP 非 2xx
3. 业务码错误
4. 空数据
5. 字段缺失或 `null`
6. 中文、特殊字符和长文本
7. 分页第二页
8. 重复点击查询时旧请求不会覆盖新请求
9. `PROXY_OFFLINE=1` 下的缓存命中和未命中

新增本地缓存时检查：

- cache key 包含 method、完整 path、有效 query、规范化 body
- 随机 `n` 参数不会导致每次生成新 key
- 不要把 token 写入缓存正文或日志
- 缓存只作为开发回放，不作为生产数据源

## 四、上线前检查清单

### 前端

- [ ] `js/core/runtime-config.js` 设置 `mode: 'production'`
- [ ] `apiBase` 指向同源 `/api` 或正式网关地址
- [ ] 浏览器端没有 token 配置
- [ ] 生产构建不包含开发缓存和真实响应文件
- [ ] API 错误提示不展示 token、Cookie、内部地址
- [ ] 查询取消、分页失败、空数据均有明确提示

### 网关 / BFF

- [ ] 仅允许白名单接口路径和方法
- [ ] 服务端保存认证凭据，浏览器不持有后端 token
- [ ] 有用户身份和权限校验
- [ ] 设置连接和响应超时
- [ ] 处理浏览器断开请求
- [ ] 日志脱敏，不记录完整请求体中的敏感字段
- [ ] 同源部署或限制 CORS 来源
- [ ] 对分页、批量查询设置上限

### 回滚方案

生产接口切换建议通过 `js/core/runtime-config.js` 完成，而不是改业务代码。上线失败时，将 `apiBase` 切回旧网关或测试网关即可；开发 proxy 仅保留给内网调试和离线回放。
