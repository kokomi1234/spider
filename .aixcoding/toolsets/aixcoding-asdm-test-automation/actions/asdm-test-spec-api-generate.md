# Instructions for s2e-api action

## Metadata

```json
{
   "guid": "d0e1f2a3-b4c5-6d7e-8f9a-0b1c2d3e4f5a",
   "name": "asdm-test-spec-api-generate",
   "displayName": "API 层示例生成",
   "description": "基于 User Story 卡片，直接扫描后端源码（Controller/DTO/Entity 类），以 HTTP 语义实例化验收标准，生成 API 层 Gherkin .feature 文件，覆盖接口契约测试、字段级边界值（源自 Bean Validation 注解）与错误码覆盖（源自异常处理源码）。输出文件携带 @layer:api 标签，与 @layer:ui（UI 层）区分，便于 CI 按测试金字塔分层筛选",
   "toolset": {
      "guid": "d4e5f6a7-b8c9-0d1e-2f3a-4b5c6d7e8f9a",
      "id": "asdm-test-automation",
      "name": "Test Automation",
      "version": "0.0.1"
   },
   "scenario": "需求实例化"
}
```

## Purpose

本指令引导 AI 模型基于 **User Story 卡片** 与**后端源码**（Controller、请求/响应 DTO、Entity、枚举类、全局异常处理类），以 **HTTP 语义**（请求方法、请求路径、请求体字段、响应状态码、响应体字段）实例化验收标准（AC），输出 API 层 Gherkin `.feature` 文件。

**重要**：本 action **直接扫描后端源码**提取端点定义与字段约束，**不依赖预先提取的 `api.md`/`data-models.md` 契约文档**。这样可以保证每次生成的 Scenario 都基于代码库当下的真实状态，避免契约文档滞后于代码导致的失真。

**与 `asdm-test-spec-ui-generate` 的关系**：

| 维度 | `asdm-test-spec-ui-generate`（UI 层） | `asdm-test-spec-api-generate`（API 契约层） |
|------|------------------------------|------------------------|
| 实例化词汇表 | 页面交互语言（"用户访问页面"、"用户查看列表项"） | HTTP 语义（"发送 POST /api/spaces"、"响应状态码为 400"） |
| 输入依赖 | User Story 卡片 + 前端源码（或前端上下文文档） | User Story 卡片 + **后端源码（Controller/DTO，必需）** |
| 颗粒度 | 1 条 AC → 1 个 Scenario | 1 条 AC → N 个场景组（契约 / 字段边界 / 错误码） |
| 实例化依据 | AC 语义 + 前端源码扫描结果 | AC 语义 + **后端源码中的方法签名与校验注解** |
| 层级标签 | `@layer:ui` | `@layer:api` |
| 输出文件 | `<story-id>.feature` | `<story-id>.api.feature` |

**核心差异**：API 层关心"源码里的端点实际接受什么、返回什么、校验什么"，UI 层关心"用户在页面上看到什么"。同一个 User Story 的同一条 AC，在两层用不同的词汇表实例化，产出两个独立的 `.feature` 文件，分别落在测试金字塔的不同层级，且各自的依据都来自当下的真实源码（前端源码 / 后端源码）。

本 action 是与 `asdm-test-spec-ui-generate` **平行的生成路径**，可独立执行。

## Language Setting

默认使用**中文（简体中文）**作为输出语言。所有生成的内容均使用中文，并遵循中文写作规范。HTTP 请求方法、状态码、字段名等技术术语保留英文原文。

如需切换语言，可在工作区根目录创建 `.aixcoding/config.json` 配置：
```json
{
  "language": "zh"
}
```
支持的语言：`zh`（中文，默认）、`en`（英文）。

## Context Injection

在开始生成之前，AI 模型必须读取 User Story 卡片，并直接扫描后端源码。**后端源码是本 action 的必需依赖，这是与 `asdm-test-spec-ui-generate` 最大的差异点。**

### Context Files to Read (Required)

