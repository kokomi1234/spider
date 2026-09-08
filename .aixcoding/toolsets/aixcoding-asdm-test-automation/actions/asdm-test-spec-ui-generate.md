# Instructions for asdm-test-spec-ui-generate action

## Metadata

```json
{
   "guid": "a7b8c9d0-e1f2-3a4b-5c6d-7e8f9a0b1c2d",
   "name": "asdm-test-spec-ui-generate",
   "displayName": "示例生成",
   "description": "基于前端源码（页面/路由/组件文件，或已提取的前端上下文文档）与 User Story 卡片，为每条 AC 生成 Happy Path 场景，直接输出包含真实测试数据的、符合 Gherkin 语法、可被 Cucumber 执行的 .feature 文件。步骤中的页面元素业务名称、路由、字段均以源码中实际存在的内容为准，本阶段只生成正常路径场景",
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

本指令引导 AI 模型基于**前端源码**（页面组件、路由、模板/JSX 中的文案与交互元素）与 User Story 卡片，以及 测试设计文档（`asdm-test-scenario-analyze` 产出），为 User Story 的每条验收标准（AC）生成 **Happy Path（正常路径）** 场景，以 Gherkin 语法组织为 `Scenario`，并将测试数据**直接内联**到 Given/When/Then 步骤中（引号字符串或数据表格），输出可直接被 Cucumber 执行的 `.feature` 文件。

**重要**：
- 本阶段**只生成 Happy Path 场景**，不生成边界值（Boundary Value）和异常值（Error Path）场景。
- 测试数据**直接内联**在步骤中，**不使用** `Scenario Outline + Examples`。每条 AC 对应一个独立的 `Scenario`，步骤中包含具体的测试数据值。
- **步骤中出现的页面元素业务名称（按钮文案、菜单名、字段标签等）必须来自源码扫描结果，不可凭业务常识臆造**。若源码中确实找不到对应元素，必须在生成摘要中如实标注，而不是编造一个"看起来合理"的名称。
- 本阶段**依赖前端源码**（或已提取的前端上下文文档）。若相关页面/路由在源码中尚未实现，本 action 无法生成有依据的 Scenario，将终止执行并给出提示（见"错误处理"）。

本阶段对应 Specification by Example（SBE）流程中的 **实例化（Instantiate）** 阶段，是"分析 → 实例化 → 校验"三阶段流程的第二步，但与传统 SBE 不同的是：本阶段的实例化依据是**已实现的前端源码**，而非纯粹的业务假设。

## Language Setting

默认使用**中文（简体中文）**作为输出语言。所有生成的内容均使用中文，并遵循中文写作规范。

如需切换语言，可在工作区根目录创建 `.aixcoding/config.json` 配置：
```json
{
  "language": "zh"
}
```
支持的语言：`zh`（中文，默认）、`en`（英文）。

> 注意：无论输出语言如何，`.feature` 文件首行应声明 `# language: zh` 或 `# language: en`，以保证 Cucumber 正确解析 Gherkin 关键字。

## Context Injection

在开始生成之前，AI 模型必须读取 User Story 卡片，并获取前端源码信息（优先读取已提取的前端上下文文档，缺失时直接扫描前端源码仓库）。

### Context Files to Read (Required)

1. **User Story 卡片** (Required - 必须读取)
   - Path: `.aixcoding/workspace/stories/<feature-id>/<us-id>.md`
   - Purpose: 获取原始 AC 的 Given-When-Then 完整文本，作为待实例化的业务范围

2. **前端页面/路由信息**（Required - 二选一，优先级从上到下）

   a. **前端上下文文档**（优先）
   - Path: `.aixcoding/contexts/layer-2/frontend.md`
   - Purpose: 获取已提取的路由清单、页面组件清单、可交互元素（按钮/菜单/表单字段）的业务命名，避免重复扫描源码
   - 若该文档不存在或为模板占位：跳过，进入下一步直接扫描源码

   b. **前端源码仓库**（文档缺失时的兜底）
   - Path: 用户指定的前端仓库根目录（或 `.aixcoding/config.json` 中配置的 `frontendRepoPath`）
   - Purpose: 定位与 User Story 业务语义相关的路由/页面文件（如 `src/pages/**`、`src/views/**`、路由配置文件），提取该页面下实际存在的可交互元素文案（按钮、菜单、表单字段 label、提示文案）与该页面调用的接口
   - **若前端上下文文档与前端源码仓库均不可用**：终止执行，提示用户提供前端仓库路径，或先执行前端上下文提取（如已有对应工具）

