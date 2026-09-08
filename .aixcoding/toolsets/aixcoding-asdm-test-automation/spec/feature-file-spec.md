# Gherkin .feature 文件规范（UI 层）

## Language Guidelines

本规范定义的文档必须使用环境检测到的响应语言。确保文档中所有内容遵循：

1. **语言一致性**: 整份文档使用同一种语言（步骤描述使用中文，变量/字段名使用英文/拼音）
2. **写作规范**: 遵循所使用语言的写作风格和格式要求
3. **表达清晰**: 确保内容在所选语言下清晰易懂

**支持的语言**:
- 中文（zh，默认）
- 英文（en）
- 其他基于环境检测的语言

---

## Overview

本规范定义了 **UI 层**（`@layer:ui`）Gherkin `.feature` 文件的结构和语法要求。此类文件是 `asdm-test-spec-ui-generate` action 的核心输出，采用 Cucumber 兼容的 Gherkin 语法，将 User Story 的验收标准（AC）实例化为可直接执行的自动化测试场景。

**与 `api-feature-spec.md` 的关系**：
- `feature-file-spec.md`（本文件）：定义 UI 层 `.feature` 文件规范，使用页面交互词汇
- `api-feature-spec.md`：定义 API 契约层（`@layer:api`）`.feature` 文件规范，使用 HTTP 词汇
- 两份规范均**不使用** `Scenario Outline + Examples` 模式，而是使用具体场景 `Scenario:` + 数据内联，差异在于词汇表和数据组织方式（本层用引号字符串/数据表格，API 层另加 DocString）

**主要用途**:
- 作为 `asdm-test-spec-ui-generate` action 的输出文档
- 直接被 Cucumber 解析和执行，驱动 BDD 自动化验收测试
- 作为开发团队编写 Step Definition 的规格说明

**关键原则**:
- 本层由 `asdm-test-spec-ui-generate` 基于 **前端源码**（或前端上下文文档）实例化，页面元素命名以源码扫描结果为准；本层只生成 Happy Path，不生成边界值/异常值
- **本阶段只生成 Happy Path（正常路径）场景**，不生成边界值和异常值场景；边界值/异常值待源码实现后由开发人员手工补充或后续迭代覆盖
- 每条 AC 对应一个 `Scenario`（**不使用** `Scenario Outline` + `Examples` + `<占位符>` 模式）
- 测试数据**直接内联**在 Given/When/Then 步骤中：少量标量用引号字符串，多字段/结构化数据用数据表格（Data Table）
- `Then` 步骤必须包含**具体可测试的期望数据值**（引号字符串或含表头的数据表格），禁止"包含上述 N 条记录""展示以下字段：xxx"等抽象描述
- Given/When/Then 严格使用页面交互语言，不出现 HTTP 方法、endpoint、状态码、JSON 等 API 语义（这些属于 `api-feature-spec.md` 的职责范围）

---

## Document Structure

使用以下模板结构生成 Gherkin `.feature` 文件：

```gherkin
@<us-id>
@layer:ui
Feature: <User Story 名称>

  作为 <用户角色>，
  我想要 <功能意图>，
  以便 <业务价值>

  Background:
    Given <公共前置条件，含内联测试数据>

  # source: <源码文件路径>（页面组件/路由文件）
  @AC-1
  Scenario: <AC-1 Happy Path 场景描述>
    Given <前置条件，含内联测试数据（引号字符串或数据表格）>
    When <操作动作，含内联测试数据>
    Then <预期结果，含具体的可测试数据值（引号字符串或含表头的数据表格），禁止抽象描述>

  # source: <源码文件路径>
  @AC-2
  Scenario: <AC-2 Happy Path 场景描述>
    Given <前置条件，含内联测试数据>
    When <操作动作，含内联测试数据>
    Then <预期结果，含具体的可测试数据值>
```

**Key Elements**:
- 文件级 Tag：`@<us-id>` + `@layer:ui`，便于 Cucumber 按 User Story 和层级过滤执行
- Feature 声明：含 User Story 名称和用户故事描述
- Background：所有 Scenario 共享的公共前置条件（如已内联的登录信息）
- Scenario 级 Tag：`@AC-<编号>`，便于按 AC 过滤执行
- `# source:` 来源标注：每个 Scenario 上方标注其对应实现的前端源码文件路径，便于测试代码生成阶段绑定与核对
- `Scenario`（**非** `Scenario Outline`）：每条 AC 对应一个，测试数据直接内联在步骤中
- 无 `Examples` 表格：本层不使用参数化场景

