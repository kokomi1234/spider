# ASDM Action: Feature Ask Me

## Metadata

```json
{
  "name": "asdm-harness-askme",
  "displayName": "需求访谈追问",
  "description": "通过结构化追问访谈用户，澄清和精炼特性需求，产出完整可执行的需求规格",
  "toolset": {
    "id": "asdm-harness-toolset",
    "name": "ASDM 驾驭工程工具集",
    "version": "0.0.1"
  },
  "scenario": "feature-elicitation"
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
| L2 按需 | `architecture.md` | 判断特性是否跨服务 |
| L2 按需 | `standard-project-structure.md` | 定位受影响模块 |
| Source | Controller/Service 源码 | 优先探索代码库，基于证据提供推荐方案，减少冗余提问 |

**IMPORTANT**: 在开始访谈之前必须先读取 `../../../.asdm/contexts/index.md`。对于每个决策点，先扫描代码库再向用户提问。

## Main Workflow

通过系统化的结构化追问，逐维度探索需求的每一个层面——功能范围、用户故事、验收标准、边界条件、依赖约束和成功指标——直到产出完整、无歧义、可执行的需求规格。

**如果可以**通过探索代码库（现有模式、相似功能、API、数据模型）获取信息，则应**优先探索代码库**，然后再向用户提问。对于每个问题，基于上下文提供 AI 的推荐方案。

### When No Feature Is Specified

如果用户调用此 action 时**未指定**新特性或待澄清的特性：

1. 读取 `../../../.asdm/workspace/asdm-harness/overall-plan.md` 了解当前项目规划
2. 查看特性清单：
   - **实现中** — 当前正在开发的特性
   - **规划中** — 已识别但尚未设计的特性
   - **已实现** — 已交付的特性
3. 分析规划中的能力缺口：
   - 现有模块是否有未满足的用户需求？
   - 是否有跨模块的横切关注点未被覆盖？
   - 是否有大量 🔵 规划中项可以整合为一个新特性？
4. 基于缺口分析向用户提出候选特性，包括：
   - 属于哪个模块
   - 为什么需要（业务价值 / 问题描述）
   - 建议的优先级
5. 让用户选择要探索的候选，随后进入标准访谈流程

### When a New Feature Is Specified

如果用户调用此 action **指定了**一个新特性（非已有 FT-xxx 标识）：

1. **确定 Feature ID**：读取 `../../../.asdm/workspace/asdm-harness/overall-plan.md`，从特性清单中找到当前最大 FT-xxx 编号，取下一个可用 ID（格式 `FT-{id}`，从 FT-001 起始）
2. **确认负责人**：如果用户未指定负责人，**必须询问用户**指定负责人姓名后再继续
3. **创建特性工作目录**：`../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/`
4. **创建 AskMe 文档**：`../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-AskMe.md`，使用下方模板
5. **注册到总体计划**：在 `../../../.asdm/workspace/asdm-harness/overall-plan.md` 的「当前迭代特性」表格中插入新特性行：
   - 编号：`FT-{id}`
   - 特性名称：链接到 AskMe 文档
   - 优先级：`P1`（除非用户指定其他优先级）
   - 状态：`🟣 澄清中`
   - 说明：从用户描述中提取的一句话摘要
6. 进入标准访谈流程（步骤 1–6），每完成一个问题**持续更新 AskMe 文档**：
   - 随着理解深入更新背景摘要
   - 对每个不明确的决策点，添加决策点章节（问题→背景→选项表→推荐→状态）
   - 当决策点新增或解决时，更新决策汇总表
   - 在回答记录中逐条记录已确认的回答及日期
   - 将决策点状态从 `⏳ 待确认` 更新为 `✅ 已确认`
   - 同步更新文档顶部的状态字段

#### AskMe Document Template

Agent **必须**遵循以下模板结构生成 AskMe 文档。保留所有一级章节为必填项。

```markdown
# FT-{id} {Feature Name} — 需求访谈追问

> 本文档记录对 FT-{id} {Feature Name} 特性的逐问题追问，用于澄清需求模糊点后制定最终需求规格。

**创建日期**：{YYYY-MM-DD}
**负责人**：{姓名}
**状态**：待回答

---

## 背景摘要

<!-- Agent 在此撰写特性背景 -->

### 核心价值

<!-- 描述该特性要解决的核心问题和业务价值 -->

### 变更范围

| 变更模块 | 变更内容 |
| ---------- | ---------- |
| <!-- 模块名 --> | <!-- 变更描述 --> |

### 初始需求

<!-- 用户原始需求描述 -->

---

## 决策点

<!-- 逐个决策点，每个决策点遵循以下结构 -->

### 决策点 {N}：{决策标题}

**问题**：{需要决策的核心问题}

**背景**：
- {补充决策所需的上下文信息}

**选项**：

| 选项 | 描述 | 优点 | 缺点 |
| ------ | ------ | ------ | ------ |
| A | {选项描述} | {优点} | {缺点} |
| B | {选项描述} | {优点} | {缺点} |

**推荐**：✅ 选项 X — {推荐方案简述}

**确认理由**：
1. {理由1}
2. {理由2}

**状态**：⏳ 待确认

---

## 决策汇总

| # | 决策 | 推荐方案 | 状态 |
| --- | ------ | ---------- | ------ |
| 1 | {决策标题} | {推荐方案} | ⏳ 待确认 |

---

## 回答记录

> 以下由用户逐一回答后填写

### 决策点 {N} 回答