3. **Gherkin .feature 文件规范** (Required - 必须遵循)
   - Path: `.aixcoding/toolsets/asdm-test-automation/spec/feature-file-spec.md`
   - Purpose: 遵循 .feature 文件的结构和语法规范

### Context Files to Read (Recommended)

4. **示例分析文档**（Recommended - 若已产出可复用）
   - Path: `.aixcoding/workspace/specs/<feature-id>/<story-id>/<story-id>.example-analysis.md`
   - Purpose: 若已通过 `asdm-test-scenario-analyze` 产出，可复用其业务语义梳理和数据取值思路，作为测试数据合理性的参考；**但页面元素命名仍以源码扫描结果为准**，二者冲突时以源码为准
   - 如果该文件不存在：不阻塞，直接基于源码与 User Story 卡片实例化

### Progressive Context Loading Strategy

1. **初始阶段**：读取 User Story 卡片，理解待生成的全貌（AC 列表、涉及的页面/功能）
2. **源码扫描阶段**：读取前端上下文文档，或直接扫描前端源码仓库，定位与本 US 相关的路由/页面组件，提取真实存在的元素文案、路由路径、该页面调用的接口
3. **映射阶段**：将每条 AC 映射到具体的页面/组件/元素，标注源码依据
4. **生成阶段**：基于映射结果生成 Happy Path `Scenario`，元素名称与测试数据直接内联，且元素名称须与源码扫描结果一致

## Steps to 示例生成

### 1. 加载 User Story 卡片

1. 接收用户指定的 User Story ID（如 `FT-001-US-02`）
2. 读取 User Story 卡片，提取原始 AC 的 Given-When-Then 完整文本
3. 若存在示例分析文档，一并读取，作为业务语义与数据取值的参考

### 2. 扫描前端页面元素（关键步骤，替代原"读取示例分析文档"作为主要依据）

1. 优先读取 前端代码仓库的`.aixcoding/contexts/index.md`；若不存在或为占位模板，进入源码扫描
2. 在前端源码仓库中，根据 US 业务语义（关键词、路由片段、模块目录名）定位相关页面/路由文件
3. 提取以下信息，作为后续 Scenario 生成的**唯一权威依据**：
   - **路由路径**：该页面对应的实际路由（如 `/spaces`、`/spaces/:id`）
   - **可交互元素的业务文案**：按钮文本、菜单名、Tab 名、表单字段 label（从模板/JSX 静态文本、i18n key 对应的默认文案中提取，动态渲染内容标注为"待运行时确认"）
   - **列表/详情展示字段**：页面渲染的数据字段与其展示标签
   - **该页面调用的接口**：前端 API 调用代码中出现的 endpoint（仅用于确认业务流程真实存在，不写入 UI 语言层，见 §3.2）
4. 逐条比对 AC 与源码扫描结果：
   - 若 AC 描述的页面/元素在源码中能找到对应实现：记录映射关系，后续步骤据此生成
   - 若 AC 描述的页面/元素在源码中找不到（尚未实现或命名不一致）：在生成摘要中标注"该 AC 未在源码中找到对应实现，已跳过 / 已使用最接近的假设并标注待确认"，**不得凭空编造元素名称冒充已实现**

**如果既无前端上下文文档也无法访问前端源码仓库**：
- 终止执行，提示用户："本 action 依赖前端源码进行实例化，请提供前端仓库路径，或先生成前端上下文文档（`.aixcoding/contexts/layer-2/frontend.md`）。"

### 3. 为每条 AC 设计 Happy Path 测试数据

基于第 2 步的源码扫描结果与示例分析文档（如有）中的数据取值参考，为每条 AC 设计正常值（Happy Path）测试数据。

#### 3.1 正常值（Happy Path）设计

