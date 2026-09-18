# ITAMP 平台接口总览

**每个字段都有抓包出处，没有任何推测。** 抓包里没有的接口，不要凭经验去拼 URL、
参数名或响应结构——猜错的排查成本远高于直接要抓包。

## ⚠️ 覆盖范围（先看这里，别拿它当全量接口清单）

| 页面 | 主接口 | 本文是否覆盖 |
| --- | --- | --- |
| 服务发布数据查询（`index.html`） | `getPublishDataList`、`getOrgTreeList` 等 | ✅ 已覆盖（第二～五章） |
| 任务单查询（`task.html`） | `taskFormSelectList` 等 7 个 | ❌ **未收录**，看 `analysis/任务单查询.har` 与 `analysis/任务单查询接口文档.md` |
| 服务订阅关系查询（`subscription.html`） | `getSubscriptionPublishHistoryList`、`getProdSysServeNoList` | ❌ **未收录**，看根目录 `服务订阅关系查询.har` |

后两个页面是在本文成稿之后接入的（2026-09-10），字段口径见 `.workbuddy/memory/MEMORY.md`
的「字段口径与陷阱」小节。

## 抓包来源

| 抓包文件 | 内容 | 接口数 | 现状 |
| --- | --- | --- | --- |
| `trace.har` | 服务订阅页完整操作流程，含主列表 `getPublishDataList` | 14 | ⚠️ 已不在仓库（本文结论仍有效） |
| `table.har` | 同上，样本较少 | 3 | ⚠️ 已不在仓库 |
| `login.har` | 登录认证 + 前端静态资源 | 2 | ⚠️ 已不在仓库 |
| `analysis/har/进入请求.har` | 页面进入时的初始化请求，含**部门树 `getOrgTreeList`** | 8 | ✅ 在库 |
| `analysis/har/userinfo.har` | 人员查询 | 2 | ✅ 在库 |
| `analysis/har/查询接口.har` | 服务发布数据查询主接口 | 1 | ✅ 在库 |

---

## 一、全局约定

### 域名与模块划分

主域名 `itamp.bocsys.cn`（内网），按路径前缀分成几摊：

| 前缀 | 归属 | 用途 |
| --- | --- | --- |
| `/itamp-tool/publish/` | 发布管理 | 服务发布数据、部门树、审批、历史版本 |
| `/itamp-tool/operation/` | 发布管理 | 操作记录 |
| `/itamp-tool/performanceCapacity/` | 发布管理 | 性能容量 |
| `/itamp-tool/intfcMgmt/` | 接口管理 | 筛选条件字典 |
| `/itamp-ems/alaysis/approval/` | 审批中心 | 人员查询 |
| `/itamp-comm/iam/` | 公共 | 登录用户、组织、角色 |
| `/itamp-asset/` | 资产 | 首页通告、意见反馈 |
| `seiaomriis.bocsys.cn` | 安全认证平台 | 单点登录（独立域名） |

来源页面基本都是 `/asserInstruments/ServiceSubscribe`（服务订阅页）。

### 认证

请求头固定带这些（抓包 100% 出现）：

```
systemId: itamp
token: <登录后拿到的 token>
ssopSessionId: <SSO 会话>
sessionId:
authMethods: udp
udpToken: / udpSessionId: / udpUserId:
Cookie: <会话>
```

**`token` 是动态的，有效期 12 小时。** 抓包实测：
`loginTime` 2026-09-03 11:02:20 → `expireTime` 2026-09-03 23:02:20。

> ⚠️ 认证 token 通过项目根目录 `.env` 的 `PROXY_TOKEN` 配置（由 `proxy.js` 启动时读取并注入请求头），代码里**没有硬编码**。token 约 12 小时过期，过期后页面报 401，换新 token 并清缓存重录即可。
> 过期后所有接口都会认证失败。更新方式：登录后调 `/itamp-comm/iam/getUserInfo`
> 取 `data.token`，填进项目根目录 `.env` 的 `PROXY_TOKEN` 即可（**现状已做成配置项**，无需改代码）。

### 响应封装：后端用了三套结构，别只按一种写

**A 型（最常见）**——`data` 装业务数据：

```json
{ "msg": "操作成功", "code": 200, "data": { ... } }
```

