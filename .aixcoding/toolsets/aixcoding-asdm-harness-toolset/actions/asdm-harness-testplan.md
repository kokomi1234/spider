# ASDM Action: Feature Test Plan

> **🔗 前置依赖**：本 action 的输入依赖于 **PRD 文档**（`FT-{id}-{name}-PRD.md`），即 `/asdm-harness-design-overall` 和 `/asdm-harness-design-details` 产出的完整产品需求文档。PRD 中的使用场景、验收条件 DoD 是生成测试计划的直接输入来源。

## Metadata

```json
{
  "name": "asdm-harness-testplan",
  "displayName": "测试计划生成",
  "description": "基于 PRD 文档生成结构化功能测试计划（Test Plan），以测试套件（Phase）组织测试用例（Task），每个用例包含明确的测试步骤，聚焦功能正确性验证",
  "toolset": {
    "id": "asdm-harness-toolset",
    "name": "ASDM 驾驭工程工具集",
    "version": "0.0.1"
  },
  "scenario": "feature-test"
}
```

## Language Setting

默认使用**中文（简体中文）**作为输出语言。

## Context Injection

使用 [context-loader](../../../.asdm/skills/context-loader/SKILL.md) 技能进行渐进式上下文加载。

### 本 Action 的加载策略

| Phase | Context | 用途 |
|:-----:|---------|------|
| L1 必读 | `index.md` | 建立项目全局认知 |
| L2 按需 | `api.md` | API 端点定义和响应格式，生成 curl 测试命令和预期断言 |
| L2 按需 | `data-models.md` | 数据模型定义，生成数据验证测试步骤 |
| Source | PRD 文档 | 使用场景和验收条件 DoD（测试计划核心输入） |

**IMPORTANT**: 在开始生成测试计划之前必须先读取 `../../../.asdm/contexts/index.md`。测试步骤中的 API 路径和预期响应格式必须基于 api.md 实际定义。

## Description

基于 PRD 文档生成结构化功能测试计划（TestPlan）。聚焦 **功能测试**——验证系统行为是否符合 PRD 定义的功能需求。采用与 Plan 类似的组织方式，以测试套件（Phase）聚合测试用例（Task），每个用例包含明确的 步骤→操作→预期结果，指引测试人员逐条验证功能正确性。

生成的 TestPlan 文档包含：

- **测试概述**：范围、目标、环境、前置条件
- **测试进度概要**：套件 → 用例 → 状态 → 覆盖功能
- **测试套件**：目标 + 多个测试用例
- **测试用例**：测试类型、前置条件、测试数据、**测试步骤（步骤→操作→预期结果）**
- **测试总结**：执行统计与通过率

> **⚠️ 前置条件**：使用本 action 前，**必须先通过 `/asdm-harness-design-overall` 和 `/asdm-harness-design-details` 完成 PRD 完整设计**。

## Usage

```text
/asdm-harness-testplan <FT-XXX 编码>
```

## Parameters

| 参数 | 必填 | 说明 |
| ------ | :----: | ------ |
| `feature_id` | ✅ | 特性编号，FT-XXX 格式 |

## Process

### ⛔ 前置条件检查

1. **定位 PRD 文档**：`../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-PRD.md`
2. **PRD 不存在** → 终止：

    ```text
    ❌ 前置条件不满足：未找到 PRD 文档。

    请先执行 /asdm-harness-design-overall FT-{id} 和 /asdm-harness-design-details FT-{id} 完成 PRD 设计。
    ```

3. **PRD 存在** → 通过：

    ```text
    ✅ 前置条件检查通过：PRD 文档存在

    继续生成测试计划...
    ```

---

### Step 1: 读取 PRD 文档

1. 读取 `FT-{id}-{name}-PRD.md` 完整内容
2. 提取以下信息作为测试计划输入：
   - **使用场景**（§2）→ 映射为测试套件
   - **验收条件 DoD**（§N）→ 映射为测试用例及验证点
   - **总体概述** → 确定测试范围和类型
   - **接口设计**（如有）→ 生成 API 测试步骤
   - **数据模型**（如有）→ 生成数据验证测试步骤