为每条 AC 生成 **1 个** Happy Path 场景：
- 使用符合业务语义的合法输入
- 覆盖 AC 中提到的核心合法枚举值（如关键角色选其一；枚举的合法取值若源码可见，如前端下拉选项的静态配置，应以源码为准）
- 使用真实、合理的业务数据（如 "研发团队空间" 而非 "test1"）
- 数据值应能完整走通 AC 描述的完整业务流程，预期结果为业务成功的正向结果
- **`Then` 预期结果必须使用具体可测试的数据值**（详见 §3.3），不可使用抽象描述性语言

#### 3.2 测试数据组织原则

- **少量标量数据**：使用引号包裹的字符串直接写在步骤中，如 `username "joseph"`
- **多字段/结构化数据**：使用数据表格（Data Table）内联在步骤下方，表头为字段名，数据行为具体值
- **预期结果必须可测试**：`Then` 步骤的预期结果**必须使用具体的测试数据值**（引号字符串或数据表格），**禁止**使用抽象描述性语言（详见 §3.3）

#### 3.3 Then 预期结果可测试性规范（重要）

`Then` 步骤是验收断言的核心，必须表达**可被自动化测试逐字段验证的具体期望值**，而非笼统的业务描述。

**禁止的写法**（抽象描述，无法逐字段断言）：
```gherkin
# ❌ 错误：引用 Given 中的数据，未显式写出期望值
Then 页面展示问诊记录列表，包含上述 2 条记录
And 每条记录均展示以下字段：id、patientId、doctorName、question、status、submitTime、answer、answerTime

# ❌ 错误：只描述行为，不含具体期望值
Then 页面展示订单详情
And 页面展示创建成功提示
```

**要求的写法**（具体数据，可逐字段断言）：
```gherkin
# ✅ 正确：使用数据表格显式写出期望展示的每条记录的每个字段值
Then 页面展示如下问诊记录列表：
  | id     | patientId            | doctorName | question            | status | submitTime          | answer                    | answerTime          |
  | Q-0001 | PAT-20260714-abc123 | 李医生     | 最近经常头痛怎么办？ | 已回复 | 2026-07-14 10:00:00 | 建议测量血压并保证充足睡眠   | 2026-07-14 10:30:00 |
  | Q-0002 | PAT-20260714-abc123 | 王医生     | 感冒发烧吃什么药？   | 已回复 | 2026-07-13 09:00:00 | 可服用对乙酰氨基酚，注意多喝水 | 2026-07-13 09:20:00 |

# ✅ 正确：标量期望值用引号字符串
Then 页面展示提示信息"创建成功"
And 页面展示的订单状态为"已支付"
```

**可测试性判定规则**：

| 判定维度 | 可测试（通过） | 不可测试（需改写） |
|----------|--------------|-------------------|
| 是否含具体值 | 步骤中包含可比对的具体数据值（字符串、数字、日期等） | 只含"上述 N 条""以下字段""列表"等笼统引用 |
| 列表/多条记录 | 使用数据表格显式列出每条记录的每个字段期望值 | 只写"包含上述 N 条记录"或"展示记录列表" |
| 字段验证 | 每个需验证的字段都有对应的期望值 | 只列举字段名列表（如"展示字段：id、name、status"） |
| 提示语/状态 | 使用引号包裹具体提示文案或状态值 | 只写"展示成功提示""展示错误信息" |
| 空结果 | 写出具体空状态期望，如 `Then 页面展示空列表，并显示提示"暂无问诊记录"` | 只写"页面为空" |

**与 Given 数据的关系**：
- `Then` 的预期结果数据表格**可以**与 `Given` 中的数据值相同（正常路径下展示已有数据），但**必须重新显式写出**，不可用"上述""如上"等引用词代替
- 若操作会改变数据状态（如新增、编辑后展示），`Then` 表格应写出**变更后**的具体期望值，而非引用 Given 原值

**空列表/无数据场景**：
- 不可只写 `Then 页面展示空列表`，应补充可观察的具体空状态：
  ```gherkin
  # ✅ 正确
  Then 页面展示空列表，列表行数为 0
  And 页面展示提示信息"暂无问诊记录"
  ```

### 4. 生成 Scenario（直接内联测试数据，元素名称以源码为准）

将每条 AC 的测试数据组织为 Gherkin 的 `Scenario`，测试数据直接内联在步骤中。

#### 4.1 Scenario 结构与来源标注