**B 型（分页接口）**——`data` 里又嵌了一层 `code`/`msg`：

```json
{ "msg": "操作成功", "code": 200,
  "data": { "total": 5049, "rows": [...], "code": 200, "msg": "...",
            "pageNum": 1, "pageSize": 10, "pageTotals": 505 } }
```

**C 型（少数）**——分页结构直接摊平在顶层，没有 `data` 包裹：

```json
{ "total": 0, "rows": [], "code": 200, "msg": "查询成功",
  "pageNum": 1, "pageSize": 10, "pageTotals": 0 }
```

`getPerformanceOperationData` 就是 C 型。前端取值要写成
`json.data || json.body || json` 才能同时吃下 A 和 C。

**D 型（特例）**——三层嵌套，`getInformationProdBatch` 独一份：

```json
{ "code": 200, "data": { "code": 200, "msg": "操作成功",
                          "data": { "sysServeNoList": [...] } } }
```

### ⚠️ `code` 字段类型不统一

多数接口返回整型的 `200`，但下面这几个返回的是**字符串 `"200"`**：

- `getInformationServerCoding`
- `getHistoryDetail`
- `conditions/subscribe`

所以判断成功不能写 `code !== 200`（严格比较会把 `"200"` 判成失败），
要用 `Number(code) !== 200`。

### 分页

- 请求：`pageNum`（**从 1 开始**）+ `pageSize`
- 响应：`total`（总记录数）+ `rows`（当前页）+ `pageTotals`（总页数）

### 防缓存参数

所有接口 URL 都带 `?n=0.1234567890`，是随机数，仅用于绕缓存，**不要写进文档或当成业务参数**。
`har2doc.py` 已自动忽略它。

---

## 二、接口清单

### 2.1 认证与用户

#### `POST https://seiaomriis.bocsys.cn/v1/staticAuth`
**干什么**：单点登录认证。独立的安全认证平台，用 EHR 工号 + 静态密码（RSA 加密）
换取登录态，之后跳转到 ITAMP。

请求体（`reqBody`）里是加密后的 `ehr`、`staticPassword`、`rs`、`rc`。
响应为空，登录结果体现在后续跳转的 URL 参数上
（`serviceSearchView?sessionid=...&statuscode=10000`，`10000` 表示成功）。

> 这是唯一一个非 `itamp.bocsys.cn` 域名的接口。

#### `GET /itamp-comm/iam/getUserInfo`
**干什么**：登录后拉取**当前登录用户**的完整信息，是页面的第一个业务请求。

返回 `data` 里有：

| 字段 | 说明 |
| --- | --- |
| `token` | **后续所有接口要用的 token**（12 小时有效） |
| `loginTime` / `expireTime` | 毫秒时间戳，算得出剩余有效期 |
| `userExtInfo` | 用户详情，含 `userId`/`userName`/`orgId`/`orgName`/`teamId`/`teamName` |
| `userExtInfo.roleList` | 角色列表，如「总行普通用户」「软件中心成员」 |
| `userExtInfo.menuList` | 菜单权限树 |
| `blackWhite` | 黑白名单标记 |

**要点**：`token` 从这里来，不是写死的。

#### `GET /itamp-comm/iam/getAsOrgList`
**干什么**：查询当前用户可切换的「作为组织」列表（用于以某个组织身份操作系统）。
本次抓包返回 `data: []`，说明该账号没有可切换的组织，所以这个接口的真实数据形态**还没抓到**。

#### `GET /itamp-comm/role/getRoleListByRoleGroupId`
**干什么**：按角色组查角色列表，用于需求审批的「经办 / 复核」人员分配。

| 参数 | 抓包出现的值 |
| --- | --- |
| `roleGroupId` | `HANDLED_GROUP`（需求管理经办组）、`REVIEW_GROUP`（需求管理复核组） |
| `status` | `1` |

返回角色数组，每项含 `roleCode`（如 `COR_FIN_HANDLED` 公司金融组经办）、
`roleName`、`roleGroupName`、`dimension`（系统控制）等。

#### `POST /itamp-ems/alaysis/approval/common/getUserInfo?userId=xxx`
**干什么**：按 userId 精确查一个人，审批流里用来把工号换成姓名和部门。