1. **User Story 卡片** (Required - 必须读取)
   - Path: `.aixcoding/workspace/stories/<feature-id>/<us-id>.md`
   - Purpose: 获取 User Story 的用户故事和验收标准（AC），作为实例化的业务输入
   - **如果该文件不存在**：提示用户检查 User Story ID 是否正确，或该 User Story 卡片尚未生成

2. **后端源码仓库** (Required - 必须直接扫描) — 与 asdm-test-spec-ui-generate 的对应关系
   - Path: 用户指定的后端仓库根目录（或 `.aixcoding/config.json` 中配置的 `backendRepoPath`）
   - 扫描范围：
      - **Controller 类**：与 User Story 业务语义相关的类（按包名/类名/路由 path 关键字匹配），提取所有 `@GetMapping`/`@PostMapping`/`@PutMapping`/`@DeleteMapping` 等方法的 HTTP 方法、路径、参数（`@RequestBody`/`@PathVariable`/`@RequestParam`）与返回类型
      - **请求/响应 DTO 类**：Controller 方法签名中引用的 DTO/VO 类，提取字段列表、类型、Bean Validation 注解（`@NotBlank`/`@NotNull`/`@Size`/`@Min`/`@Max`/`@Pattern`/`@Email` 等）
      - **枚举类**：字段类型为枚举时，读取枚举类源码获取合法值全集
      - **全局异常处理类**（如 `@ControllerAdvice`/`@ExceptionHandler`）：确认错误响应体结构与状态码映射
   - Purpose: 作为端点定义与字段约束的**唯一权威依据**，替代预先提取的契约文档
   - **如果后端仓库路径不可访问，或在仓库中定位不到与 User Story 业务语义匹配的 Controller**：终止执行（见"错误处理"）

3. **API 层 .feature 文件规范** (Required - 必须遵循)
   - Path: `.aixcoding/toolsets/asdm-test-automation/spec/api-feature-spec.md`
   - Purpose: 遵循 API 层 .feature 文件的结构、HTTP 词汇表与场景组组织规范

### Context Files to Read (Recommended)

4. **Feature 准备文档** (Recommended - 按需)
   - Path: `.aixcoding/workspace/stories/<feature-id>/<feature-id>-FeaturePrep.md`
   - Purpose: 获取 Feature 的三要素分析（who/what/why）和假设约束，辅助理解业务语义与业务约束

5. **示例分析文档** (Recommended - 复用已有产出)
   - Path: `.aixcoding/workspace/specs/<feature-id>/<story-id>/<story-id>.example-analysis.md`
   - Purpose: 若已通过 `asdm-test-scenario-analyze` 产出，可复用其变量识别和数据需求清单，辅助理解业务语义；**字段类型与约束仍以源码扫描结果为准**，二者冲突时以源码为准
   - **如果该文件不存在**：不阻塞，本 action 基于源码独立实例化

6. **既有契约文档（可选交叉参考）**
   - Path: `.aixcoding/contexts/layer-2/api.md` / `.aixcoding/contexts/layer-2/data-models.md`
   - Purpose: 若存在，可作为源码扫描结果的交叉参考（例如帮助快速定位相关 Controller 所在模块），**但不作为字段约束与端点定义的最终依据**——一旦与本次源码扫描结果不一致，以本次扫描的源码为准

### Progressive Context Loading Strategy

1. **初始阶段**：读取 User Story 卡片，提取用户故事和 AC
2. **源码定位阶段**：根据 AC 业务语义，在后端源码仓库中定位相关 Controller 类
3. **源码提取阶段**：读取 Controller 方法签名（HTTP 方法、路径、参数、返回类型），追踪引用的 DTO/Entity/枚举类源码，提取字段与校验注解；读取全局异常处理类确认错误响应结构
4. **映射阶段**：将每条 AC 映射到 API 层场景组（契约 / 字段边界 / 错误码），确定 AC 与源码中实际方法的对应关系
5. **生成阶段**：基于源码提取的约束生成具体场景（场景 + DataTable + DocString），使用 HTTP 语义词汇
6. **标注阶段**：对源码中确实无法确定的精确值（如动态拼接的错误 message、依赖运行时配置的行为）标注为待人工确认