---

## Section Guidelines

### 1. Feature 声明

**要求**：
- 文件必须以 `Feature:` 关键字开头（语言声明之后）
- Feature 名称使用 User Story 名称
- Feature 描述包含 User Story 的用户故事（作为…我想要…以便…）
- Feature 声明上方必须有文件级 Tag `@<us-id>` + `@layer:ui`

**语法**：
```gherkin
@FT-001-US-02
@layer:ui
Feature: 团队空间管理视图

  作为一个团队空间 Owner，
  我想要进入团队空间的管理视图，
  以便查看和管理团队空间的基本信息。
```

### 2. Background

**要求**：
- 如果多个 Scenario 共享相同的前置条件，使用 Background 提取
- Background 必须位于所有 Scenario 之前
- Background 中如涉及登录/身份验证，必须使用示例分析文档中"身份验证方式"变量的**具体字段**（如"用户名+密码"）和**具名角色**（如"张三"），不得使用"已通过身份验证"这类空泛表述；若该变量在示例分析文档中标注为"待源码验证"，如实标注"待确认验证方式"
- 如果没有公共前置条件，可省略 Background

**语法**：
```gherkin
Background:
  Given 用户 "张三" 已使用用户名 "zhangsan" 和密码 "Passw0rd!" 登录系统
  And 系统中存在团队空间 "研发团队空间"
```

### 3. Scenario（具体场景，非 Scenario Outline）

**要求**：
- 每条 AC 对应**一个** `Scenario`（Happy Path），使用 `Scenario:` 关键字，**不使用** `Scenario Outline:`
- 每个 Scenario 上方有 `@AC-<编号>` Tag
- 每个 Scenario 上方有 `# source: <源码文件路径>` 来源标注（对应前端页面组件/路由文件），便于 `asdm-test-code-generate` 阶段绑定与人工核对
- 场景描述简洁，包含 AC 编号
- 步骤中的测试数据直接写具体值，不使用 `<变量名>` 占位符

**语法**：
```gherkin
@AC-1
Scenario: AC-1 管理视图页面展示
  Given 用户是团队空间 "研发团队空间" 的成员，角色为 "Owner"
  When 用户从团队空间列表点击进入空间 "研发团队空间"
  Then 系统展示团队空间 "研发团队空间" 的管理视图页面
```

### 4. 测试数据内联方式

**要求**：
- **少量标量数据**：使用双引号包裹的字符串直接写在步骤中，如 `username "joseph"`
- **多字段/结构化数据**：使用数据表格（Data Table）内联在步骤下方，表头为字段名，数据行为具体值
- 同一数据在 Given 与 When 中必须保持一致（如同一用户名）

**方式一：引号包裹的字符串**（适用于少量标量数据）
```gherkin
Scenario: Login successfully
  Given exists a user with username "joseph" and password "123"
  When I login with username "joseph" and password "123"
  Then 页面展示欢迎信息"欢迎，joseph"
  And 当前登录用户显示为"joseph"
```

**方式二：数据表格**（适用于多字段/结构化数据）
```gherkin
Scenario: Create order
  When create order with data below:
    | Order number | Product name | Total | Recipient name | Recipient mobile | Recipient address | Status          |
    | SN001        | T-shirt      | 19    | Tom            | 415-555-2671     | New York          | To be delivered |
  Then the following order should be displayed:
    | Order number | Product name | Total | Status          |
    | SN001        | T-shirt      | 19    | To be delivered |
```

**数据内联选择规则**：

| 数据特征 | 推荐方式 | 示例 |
|----------|----------|------|
| 单个或少量的标量值（用户名、状态、ID） | 引号字符串 | `username "joseph"` |
| 多字段输入（表单、订单、配置） | 输入数据表格 | 见方式二 |
| 多字段预期结果（列表展示、详情回显） | 结果数据表格（含表头） | `Then 页面展示如下订单列表：` + 表格 |
| 单一明确的结果值 | 引号字符串或纯文本 | `should be "成功"` |

### 5. Then 预期结果可测试性规范（重要）

`Then` 步骤是验收断言的核心，必须表达**可被自动化测试逐字段验证的具体期望值**，而非笼统的业务描述。

