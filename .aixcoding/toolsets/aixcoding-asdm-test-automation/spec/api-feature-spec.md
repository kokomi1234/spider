# API 层 Gherkin .feature 文件规范

## Language Guidelines

本规范定义的文档必须使用环境检测到的响应语言。确保文档中所有内容遵循：

1. **语言一致性**: 步骤描述使用中文，HTTP 方法/状态码/字段名等技术术语保留英文原文
2. **写作规范**: 遵循所使用语言的写作风格和格式要求
3. **表达清晰**: 确保内容在所选语言下清晰易懂

**支持的语言**:
- 中文（zh，默认）
- 英文（en）
- 其他基于环境检测的语言

---

## Overview

本规范定义了 **API 层** Gherkin `.feature` 文件的结构和语法要求。此类文件是 `asdm-test-spec-api-generate` action 的核心输出，采用 Cucumber 兼容的 Gherkin 语法，以 **HTTP 语义**（请求方法、路径、请求体、响应状态码、响应体）实例化 User Story 的验收标准（AC），产出测试金字塔中 API 契约层的自动化测试场景。

**与 `feature-file-spec.md` 的关系**：
- `feature-file-spec.md`：定义 UI 层（`@layer:ui`）`.feature` 文件规范，使用页面交互词汇
- `api-feature-spec.md`（本文件）：定义 API 契约层（`@layer:api`）`.feature` 文件规范，使用 HTTP 词汇
- 两份规范均**不使用** `Scenario Outline + Examples + <占位符>` 模式，而是使用具体场景 `Scenario:`；差异在于词汇表、颗粒度映射和数据组织方式（本层额外使用 DocString 传递 JSON 请求/响应体）

**关键原则**:
- 依赖**后端源码**（Controller / 请求·响应 DTO / Entity / 枚举 / 全局异常处理类）作为实例化依据，`asdm-test-spec-api-generate` 直接扫描后端源码提取端点定义与字段约束，**不依赖预先提取的 `api.md`/`data-models.md` 契约文档**，保证生成的 Scenario 基于代码库当下的真实状态
- 一条 AC 按测试关注点拆分为多个**具体场景**（契约 / 字段边界 / 错误码），而非强制 1:1
- 使用 `Scenario:`，**不使用** `Scenario Outline:` + `Examples:` + `<占位符>`；每个场景自包含完整业务数据
- 前置数据用 DataTable，请求体/响应体用 DocString（`"""` 包裹完整 JSON），步骤参数用双引号内嵌（如 `"/api/spaces"`），不使用 `<占位符>`
- Given/When/Then 全部使用 HTTP 请求/响应词汇，不出现页面交互语言
- 必须携带 `@layer:api` 层级标签，与 `@layer:ui` 区分，支持 CI 按测试金字塔分层筛选
- 源码无法静态确定的精确约束使用假设值，以注释标注为待人工确认

---

## Document Structure

使用以下模板结构生成 API 层 Gherkin `.feature` 文件：