## Steps to API 层示例生成

### 1. 加载 User Story 卡片并定位后端源码

1. 接收用户指定的 User Story ID（如 `FT-001-US-01`）
2. 从 User Story ID 解析 Feature ID（如 `FT-001`）和 User Story 序号（如 `US-01`）
3. 读取 User Story 卡片，提取用户故事和验收标准（AC）列表
4. 在后端源码仓库中，根据 AC 业务语义（关键词、模块目录名、领域术语）定位相关 Controller 类文件

**如果 User Story ID 未指定**：
- 扫描 `.aixcoding/workspace/stories/` 目录
- 列出所有已有 Feature 下的 User Story（ID + 名称 + 状态）
- 提示用户选择要生成 API 层示例的 User Story

**如果后端仓库路径未提供或无法访问**：
- 提示用户："API 层示例生成依赖后端源码进行实例化，请提供后端仓库路径（或在 `.aixcoding/config.json` 中配置 `backendRepoPath`）。"
- 终止执行，不生成 .feature 文件

**如果在源码中定位不到与该 User Story 业务语义匹配的 Controller**：
- 提示用户确认该 User Story 关联的后端模块，或该 User Story 可能是纯前端展示逻辑，建议仅使用 `asdm-test-spec-ui-generate`
- 终止执行，不生成 .feature 文件

### 2. 扫描源码，建立 AC 与 API 端点的映射

这是 API 层实例化的关键步骤——不是机械地把每条 AC 翻译成一个 Scenario，而是逐个读取源码中的方法签名，分析 AC 背后涉及的真实接口实现。

#### 2.1 读取 Controller 方法签名，定位相关端点

逐条分析 AC，在定位到的 Controller 源码中找到支撑该 AC 的方法：

| AC | 业务语义 | 涉及方法（源码） | HTTP 方法+路径 | 请求体类型 | 响应类型 |
|----|----------|----------|--------|----------|----------|
| AC-1 | 展示团队空间列表 | `SpaceController#listSpaces` | GET /api/spaces | 无 | `List<SpaceResponse>` |
| AC-4 | 列表项信息展示 | `SpaceController#listSpaces`（响应体字段） | GET /api/spaces | 无 | `List<SpaceResponse>` |

映射时须记录方法在源码中的类名与方法名，作为后续来源标注的依据。

#### 2.2 识别 AC 的 API 层测试关注点

**关键设计点**：API 层测试的颗粒度通常不等于 UI 层 AC 的颗粒度。一条 AC 在 API 层可能拆成多个测试关注点：

| 测试关注点 | 标签 | 关注内容 | 示例 |
|------------|------|----------|------|
| **接口契约** | `@api:contract` | 请求/响应结构是否与源码方法签名一致，字段是否齐全，类型是否正确 | GET /api/spaces 返回数组，每项含 id/name/desc/role 字段（与 `SpaceResponse` 类字段逐一对应） |
| **字段级边界值** | `@api:boundary` | 请求体字段的长度边界、空值、枚举值、格式约束（**直接取自源码 Bean Validation 注解的参数值**） | `name` 长度恰好达到 `@Size(max=50)` 的 50、`description` 为空、`role` 传入枚举类之外的非法值 |
| **错误码覆盖** | `@api:error` | 认证失败(401)、权限不足(403)、资源不存在(404)、校验失败(400)、服务异常(500)，**状态码取自源码实际的异常处理逻辑** | 未携带 Token 返回 401（对应 `SecurityConfig`/过滤器逻辑）、无权限用户访问返回 403 |

一条 AC 可能同时涉及多个关注点，需为每个关注点生成独立的具体场景（或一组）。

#### 2.3 从源码提取字段约束

直接读取 Controller 方法引用的 DTO/Entity 类源码，提取字段的 Bean Validation 注解作为边界值设计依据：

