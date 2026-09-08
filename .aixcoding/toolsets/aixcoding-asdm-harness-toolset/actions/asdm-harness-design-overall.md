# ASDM Action: PRD 总体设计

> **🔗 前置依赖**：本 action 的输入依赖于 **AskMe 文档**（`FT-{id}-{name}-AskMe.md`），即 `/asdm-harness-askme` 产出的需求访谈文档。AskMe 中的已确认决策、变更范围等是 PRD 设计的直接输入来源。

## Metadata

```json
{
  "name": "asdm-harness-design-overall",
  "displayName": "PRD 总体设计",
  "description": "基于需求澄清结果，生成 PRD 核心章节（仅总体概述 + 使用场景），其余章节留给详细设计阶段",
  "toolset": {
    "id": "asdm-harness-toolset",
    "name": "ASDM 驾驭工程工具集",
    "version": "0.0.1"
  },
  "scenario": "feature-prd-design-overall"
}
```

## Language Setting

默认使用**中文（简体中文）**作为输出语言。所有生成的内容均使用中文，并遵循中文写作规范。

## Context Injection

使用 [context-loader](../../../.asdm/skills/context-loader/SKILL.md) 技能进行渐进式上下文加载。

### 本 Action 的加载策略

| Phase | Context | 用途 |
|:-----:|---------|------|
| L1 必读 | `index.md` | 建立项目全局认知 |
| L2 按需 | `architecture.md` | 确定变更影响范围 |
| Source | AskMe 文档 | 需求澄清结果 |

**IMPORTANT**: 在开始 PRD 总体设计之前必须先读取 `../../../.asdm/contexts/index.md`。

## Description

ASDM 驾驭工程的 PRD 总体设计阶段——基于 `/asdm-harness-askme` 的澄清结果，生成 PRD 的核心骨架：**总体概述**和**使用场景**两个章节。

> 详细设计（技术方案、数据模型、接口设计、验收条件 DoD 等）由独立的 `/asdm-harness-design-details` action 负责，基于 Code Research 结果补充。

> **⚠️ 前置条件**：使用本 action 前，必须先通过 `/asdm-harness-askme` 完成需求访谈，确保 AskMe 文档存在且所有决策点已确认。

## Usage

```text
/asdm-harness-design-overall <FT-XXX 编码>
```

必须提供特性编码 FT-XXX。如果仅提供自然语言描述，AI 将引导用户先使用 `/asdm-harness-askme` 获取特征编号。

---

## Process

### ⛔ 前置条件检查

1. **确定特性编码**：从用户输入中提取 FT-XXX 格式编码

2. **检查 AskMe 文档**：
   - 检查 `../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-AskMe.md`
   - **如不存在** → 终止，提示用户先执行 `/asdm-harness-askme`

3. **检查 AskMe 完成状态**：
   - 检查文档头部状态标记
   - 扫描所有决策点，确认均为 `✅ 已确认`

   a. 有未确认决策点 → 终止，列出未确认项，提示 `/asdm-harness-askme FT-{id}`

   b. 全部已确认 → 通过：

    ```text
    ✅ 前置条件检查通过：
    ✓ AskMe 文档存在
    ✓ 文档状态: 已完成
    ✓ 决策点: N 个已确认，0 个待确认

    继续进入 PRD 总体设计流程...
    ```

---

### ⛔ 硬约束

> **本 action 只能产出以下两个章节的内容，严禁产出其他任何章节**：

| 允许产出的章节 | 包含子节 |
|:---:|------|
| **1. 总体概述** | 1.1 背景与目标、1.2 核心概念、1.3 变更范围、1.4 关键决策 |
| **2. 使用场景** | 2.1~2.N 各场景（角色、前置条件、操作步骤、预期结果） |

**严禁在本阶段产出**：技术方案、数据模型、接口设计、系统架构、依赖关系、风险与缓解、验收条件 (DoD) 等任何超出「总体概述」和「使用场景」的内容。这些章节**必须由 `/asdm-harness-design-details` 负责**，基于 Code Research 结果再补充。

