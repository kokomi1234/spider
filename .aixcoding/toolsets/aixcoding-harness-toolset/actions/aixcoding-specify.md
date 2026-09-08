---
name: aixcoding-specify
description: '测试规格：Story AC→.feature+测试计划。按开发进度分层生成：开发前只生成 API 层 .feature，开发完成后补全 UI 层。基于 aixcoding-test-automation 工具集（analyze→api-generate/ui-generate→validate）。'
---

# aixcoding Specify — 测试规格

## 整合

| 原步骤 | 工具集                            | 集成方式 |
|--------|--------------------------------|----------|
| asdm-test-scenario-analyze | aixcoding-asdm-test-automation | AC 变量分析 + 测试维度 |
| asdm-test-spec-api-generate | aixcoding-asdm-test-automation | API 层 Gherkin .feature（开发前） |
| asdm-test-spec-ui-generate | aixcoding-asdm-test-automation | UI 层 Gherkin .feature（开发完成后） |
| asdm-test-spec-validate | aixcoding-asdm-test-automation | 语法 + 覆盖率校验 |
| asdm-harness-testplan | aixcoding-asdm-harness-toolset | 测试计划 |

## Input

| 输入项 | 来源 | 必填 |
|--------|------|:--:|
| Story ID | 用户 | ✅ |
| Story 卡片 | 03 `.aixcoding/workspace/stories/<feature-id>/<sid>.md` | 自动 |
| 技术方案 DoD | 02 `.aixcoding/workspace/design/<id>/` | 按需 |

## Workflow

先判断源码实现进度，按阶段生成对应层级的 .feature（**不再做 Code→Spec 校正**，避免重复动作）。

### 1. 测试计划

Follow aixcoding-asdm-harness-toolset asdm-harness-testplan action.

### 2. 示例分析

Follow aixcoding-asdm-test-automation asdm-test-scenario-analyze action.

### 3. 分层生成 .feature（按开发进度）

- **源码尚未实现（开发前）** → 只生成 **API 层**：
  - 优先确立接口契约/后端 DDL（入参、校验规则、返回结构），指导接口开发。
  - Follow aixcoding-asdm-test-automation asdm-test-spec-api-generate action，生成 `<story-id>.api.feature`。
  - **不生成** UI 层，不做校正。
- **源码已实现（开发完成、代码写好之后）** → 此时 api.feature 已在开发前生成，本次**追加生成 UI 层**：
  - Follow aixcoding-asdm-test-automation asdm-test-spec-ui-generate action，生成 `<story-id>.ui.feature`。
  - **不重复**生成已存在的 api.feature（api 已先行产出），不做校正。

### 4. 校验

Follow aixcoding-asdm-test-automation asdm-test-spec-validate action.

## Output

```
.aixcoding/workspace/specs/<feature-id>/<story-id>/
├── test-plan.md
├── example-analysis.md
├── <story-id>.api.feature     # 开发前生成，接口契约
├── <story-id>.ui.feature     # 开发完成后生成，UI 场景
└── validation-report.md
```

## Guardrails

- 开发前**只生成 API 层**，不生成 UI 层、不做 Code→Spec 校正。
- 开发完成后才补全 UI 层。

## 使用

`/aixcoding-specify <story-id>` 或 `--all`
