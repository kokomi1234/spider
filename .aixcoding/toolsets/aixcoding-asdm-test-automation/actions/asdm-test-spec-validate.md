# Instructions for asdm-test-spec-validate action

## Metadata

```json
{
  "guid": "b8c9d0e1-f2a3-4b5c-6d7e-8f9a0b1c2d3e",
  "name": "asdm-test-spec-validate",
  "displayName": "示例校验",
  "description": "对生成的 Gherkin .feature 文件进行语法校验、测试覆盖率检查和 Cucumber 可执行性验证，产出校验报告和优化建议。此阶段不依赖源码，聚焦于 Gherkin 语法正确性和测试覆盖完整性",
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

本指令引导 AI 模型对 `asdm-test-spec-ui-generate` 或 `asdm-test-spec-api-generate` 产出的 Gherkin `.feature` 文件进行校验，包括 Gherkin 语法正确性、测试覆盖率完整性和 Cucumber 可执行性，产出校验报告和优化建议，确保 `.feature` 文件语法正确、测试覆盖充分、可被 Cucumber 解析执行。

**重要**：
- 本阶段不依赖源码仓库，聚焦于 Gherkin 语法、测试覆盖和可执行性三个维度。
- 本 action 同时支持 UI 层（`@layer:ui`，`asdm-test-spec-ui-generate` 产出）和 API 契约层（`@layer:api`，`asdm-test-spec-api-generate` 产出）的 `.feature` 文件校验，两层的校验标准不同（UI 层只产出 Happy Path 具体 `Scenario`，api 层按测试关注点拆分）。
- **本工具集不使用 `Scenario Outline` + `Examples` + `<占位符>` 模式**。`asdm-test-spec-ui-generate` 与 `asdm-test-spec-api-generate` 均产出具体场景 `Scenario:`，测试数据直接内联（UI 层用引号字符串/数据表格，api 层用 DataTable/DocString）。若在 `.feature` 文件中发现 `Scenario Outline`/`Examples`/`<占位符>`，应在校验报告中标注为**不符合当前规范**（`feature-file-spec.md` / `api-feature-spec.md`），而非视为合法的历史写法。

本阶段对应 Specification by Example（SBE）流程中的 **校验（Validate）** 阶段，是"分析 → 实例化 → 校验"三阶段流程的第三步。

## Language Setting

默认使用**中文（简体中文）**作为输出语言。所有生成的内容均使用中文，并遵循中文写作规范。

如需切换语言，可在工作区根目录创建 `.aixcoding/config.json` 配置：
```json
{
  "language": "zh"
}
```
支持的语言：`zh`（中文，默认）、`en`（英文）。

## Context Injection

在开始校验之前，AI 模型必须读取待校验的 `.feature` 文件及相关上下文。

### Context Files to Read (Required)

1. **Gherkin .feature 文件** (Required - 必须读取)
   - Path: `.aixcoding/workspace/specs/<feature-id>/<story-id>/<story-id>.feature`（UI 层，`asdm-test-spec-ui-generate` 产出）和/或 `<story-id>.api.feature`（API 层，`asdm-test-spec-api-generate` 产出）
   - Purpose: 校验的目标文件。两个文件可独立存在，按实际存在的文件逐个校验
   - **如果两个文件都不存在**：提示用户先执行 `/asdm-test-spec-ui-generate <us-id>` 或 `/asdm-test-spec-api-generate <us-id>`

2. **示例分析文档** (Required - 必须读取)
   - Path: `.aixcoding/workspace/specs/<feature-id>/<story-id>/<story-id>.example-analysis.md`
   - Purpose: 校验测试数据是否与分析阶段识别的变量和维度一致

3. **User Story 卡片** (Required - 必须读取)
   - Path: `.aixcoding/workspace/stories/<feature-id>/<us-id>.md`
   - Purpose: 校验 Scenario 是否覆盖了所有 AC

4. **Gherkin .feature 文件规范** (Required - 必须遵循)
   - Path: `.aixcoding/toolsets/asdm-test-automation/spec/feature-file-spec.md`（UI 层）和/或 `.aixcoding/toolsets/asdm-test-automation/spec/api-feature-spec.md`（API 层）
   - Purpose: 校验 .feature 文件是否符合规范。根据文件的 `@layer:` 标签选择对应规范：`@layer:ui` 对应 `feature-file-spec.md`，`@layer:api` 对应 `api-feature-spec.md`

**IMPORTANT**: 本阶段不扫描源码仓库。

## Steps to 示例校验

### 1. 加载待校验文件

1. 接收用户指定的 User Story ID（如 `FT-001-US-02`）
2. 读取存在的 `.feature` 文件（`<story-id>.feature` 为 UI 层，`<story-id>.api.feature` 为 API 层，两者可独立存在）、示例分析文档和 User Story 卡片

**如果两个 .feature 文件都不存在**：提示用户先执行 `/asdm-test-spec-ui-generate <us-id>` 或 `/asdm-test-spec-api-generate <us-id>`

### 2. Gherkin 语法校验

逐项检查 `.feature` 文件的 Gherkin 语法正确性：

#### 2.1 文件结构校验

| 检查项 | 规则 | 严重级别 |
|--------|------|----------|
| 语言声明（仅 UI 层） | `@layer:ui` 文件首行应为 `# language: zh`（或 `en`） | ⚠️ 警告 |
| Feature 声明 | 文件必须以（语言声明之后的）`Feature:` 开头 | ❌ 错误 |
| Layer 标签 | 文件级必须有 `@layer:ui` 或 `@layer:api` 标签（与生成 action 对应） | ⚠️ 警告 |
| Feature 描述 | Feature 下应有用户故事描述 | ⚠️ 警告 |
| Scenario | 至少包含一个 `Scenario:` | ❌ 错误 |
| 未使用 Scenario Outline | 文件中不应出现 `Scenario Outline:` / `Examples:` / `<占位符>` | ❌ 错误 |
| Background | 若使用 Background，必须位于所有 Scenario 之前 | ❌ 错误 |
| 文件头注释（仅 api 层） | Feature 下方应有标注生成工具与依赖契约的注释 | ⚠️ 警告 |