```json
{ "userId": "8404725", "userName": "魏甜甜",
  "orgId": "1643A", "orgName": "中国银行软件中心（西安）",
  "teamId": "1465A", "teamName": "中国银行软件中心（西安）开发一部",
  "userLeave": "经理" }
```

> 注意 `teamId` 是**部门 ID**（1465A），而不是 `orgId`（1643A）。
> 服务数据里的 `deptId` 对应的是 `teamId` 这一级。

#### `POST /itamp-ems/alaysis/approval/common/getUserList?userName=xxx`
**干什么**：按**中文姓名**模糊搜人（参数是 query 里的 `userName`，无 body），
常用于负责人输入框的联想。

```json
[{ "userId": "0581623", "userName": "李胜",
   "orgName": "中国银行海口琼山支行", "teamName": "中国银行海口琼山支行" }, ...]
```

> ⚠️ 抓包里搜「郑梓辉」返回 `{"msg":"查询失败！","code":500}`，
> 搜「李胜」正常。**这个接口对部分姓名会报 500**，调用方必须容错，不能假设一定成功。

---

### 2.2 服务发布数据（核心业务）

#### `POST /itamp-tool/publish/getPublishDataList` ⭐
**干什么**：**服务发布数据的主列表查询**，分页 + 多条件筛选。当前页面
（`publish/index.html`）用的就是它。

请求体只有这 17 个字段，**后端只认这些，传别的会被静默忽略**：

```json
{ "compNum": "E00301",              // 组件编号，如 E00301，实际上是必填
  "batch": "",                      // 批次
  "serverCodingList": [],           // 服务编码列表
  "serviceName": "",                // 服务名称，模糊
  "callerComponent": "",            // 调用方组件
  "subscriberStatus": "",           // 订阅状态
  "isChecked": "",                  // 是否已核对
  "pageSize": 10,
  "pageNum": 1,
  "isSendOutsideSystem": "",        // 是否发送行外
  "principal": "",                  // 负责人
  "principalName": "",              // 负责人姓名
  "serviceStatus": "",              // 服务状态
  "sysServeNoList": [],             // 系统服务号列表
  "sysServeNo": "",                 // 系统服务号
  "deptId": "",                     // 部门 ID（不是部门名称）
  "implementationUnit": "" }        // 实施单位
```

响应 `data.rows[]` 共 100+ 个字段，常用且有值的：

`serverCoding`（服务编码，唯一标识）、`serviceName`、`interfaceCode`、
`provideSystemNumber`（组件编号）、`sheetProductBatch`（批次）、
`offerServerState`（发布基线）、`isChecked`、`deptId` / `deptName`、`sysServeNo`。

> ⚠️ **只发非空值**。空字符串也别发，否则可能干扰后端筛选逻辑。

#### `POST /itamp-tool/publish/getPublishList`
**干什么**：查**某个发布**被哪些系统订阅了。按 `publishId` 查，返回订阅方明细。

```json
// 请求
{ "callerComponent": "", "operationType": "", "pageNum": 1, "pageSize": 10,
  "status": "", "publishId": "8b6a7d05-31b8-4e5c-a8ff-08a9957a467f" }
```

返回的 row 里有 `subscriberComponentName`（订阅方组件）、`callerComponent`、
`subscriberStatus`、`subscriberId` 等订阅侧字段。

#### `POST /itamp-tool/publish/getInformationProdBatch`
**干什么**：查某个组件下可选的**服务编号下拉选项**，用于填充筛选框。

请求 `{"compNum":"E00301"}`。
响应是 D 型三层嵌套，真正的选项在 `data.data.sysServeNoList`：

```json
[{ "label": "E00301TP42E9", "value": "E00301TP42E9", "shortEn": null }]
```

#### `POST /itamp-tool/publish/getInformationServerCoding`
**干什么**：查某个组件下的**服务编码大全**，是个很长的字符串数组。

请求 `{"compNum":"E00301"}`，响应 `data` 是裸数组，抓包样本 **5634 条**：

```json
["PsnXpadProductBalanceQuery", "ObsSDCrcdLossReplaceSetConfirm", ...]
```