每条 AC 对应一个 `Scenario`（**不使用** `Scenario Outline`），并在其上方添加**来源标注注释**，指向第 2 步扫描到的源码位置，便于后续 `asdm-test-code-generate` 阶段绑定 step definition，也便于追溯该 Scenario 的实现依据：

```gherkin
# source: src/pages/SpaceList/index.tsx（页面组件）
@AC-1
Scenario: <AC 编号> <Happy Path 场景描述>
  Given <前置条件，含内联测试数据>
  When <操作动作，含内联测试数据>
  Then <预期结果，含具体的可测试数据值（引号字符串或数据表格），禁止抽象描述>
```

若某元素文案无法从静态源码中确认（如接口返回的动态文案），来源标注中注明"待运行时确认"：
```gherkin
# source: src/pages/SpaceList/index.tsx（页面组件）；提示文案为动态渲染，待运行时确认
```

#### 4.2 UI 语言边界（重要）

UI 层 `.feature` 描述的是**用户在页面上能看到、能操作的行为**，而不是接口调用。即使源码扫描过程中获取了该页面调用的接口信息（endpoint、参数等），也**不得**将其带入本阶段的 Given/When/Then——这些属于 `asdm-test-spec-api-generate` 产出的 `@layer:api` Scenario 的职责范围，两者可基于同一次源码扫描的不同产物（前端页面 vs 后端接口），但语言层完全不同。

| 层级 | 应该出现 | 禁止出现 |
|------|----------|----------|
| Given | 页面/系统状态、已登录的具名角色、已存在的业务数据（表格形式） | HTTP 方法、endpoint 路径、service/组件名 |
| When | 点击 / 输入 / 选择 / 提交 + 页面元素的业务名称（须与源码一致） | "调用"、请求参数、header、接口方法 |
| Then | 页面展示的字段 / 列表 / 提示语等业务可观察结果 | 状态码、JSON、响应体、"接口返回" |

**关于元素命名的权威来源**：步骤中使用的页面元素业务名称（如"'历史问诊'菜单""'查询'按钮"）**必须与源码扫描结果一致**（组件中的实际文案、i18n 默认文案）。若源码中同一元素在不同位置命名不一致（如按钮文案与埋点名不同），以**用户可见的页面文案**为准。具体的 CSS 选择器/组件 ID 定位仍不属于本阶段职责，留待 `asdm-test-code-generate` 阶段的 step definition 绑定。

**Background 中的登录/身份验证**：必须使用源码中实际实现的身份验证方式（如登录页表单字段、免密跳转逻辑等），使用具名角色（如"张三"）而非抽象业务键；若源码中的验证方式无法从静态代码确认（如依赖第三方 SSO 跳转），应在 Background 中如实标注"待确认验证方式"，不得自行编造为"已通过身份验证"这类空泛表述。

#### 4.3 测试数据内联方式

**方式一：引号包裹的字符串**（适用于少量标量数据）

参考示例：
```gherkin
Scenario: Login successfully
  Given exists a user with username "joseph" and password "123"
  When I login with username "joseph" and password "123"
  Then 页面展示欢迎信息"欢迎，joseph"
  And 当前登录用户显示为"joseph"
```

要点：
- 字符串值用双引号 `"` 包裹，便于在步骤文本中识别
- 同一数据在 Given 与 When 中保持一致（如用户名 "joseph"）
- `Then` 的预期结果使用引号包裹**具体期望文案**（如"欢迎，joseph"），而非"登录成功"等抽象描述

**方式二：数据表格**（适用于多字段/结构化数据）

参考示例：
```gherkin
Scenario: Create order
  When create order with data below:
    | Order number | Product name | Total | Recipient name | Recipient mobile | Recipient address | Status          |
    | SN001        | T-shirt      | 19    | Tom            | 415-555-2671     | New York          | To be delivered |
  Then the following order should be displayed:
    | Order number | Product name | Total | Status          |
    | SN001        | T-shirt      | 19    | To be delivered |
```

要点：
- 步骤末尾以 `:` 结尾，下一行紧跟数据表格
- 表头为字段名（语义化英文或中文，与业务一致，须与源码页面展示字段一致）
- **`Then` 步骤的数据表格必须包含表头行**，表头为期望验证的字段名，数据行为期望的具体值
- `Then` 的预期结果**必须显式写出期望数据**，不可用"上述""如上"等引用 Given 中的数据