**禁止的写法**（抽象描述，无法逐字段断言）：
```gherkin
# ❌ 错误：引用 Given 中的数据，未显式写出期望值
Then 页面展示问诊记录列表，包含上述 2 条记录
And 每条记录均展示以下字段：id、patientId、doctorName、question、status

# ❌ 错误：只描述行为，不含具体期望值
Then 页面展示订单详情
And 页面展示创建成功提示
```

**要求的写法**（具体数据，可逐字段断言）：
```gherkin
# ✅ 正确：使用数据表格显式写出期望展示的每条记录的每个字段值
Then 页面展示如下问诊记录列表：
  | id     | patientId            | doctorName | status |
  | Q-0001 | PAT-20260714-abc123 | 李医生     | 已回复 |

# ✅ 正确：标量期望值用引号字符串
Then 页面展示提示信息"创建成功"
And 页面展示的订单状态为"已支付"
```

**可测试性判定规则**：

| 判定维度 | 可测试（通过） | 不可测试（需改写） |
|----------|--------------|-------------------|
| 是否含具体值 | 步骤中包含可比对的具体数据值（字符串、数字、日期等） | 只含"上述 N 条""以下字段""列表"等笼统引用 |
| 列表/多条记录 | 使用数据表格显式列出每条记录的每个字段期望值 | 只写"包含上述 N 条记录"或"展示记录列表" |
| 字段验证 | 每个需验证的字段都有对应的期望值 | 只列举字段名列表 |
| 提示语/状态 | 使用引号包裹具体提示文案或状态值 | 只写"展示成功提示""展示错误信息" |
| 空结果 | 写出具体空状态期望，如"列表行数为 0"+提示文案 | 只写"页面为空" |

**与 Given 数据的关系**：`Then` 的预期结果数据表格可以与 `Given` 中的数据值相同，但**必须重新显式写出**，不可用"上述""如上"等引用词代替；若操作改变了数据状态，`Then` 应写出变更后的具体期望值。

### 6. UI 语言边界（重要）

UI 层 `.feature` 描述的是**用户在页面上能看到、能操作的行为**，而不是接口调用。即使 User Story 卡片的"技术依据"小节含 endpoint、service 名等接口信息，也**不得**将其带入本层的 Given/When/Then——这些属于 `api-feature-spec.md`（`@layer:api`）的职责范围。

| 层级 | 应该出现 | 禁止出现 |
|------|----------|----------|
| Given | 页面/系统状态、已登录的具名角色、已存在的业务数据（表格形式） | HTTP 方法、endpoint 路径、service/组件名 |
| When | 点击 / 输入 / 选择 / 提交 + 页面元素的业务名称 | "调用"、请求参数、header、接口方法 |
| Then | 页面展示的字段 / 列表 / 提示语等业务可观察结果 | 状态码、JSON、响应体、"接口返回" |

本层不需要真实存在的 UI 元素（CSS 选择器、组件 ID）才能生成 Scenario——步骤中只需使用业务角色能理解的名称，具体元素定位由 `asdm-test-code-generate` 阶段的 Step Definition 绑定。若 AC 未提及某操作对应的页面入口，应使用业务语言的合理假设，并在生成摘要中标注"待 UI 走查确认"，不得回退为 API 调用来规避不确定性。

### 7. Tag 使用规范

**要求**：
- 文件级 Tag：`@<us-id>`（如 `@FT-001-US-02`）+ `@layer:ui`，位于 Feature 上方
- Scenario 级 Tag：`@AC-<编号>`（如 `@AC-1`），位于每个 Scenario 上方
- 本层不再使用 `@normal`/`@boundary`/`@error` 等数据类型 Tag（因本阶段只产出 Happy Path，无数据类型分组）

**Tag 用途**：
| Tag | 位置 | 用途 |
|-----|------|------|
| `@<us-id>` | Feature 上方 | 按 User Story 过滤执行 |
| `@layer:ui` | Feature 上方 | 按 UI 层过滤（测试金字塔分层） |
| `@layer:api` | Feature 上方 | 按 API 契约层过滤（`asdm-test-spec-api-generate` 产出，详见 `api-feature-spec.md`） |
| `@AC-<编号>` | Scenario 上方 | 按 AC 过滤执行 |

**CI 分层筛选示例**（Cucumber `--tags` 表达式）：
- 仅跑 UI 层：`--tags @layer:ui`
- 仅跑 API 层：`--tags @layer:api`
- 排除某层：`--tags "not @layer:ui"`