#### 2.2 关键字与数据组织校验

| 检查项 | 规则 | 严重级别 |
|--------|------|----------|
| Given/When/Then | 每个 Scenario 必须包含 Given、When、Then | ❌ 错误 |
| 数据内联（UI 层） | 测试数据以引号字符串或数据表格直接内联，不使用 `<占位符>` | ❌ 错误 |
| 数据组织（api 层） | 前置数据用 DataTable，请求体/响应体用 DocString（`"""JSON"""`） | ❌ 错误 |
| 参数引号（api 层） | HTTP 方法/路径等步骤参数以双引号内嵌具体值，不使用占位符 | ❌ 错误 |
| DocString JSON 合法性（api 层） | DocString 内的 JSON 必须可被解析（无语法错误） | ❌ 错误 |
| 变量/字段命名合法性 | 内部标识（非展示文案）使用英文/拼音，避免中文和特殊字符 | ⚠️ 警告 |

#### 2.3 数据表格校验（DataTable，含 UI 层结果表格）

| 检查项 | 规则 | 严重级别 |
|--------|------|----------|
| 列数一致 | 每行数据的列数必须与表头一致 | ❌ 错误 |
| 含表头 | `Then` 步骤使用的结果表格必须包含表头行 | ❌ 错误 |

### 3. 测试覆盖率检查

检查 `.feature` 文件是否充分覆盖了 User Story 的所有验收标准。**覆盖率的判定标准按 `@layer:` 标签区分**，因为两层的生成范围不同（UI 层只产出 Happy Path，api 层按测试关注点拆分），不可用同一套"正常/边界/异常"标准套用到两层。

#### 3.1 AC 覆盖率（通用）