| 字段 | 来源类型（源码类名） | 源码中的约束注解 | 边界值依据 |
|------|----------|------|-----------|
| name | `SpaceCreateRequest` | `@NotBlank @Size(max=50)` | 空值、50 字符、51 字符 |
| description | `SpaceCreateRequest` | `@Size(max=200)`（无 `@NotBlank`，可选） | 空字符串、200 字符、201 字符 |
| role | `SpaceResponse` | `enum RoleType { Owner, Admin, Member }` | 三个合法值各一例 |

**若源码中该字段确实没有校验注解**：如实标注"源码未定义校验约束，本项不生成对应的 boundary 场景"，不得凭业务常识臆造约束参数（如自行假设 `max=50`）。

### 3. 为每个测试关注点设计测试数据

#### 3.1 接口契约测试（`@api:contract`）

验证请求/响应结构符合源码方法签名：

- **正常契约**：合法请求 → 响应状态码 200 + 响应体包含源码 DTO 定义的所有字段且类型正确
- **响应结构**：列表接口返回 JSON 数组、分页接口返回含 items/total 的对象（若源码使用分页封装类）、详情接口返回单对象——具体结构以源码返回类型为准
- **字段完整性**：响应体包含源码 DTO 中定义的所有字段（不缺字段、不多字段）

设计 1-3 个正常契约用例，覆盖源码中定义的主要响应结构。

#### 3.2 字段级边界值测试（`@api:boundary`）

基于源码 DTO 类的字段约束注解，为请求体字段设计边界值：

- **必填字段**（`@NotBlank`/`@NotNull`）：合法值 / 空值 / null / 纯空格
- **长度约束**（`@Size`）：恰好 max / max+1 / 恰好 min / min-1（数值取自源码注解参数，不臆造）
- **枚举字段**：枚举类源码中每个合法值 / 非法枚举值 / 大小写差异（如源码区分大小写）
- **格式约束**（`@Email`/`@Pattern` 等）：符合格式 / 不符合格式
- **唯一性约束**（如源码 Service 层或数据库层有唯一校验逻辑）：不重复值 / 已存在值

**源码中确实无法确定的边界值**：
- 若约束存在于运行时逻辑（如 Service 层手写校验而非注解），需一并读取该段代码逻辑提取约束
- 若约束依赖外部配置（如从配置中心读取的阈值），标注为"依赖运行时配置，边界值待人工确认"，不臆造具体数值

#### 3.3 错误码覆盖测试（`@api:error`）

基于源码中全局异常处理类（`@ControllerAdvice`/`@ExceptionHandler`）与安全配置，覆盖典型错误码：

| 状态码 | 场景 | 实例化方式（依据源码） |
|--------|------|-----------|
| 400 | 请求体校验失败 | 发送违反字段约束注解的请求体，触发源码中 `MethodArgumentNotValidException` 等处理逻辑 |
| 401 | 未认证 | 不携带 Token / 携带无效 Token，触发源码中的认证过滤器逻辑 |
| 403 | 权限不足 | 以无权限用户身份访问，触发源码中的权限校验逻辑（如 `@PreAuthorize`） |
| 404 | 资源不存在 | 请求不存在的资源 ID，触发源码中抛出的 `NotFoundException` 等业务异常 |
| 409 | 唯一性冲突 | 提交与已有记录重复的唯一字段，触发源码中的唯一性校验逻辑 |
| 500 | 服务异常 | 仅在源码中能明确复现该异常路径时构造，否则标注为待源码走查确认，不在生成阶段强制构造 |

**预期结果**：响应状态码 + 错误响应体字段（如 `status`/`message`/`path`，结构须与源码全局异常处理类的实际返回体一致）。错误 message 的精确原文以源码中硬编码的文案为准；若为动态拼接（如包含具体字段名的模板文案），标注为待人工确认。

### 4. 生成具体场景（Scenario + DataTable + DocString），并标注源码来源

将测试数据组织为 Gherkin **具体场景**，使用英文关键字 + HTTP 语义词汇。**默认使用 `Scenario:`，不使用 `Scenario Outline:` + `Examples:` + `<占位符>` 模式。** 每个场景自包含完整业务数据：前置数据用 DataTable，请求/响应体用 DocString；每个场景上方标注对应的源码方法，便于溯源。