> API 层 `.feature` 文件的完整规范见 `api-feature-spec.md`。

---

## Gherkin 关键字参考

| 关键字 | 用途 | 使用场景 |
|--------|------|----------|
| `Feature` | 功能描述 | 文件顶部，含 User Story 用户故事 |
| `Background` | 公共前置条件 | 所有 Scenario 共享的 Given 步骤，数据内联 |
| `Scenario` | 具体场景 | 每条 AC 对应一个（Happy Path），测试数据内联在步骤中 |
| `Given` | 前置条件 | 对应 AC 的 Given，含内联测试数据 |
| `When` | 操作动作 | 对应 AC 的 When，含内联测试数据 |
| `Then` | 预期结果 | 对应 AC 的 Then，必须含具体可测试数据值（引号字符串或含表头的数据表格） |
| `And` / `But` | 补充步骤 | 多个 Given/When/Then 之间的连接 |
| 数据表格 | 内联结构化数据 | 紧跟在步骤下方（以 `:` 结尾），用于多字段输入/输出 |

> **不使用** `Scenario Outline` 和 `Examples`：本规范不采用参数化场景，测试数据直接内联在 `Scenario` 的步骤中。

---

## Usage Guidelines

生成 Gherkin `.feature` 文件时：

1. **加载分析文档**：读取 `example-analysis.md`，获取变量、数据需求清单中的正常值（Happy Path）示例
2. **设计 Happy Path 数据**：为每条 AC 设计 1 个符合业务语义的正常路径场景数据
3. **编写 Scenario**：将 AC 的 Given-When-Then 转化为数据内联的具体步骤（引号字符串或数据表格）
4. **确保 Then 可测试**：预期结果必须使用具体可测试数据值，禁止抽象描述
5. **组装文件**：添加语言声明、Feature 声明、Background、Tag
6. **自检**：数据真实性、覆盖完整性、内联一致性、UI 语言边界

**重要**：
- 每条 AC 必须有对应的 `Scenario`（非 `Scenario Outline`）
- 本阶段只生成 Happy Path，不生成边界值/异常值场景
- 测试数据必须真实合理（非 "test123" 等无意义值），且直接内联，不使用占位符/Examples

---

## Output Format

**格式**: Gherkin（纯文本，UTF-8 编码）
**位置**: `.aixcoding/workspace/specs/<feature-id>/<story-id>/<story-id>.feature`
**命名**: 使用 User Story 名称（kebab-case 英文）作为文件名，如 `team-space-management-view.feature`

**格式细节**:
- 文件扩展名：`.feature`
- 编码：UTF-8（支持中文步骤描述）
- 缩进：2 个空格（Gherkin 惯例）
- 表格列对齐：使用空格对齐 `|` 分隔符

**示例**:
- 示例路径: `.aixcoding/workspace/specs/FT-001/FT-001-US-02/FT-001-US-02.feature`
- 示例命名: `<story-id>.feature`（如 `FT-001-US-02.feature`）

---

## Complete Example

以下是一个完整的 `.feature` 文件示例，基于 User Story `FT-001-US-02`（团队空间管理视图）：

```gherkin
@FT-001-US-02
@layer:ui
Feature: 团队空间管理视图

  作为一个团队空间 Owner，
  我想要进入团队空间的管理视图，
  以便查看和管理团队空间的基本信息。

  Background:
    Given 用户 "张三" 已使用用户名 "zhangsan" 和密码 "Passw0rd!" 登录系统
    And 系统中存在团队空间 "研发团队空间"

  @AC-1
  Scenario: AC-1 管理视图页面展示
    Given 用户是团队空间 "研发团队空间" 的成员，角色为 "Owner"
    When 用户从团队空间列表点击进入空间 "研发团队空间"
    Then 系统展示团队空间 "研发团队空间" 的管理视图页面

  @AC-2
  Scenario: AC-2 基本信息展示
    Given 用户进入团队空间 "研发团队空间" 的管理视图
    When 用户查看页面
    Then 页面展示如下基本信息：
      | 字段     | 值             |
      | 名称     | 研发团队空间   |
      | 描述     | 用于研发协作   |
      | 创建者   | 张三           |

  @AC-3
  Scenario: AC-3 当前用户角色展示
    Given 用户以角色 "Owner" 进入团队空间 "研发团队空间" 的管理视图
    When 用户查看页面
    Then 页面展示当前用户角色为"Owner"

  @AC-4
  Scenario: AC-4 Owner 视角的管理入口
    Given 用户以角色 "Owner" 进入团队空间 "研发团队空间" 的管理视图
    When 用户查看管理视图
    Then 页面展示管理功能入口"成员管理"
    And 页面展示管理功能入口"空间设置"
```

