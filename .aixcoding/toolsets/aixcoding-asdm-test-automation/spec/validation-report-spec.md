# 校验报告规范

## Language Guidelines

本规范定义的文档必须使用环境检测到的响应语言。确保文档中所有内容遵循：

1. **语言一致性**: 整份文档使用同一种语言
2. **写作规范**: 遵循所使用语言的写作风格和格式要求
3. **表达清晰**: 确保内容在所选语言下清晰易懂

**支持的语言**:
- 中文（zh，默认）
- 英文（en）
- 其他基于环境检测的语言

---

## Overview

本规范定义了校验报告（`validation-report.md`）的结构和格式要求。此类文档用于记录 `asdm-test-spec-validate` action 对 Gherkin `.feature` 文件的校验结果，包括 Gherkin 语法校验、测试覆盖率检查和 Cucumber 可执行性验证。

**重要**：本阶段不依赖源码仓库。

**关键前提**：本工具集当前**不使用** `Scenario Outline` + `Examples` + `<占位符>` 模式。`asdm-test-spec-ui-generate`（`@layer:ui`）与 `asdm-test-spec-api-generate`（`@layer:api`）均产出具体场景 `Scenario:`，测试数据直接内联：
- UI 层：引号字符串或数据表格，且**只包含 Happy Path**（不含边界值/异常值）
- api 层：前置数据用 DataTable，请求体/响应体用 DocString，按 `@api:contract`/`@api:boundary`/`@api:error` 关注点拆分场景

若在 `.feature` 文件中发现 `Scenario Outline` + `Examples`，校验报告应将其标注为不符合当前规范（`feature-file-spec.md` / `api-feature-spec.md`），而非按合法写法核对占位符与表格。

**主要用途**:
- 作为 `asdm-test-spec-validate` action 的输出文档
- 记录 `.feature` 文件的语法、覆盖率和可执行性校验结果
- 提供优化建议，指导 `.feature` 文件的修正和改进

**校验维度**:
- Gherkin 语法正确性（含"未使用 Scenario Outline/Examples"检查）
- 测试覆盖率完整性（按 `@layer:` 区分判定标准：UI 层 = AC 覆盖 + Happy Path 完整性；api 层 = AC 覆盖 + 测试关注点覆盖）
- Cucumber 可执行性（解析验证、DataTable/DocString 结构、Step 自动化评估）

---

## Document Structure

使用以下模板结构生成校验报告：