#### 4.1 HTTP 语义词汇表（英文关键字 + 引号内嵌参数）

| AC 步骤 | UI 层词汇（asdm-test-spec-ui-generate） | API 层词汇（asdm-test-spec-api-generate）       |
|---------|--------------------------|--------------------------------------------|
| Given | 用户已登录系统 | 请求认证状态为 "已登录" / "未登录" / "用户名/密码 错误"        |
| Given | 存在如下团队空间: + DataTable | 存在如下团队空间: + DataTable                      |
| When | 用户访问团队空间列表页面 | 发送 GET 请求 "/api/spaces"                    |
| When | 用户查看列表项 | 发送 POST 请求 "/api/spaces"，请求体如下 + DocString |
| Then | 系统展示团队空间列表 | 响应状态码为 200，And 返回如下团队空间列表 + DocString      |

**步骤参数规则**：
- 参数用双引号内嵌（如 `"/api/spaces"`、`"携带有效Token"`），不使用 `<占位符>`
- 状态码为数字，不加引号（如 `Then 响应状态码为 200`）
- 请求体/响应体用 DocString（`"""` 包裹完整 JSON），不内嵌在步骤文本中
- 路径、方法、状态码必须与源码扫描结果**完全一致**，不得四舍五入或简化

#### 4.2 场景结构（按测试关注点分组，含来源标注）

每条 AC 的每个测试关注点对应一个或多个**具体场景**：

```gherkin
# source: com.isoftstone.space.controller.SpaceController#listSpaces (GET /api/spaces)
@api:contract
@AC-1
Scenario: AC-1 接口契约 - 已登录用户查询团队空间列表
  Given 请求认证状态为 "已登录"
  And 存在如下团队空间:
    | id | name     | description | role   |
    | 1  | 研发团队空间 | 用于研发协作 | Owner  |
    | 2  | 产品团队空间 | 用于产品规划 | Member |
  When 发送 GET 请求 "/api/spaces"
  Then 响应状态码为 200
  And 返回如下团队空间列表
  """
  [
    {
      "id": 1,
      "name": "研发团队空间",
      "description": "用于研发协作",
      "role": "Owner"
    },
    {
      "id": 2,
      "name": "产品团队空间",
      "description": "用于产品规划",
      "role": "Member"
    }
  ]
  """
```

```gherkin
# source: com.isoftstone.space.dto.SpaceCreateRequest#name (@NotBlank @Size(max=50))
@api:boundary
@AC-4
Scenario: AC-4 字段边界 - 创建空间时 name 为空
  Given 请求认证状态为 "已登录"
  When 发送 POST 请求 "/api/spaces"，请求体如下
  """
  {
    "name": "",
    "description": "用于研发协作"
  }
  """
  Then 响应状态码为 400
```

```gherkin
# source: com.isoftstone.space.controller.SpaceController#listSpaces (GET /api/spaces)；401 依据 JwtAuthenticationFilter 逻辑
@api:error
@AC-1
Scenario: AC-1 错误码 - 未携带Token访问返回401
  Given 请求认证状态为 "未登录"
  When 发送 GET 请求 "/api/spaces"
  Then 响应状态码为 401
  And 响应体包含 message 字段
```

#### 4.3 场景编写规则

- 使用具体场景 `Scenario:`，每个场景自包含完整业务数据（DataTable + DocString）
- 前置数据用 DataTable（`Given 存在如下团队空间:` + 表格），替代模糊的数量描述
- 请求体用 DocString（`When 发送 POST 请求 "...", 请求体如下` + `"""JSON"""`）
- 响应体用 DocString（`And 返回如下团队空间列表` + `"""JSON"""`），便于 Step Definition 结构化比对
- 步骤参数用双引号内嵌（如 `"/api/spaces"`、`"携带有效Token"`），不使用 `<占位符>` + Examples 表格
- 边界值/异常值为每个边界/异常情况生成独立场景，而非用 Examples 行罗列
- 每个场景上方以 `# source:` 注释标注对应的源码类名/方法名/字段约束注解，便于后续核对与测试代码生成时定位真实方法