---

### Step 2: 规划测试套件

1. **从 PRD 使用场景生成测试套件**：
   - PRD 中的每个使用场景对应一个测试套件
   - 按场景优先级排序（核心场景 → 辅助场景 → 边界场景）

2. **从 DoD 补充异常和边界测试套件**：
   - 验收条件中未覆盖的异常路径 → 边界测试套件
   - 跨场景的集成验证 → 集成测试套件

3. **命名规则**：套件名应简洁描述测试目标

---

### Step 3: 生成测试用例

对每个测试套件，生成测试用例：

1. **用例拆分**：
   - 每个用例覆盖一个可独立验证的测试点
   - 正常路径 + 异常路径分别成用例

2. **编写测试步骤**（核心）：

    每个步骤使用统一格式：

    | 步骤 | 操作 | 预期结果 |
    | :----: | ------ | ------ |

    **操作编写规范**：
    - API 接口测试：使用 `curl` 命令，包含完整路径、参数和请求体
    - 前端 UI 测试：按「页面 → 按钮 → 输入 → 提交」描述操作路径
    - 数据库验证：使用查询命令验证数据状态

    **预期结果编写规范**：
    - HTTP 接口：明确状态码 + 关键响应字段断言
    - 数据库：明确查询应返回的行数、字段值
    - UI：明确页面展示内容或交互反馈

    **步骤覆盖要求**：
    - 前置准备步骤（数据准备、环境检查）
    - 核心执行步骤（按场景流程）
    - 验证确认步骤（断言检查）
    - 清理还原步骤（如需要）

3. **标注测试类型**：每个用例标注类型（功能测试 / 边界测试 / 异常测试）

---

### Step 4: 组装并写入 TestPlan 文档

读取 `../specs/test-spec.md`，按模板生成。

**输出路径**：`../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-TestPlan.md`

**文档章节**：

- 测试概述 + 测试环境 + 前置条件
- 测试进度概要表
- 各测试套件（Phase）含测试用例（Task）和步骤
- 测试总结（执行跟踪表 + 通过率）

---

### Step 5: 完成提示

```text
✅ 测试计划已生成！

📄 TestPlan 文档: ../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-TestPlan.md

📊 测试概览：
- 测试套件: N 个
- 测试用例: N 个
- 测试步骤: N 条

📌 使用方式：
- 测试人员可按照测试套件→测试用例→测试步骤逐条执行
- 每完成一条步骤可标记结果
- 在「测试总结」中跟踪整体通过率
```

---

## Purpose

- 基于 PRD 使用场景和验收条件生成结构化测试计划
- 每个测试用例包含明确的步骤化操作指引
- 为测试 Agent 或测试人员提供可逐条执行的测试清单
- 跟踪测试执行进度和通过率

## Input

- 特性编码 FT-XXX（必填）
- PRD 文档（自动读取）：`../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-PRD.md`

## Output

```json
{
  "phase": "test_planning",
  "status": "success",
  "feature_id": "FT-XXX",
  "feature_name": "string",
  "source_doc": ".asdm/workspace/asdm-harness/feat/FT-XXX-name/FT-XXX-name-PRD.md",
  "test_suites": [
    {
      "suite_number": 1,
      "suite_name": "套件名",
      "case_count": 3
    }
  ],
  "total_cases": 8,
  "total_steps": 40,
  "testplan_path": ".asdm/workspace/asdm-harness/feat/FT-XXX-name/FT-XXX-name-TestPlan.md",
  "timestamp": "ISO 8601 datetime"
}
```

## Downstream Flow

```text
/asdm-harness-design-details       ← 上一步：PRD 详细设计
/asdm-harness-develop              ← 上一步：开发实施（Feature 级，并行）
/asdm-harness-us-develop           ← 上一步：开发实施（US 级，全部 US 完成后）
        │
        ▼
/asdm-harness-testplan              ← 当前步骤：测试计划生成
```

## Spec Reference

- [test-spec.md](../specs/test-spec.md) — 测试计划文档结构与内容规范