#### 4.4 数据内联选择规则

| 数据特征 | 推荐方式 | 示例 |
|----------|----------|------|
| 单个或少量的标量值（用户名、状态、ID） | 引号字符串 | `username "joseph"` |
| 多字段输入（表单、订单、配置） | 输入数据表格 | 见上方"方式二" |
| 多字段预期结果（列表展示、详情回显） | 结果数据表格（含表头） | `Then 页面展示如下订单列表：` + 表格 |
| 单一明确的结果值 | 引号字符串或纯文本 | `should be "成功"` |

> **关键约束**：当 `Then` 需要验证列表/多条记录/多字段展示时，**必须**使用数据表格逐行逐字段写出期望值（含表头），**禁止**仅用文字描述"包含上述 N 条记录"或"展示以下字段：id、name、status"。详见 §3.3。

### 5. 组装 .feature 文件

将所有 `Scenario` 组装为完整的 Gherkin `.feature` 文件。

#### 5.1 .feature 文件结构

```gherkin
# language: zh
# 本 .feature 文件由 asdm-test-spec-ui-generate 基于前端源码生成
# 源码扫描范围: <路由/页面文件列表>
@<us-id>
@layer:ui
Feature: <User Story 名称>

  作为 <用户角色>，
  我想要 <功能意图>，
  以便 <业务价值>

  Background:
    Given <公共前置条件>

  # source: <源码路径>
  @AC-1
  Scenario: <AC-1 Happy Path 场景描述>
    Given <前置条件，含内联测试数据>
    When <操作动作，含内联测试数据>
    Then <预期结果，含具体的可测试数据值（引号字符串或数据表格）>

  # source: <源码路径>
  @AC-2
  Scenario: <AC-2 Happy Path 场景描述>
    Given <前置条件，含内联测试数据>
    When <操作动作，含内联测试数据>
    Then <预期结果，含具体的可测试数据值（引号字符串或数据表格）>
```

#### 5.2 Gherkin 关键字使用规范

| 关键字 | 用途 | 使用场景 |
|--------|------|----------|
| `# language:` | 语言声明 | 文件首行，声明 Gherkin 关键字语言（`zh`/`en`） |
| `# source:` | 来源标注 | 文件头标注扫描范围，每个 Scenario 上方标注对应源码文件 |
| `Feature` | 功能描述 | 文件顶部，含 User Story 用户故事 |
| `Background` | 公共前置条件 | 所有 Scenario 共享的 Given 步骤 |
| `Scenario` | 具体场景 | 每条 AC 对应一个，测试数据内联在步骤中 |
| `Given` | 前置条件 | 对应 AC 的 Given，含内联测试数据 |
| `When` | 操作动作 | 对应 AC 的 When，含内联测试数据 |
| `Then` | 预期结果 | 对应 AC 的 Then，**必须含具体可测试数据值**（引号字符串或含表头的数据表格），禁止抽象描述 |
| `And` / `But` | 补充步骤 | 多个 Given/When/Then 之间的连接 |
| `@tag` | 标签 | 标注 User Story ID、AC 编号、层级标签 `@layer:ui`（与 `asdm-test-spec-api-generate` 产出的 `@layer:api` 区分，便于 CI 分层筛选） |
| 数据表格 | 内联结构化数据 | 紧跟在步骤下方，用于多字段输入/输出 |

> **注意**：本 action **不使用** `Scenario Outline` 和 `Examples`。测试数据直接内联在 `Scenario` 的步骤中。

### 6. 测试数据合理性自检

生成 .feature 文件后，对测试数据进行合理性自检：

#### 6.1 源码一致性校验（新增，重要）
- 步骤中出现的页面元素业务名称（按钮/菜单/字段 label）是否与源码扫描结果**逐一核对一致**？
- 路由/页面是否确实在源码中存在对应实现？
- 是否存在凭业务常识"脑补"出来、源码中实际找不到的元素名称？如有，必须改写或标注待确认
- 每个 Scenario 上方是否都有 `# source:` 来源标注？

#### 6.2 数据真实性校验
- 测试数据是否真实合理（非 "test123" 等无意义值）？
- 业务场景描述是否贴合实际？