> 注意这个接口返回的 `code` 是字符串 `"200"`。
> 数据量很大，适合做前端联想输入的数据源，不适合一次性全渲染。

#### `POST /itamp-tool/publish/getOrgTreeList` ⭐
**干什么**：查**部门树**，部门筛选下拉的数据源。

```
POST /itamp-tool/publish/getOrgTreeList?orgID=M2534&n=0.8678
```

- 方法是 **POST**，无请求体
- `orgID` 放在 **query string** 里
- 响应是**扁平数组，没有 children 层级**
- 元素字段是 `value`（部门名称）+ `key`（部门 ID）——**注意 value 在前且是名称，
  key 是 ID，跟直觉相反**

```json
{ "msg": "操作成功", "code": 200,
  "data": [{ "value": "中国银行软件中心（西安）开发一部", "key": "1465A" }, ...] }
```

抓包实测：`3696H` 返回 44 条（中银金融科技），`M2534` 返回 70 条（软件中心），
合并去重 **114 个部门**。

> 已核对：服务数据里的 `deptId`（1465A、K4229）都能在这棵树里找到，
> 所以拿 `key` 当 `getPublishDataList` 的 `deptId` 去筛选是成立的。

#### `POST /itamp-tool/publish/getJudgeInfo`
**干什么**：查某个组件 + 调用方组合下的**审批人**名单。

```json
// 请求
{ "compNum": "E00301", "principal": "", "callerComponent": "E00406" }
// 响应 data[]
{ "judgeRoleName": "服务方产品负责人", "judgeName": "魏甜甜",
  "judgeDeptName": "中国银行软件中心（西安）开发一部",
  "judgeUserId": "8404725", "judgeDeptId": "1465A" }
```

`judgeDeptId` 与 `getOrgTreeList` 的 `key`、`getPublishDataList` 的 `deptId` 是同一套编码。

#### `POST /itamp-tool/publish/getTextData`
**干什么**：查某个组件关联的**说明文档**，返回章节和附件。

请求 `{"assemblyNo":"E00301"}`（注意这里是 `assemblyNo` 不是 `compNum`）：

```json
[{ "chapterId": "E00301",
   "fileInfo": [{ "name": "BBS 接口文档-v1.3.docx", "id": "a40d9877-..." }],
   "textDataList": [""] }]
```

#### `POST /itamp-tool/publish/getHistory`
**干什么**：查某个服务的**变更历史列表**（谁在什么时候改了什么）。

```json
// 请求
{ "dataId": "1b3fda57-0848-406b-8459-0560e6704b57", "pageNum": 1, "pageSize": 10, "delFlg": "0" }
```

`dataId` 传的是 `publishId`。返回的 row 结构与 `getPublishDataList` 的 row 高度相似
（含 `serverCoding`、`sysServeNo`、`prodBatch` 等），额外带 `operationType`、`createBy`、`createTime`。

#### `POST /itamp-tool/publish/getHistoryDetail`
**干什么**：查历史**某一个版本**的接口明细，是 `getHistory` 的下钻。

```json
// 请求
{ "informationId": "eac6bf0b-...", "createTime": "2026-08-31 15:53:51",
  "publishId": "1b3fda57-..." }
```

响应 `data` 有 5 个子列表：

| 字段 | 内容 |
| --- | --- |
| `childReqList` | **请求字段**列表（`messageType: "1"`） |
| `childRespList` | **响应字段**列表（`messageType: "2"`） |
| `interfaceModifyList` | 接口变更点：`modifyDetail`（如「新增交易接口」）、`modifier`、`modifyDate`、`prodBatch` |
| `revisionList` | 修订记录（抓包样本为空，结构未知） |
| `deployList` | 部署记录（抓包样本为空，结构未知） |

字段项结构：`parameter`（英文参数名）、`parameterName`（中文名）、`type`、`isMust`（`M` 必输）、`length`、`dictNo`、`remark1~3`。

> 这个接口的 `code` 也是字符串 `"200"`。

#### `POST /itamp-tool/publish/getInfoBaseVersion`
**干什么**：查基线版本列表，`type` 区分基线类型（抓包里是 `"02"`）。

```json
// 请求
{ "pageNum": 1, "pageSize": 10, "informationId": "7e461c12-...", "type": "02" }
```