| 检查项 | 规则 | 严重级别 |
|--------|------|----------|
| AC 映射 | 每个 `Scenario` 应通过 Tag（`@AC-<编号>`）关联到具体 AC | ⚠️ 警告 |
| 无遗漏 AC（UI 层） | 每条 AC 至少有一个对应的 `Scenario`（Happy Path） | ❌ 错误 |
| 无遗漏 AC（api 层） | 每条涉及接口的 AC 至少有一个对应的 `Scenario`；不适用的 AC 应在生成摘要中说明跳过原因 | ⚠️ 警告 |

#### 3.2 UI 层数据覆盖（`@layer:ui`）

| 检查项 | 规则 | 严重级别 |
|--------|------|----------|
| Happy Path 覆盖 | 每条 AC 有且仅有 1 个 Happy Path `Scenario` | ❌ 错误 |
| 未额外生成边界/异常 | 不应出现边界值/异常值 Scenario（本阶段职责范围之外，如存在应提示转入后续迭代，而非计入错误） | ℹ️ 提示 |
| Then 可测试性 | 每个 `Then` 步骤含具体可测试数据值（引号字符串或含表头数据表格），不含"包含上述 N 条""展示以下字段"等抽象描述 | ❌ 错误 |
| UI 语言边界 | Given/When/Then 未出现 HTTP 方法、endpoint、状态码、JSON 等 API 语义 | ❌ 错误 |

#### 3.3 api 层测试关注点覆盖（`@layer:api`）

| 检查项 | 规则 | 严重级别 |
|--------|------|----------|
| 契约测试覆盖 | 涉及接口的 AC 至少有 1 个 `@api:contract` Scenario | ⚠️ 警告 |
| 边界值覆盖 | 涉及请求体字段约束的 AC 有 `@api:boundary` Scenario | ⚠️ 警告 |
| 错误码覆盖 | 涉及鉴权/校验的 AC 有 `@api:error` Scenario | ⚠️ 警告 |
| 关注点标签完整 | 每个 Scenario 都带有 `@api:contract`/`@api:boundary`/`@api:error` 之一 | ❌ 错误 |
| 待人工确认标注 | 使用假设值的边界值/错误码场景已标注"待人工确认" | ⚠️ 警告 |

#### 3.4 枚举覆盖率（两层通用，适用时）

| 检查项 | 规则 | 严重级别 |
|--------|------|----------|
| 枚举合理覆盖 | UI 层 Happy Path 至少覆盖 1 个核心合法枚举值；api 层枚举类型的每个合法值在契约/边界场景中至少出现一次 | ⚠️ 警告 |
| 枚举越界（仅 api 层） | `@api:boundary`/`@api:error` 场景中包含非法枚举值的用例 | ⚠️ 警告 |

### 4. Cucumber 可执行性验证

验证 `.feature` 文件能否被 Cucumber 正确解析和执行：

#### 4.1 解析验证

通过工具或人工检查确认：
- 文件可被 Gherkin 解析器无错误解析
- DataTable 各行列数与表头一致，DocString 闭合正确、JSON 合法（api 层）
- 无 Gherkin 语法级别的歧义

#### 4.2 Step 可自动化评估

评估每个 Given/When/Then 步骤是否可被自动化：
- 步骤描述是否清晰、无歧义
- 步骤中的操作是否可通过代码实现
- 标注需要人工编写 Step Definition 的步骤

### 5. 生成校验报告

创建校验报告，保存到：
`.aixcoding/workspace/specs/<feature-id>/<story-id>/<story-id>.validation-report.md`

**校验报告模板**：