```markdown
# <User Story ID> 示例校验报告

> 属于 User Story: <User Story ID> <User Story 名称>
> 属于 Feature: <Feature ID> <Feature Name>
> 校验对象: <story-id>.feature（@layer:ui）和/或 <story-id>.api.feature（@layer:api）

**校验状态**：<通过 / 需优化 / 需返工>
**校验日期**：<YYYY-MM-DD>

---

## 1. 校验摘要

| 校验维度 | 检查项数 | 通过 | 警告 | 错误 |
|----------|----------|------|------|------|
| Gherkin 语法 | <数量> | <数量> | <数量> | <数量> |
| 测试覆盖率 | <数量> | <数量> | <数量> | <数量> |
| Cucumber 可执行性 | <数量> | <数量> | <数量> | <数量> |
| **合计** | <数量> | <数量> | <数量> | <数量> |

## 2. Gherkin 语法校验

### 2.1 文件结构
| 检查项 | 结果 | 说明 |
|--------|------|------|
| Feature 声明 | <✅/⚠️/❌> | <说明> |
| Layer 标签 | <✅/⚠️/❌> | @layer:<ui/api> |
| Scenario 数量 | <✅/⚠️/❌> | 共 <数量> 个（均为具体 Scenario） |
| 未使用 Scenario Outline/Examples | <✅/❌> | <说明> |

### 2.2 关键字与数据组织
| 检查项 | 结果 | 说明 |
|--------|------|------|
| Given/When/Then 完整性 | <✅/⚠️/❌> | <说明> |
| 数据内联（UI 层） | <✅/⚠️/❌> | 引号字符串/数据表格，无 `<占位符>` |
| DataTable/DocString（api 层） | <✅/⚠️/❌> | <说明> |
| 变量/字段命名合法性 | <✅/⚠️/❌> | <说明> |

### 2.3 数据表格
| 检查项 | 结果 | 说明 |
|--------|------|------|
| 列数一致 | <✅/⚠️/❌> | <说明> |
| Then 表格含表头 | <✅/⚠️/❌> | <说明> |

## 3. 测试覆盖率

### 3.1 AC 覆盖
| AC 编号 | AC 标题 | 对应 Scenario | 状态 |
|---------|---------|---------------|------|
| AC-1 | <标题> | Scenario: AC-1 ... | <✅ 已覆盖/❌ 未覆盖> |
| AC-2 | <标题> | Scenario: AC-2 ... | <✅ 已覆盖/❌ 未覆盖> |

### 3.2 数据覆盖（按 layer 区分）

**UI 层**（仅 Happy Path）：
| Scenario | Happy Path 数据 | Then 可测试性 | 状态 |
|----------|------------------|---------------|------|
| Scenario 1 | <✅ 1 例> | <✅ 具体数据值/❌ 抽象描述> | <✅ 完整/❌ 需修复> |

**api 层**（按测试关注点）：
| AC | @api:contract | @api:boundary | @api:error | 状态 |
|----|-----------------|-----------------|-------------|------|
| AC-1 | <数量> 例 | <数量> 例 | <数量> 例 | <✅ 完整/⚠️ 部分> |

### 3.3 枚举覆盖
| 枚举类型 | 合法值 | 已覆盖值 | 缺失值 | 状态 |
|----------|--------|----------|--------|------|
| <枚举名> | <值1, 值2, 值3> | <已覆盖值> | <缺失值或"无"> | <✅ 完整/⚠️ 缺失> |

## 4. Cucumber 可执行性

### 4.1 解析验证
| 检查项 | 结果 | 说明 |
|--------|------|------|
| Gherkin 解析 | <✅/❌> | <说明> |
| DataTable 列数一致 | <✅/❌> | <说明> |
| DocString JSON 合法（api 层） | <✅/❌> | <说明> |

### 4.2 Step 自动化评估
| 步骤 | 可自动化 | 备注 |
|------|----------|------|
| Given <步骤> | <✅ 是/⚠️ 待评估> | <备注> |
| When <步骤> | <✅ 是/⚠️ 待评估> | <备注> |
| Then <步骤> | <✅ 是/⚠️ 待评估> | <备注> |

## 5. 优化建议

### 5.1 必须修复（错误）
1. <错误描述及修复建议>

### 5.2 建议优化（警告）
1. <警告描述及优化建议>

### 5.3 可选改进
1. <改进建议>

## 6. 校验结论

- **整体状态**: <通过 / 需优化 / 需返工>
- **错误数**: <数量>
- **警告数**: <数量>
- **建议**: <下一步行动建议>

---

**创建日期**：<YYYY-MM-DD>
**维护者**：AI Agent (asdm-test-automation)
```

**Key Elements**:
- 校验摘要：三维度校验结果的汇总统计表
- Gherkin 语法校验：文件结构（含"未使用 Scenario Outline/Examples"）、关键字与数据组织（区分 UI 层内联数据与 api 层 DataTable/DocString）、数据表格的逐项检查
- 测试覆盖率：AC 覆盖（通用）+ 按 `@layer:` 区分的数据覆盖标准（UI 层 = Happy Path 完整性；api = 测试关注点覆盖）+ 枚举覆盖
- Cucumber 可执行性：解析验证（含 DocString JSON 合法性）和 Step 自动化评估
- 优化建议：分错误/警告/改进三级提供具体建议
- 校验结论：整体状态和下一步行动建议

---

## Section Guidelines

### 1. 校验摘要

**要求**：
- 汇总三个校验维度的检查项数量和结果分布
- 结果分三级：通过（✅）、警告（⚠️）、错误（❌）

**状态判定规则**：
| 条件 | 整体状态 |
|------|----------|
| 0 错误，0 警告 | 通过 |
| 0 错误，≥1 警告 | 需优化 |
| ≥1 错误 | 需返工 |

### 2. Gherkin 语法校验