---

### 主流程

1. **提取 AskMe 信息**：
   - 特性概述（核心价值、变更范围）
   - 已确认决策及理由
   - 初始需求描述

2. **读取 PRD 模板**：读取 `../specs/prd-spec.md`

3. **编写 PRD 核心章节**（**仅产出以下内容**）：
   - 文档路径：`../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-PRD.md`
   - 创建特性目录（如不存在）
   - 填充固定骨架中的以下部分：
     - 修订记录（初始版本 1.0.0）
     - **目录**：只列出「1. 总体概述」和「2. 使用场景」两个章节（带可点击链接），其余章节标题以 `<!-- 阶段二补充：技术方案、数据模型、接口设计、依赖关系、风险与缓解、验收条件 (DoD) -->` 注释形式占位，**不加链接**
     - **1. 总体概述**（1.1 背景与目标、1.2 核心概念、1.3 变更范围、1.4 关键决策）
     - **2. 使用场景**（基于 AskMe 中澄清的交互流程，每个场景包含角色、前置条件、操作步骤、预期结果）
   - **严禁编写**：技术方案、数据模型、接口设计、系统架构、依赖关系、风险与缓解、验收条件 (DoD) 等任何超出「总体概述」和「使用场景」的内容
   - 目录中如有后续章节占位，正文中对应章节**只写章节标题 + 一行 `<!-- 阶段二补充 -->` 占位注释**，不写任何实质内容

4. **更新 overall-plan.md**：
   - 将特性状态从 `🟣 澄清中` → `🟠 设计中`
   - 更新特性名称列为指向 PRD 文档的 Markdown 链接

5. **完成提示**：

    ```text
    ✅ PRD 总体设计已完成！

    📄 PRD 文档: ../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-PRD.md
    📋 overall-plan.md 状态已更新：🟣 澄清中 → 🟠 设计中
    📝 已产出章节：1. 总体概述、2. 使用场景
    ⏳ 待详细设计补充：技术方案、数据模型、接口设计、依赖关系、风险与缓解、验收条件 (DoD)

    👉 下一步：
    - 若特性涉及 UI 且已有设计图 → 执行 /asdm-harness-design-parse FT-{id} 解析设计图
    - 否则直接执行 /asdm-harness-design-details FT-{id} 进行 Code Research 并补充详细设计章节
    ```

---

## Purpose

- 将已澄清的需求转化为 PRD 核心骨架（总体概述 + 使用场景）
- 定义功能边界、核心概念和关键决策
- 描述完整的使用场景和交互流程
- 为详细设计阶段提供明确的设计依据

## Input

- 特性编码 FT-XXX（必填）
- AskMe 文档（自动读取）
- 项目总体计划：`../../../.asdm/workspace/asdm-harness/overall-plan.md`

## Output

```json
{
  "phase": "prd_overall",
  "status": "success",
  "feature_id": "FT-XXX",
  "feature_name": "string",
  "prd_path": ".asdm/workspace/asdm-harness/feat/FT-XXX-name/FT-XXX-name-PRD.md",
  "chapters_produced": ["1. 总体概述", "2. 使用场景"],
  "chapters_pending": ["技术方案", "数据模型", "接口设计", "依赖关系", "风险与缓解", "验收条件 (DoD)"],
  "planning_updated": true,
  "next_action": "/asdm-harness-design-parse (可选) 或 /asdm-harness-design-details",
  "timestamp": "ISO 8601 datetime"
}
```

## Downstream Flow

```text
/asdm-harness-askme                 ← 上一步：需求访谈
        │
        ▼
/asdm-harness-design-overall        ← 当前步骤：PRD 总体设计
        │
        ▼
/asdm-harness-design-parse          ← 可选步骤：设计图解析（仅 UI 特性需要）
        │
        ▼
/asdm-harness-design-details        ← 下一步：PRD 详细设计
        │
        ▼
/asdm-harness-plan                  ← 后续：开发任务规划
```

## Spec Reference

- [prd-spec.md](../specs/prd-spec.md) — PRD 文档结构与内容规范