```markdown
# <User Story ID> 示例校验报告

> 属于 User Story: <User Story ID> <User Story 名称>
> 属于 Feature: <Feature ID> <Feature Name>
> 校验对象: <story-id>.feature（@layer:ui）和/或 <story-id>.api.feature（@layer:api）

**校验状态**：{通过 / 需优化 / 需返工}
**校验日期**：{YYYY-MM-DD}

---

## 1. 校验摘要

| 校验维度 | 检查项数 | 通过 | 警告 | 错误 |
|----------|----------|------|------|------|
| Gherkin 语法 | {数量} | {数量} | {数量} | {数量} |
| 测试覆盖率 | {数量} | {数量} | {数量} | {数量} |
| Cucumber 可执行性 | {数量} | {数量} | {数量} | {数量} |
| **合计** | {数量} | {数量} | {数量} | {数量} |

## 2. Gherkin 语法校验

### 2.1 文件结构
| 检查项 | 结果 | 说明 |
|--------|------|------|
| Feature 声明 | ✅ 通过 | - |
| Layer 标签 | ✅ 通过 | @layer:{ui/api} |
| Scenario 数量 | ✅ 通过 | 共 {数量} 个（均为具体 Scenario，非 Scenario Outline） |
| 未使用 Scenario Outline/Examples | ✅ 通过 | 未发现 `Scenario Outline:` / `Examples:` / `<占位符>` |

### 2.2 关键字与数据组织
| 检查项 | 结果 | 说明 |
|--------|------|------|
| Given/When/Then 完整性 | ✅ 通过 | - |
| 数据内联/DataTable/DocString | ✅ 通过 | 未发现 `<占位符>` 或 `Examples:` |

### 2.3 数据表格
| 检查项 | 结果 | 说明 |
|--------|------|------|
| 列数一致 | ✅ 通过 | - |
| Then 表格含表头 | ✅ 通过 | - |

## 3. 测试覆盖率

### 3.1 AC 覆盖
| AC 编号 | AC 标题 | 对应 Scenario | 状态 |
|---------|---------|---------------|------|
| AC-1 | {标题} | Scenario: AC-1 ... | ✅ 已覆盖 |
| AC-2 | {标题} | Scenario: AC-2 ... | ✅ 已覆盖 |

### 3.2 数据覆盖（按 layer 区分）
**UI 层**：
| Scenario | Happy Path | Then 可测试性 | 状态 |
|----------|------------|---------------|------|
| Scenario: AC-1 ... | ✅ 1 例 | ✅ 具体数据值 | ✅ 完整 |

**api 层**：
| Scenario | @api:contract | @api:boundary | @api:error | 状态 |
|----------|----------------|----------------|------------|------|
| AC-1 相关场景 | {数量} 例 | {数量} 例 | {数量} 例 | ✅ 完整/⚠️ 部分 |

### 3.3 枚举覆盖
| 枚举类型 | 合法值 | 已覆盖值 | 缺失值 | 状态 |
|----------|--------|----------|--------|------|
| {枚举名} | {值1, 值2, 值3} | {已覆盖值} | {缺失值或"无"} | ✅ 完整/⚠️ 缺失 |

## 4. Cucumber 可执行性

### 4.1 解析验证
| 检查项 | 结果 | 说明 |
|--------|------|------|
| Gherkin 解析 | ✅ 通过 | 无语法错误 |
| DataTable/DocString 结构 | ✅ 通过 | 列数一致，JSON 合法（api 层） |

### 4.2 Step 自动化评估
| 步骤 | 可自动化 | 备注 |
|------|----------|------|
| Given {步骤} | ✅ 是 | 需编写 Step Definition |
| When {步骤} | ✅ 是 | 需编写 Step Definition |
| Then {步骤} | ✅ 是 | 需编写 Step Definition |

## 5. 优化建议

### 5.1 必须修复（错误）
1. {错误描述及修复建议}

### 5.2 建议优化（警告）
1. {警告描述及优化建议}

### 5.3 可选改进
1. {改进建议}

## 6. 校验结论

- **整体状态**: {通过 / 需优化 / 需返工}
- **错误数**: {数量}
- **警告数**: {数量}
- **建议**: {下一步行动建议}

---

**创建日期**：{YYYY-MM-DD}
**维护者**：AI Agent (asdm-test-automation)
```