### 5. 组装 API 层 .feature 文件

#### 5.1 文件结构

```gherkin
@<us-id>
@layer:api
Feature: <User Story 名称> - API 层

  作为 <用户角色>，
  我想要 <功能意图>，
  以便 <业务价值>。

  # 本 .feature 文件由 asdm-test-spec-api-generate 基于后端源码直接扫描生成，以 HTTP 语义实例化验收标准
  # 测试关注点: 接口契约(@api:contract) / 字段边界(@api:boundary) / 错误码(@api:error)
  # 依赖后端源码: <Controller/DTO 文件路径列表>

  Background:
    Given 请求基础地址为 "<base_url>"

  # ========== AC-1: <AC 标题> ==========

  # source: <Controller 类名#方法名>
  @api:contract
  @AC-1
  Scenario: AC-1 接口契约 - <端点描述>
    Given 请求认证状态为 "<auth_state>"
    And 存在如下<资源>:
      | id | name     | description | role   |
      | 1  | 研发团队空间 | 用于研发协作 | Owner  |
    When 发送 GET 请求 "/api/spaces"
    Then 响应状态码为 200
    And 返回如下团队空间列表
    """
    [
      {
        "id": 1,
        "name": "研发团队空间",
        "description": "用于研发协作",
        "role": "Owner"
      }
    ]
    """

  # source: <Controller 类名#方法名>；401 依据 <认证过滤器类名>
  @api:error
  @AC-1
  Scenario: AC-1 错误码 - <错误场景描述>
    Given 请求认证状态为 "未登录"
    When 发送 GET 请求 "/api/spaces"
    Then 响应状态码为 401
    And 响应体包含 message 字段

  # ========== AC-4: <AC 标题> ==========

  # source: <DTO 类名#字段名（校验注解）>
  @api:boundary
  @AC-4
  Scenario: AC-4 字段边界 - <字段约束描述>
    Given 请求认证状态为 "已登录"
    When 发送 POST 请求 "/api/spaces"，请求体如下
    """
    {
      "name": "<边界值>",
      "description": "用于研发"
    }
    """
    Then 响应状态码为 <status_code>
```

**Key Elements**:
- 文件级 Tag：`@<us-id>` + `@layer:api`（与 UI 层的 `@layer:ui` 区分）
- 场景级 Tag：`@api:contract` / `@api:boundary` / `@api:error`（标识测试关注点）+ `@AC-<编号>`（关联 AC）
- 每个场景上方 `# source:` 标注对应的源码类名/方法名/字段约束
- Background：所有 Scenario 共享的请求基础地址等公共前置
- 使用具体场景 `Scenario:`，前置数据用 DataTable，请求/响应体用 DocString
- 文件头注释：标注生成工具、依赖的具体源码文件、更新方式

#### 5.2 CI 分层筛选

层级标签与关注点标签支持 Cucumber 按 tag 表达式筛选：
- 仅跑 API 层：`--tags @layer:api`
- 仅跑 UI 层：`--tags @layer:ui`
- 仅跑 API 契约测试：`--tags @api:contract`
- 排除某层：`--tags "not @layer:ui"`

### 6. 测试数据合理性自检

生成 .feature 文件后，进行合理性自检：

#### 6.1 源码一致性校验（替代原"契约一致性校验"，重要）
- Scenario 中的端点路径/HTTP 方法是否与源码 `@XxxMapping` 注解定义**逐一核对一致**？
- 请求体字段名/类型是否与源码 DTO 类字段定义一致（含大小写、驼峰命名）？
- 边界值数值是否**精确取自**源码 Bean Validation 注解的参数（如 `@Size(max=50)` → 50/51），而非估算或臆造？
- 响应体断言是否与源码方法返回类型的字段一致？
- 错误码场景的状态码是否对应源码中实际存在的异常处理逻辑，而非泛泛套用通用 HTTP 语义？
- 每个 Scenario 是否都有 `# source:` 来源标注？