---

## Best Practices

编写 Gherkin `.feature` 文件时：

1. **分析驱动数据**：测试数据基于示例分析文档中的数据需求清单（正常值部分）生成
2. **Scenario 而非 Outline**：使用具体场景，测试数据内联，不为同一 AC 堆叠多个占位符行
3. **变量名英文**：如涉及内部标识（非展示文案），使用英文/拼音
4. **步骤描述中文**：Given/When/Then 的描述使用中文，与 AC 保持一致
5. **Background 复用**：公共前置条件（含具体数据）提取到 Background，避免重复
6. **Tag 标注完整**：User Story ID、层级标签和 AC 编号必须标注，便于过滤执行
7. **Then 可测试**：预期结果必须使用具体的可测试数据值，禁止抽象描述
8. **UI 语言边界**：不出现 HTTP/接口语义，保持页面交互语言

### Common Pitfalls to Avoid

- **误用 Scenario Outline**：本层不使用 `Scenario Outline` + `Examples`，若发现应改写为具体 `Scenario`
- **Then 抽象化**：预期结果只写"展示列表""操作成功"等，未给出可比对的具体值
- **缺少语言声明**：文件首行遗漏 `# language:`，导致 Cucumber 无法正确解析中文关键字
- **混入 API 语义**：When/Then 步骤中出现 HTTP 方法、状态码、JSON 响应体等
- **数据不真实**：使用 "test1"、"abc" 等无业务含义的数据
- **缺少 Tag**：未标注 User Story ID、层级标签或 AC 编号，无法按条件过滤执行
- **生成边界值/异常值**：本 action 只产出 Happy Path，若误生成边界/异常场景应移除或转交人工补充

---

## Related Documents

本规范模板与以下文件配合使用：

- **api-feature-spec.md**: API 契约层（`@layer:api`）.feature 文件规范，由 `asdm-test-spec-api-generate` 使用，与本规范（UI 层）共同构成测试金字塔分层
- **example-analysis-spec.md**: 示例分析文档规范，由 `asdm-test-scenario-analyze` 生成，作为 `.feature` 文件生成的依据
- **validation-report-spec.md**: 校验报告规范，由 `asdm-test-spec-validate` 生成，校验 `.feature` 文件的语法和覆盖率

本规范被以下 action 使用：

- **Action: asdm-test-spec-ui-generate**: 生成 UI 层（`@layer:ui`）Gherkin `.feature` 文件时遵循本规范
- **Action: asdm-test-spec-validate**: 校验 `.feature` 文件时读取本规范定义的结构和语法要求

---

## Checklist

完成 Gherkin `.feature` 文件前，检查：

- [ ] 文件以 `Feature:` 开头，上方有 `@<us-id>` + `@layer:ui` Tag
- [ ] Feature 描述包含 User Story 用户故事
- [ ] Background（如有）位于所有 Scenario 之前，且数据已内联
- [ ] 每条 AC 有对应的 `Scenario`（非 `Scenario Outline`）
- [ ] 每个 Scenario 上方有 `@AC-<编号>` Tag
- [ ] 每个 Scenario 上方有 `# source:` 来源标注（源码文件路径）
- [ ] 测试数据直接内联在步骤中（引号字符串或数据表格），无 `<占位符>`
- [ ] 未使用 `Scenario Outline` / `Examples`
- [ ] 每个 `Then` 步骤包含具体可测试数据值，无"包含上述 N 条""展示以下字段"等抽象描述
- [ ] 列表/多字段预期结果使用含表头的数据表格逐行逐字段写出
- [ ] Given/When/Then 未出现 HTTP 方法、endpoint、状态码、JSON 等 API 语义
- [ ] Background 中的身份验证使用具体字段和具名角色，未使用空泛表述
- [ ] 测试数据真实合理（非 "test123" 等无意义值）
- [ ] 表格列使用空格对齐
- [ ] 文件编码为 UTF-8