```gherkin
@<us-id>
@layer:api
Feature: <User Story 名称> - API 层

  作为 <用户角色>，
  我想要 <功能意图>，
  以便 <业务价值>。

  # 本 .feature 文件由 asdm-test-spec-api-generate 生成，以 HTTP 语义实例化验收标准
  # 测试关注点: 接口契约(@api:contract) / 字段边界(@api:boundary) / 错误码(@api:error)
  # 依赖后端源码: <Controller/DTO 文件路径列表>

  Background:
    Given 请求基础地址为 "<base_url>"

  # ========== AC-1: <AC 标题> ==========

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

  @api:error
  @AC-1
  Scenario: AC-1 错误码 - <错误场景描述>
    Given 请求认证状态为 "未登录"
    When 发送 GET 请求 "/api/spaces"
    Then 响应状态码为 401
    And 响应体包含 message 字段

  # ========== AC-4: <AC 标题> ==========

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
- 文件级 Tag：`@<us-id>` + `@layer:api`
- Feature 声明：Feature 名称标注"API 层"，含 User Story 用户故事描述
- 文件头注释：标注生成工具、测试关注点图例、依赖的后端源码文件路径
- Background：所有 Scenario 共享的请求基础地址等公共前置
- 场景级 Tag：`@api:<关注点>`（`contract`/`boundary`/`error`）+ `@AC-<编号>`
- `Scenario`（**非** `Scenario Outline`）：每个测试关注点对应一个或多个具体场景
- 前置数据用 DataTable，请求体/响应体用 DocString（`"""JSON"""`）
- 步骤参数用双引号内嵌，不使用 `<占位符>` + `Examples` 表格

---

## Section Guidelines

### 1. Layer 标签（与 UI 层区分的统一约定）

**层级标签是 API 层与 UI 层 .feature 文件的核心区分机制**，支持 CI 按测试金字塔分层筛选执行。

| 层级标签 | 位置 | 适用 action | 含义 |
|----------|------|------------|------|
| `@layer:api` | Feature 上方（文件级） | `asdm-test-spec-api-generate` | API 契约层测试，HTTP 语义 |
| `@layer:ui` | Feature 上方（文件级） | `asdm-test-spec-ui-generate` | UI 层测试，页面交互语义 |

**CI 分层筛选示例**（Cucumber `--tags` 表达式）：
- 仅跑 API 层：`--tags @layer:api`
- 仅跑 UI 层：`--tags @layer:ui`
- 全量执行：不传 tag 或 `--tags "@layer:api or @layer:ui"`
- 排除某层：`--tags "not @layer:ui"`

### 2. Feature 声明

**要求**：
- 文件必须以 `Feature:` 关键字开头
- Feature 名称使用 User Story 名称并标注"API 层"
- Feature 声明上方必须有文件级 Tag `@<us-id>` + `@layer:api`
- Feature 描述包含 User Story 的用户故事（作为…我想要…以便…）
- Feature 下方需有文件头注释，标注生成工具、测试关注点图例、依赖的后端源码文件路径

**语法**：
```gherkin
@FT-001-US-01
@layer:api
Feature: 团队空间列表视图 - API 层

  作为一个团队创建者，
  我想要查看我参与的团队空间列表，
  以便选择进入某个空间或创建新的团队空间。

  # 本 .feature 文件由 asdm-test-spec-api-generate 生成，以 HTTP 语义实例化验收标准
  # 测试关注点: 接口契约(@api:contract) / 字段边界(@api:boundary) / 错误码(@api:error)
  # 依赖后端源码: <Controller/DTO 文件路径列表>
```

### 3. Background

**要求**：
- 如果多个 Scenario 共享相同的前置条件（如请求基础地址），使用 Background 提取
- Background 必须位于所有 Scenario 之前
- Background 中的步骤参数使用双引号内嵌具体值，不使用占位符
- 如果没有公共前置条件，可省略 Background

**语法**：
```gherkin
Background:
  Given 请求基础地址为 "http://localhost:8080"
```

### 4. 测试关注点分组

**核心设计**：API 层测试的颗粒度不等于 UI 层 AC 的颗粒度。一条 AC 在 API 层按测试关注点拆分为多个具体场景（`Scenario:`）。

| 关注点标签 | 含义 | 关注内容 |
|-----------|------|----------|
| `@api:contract` | 接口契约测试 | 请求/响应 schema 是否符合约定，字段是否齐全、类型正确 |
| `@api:boundary` | 字段级边界值 | 请求体字段的长度边界、空值、枚举值、格式约束 |
| `@api:error` | 错误码覆盖 | 认证失败(401)、权限不足(403)、资源不存在(404)、校验失败(400)等 |

**拆分原则**：
- 一条 AC 可能同时涉及多个关注点，为每个关注点生成独立的 `Scenario:`（一个或多个）
- 纯展示类 AC（如"列表项信息展示"）在 API 层体现为响应体字段的契约测试（`@api:contract`）
- 涉及输入校验的 AC 同时需要字段边界测试（`@api:boundary`）和错误码测试（`@api:error`）
- 若某关注点不适用于某 AC，可跳过，不强求三关注点全覆盖

### 5. HTTP 语义词汇表（英文关键字 + 引号内嵌参数）

| AC 步骤 | UI 层词汇（`feature-file-spec.md`） | API 层词汇（本规范） |
|---------|--------------------------|--------------------------------------------|
| Given | 用户已登录系统 | 请求认证状态为 "已登录" / "未登录" / "用户名/密码 错误" |
| Given | 存在如下团队空间: + DataTable | 存在如下团队空间: + DataTable |
| When | 用户访问团队空间列表页面 | 发送 GET 请求 "/api/spaces" |
| When | 用户查看列表项 | 发送 POST 请求 "/api/spaces"，请求体如下 + DocString |
| Then | 系统展示团队空间列表 | 响应状态码为 200，And 返回如下团队空间列表 + DocString |

**步骤参数规则**：
- 参数用双引号内嵌（如 `"/api/spaces"`、`"已登录"`），**不使用** `<占位符>`
- 状态码为数字，不加引号（如 `Then 响应状态码为 200`）
- 请求体/响应体用 DocString（`"""` 包裹完整 JSON），不内嵌在步骤文本中

### 6. Scenario（具体场景，非 Scenario Outline）

**要求**：
- 使用 `Scenario:` 关键字，**不使用** `Scenario Outline:`
- 场景描述格式：`AC-<编号> <关注点> - <具体场景描述>`
- 每个 Scenario 上方必须有 `@api:<关注点>` + `@AC-<编号>` Tag
- 每个场景自包含完整业务数据：前置数据用 DataTable，请求体/响应体用 DocString

**接口契约场景语法**：
```gherkin
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
    { "id": 1, "name": "研发团队空间", "description": "用于研发协作", "role": "Owner" },
    { "id": 2, "name": "产品团队空间", "description": "用于产品规划", "role": "Member" }
  ]
  """