#### 6.3 覆盖完整性校验
- 每条 AC 是否都有对应的 Happy Path `Scenario`？
- 每个 `Scenario` 是否包含完整的 Given-When-Then 且数据内联？
- 每个 `Then` 步骤是否包含具体的期望数据值（引号字符串或数据表格），而非抽象描述？
- 枚举类型是否核心合法值有用例？

#### 6.4 内联数据一致性校验
- 同一数据在 Given 与 When 中是否一致（如同一用户的用户名）？
- 数据表格的列对齐是否规范？
- 引号字符串是否正确闭合？

#### 6.5 Then 预期结果可测试性校验（重要）
- 每个 `Then` 步骤是否包含**具体的期望数据值**（引号字符串或数据表格），而非抽象描述？
- 是否存在"包含上述 N 条记录""展示以下字段：xxx""展示列表"等**笼统引用**？如有，改写为显式数据表格
- `Then` 的数据表格是否**包含表头行**？表头是否为期望验证的字段名？
- 列表/多条记录的预期结果是否使用数据表格**逐行逐字段**写出期望值？
- 提示语/状态等标量期望是否用引号包裹了具体文案？
- 空列表场景是否写出了可观察的具体空状态（如"列表行数为 0"+"提示信息'暂无数据'"），而非仅"页面为空"？
- `Then` 中的数据是否与 `Given`/`When` 中的一致（正常路径下应一致），且**显式重写**而非引用？

#### 6.6 UI 语言边界校验
- When/Then 步骤中是否出现了 HTTP 方法、endpoint、状态码、JSON 响应体等 API 语义？如有，改写为页面操作/页面展示的业务语言
- Given 中涉及的服务/组件名是否被误写入步骤文本？应替换为业务状态描述
- Background 中的登录/身份验证是否使用了源码中实际的验证字段（如"用户名+密码"），而非"已通过身份验证"这类空泛表述？

### 7. 保存 .feature 文件

将生成的 .feature 文件保存到：
`.aixcoding/workspace/specs/<feature-id>/<story-id>/<story-id>.feature`

**文件命名**：使用 User Story ID（`<us-id>`）作为文件名，如 `FT-001-US-02.feature`，与 API 层 `FT-001-US-02.api.feature` 共存于同一目录。

### 8. 呈现生成摘要

向用户展示生成阶段的产出摘要：

```markdown
# 示例生成完成

## User Story 信息
- **User Story ID**: <us-id>
- **User Story 名称**: <n>
- **AC 数量**: <数量>

## 源码扫描依据
- **依据来源**: <前端上下文文档 / 前端源码仓库扫描>
- **扫描的路由/页面文件**: <文件列表>
- **未在源码中找到对应实现的 AC**: <数量> 个（<列表，如有>）

## 生成结果
- **Scenario 总数**: <数量>（均为 Happy Path）
- **使用数据表格的 Scenario**: <数量> 个
- **使用引号字符串的 Scenario**: <数量> 个
- **标注"待运行时确认"的元素**: <数量> 个（<列表，如有>）

## 生成文件
- Gherkin 文件: `.aixcoding/workspace/specs/<feature-id>/<story-id>/<story-id>.feature`

## 下一步
1. 执行 `/asdm-test-spec-validate <us-id>` 校验 Gherkin 语法和测试覆盖率
2. 对标注"待确认"的元素，建议人工走查页面后修正
3. 如需补充边界值/异常值场景，可在源码实现后手工扩展
```

## Execution Guidelines

### When to Use This Action

使用本 action 的场景：
- User Story 对应的前端页面**已实现**（或已有前端上下文文档）
- 需要将验收标准实例化为 Cucumber 可执行的、与真实前端实现一致的 Gherkin .feature 文件
- 只需生成 Happy Path 场景，快速建立可执行的UI 验收用例

**不适用场景**：源码尚未实现的前置探索阶段。若前端页面尚未开发、仅有设计稿或原型，本 action 无法进行有依据的实例化；此时应待前端开发完成后再执行本 action。

### 测试数据生成原则