`type` 的其他取值还没抓到。

---

### 2.3 操作记录

#### `POST /itamp-tool/operation/getOperationRecordList`
**干什么**：查某个**发布**的操作记录（谁做了什么操作）。按 `publishId` 查。

```json
{ "operationType": "", "pageNum": 1, "pageSize": 10, "publishId": "eac6bf0b-..." }
```

#### `POST /itamp-tool/operation/getSubOperationRecordList`
**干什么**：查某条**订阅**的操作记录。按 `subscriptionId` 查。

```json
{ "operationType": "", "pageNum": 1, "pageSize": 10, "subscriptionId": "7e461c12-..." }
```

两个接口响应结构一致（B 型分页），区别只在查的主键是发布还是订阅。
`operationType` 的取值字典还没抓到。

---

### 2.4 性能容量

#### `POST /itamp-tool/performanceCapacity/getData`
**干什么**：查某条订阅的**容量评估数据**（TPS、交易量、延迟）。

请求 `{"subscriptionId":"7e461c12-..."}`：

```json
{ "prodBatch": "26年10月独立", "serverNo": "M-202607-10725", "reviewStatus": "05",
  "prodTPSNormal": "", "volumeNormal": "", "latencyNormal": "",
  "prodTPSPeak": "10", "volumePeak": "", "latencyPeak": "" }
```

> 字段命名规律：`prod` 前缀 + `Normal`（正常）/ `Peak`（峰值）。
> 抓包样本里大部分是空字符串，**只有 `prodTPSPeak` 有值**，说明容量数据填报率很低。

#### `POST /itamp-tool/performanceCapacity/getPerformanceOperationData`
**干什么**：查容量数据的操作记录。请求与 `getSubOperationRecordList` 同构。

> 这是唯一一个 **C 型响应**（分页结构摊平在顶层，无 `data` 包裹）的接口。

---

### 2.5 筛选条件字典

#### `POST /itamp-tool/intfcMgmt/conditions/subscribe`
**干什么**：**服务订阅页**的筛选下拉选项字典，页面进入时调一次，把所有下拉选项一次取回。
抓包里调了 9 次（多次进入 / 切换标签）。

响应 `data` 有 6 组选项，每组都是 `{label, value, shortEn}` 结构：

| 字段 | 条数 | 内容 |
| --- | --- | --- |
| `phyTechCompList` | 375 | 物理技术组件（如 DevOps 平台、DB2、GoldenDB） |
| `subSystemList` | 445 | 子系统（如 资产负债管理系统-ALMS） |
| `physicalApplicationComponentList` | 69 | 物理应用组件 |
| `batchList` | 295 | **批次**（`label` 是 `2606批次`，`value` 是 `2606`） |
| `branchName` | 91 | 分行（如 北京市分行 / 00002） |
| `unusedList` | 208 | 未使用的组件 |

> ⚠️ 这是**服务订阅页**的字典，不是「服务发布数据查询页」的。
> `batchList` 的 `2606批次` 格式与发布数据里的 `sheetProductBatch`（`2611批次`）一致，
> 但两者是否同源未经验证，不要直接混用。
>
> `code` 也是字符串 `"200"`。

---

### 2.6 首页通告与反馈

#### `POST /itamp-asset/releaseNotice/list/selectPage`
**干什么**：首页「发布通告」分页列表。请求 `{"pageNum":1,"pageSize":10,"status":2,"keyword":""}`，
抓包返回 `data: null`（当时没有通告）。

#### `POST /itamp-asset/releaseNotice/batch/getNoticeReadFlag`
**干什么**：查发布通告的**未读数**。请求 `{"latestFlag":1,"status":2}`，
响应 `data` 是个整数（抓包为 `0`，表示无未读）。

#### `POST /itamp-asset/advice/queryAdviceInfo`
**干什么**：首页的意见反馈 / 建议提示。

```json
{ "infoStatus": "01", "infoUserId": "4711510", "flushFlag": "1" }
```

抓包返回 `data: []`。`infoStatus` 其他取值未抓到。

---

### 2.7 页面