**回答**：✅ {回答内容}
**日期**：{YYYY-MM-DD}

---

## 关联文档

- [项目总体计划](../../overall-plan.md) — 项目规划总览

---

**文档版本**：0.1
**创建日期**：{YYYY-MM-DD}
**最后更新**：{YYYY-MM-DD}
**维护者**：AI Agent (asdm-harness)
```

##### 模板使用规则

1. **标题格式**：`# FT-{id} {Feature Name} — 需求访谈追问`，副标题统一使用"需求访谈追问"
2. **引用块**：标题下方的引用块固定描述文档用途，不可省略
3. **创建日期与状态**：紧跟引用块，状态可选值为 `待回答` / `进行中` / `已完成`
4. **背景摘要**：必填，至少包含特性背景概述；`核心价值`、`变更范围`、`初始需求` 子节按需使用
5. **决策点**：核心章节，每个待澄清的决策点必须按模板结构组织（问题→背景→选项表→推荐→确认理由→状态）
6. **决策汇总表**：必填，所有决策点的概览，便于快速浏览
7. **回答记录**：必填，用户确认后逐条记录回答内容和日期
8. **关联文档**：必填，至少包含项目总体计划的链接
9. **文档元信息**：必填，包含版本、创建日期、最后更新、维护者——其中**日期全部使用 `####-##-##` 格式的 Markdown 注释**，由 AI 在生成文档时替换为实际日期

### When an Existing Feature Is Specified

如果用户指定了已有的 FT-xxx 标识：

1. 定位并读取 `../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/` 目录下的已有特性文档
2. 检查是否已存在 `-AskMe.md`；如果存在，从中断处继续访谈
3. 如果不存在 `-AskMe.md`，根据已有内容初始化一份新的 AskMe 文档
4. 聚焦上次规格之后的新增需求、遗留模糊点或变更

---

## Purpose

- 通过结构化访谈获取完整需求
- 澄清用户意图中的模糊点和矛盾
- 识别边界条件、约束和非功能需求
- 产出可进入设计阶段的可执行需求规格
- 利用代码库知识减少冗余提问

## Steps

1. 理解用户的初始特性描述
2. 探索代码库获取上下文：现有模式、相关功能、数据模型
3. 将不明确点结构化为 AskMe 文档中的 **决策点**，每个包含：
   - 清晰的 **问题** 陈述
   - 帮助用户做出知情决策的 **背景** 信息
   - 列出可行替代方案的 **选项** 表（描述/优点/缺点）
   - 基于代码库证据和最佳实践的 **推荐** 方案及 **确认理由**
   - **状态** 字段（⏳ 待确认 → ✅ 已确认）
4. 逐个向用户呈现决策（或批量呈现相关决策），获取确认或替代选择
5. 将每个已确认的回答记录在 **回答记录** 章节，更新 **决策汇总** 表
6. 将边界条件和错误处理需求作为额外的决策点提出
7. 所有决策确认完毕后，整理完整需求规格

## Input

- 用户的特性描述或想法（可粗略也可详细）——**如未指定特性则为空**
- 已有 FT-xxx 标识（如果是细化已存在特性）
- 代码库探索工作区上下文
- 项目总体计划：`../../../.asdm/workspace/asdm-harness/overall-plan.md`（未指定特性时使用）

## Output

### 访谈进行中输出（持续更新）

```json
{
  "phase": "elicitation",
  "status": "in_progress",
  "feature_id": "FT-XXX",
  "feature_name": "string",
  "document_path": ".asdm/workspace/asdm-harness/feat/FT-XXX-name/FT-XXX-name-AskMe.md",
  "decisions_asked": 5,
  "decisions_resolved": 3,
  "decisions_pending": 2,
  "timestamp": "ISO 8601 datetime"
}
```

### 访谈完成输出

```json
{
  "phase": "elicitation",
  "status": "completed",
  "feature_id": "FT-XXX",
  "feature_name": "string",
  "document_path": ".asdm/workspace/asdm-harness/feat/FT-XXX-name/FT-XXX-name-AskMe.md",
  "total_decisions": 8,
  "resolved_decisions": 8,
  "key_decisions": ["decision 1", "decision 2"],
  "next_steps": [
    "执行 /asdm-harness-design-overall FT-XXX 进入 PRD 总体设计",
    "执行 /asdm-harness-plan FT-XXX 进入开发任务规划"
  ],
  "timestamp": "ISO 8601 datetime"
}
```

## Downstream Flow

```text
/asdm-harness-askme                 ← 当前步骤：需求访谈
        │
        ▼
/asdm-harness-design-overall        ← PRD 总体设计（基于澄清结果）
        │
        ▼
/asdm-harness-design-parse          ← 可选：设计图解析（仅 UI 特性需要）
        │
        ▼
/asdm-harness-design-details        ← PRD 详细设计
        │
        ▼
/asdm-harness-plan                  ← 开发任务拆解（基于 PRD）
```

### 推荐流程

1. **需求访谈**：`/asdm-harness-askme` → 生成 AskMe 文档
2. **总体设计**：`/asdm-harness-design-overall` → 生成 PRD 总体概述 + 使用场景
3. **设计图解析**（可选）：`/asdm-harness-design-parse` → 将 UI 设计图解析为结构化规格文档
4. **详细设计**：`/asdm-harness-design-details` → 补充技术方案、数据模型、验收条件
5. **任务规划**：`/asdm-harness-plan` → 生成可执行开发计划