1. **源码驱动**：测试数据与页面元素命名基于前端源码（或前端上下文文档）的实际扫描结果生成，而非业务假设
2. **只覆盖 Happy Path**：每条 AC 只生成正常路径场景，不生成边界值/异常值
3. **数据真实**：使用贴合业务场景的真实数据（如 "研发团队空间" 而非 "test1"）
4. **内联优先**：测试数据直接内联在步骤中，不使用 Scenario Outline + Examples
5. **格式规范**：少量标量用引号字符串，多字段用数据表格，保持列对齐
6. **Then 可测试**：`Then` 预期结果必须使用具体的可测试数据值（引号字符串或含表头的数据表格），禁止"包含上述 N 条记录""展示以下字段：xxx"等抽象描述
7. **来源可溯**：每个 Scenario 标注来源源码路径，便于后续 `asdm-test-code-generate` 阶段绑定与人工核对

### Gherkin 语法原则

1. **Scenario 而非 Scenario Outline**：使用具体场景，测试数据内联
2. **数据内联**：引号字符串或数据表格，避免占位符
3. **Background 复用**：多个 Scenario 共享的前置条件放入 Background
4. **Tag 标注**：使用 Tag 标注 User Story ID 和 AC 编号，便于过滤执行
5. **语言声明**：文件首行声明 `# language:` 以正确解析 Gherkin 关键字
6. **来源注释**：每个 Scenario 上方标注 `# source:` 注释

### 错误处理

- **前端上下文文档与前端源码仓库均不可用**：终止执行，提示用户提供前端仓库路径（或 `.aixcoding/config.json` 中配置 `frontendRepoPath`），或先生成前端上下文文档
- **User Story 卡片不存在**：提示用户检查 User Story ID 是否正确，或该 User Story 卡片尚未生成
- **AC 描述的页面/元素在源码中找不到**：在生成摘要中标注该 AC 未实现或命名不一致，跳过或使用最接近的假设并标注待确认，不得凭空编造
- **AC 过于抽象无法实例化**：提示用户该 AC 可能需要进一步细化
- **Then 预期结果出现抽象描述**：检测到"包含上述 N 条记录""展示以下字段：xxx""展示列表"等笼统表述时，必须改写为含具体期望值的数据表格或引号字符串（详见 §3.3）
- **数据表格列对齐问题**：确保数据表格各列用 `|` 分隔并对齐

## Usage

To use this instruction, the AI model should:
1. 检测响应语言
2. 接收用户指定的 User Story ID
3. 读取 User Story 卡片
4. 读取前端上下文文档，或扫描前端源码仓库，提取路由、页面元素文案、字段清单
5. 将每条 AC 映射到源码中的具体实现，标注找不到对应实现的 AC
6. 为每条 AC 设计 Happy Path 测试数据，元素名称须与源码扫描结果一致
7. 将测试数据内联到 Given/When/Then 步骤中（引号字符串或数据表格）
8. 确保 `Then` 预期结果使用具体的可测试数据值，禁止抽象描述性语言（详见 §3.3）
9. 生成 `Scenario`（非 Scenario Outline），并标注 `# source:` 来源注释
10. 组装完整的 Gherkin .feature 文件
11. 进行测试数据合理性自检（含 §6.1 源码一致性校验、§6.5 Then 可测试性校验）
12. 保存 .feature 文件
13. 呈现生成摘要并提示下一步

## Output Summary

完成生成阶段后，将生成以下产出：
- Gherkin `.feature` 文件：`.aixcoding/workspace/specs/<feature-id>/<story-id>/<story-id>.feature`

所有文件保存在 `.aixcoding/workspace/specs/<feature-id>/<story-id>/` 目录下。

### Downstream Flow

```text
前端页面已实现（或已有前端上下文文档 .aixcoding/contexts/layer-2/frontend.md）  ← 前置条件
        │
        ▼
/asdm-test-spec-ui-generate <us-id>              ← 当前步骤：基于前端源码生成 UI 层 Gherkin .feature 文件（@layer:ui，Happy Path，测试数据内联，元素命名以源码为准）
        │
        ├─ 平行可选：/asdm-test-spec-api-generate <us-id>  基于后端源码生成 API 层 .feature 文件（@layer:api，HTTP 语义）
        │
        ▼
/asdm-test-spec-validate <us-id>              ← 校验 Gherkin 语法与覆盖率
```