### 6. 呈现校验摘要

向用户展示校验阶段的产出摘要：

```markdown
# 示例校验完成

## User Story 信息
- **User Story ID**: <us-id>
- **User Story 名称**: <name>

## 校验结果
- **整体状态**: {✅ 通过 / ⚠️ 需优化 / ❌ 需返工}
- **Gherkin 语法**: {通过/警告/错误}
- **测试覆盖率**: {通过/警告/错误}
- **Cucumber 可执行性**: {通过/警告/错误}

## 生成文件
- 校验报告: `.aixcoding/workspace/specs/<feature-id>/<story-id>/<story-id>.validation-report.md`

## 下一步
- 如有错误：根据校验报告修复 .feature 文件，重新执行 `/asdm-test-spec-validate <us-id>`
- 如已通过：.feature 文件可交付，进入测试代码生成阶段
```

## Execution Guidelines

### When to Use This Action

使用本 action 的场景：
- User Story 已通过 `asdm-test-spec-ui-generate` 生成 Gherkin `.feature` 文件
- 需要校验 `.feature` 文件的 Gherkin 语法正确性
- 需要验证测试覆盖是否充分（AC 覆盖、按 layer 区分的数据/关注点覆盖、枚举覆盖）
- `.feature` 文件交付前的质量把关

### 校验原则

1. **严格分级**：错误（❌）必须修复，警告（⚠️）建议优化，通过（✅）无需处理
2. **按层校验**：覆盖率判定按 `@layer:` 区分——UI 层核对 Happy Path 完整性与 Then 可测试性，api 层核对 `@api:contract`/`@api:boundary`/`@api:error` 关注点覆盖，不可用同一套"正常/边界/异常"标准套用到两层
3. **可执行性导向**：所有校验以确保 Cucumber 可正确执行为最终目标
4. **禁用 Outline**：发现 `Scenario Outline`/`Examples`/`<占位符>` 时，视为不符合当前规范，应在报告中作为"必须修复"项指出，引导改写为具体 `Scenario` + 内联数据/DataTable/DocString

### 错误处理

- **.feature 文件不存在**：提示用户先执行 `/asdm-test-spec-ui-generate <us-id>`
- **Gherkin 语法错误**：在校验报告中列出具体错误位置和修复建议
- **AC 未全覆盖**：列出缺失的 AC 编号，建议补充对应 `Scenario`
- **发现 Scenario Outline/Examples**：作为"必须修复"项，指出应改写为具体 `Scenario` + 内联数据

## Usage

To use this instruction, the AI model should:
1. 检测响应语言
2. 接收用户指定的 User Story ID
3. 读取 .feature 文件、示例分析文档和 User Story 卡片
4. 执行 Gherkin 语法校验（含"未使用 Scenario Outline/Examples"检查）
5. 执行测试覆盖率检查（AC 覆盖 + 按 layer 区分的数据/关注点覆盖 + 枚举覆盖）
6. 评估 Cucumber 可执行性
7. 生成校验报告并保存
8. 呈现校验摘要并提示下一步

## Output Summary

完成校验阶段后，将生成以下产出：
- 校验报告：`.aixcoding/workspace/specs/<feature-id>/<story-id>/<story-id>.validation-report.md`

所有文件保存在 `.aixcoding/workspace/specs/<feature-id>/<story-id>/` 目录下。

### Downstream Flow

```text
/asdm-test-spec-ui-generate <us-id>              ← 上一步：基于前端源码生成 UI 层 Gherkin .feature 文件（@layer:ui）
   和/或 /asdm-test-spec-api-generate <us-id>          ← （平行）基于后端源码生成 API 层 .feature 文件（@layer:api，HTTP 语义）
        │
        ▼
/asdm-test-spec-validate <us-id>              ← 当前步骤：校验语法与覆盖率（无源码依赖，校验两层文件）
        │
        ▼
/asdm-test-code-generate       ← 下一步：基于 .feature 文件生成可执行测试代码
```