```

**字段边界场景语法**：
```gherkin
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

**错误码场景语法**：
```gherkin
@api:error
@AC-1
Scenario: AC-1 错误码 - 未携带Token访问返回401
  Given 请求认证状态为 "未登录"
  When 发送 GET 请求 "/api/spaces"
  Then 响应状态码为 401
  And 响应体包含 message 字段
```

### 7. DataTable 与 DocString 使用规范

**要求**：
- **前置数据（Given）**：涉及多条/多字段前置资源时，使用 DataTable（`Given 存在如下团队空间:` + 表格），替代模糊的数量描述
- **请求体（When）**：使用 DocString（`When 发送 POST 请求 "..."，请求体如下` + `"""JSON"""`）
- **响应体（Then）**：使用 DocString（`Then 返回如下团队空间列表` + `"""JSON"""`），便于 Step Definition 结构化比对（如 `json.loads` 后逐字段断言）
- DocString 中的 JSON 必须合法可解析，字段名与源码 DTO 类字段一致（含大小写、驼峰命名）
- **不使用** `<占位符>` + `Examples` 表格：边界值/异常值为每个边界/异常情况生成独立场景

### 8. 待人工确认标注

**要求**：
- 源码无法静态确定的精确约束（如依赖运行时配置/动态拼接的错误 message）的边界值/错误码场景上方必须添加注释标注待人工确认
- 注释格式：`# 待人工确认: <说明需校正的内容>`
- 文件头部添加注释说明文件状态（由 `asdm-test-spec-api-generate` 生成）

**示例**：
```gherkin
# 待人工确认: name 最大长度需根据源码 @Size 注解校正，当前依据扫描结果假设为 50
@api:boundary
@AC-4
Scenario: AC-4 字段边界 - 创建空间时 name 超过最大长度
  Given 请求认证状态为 "已登录"
  When 发送 POST 请求 "/api/spaces"，请求体如下
  """
  {
    "name": "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwx",
    "description": "用于研发协作"
  }
  """
  Then 响应状态码为 400
```

### 9. Tag 使用规范

**Tag 体系**：

| Tag | 位置 | 用途 |
|-----|------|------|
| `@<us-id>` | Feature 上方 | 按 User Story 过滤执行 |
| `@layer:api` | Feature 上方 | 按 API 契约层过滤（测试金字塔分层） |
| `@layer:ui` | Feature 上方 | 按 UI 层过滤（`asdm-test-spec-ui-generate` 产出） |
| `@AC-<编号>` | Scenario 上方 | 按 AC 过滤执行 |
| `@api:contract` | Scenario 上方 | 仅执行接口契约测试 |
| `@api:boundary` | Scenario 上方 | 仅执行字段级边界值测试 |
| `@api:error` | Scenario 上方 | 仅执行错误码覆盖测试 |

---

## Gherkin 关键字参考

| 关键字 | 用途 | 使用场景 |
|--------|------|----------|
| `Feature` | 功能描述 | 文件顶部，含 User Story 用户故事（标注"API 层"） |
| `Background` | 公共前置条件 | 所有 Scenario 共享的请求基础地址等 |
| `Scenario` | 具体场景 | 每个测试关注点对应一个或多个，数据自包含 |
| `Given` | 前置条件 | 请求认证状态、系统前置数据（DataTable） |
| `When` | 操作动作 | 发送 HTTP 请求，请求体用 DocString |
| `Then` | 预期结果 | 响应状态码、响应体结构/字段断言，响应体用 DocString |
| `And` | 补充步骤 | 多个 Given/When/Then 之间的连接 |
| DataTable | 内联前置数据 | 紧跟 Given 步骤下方，用于多条/多字段前置资源 |
| DocString | 内联请求/响应体 | 紧跟 When/Then 步骤下方，`"""` 包裹完整 JSON |