#### 6.2 覆盖完整性校验
- 每条涉及接口的 AC 是否都有对应的 API 层 Scenario？
- 涉及字段约束的端点是否覆盖了 contract / boundary / error 三个关注点（如适用）？
- 枚举类型字段是否每个合法值都有用例（数值取自源码枚举类定义）？
- 必填字段（源码标注 `@NotBlank`/`@NotNull`）是否覆盖了空值异常用例？

#### 6.3 待源码验证项标注校验
- 依赖运行时配置或动态逻辑、无法从静态源码确定的精确约束是否已标注待人工确认？
- 错误 message 若为动态拼接（非源码硬编码原文）的，是否已标注？

### 7. 保存 .feature 文件

将生成的 API 层 .feature 文件保存到：
`.aixcoding/workspace/specs/<feature-id>/<story-id>/<story-id>.api.feature`

**文件命名**：使用 User Story ID（`<us-id>`）+ `.api` 后缀，与 UI 层的 `<story-id>.feature` 共存于同一目录，如 `FT-001-US-02.api.feature`。

### 8. 呈现生成摘要

向用户展示生成阶段的产出摘要：

```markdown
# API 层示例生成完成

## User Story 信息
- **User Story ID**: <us-id>
- **User Story 名称**: <name>
- **AC 数量**: <数量>

## 源码扫描依据
- **扫描的 Controller**: <类名列表>
- **扫描的 DTO/Entity/枚举类**: <类名列表>
- **涉及端点**: <数量> 个（<端点列表摘要>）

## 生成结果
- ** Scenario 总数**: <数量>
  - 接口契约测试 (@api:contract): <数量> 个
  - 字段级边界值 (@api:boundary): <数量> 个
  - 错误码覆盖 (@api:error): <数量> 个

## 待源码验证项
- **依赖运行时配置/无法静态确定的约束**: <数量> 个（已标注待人工确认）
- **待确认的动态错误 message**: <数量> 个（已标注待人工确认）

## 生成文件
- API 层 Gherkin 文件: `.aixcoding/workspace/specs/<feature-id>/<story-id>/<story-id>.api.feature`

## 下一步
1. 执行 `/asdm-test-spec-validate <us-id>` 校验 Gherkin 语法和测试覆盖率
2. CI 集成时，使用 `--tags @layer:api` 筛选执行 API 层测试
```

## Execution Guidelines

### When to Use This Action

使用本 action 的场景：
- User Story 卡片已生成（位于 `.aixcoding/workspace/stories/<feature-id>/<us-id>.md`）
- 对应的后端 Controller/DTO **源码已实现**且可访问
- 需要以 HTTP 语义实例化验收标准，生成与代码库当下真实状态一致的 API 层（测试金字塔中层）`.feature` 文件
- 需要与 UI 层（`asdm-test-spec-ui-generate`）分层，CI 按测试金字塔分层执行

**不适用场景**：后端接口尚未实现的前置探索阶段。若 Controller/DTO 源码尚不存在，本 action 无法进行有依据的实例化，将终止执行。

### 与 asdm-test-spec-ui-generate 的选择

| 场景 | 推荐 action |
|------|------------|
| 生成 UI 层测试（页面交互语义，依据前端源码） | `asdm-test-spec-ui-generate` |
| 生成 API 契约层测试（HTTP 语义，依据后端源码） | `asdm-test-spec-api-generate` |
| 两层都需要 | 两个 action 各执行一次，产出 `<story-id>.feature`（UI 层）和 `<story-id>.api.feature`（api） |

### 实例化原则