#### `GET /asserInstruments/serviceSearchView`
**干什么**：SPA 页面入口（Vue 单页）。返回空壳 HTML + `app.b53531.js`。
登录成功后跳转到 `serviceSearchView?sessionid=...&statuscode=10000`。

---

## 三、字段陷阱清单

这些坑都是实测出来的，写业务代码时直接避开：

| 陷阱 | 说明 |
| --- | --- |
| **`code` 类型不统一** | 多数 `int 200`，但 `getInformationServerCoding` / `getHistoryDetail` / `conditions/subscribe` 是 `str "200"`。用 `Number()` 比较 |
| **响应四套结构** | A/B/C/D 型，见第一节。取值写 `json.data \|\| json.body \|\| json` |
| **`serviceStatus` 恒为 null** | 服务的真实基线在 **`offerServerState`** |
| **`batch` 恒为 null** | 真实批次在 **`sheetProductBatch`** |
| **`principal` / `principalName` / `implementationUnit` 全空** | 想筛负责人是筛不出来的 |
| **部门字段有两套** | `deptId`/`deptName` 和 `prodDeptId`/`prodDeptName`。列表筛选用 `deptId` |
| **订阅相关字段全为 null** | `subscriberStatus`、`subscriberId`、`subscriberComponentName` 在主列表里全是 null，订阅信息要去 `getPublishList` 查 |
| **`teamId` 才是部门 ID** | `getUserInfo` 里 `orgId`（1643A）是组织，`teamId`（1465A）才是部门 |
| **筛选用 `deptId` 不是 `deptName`** | 后端只认 ID |
| **token 12 小时过期** | 过期后全部接口认证失败 |
| **`getPublishDataList` 只认 17 个字段** | 传响应体字段名会被静默忽略，表现为「筛选条件全部失效」 |

---

## 四、本地调试

```bash
# 1. 启动代理（注入 token + CORS）
cd publish && node proxy.js
curl http://localhost:3000/health          # 确认代理活着

# 2. 打开页面
open index.html
```

代理把 `/publish/xxx` 映射到 `/itamp-tool/publish/xxx`。

> ⚠️ **页面不能直连 `itamp.bocsys.cn`** —— 页面是本地打开的，直连属于跨域，
> 浏览器会直接拦掉，表现为「列表一直空着」且控制台只有一句看不懂的 CORS 报错。
>
> 另外代理转发失败时的 502 **必须带 CORS 头**，否则浏览器只会报跨域错误，
> 真正的 `ENOTFOUND`（域名解析失败）被盖住，排查方向会跑偏。

---

## 五、还没抓到的

这些接口/参数在现有抓包里**没有样本**，需要时先补抓包，不要猜：

| 项 | 状态 |
| --- | --- |
| `getAsOrgList` 的非空响应 | 抓包返回 `[]` |
| `getOperationRecordList` / `getSubOperationRecordList` 的 `operationType` 取值字典 | 抓包传的是空字符串 |
| `getInfoBaseVersion` 的 `type` 除 `"02"` 外的取值 | 只抓到 `"02"` |
| `getHistoryDetail` 的 `revisionList` / `deployList` 结构 | 抓包样本为空数组 |
| `releaseNotice` 的 `status` 除 `2` 外的取值 | 只抓到 `2` |
| `queryAdviceInfo` 的 `infoStatus` 除 `"01"` 外的取值 | 只抓到 `"01"` |
| 服务发布数据查询页（非订阅页）自己的筛选字典接口 | 未抓到；`conditions/subscribe` 是订阅页的 |
| 服务的「订阅 / 取消订阅」写操作接口 | 抓包里只有查询，没有写操作 |

---

## 附：机器可读文档

字段级的明细表（每个字段的类型、是否必含、示例、中文说明）由 `har2doc.py` 生成：

```bash
python3 har2doc.py <file.har> -o output --format both      # har2doc.py 与本文件同目录
python3 har2doc.py 进入请求.har  -o output --format md --md-name "进入请求接口文档.md"
```

产物：

- `output/接口文档.md` —— trace.har 的 14 个接口
- `output/进入请求接口文档.md` —— 8 个接口
- `output/openapi.json` —— OpenAPI 3.0，可导入 Apifox / Postman

本文档负责讲清「接口是干嘛的 + 有什么坑」，字段明细查那三份。