> **不使用** `Scenario Outline` 和 `Examples`：本规范使用具体场景，测试数据通过 DataTable/DocString 自包含在每个 Scenario 中。

---

## Usage Guidelines

生成 API 层 Gherkin `.feature` 文件时：

1. **加载 User Story 与源码**：读取 User Story 卡片并直接扫描后端源码（Controller/DTO/枚举/异常处理类）
2. **建立 AC-端点映射**：定位每条 AC 涉及的 API 端点，识别测试关注点（契约/边界/错误码）
3. **提取字段约束**：从源码 DTO/Entity 类的 Bean Validation 注解与枚举类提取字段约束，作为边界值设计依据
4. **设计测试数据**：按契约/边界/错误码三个关注点设计测试数据
5. **编写 Scenario**：使用 HTTP 语义词汇编写具体场景，前置数据用 DataTable，请求/响应体用 DocString
6. **组装文件**：添加 Feature 声明、文件头注释、Background、层级标签 `@layer:api`
7. **自检源码一致性**：校验端点路径、字段、状态码与后端源码一致

**重要**：
- 步骤参数使用双引号内嵌具体值，不使用 `<占位符>`
- 每条涉及接口的 AC 至少有一个对应的 API 层 `Scenario`
- 必须携带 `@layer:api` 标签
- 测试数据必须基于后端源码，不可臆造
- 源码无法静态确定的精确约束必须标注待人工确认

---

## Output Format

**格式**: Gherkin（纯文本，UTF-8 编码）
**位置**: `.aixcoding/workspace/specs/<feature-id>/<story-id>/<story-id>.api.feature`
**命名**: 使用 User Story 名称（kebab-case 英文）+ `.api` 后缀，如 `team-space-list-view.api.feature`（与 UI 层的 `team-space-list-view.feature` 共存）

**格式细节**:
- 文件扩展名：`.api.feature`
- 编码：UTF-8（支持中文步骤描述）
- 缩进：2 个空格（Gherkin 惯例）
- 表格列对齐：使用空格对齐 `|` 分隔符
- DocString 内的 JSON 保持标准缩进（2 空格），便于阅读

---

## Complete Example

以下是一个完整的 API 层 `.feature` 文件示例，基于 User Story `FT-001-US-01`（团队空间列表视图）：

```gherkin
@FT-001-US-01
@layer:api
Feature: 团队空间列表视图 - API 层

  作为一个团队创建者，
  我想要查看我参与的团队空间列表，
  以便选择进入某个空间或创建新的团队空间。

  # 本 .feature 文件由 asdm-test-spec-api-generate 生成，以 HTTP 语义实例化验收标准
  # 测试关注点: 接口契约(@api:contract) / 字段边界(@api:boundary) / 错误码(@api:error)
  # 依赖后端源码: <Controller/DTO 文件路径列表>

  Background:
    Given 请求基础地址为 "http://localhost:8080"

  # ========== AC-1: 展示团队空间列表 ==========

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
      { "id": 1, "name": "研发团队空间", "description": "用于研发协作", "role": "Owner" },
      { "id": 2, "name": "产品团队空间", "description": "用于产品规划", "role": "Member" }
    ]
    """

  @api:error
  @AC-1
  Scenario: AC-1 错误码 - 未携带Token访问返回401
    Given 请求认证状态为 "未登录"
    When 发送 GET 请求 "/api/spaces"
    Then 响应状态码为 401
    And 响应体包含 message 字段

  # ========== AC-4: 列表项信息展示 ==========

  @api:contract
  @AC-4
  Scenario: AC-4 接口契约 - 列表项响应体字段完整性
    Given 请求认证状态为 "已登录"
    And 存在如下团队空间:
      | id | name         |
      | 1  | 研发团队空间 |
    When 发送 GET 请求 "/api/spaces"
    Then 响应状态码为 200
    And 返回如下团队空间列表
    """
    [
      { "id": 1, "name": "研发团队空间", "description": "用于研发协作", "role": "Owner" }
    ]
    """

  # 待人工确认: name 最大长度需根据源码 @Size 注解校正，当前依据扫描结果假设为 50
  @api:boundary
  @AC-4
  Scenario: AC-4 字段边界 - 创建空间时 name 超过最大长度
    Given 请求认证状态为 "已登录"
    When 发送 POST 请求 "/api/spaces"，请求体如下
    """
    {
      "name": "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwx",
      "description": "用于研发协作"
    }
    """
    Then 响应状态码为 400

  @api:error
  @AC-4
  Scenario: AC-4 错误码 - 创建空间时唯一性冲突
    Given 请求认证状态为 "已登录"
    And 存在如下团队空间:
      | id | name         |
      | 1  | 研发团队空间 |
    When 发送 POST 请求 "/api/spaces"，请求体如下
    """
    {
      "name": "研发团队空间",
      "description": "重复名称"
    }
    """
    Then 响应状态码为 409
    And 响应体包含 message 字段
```