1. **源码驱动**：测试数据与字段约束直接基于后端源码（Controller/DTO/枚举类/异常处理类）扫描结果生成，而非预先提取的契约文档或凭空臆造
2. **关注点分离**：一条 AC 按测试关注点（契约/边界/错误码）拆分为多个具体场景，而非强制 1:1
3. **具体场景优先**：使用 `Scenario:`，每个场景自包含完整业务数据（DataTable + DocString），不使用 `Scenario Outline:` + `Examples:` + `<占位符>` 模式
4. **引号内嵌参数**：步骤参数用双引号内嵌（如 `"/api/spaces"`），不使用 `<占位符>`
5. **DocString 提供完整 JSON**：请求体/响应体用 `"""` 包裹完整 JSON，便于 Step Definition 结构化比对
6. **HTTP 语义**：Given/When/Then 全部使用 HTTP 请求/响应词汇，不出现页面交互语言
7. **层级标签**：必须携带 `@layer:api`，与 `@layer:ui` 区分
8. **来源可溯**：每个场景标注 `# source:` 注释，指向具体的源码类名/方法名/字段约束，无法静态确定的项标注待人工确认，不臆造

### 错误处理

- **User Story 卡片不存在**：提示用户该 User Story 卡片尚未生成，需先完成 User Story 拆分
- **后端仓库路径未提供或无法访问**：提示用户提供后端仓库路径（或配置 `backendRepoPath`），终止执行
- **在源码中定位不到与该 User Story 匹配的 Controller**（可能是纯前端展示逻辑）：提示用户该 User Story 可能不适合生成 API 层示例，建议仅用 `asdm-test-spec-ui-generate`
- **AC 无法映射到源码中的具体方法**：在摘要中标注该 AC 跳过原因，不强制生成空场景
- **DTO/Entity 引用了无法读取源码的外部依赖**（如第三方 jar 包类）：标注待人工确认，基于方法签名可见的字段名与类型做最小假设

## Usage

To use this instruction, the AI model should:
1. 检测响应语言
2. 接收用户指定的 User Story ID
3. 读取 User Story 卡片，提取用户故事和 AC
4. 在后端源码仓库中定位相关 Controller 类，若找不到则提示并终止
5. 读取 Controller 方法签名，追踪 DTO/Entity/枚举类源码，提取字段类型与 Bean Validation 校验注解
6. 读取全局异常处理类，确认错误响应体结构与状态码映射
7. 建立 AC 与源码方法的映射，识别每条 AC 的测试关注点（契约/边界/错误码）
8. 为每个测试关注点设计测试数据，边界值精确取自源码注解参数，使用 HTTP 语义词汇
9. 对源码中无法静态确定的精确约束标注为待人工确认，不臆造
10. 生成**具体场景**（`Scenario:` + DataTable + DocString），按测试关注点分组，标注 `# source:` 来源注释，**不使用** `Scenario Outline:` + `Examples:` + `<占位符>`
11. 组装完整的 API 层 Gherkin .feature 文件：英文关键字（无需 `# language: zh-CN`），携带 `@layer:api` 标签
12. 进行测试数据合理性自检（含 §6.1 源码一致性校验）
13. 保存 .feature 文件
14. 呈现生成摘要并提示下一步

## Output Summary

完成生成阶段后，将生成以下产出：
- API 层 Gherkin `.feature` 文件：`.aixcoding/workspace/specs/<feature-id>/<story-id>/<story-id>.api.feature`

所有文件保存在 `.aixcoding/workspace/specs/<feature-id>/<story-id>/` 目录下。

### Downstream Flow

```text
后端 Controller/DTO 源码已实现  ← 前置条件（直接扫描后台源码，不依赖契约文档）
        │
        ▼
/asdm-test-spec-api-generate <us-id>                 ← 当前步骤：直接扫描后端源码，生成 API 层 Gherkin .feature 文件（HTTP 语义）
        │
        ├─ 与 /asdm-test-spec-ui-generate <us-id> 平行（可同时产出 UI 层 + api 层两份 .feature，分别依据前端/后端源码）
        │
        ▼
/asdm-test-spec-validate <us-id>            ← 校验 Gherkin 语法与覆盖率（含 @layer:api 标签校验）
        │
        ▼
/asdm-test-code-generate       ← 下一步：基于 .feature 文件生成可执行测试代码
```