**检查项**：语言声明（UI 层）、Feature 声明、Layer 标签、Scenario 数量、未使用 `Scenario Outline`/`Examples`/`<占位符>`、Background 位置、Given/When/Then 完整性、数据内联方式（UI 层引号字符串/数据表格；api 层 DataTable/DocString）、变量与字段命名合法性、数据表格列数一致、Then 表格含表头

### 3. 测试覆盖率

**判定标准按 `@layer:` 区分**：

- **AC 覆盖（通用）**：每条 AC（api 层为涉及接口的 AC）至少有一个对应 `Scenario`
- **UI 层数据覆盖**：每条 AC 有且仅有 1 个 Happy Path `Scenario`；不要求边界值/异常值（本阶段职责范围之外）；`Then` 步骤须逐项核对是否含具体可测试数据值
- **api 层测试关注点覆盖**：涉及接口的 AC 应覆盖 `@api:contract`（契约）/`@api:boundary`（字段边界，如涉及请求体约束）/`@api:error`（错误码，如涉及鉴权/校验）中的适用项，不强求三者全覆盖
- **枚举覆盖**：枚举类型的每个合法值在正常路径/契约场景中至少出现一次；api 层的 `@api:boundary`/`@api:error` 场景应覆盖非法枚举值

### 4. Cucumber 可执行性

**检查项**：
- 解析验证：Gherkin 解析无错误、DataTable 列数一致、DocString 闭合正确且 JSON 合法（api 层）
- Step 自动化评估：步骤描述清晰、可代码实现

### 5-6. 优化建议与校验结论

**要求**：
- 优化建议按错误/警告/改进三级分组，每条具体可操作
- 若发现 `Scenario Outline`/`Examples`/`<占位符>` 残留，须作为"必须修复（错误）"项，指出应改写为具体 `Scenario` + 内联数据/DataTable/DocString

---

## Usage Guidelines

生成校验报告时：

1. **加载文件**：读取 `.feature` 文件（区分 `@layer:ui` / `@layer:api`）、示例分析文档和 User Story 卡片
2. **语法校验**：逐项检查 Gherkin 语法正确性，确认未使用 `Scenario Outline`/`Examples`
3. **覆盖率检查**：按 layer 核对 AC 覆盖，UI 层核对 Happy Path 完整性与 Then 可测试性，api 层核对测试关注点覆盖
4. **可执行性评估**：验证 Gherkin 解析、DataTable/DocString 结构，评估 Step 自动化可行性
5. **生成建议**：按严重级别整理优化建议
6. **得出结论**：判定整体状态，提供下一步建议

**重要**：
- 本阶段不扫描源码仓库
- 两层的校验标准不同，不可用同一套"正常/边界/异常"标准套用到 UI 层

---

## Output Format

**格式**: Markdown
**位置**: `.aixcoding/workspace/specs/<feature-id>/<story-id>/<story-id>.validation-report.md`
**命名**: 使用 User Story ID 作为前缀，如 `<story-id>.validation-report.md`

---

## Related Documents

- **example-analysis-spec.md**: 示例分析文档规范，校验变量和维度一致性的基准
- **feature-file-spec.md**: UI 层（`@layer:ui`）Gherkin `.feature` 文件规范，校验语法和结构时的基准
- **api-feature-spec.md**: API 契约层（`@layer:api`）Gherkin `.feature` 文件规范，校验语法和结构时的基准

本规范被以下 action 使用：
- **Action: asdm-test-spec-validate**: 生成校验报告时遵循本规范

---

## Checklist

- [ ] 校验摘要表包含三个维度的统计数据
- [ ] Gherkin 语法校验逐项检查，每项有结果和说明
- [ ] 已确认文件未使用 `Scenario Outline`/`Examples`/`<占位符>`
- [ ] AC 覆盖表列出所有 AC 及其对应 Scenario
- [ ] UI 层核对了 Happy Path 完整性与 Then 可测试性
- [ ] api 层核对了 `@api:contract`/`@api:boundary`/`@api:error` 关注点覆盖
- [ ] 枚举覆盖表列出合法值、已覆盖值和缺失值
- [ ] Cucumber 可执行性包含解析验证（含 DocString JSON 合法性）和 Step 评估
- [ ] 优化建议按错误/警告/改进三级分组
- [ ] 校验结论包含整体状态
- [ ] 日期格式为 YYYY-MM-DD