---

## Best Practices

编写 API 层 Gherkin `.feature` 文件时：

1. **源码驱动数据**：测试数据基于后端源码生成，端点路径、字段、状态码必须与源码 `@XxxMapping`/DTO 一致
2. **关注点分离**：一条 AC 按测试关注点拆分，契约/边界/错误码各自独立 `Scenario`
3. **HTTP 语义一致**：Given/When/Then 全部使用 HTTP 词汇，不混入页面交互语言
4. **具体场景优先**：使用 `Scenario:`，每个场景自包含完整业务数据（DataTable + DocString）
5. **层级标签必备**：必须携带 `@layer:api`，支持 CI 分层筛选
6. **Background 复用**：请求基础地址等公共前置提取到 Background
7. **假设值标注**：源码无法静态确定的精确约束必须标注待人工确认（依赖运行时配置/动态逻辑）

### Common Pitfalls to Avoid

- **误用 Scenario Outline**：本规范使用具体场景 `Scenario:` + DataTable/DocString，不使用 `Scenario Outline` + `Examples` + `<占位符>`
- **混用词汇表**：API 层 .feature 中出现"用户访问页面"等 UI 词汇，应改用"发送 GET 请求"
- **强制 1:1 映射**：将每条 AC 机械翻译成一个 Scenario，忽略了契约/边界/错误码的拆分
- **缺少层级标签**：未标注 `@layer:api`，导致 CI 无法按测试金字塔分层筛选
- **与源码不一致**：端点路径或字段名与后端源码 `@XxxMapping` / DTO 定义不符
- **假设值未标注**：源码无法静态确定的精确约束使用假设值但未标注待人工确认
- **错误码无响应断言**：错误码场景只断言状态码，未断言错误响应体结构
- **DocString JSON 不合法**：请求体/响应体的 JSON 格式错误，无法被 `json.loads` 解析

---

## Related Documents

本规范模板与以下文件配合使用：

- **feature-file-spec.md**: UI 层（`@layer:ui`）.feature 文件规范，由 `asdm-test-spec-ui-generate` 使用
- **example-analysis-spec.md**: 示例分析文档规范，可为本 action 提供变量识别参考（可选）

本规范被以下 action 使用：

- **Action: asdm-test-spec-api-generate**: 生成 API 层 Gherkin `.feature` 文件时遵循本规范
- **Action: asdm-test-spec-validate**: 校验 API 层 `.feature` 文件时读取本规范定义的结构和语法要求

---

## Checklist

完成 API 层 Gherkin `.feature` 文件前，检查：

- [ ] 文件以 `Feature:` 开头，上方有 `@<us-id>` + `@layer:api` Tag
- [ ] Feature 名称标注"API 层"，描述包含 User Story 用户故事
- [ ] Feature 下方有文件头注释（生成工具、测试关注点图例、依赖的后端源码文件路径）
- [ ] Background（如有）位于所有 Scenario 之前，参数用双引号内嵌
- [ ] 每条涉及接口的 AC 有对应的 API 层 `Scenario`（非 `Scenario Outline`）
- [ ] 每个 Scenario 上方有 `@api:<关注点>` + `@AC-<编号>` Tag
- [ ] Given/When/Then 全部使用 HTTP 语义词汇，无页面交互语言
- [ ] 步骤参数用双引号内嵌，未使用 `<占位符>` / `Examples`
- [ ] 前置数据用 DataTable，请求体/响应体用 DocString（`"""JSON"""`）
- [ ] DocString 中的 JSON 合法可解析
- [ ] 端点路径、请求体字段、响应体字段与后端源码（Controller/DTO）一致
- [ ] 涉及字段约束的 AC 覆盖了契约/边界/错误码三个关注点（如适用）
- [ ] 源码无法静态确定的精确约束已标注待人工确认
- [ ] 错误码场景同时断言状态码和错误响应体结构
- [ ] 表格列使用空格对齐
- [ ] 文件编码为 UTF-8
