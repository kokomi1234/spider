# ASDM Action: Workspace Initialization

## Metadata

```json
{
  "guid": "c8d9e0f1-2a3b-4c5d-6e7f-8a9b0c1d2e3f",
  "name": "asdm-harness-init",
  "displayName": "驾驭工作区初始化",
  "description": "初始化 ASDM 驾驭工作区——创建工作区目录骨架，从项目上下文中自动采集信息并生成项目总体计划（overall-plan.md）",
  "toolset": {
    "id": "asdm-harness-toolset",
    "name": "ASDM 驾驭工程工具集",
    "version": "0.0.1"
  },
  "scenario": "workspace-init"
}
```

## Language Setting

默认使用**中文（简体中文）**作为输出语言。所有生成的内容均使用中文，并遵循中文写作规范。

## Description

初始化 ASDM 项目的驾驭工作区，为 AI 优先研发流程准备运行环境。本 action 是 ASDM 驾驭工作流的**入口**——完成工作区目录创建和总体计划生成后，其他 action（askme / design / plan / develop / testplan / verify）方可正常运行。

核心职责：
- 创建工作区目录骨架（`.asdm/workspace/asdm-harness/`）
- 从项目上下文自动采集项目信息（名称、技术栈、服务拓扑、模块清单等）
- 按 `overall-plan-spec.md` 模板生成项目总体计划

> **使用时机**：项目首次接入 ASDM 驾驭流程时执行。如果工作区已初始化（存在 `overall-plan.md`），将询问用户是否覆盖。

## Usage

```text
/asdm-harness-init
```

无需参数。所有项目信息从 `.asdm/contexts/index.md` 和项目 `README.md` 自动采集。

## Context Injection

使用 [context-loader](../../../.asdm/skills/context-loader/SKILL.md) 技能进行渐进式上下文加载。

### 本 Action 的加载策略

| Phase | Context | 用途 |
|:-----:|---------|------|
| L1 必读 | `index.md` | 建立项目全局认知：项目名称、技术栈、服务拓扑 |
| L2 按需 | `architecture.md` | 确认服务间关系 |
| L2 按需 | `standard-project-structure.md` | 项目完整目录结构 |
| Spec 必读 | `README.md`, `overall-plan-spec.md` | 项目概述 + overall-plan 模板规范 |

**IMPORTANT**: 在开始执行步骤之前必须先读取 `../../../.asdm/contexts/index.md`。

## Process

### 1. 检查工作区状态

1. 检查 `../../../.asdm/workspace/asdm-harness/` 目录是否存在
2. 检查 `../../../.asdm/workspace/asdm-harness/overall-plan.md` 是否已存在

如果已经存在：

```text
⚠️ 工作区已初始化：
   ../../../.asdm/workspace/asdm-harness/overall-plan.md 已存在

   选择操作：
   A. 覆盖 — 重新生成 overall-plan.md（现有文件将被重命名为 .bak）
   B. 跳过 — 保留现有文件，仅创建缺失的目录
   C. 取消 — 退出初始化

   请输入 A / B / C：
```

根据用户选择执行对应操作。选项 B 跳至步骤 2（仅创建缺失目录），选项 C 终止。

### 2. 创建目录结构

按 README.md 定义的工作区结构创建所有目录：

```bash
mkdir -p .asdm/workspace/asdm-harness/feat
```

创建完成后输出：

```text
✅ 工作区目录已创建：
   ../../../.asdm/workspace/asdm-harness/
   └── feat/                          # 特性工作目录
```

### 3. 采集项目信息

从已读取的上下文中提取以下信息填充 overall-plan.md：

#### 3.1 项目概述

| 字段 | 来源 | 提取方法 |
|------|------|----------|
| 项目名称 | `../../../.asdm/contexts/index.md` → 基本信息.名称 | 直接读取 |
| 项目定位 | `../../../README.md` → 项目概述 第 1 段 | 提取一句话定位 |
| 核心技术栈 | `../../../.asdm/contexts/index.md` → 基本信息.技术栈 | 直接读取 |
| 核心能力 | `../../../README.md` → 核心特性 + 服务表 | 提取 3~5 项核心能力表述 |

#### 3.2 产品规划范围

| 字段 | 来源 | 提取方法 |
|------|------|----------|
| 代码库列表 | `README.md` → 项目组件结构表 | 提取目录路径 + 描述 |
| 分支 | git branch 当前分支（或默认 `main`） | 执行 `git branch --show-current` |

代码库清单按从 L2 context（`architecture.md` + `standard-project-structure.md`）读取的实际项目结构填写。

#### 3.3 功能模块

从 L2 context（`architecture.md`）中提取服务/模块清单，按 `{编号} | {模块名} | {代码库目录}` 格式填入表格。

> **警告**：不要硬编码任何模块或代码库路径。所有项目结构信息必须从 context-loader 注入的上下文中实际读取，如有差异以实际为准。

#### 3.4 日期与版本

- 所有日期字段填入当前日期（`YYYY-MM-DD`）
- 迭代版本设为 `v0.0.1`
- 特性清单初始为空（仅保留状态说明，无具体特性行）

### 4. 生成 overall-plan.md

读取 `../specs/overall-plan-spec.md`，按模板生成 `../../../.asdm/workspace/asdm-harness/overall-plan.md`。

#### 生成规则

1. **模板骨架保留**：保留 spec 中定义的所有章节（概述 → 产品规划范围 → 核心概念 → 分支策略 → 团队协作流程 → 功能模块 → 迭代信息 → 特性清单 → 更新日志）

2. **占位符替换**：将 `<项目名称>` 替换为从 `index.md` 读取的实际项目名称，将 `<一句话项目定位>` 替换为从 `README.md` 提取的定位描述

3. **特性清单为空**：特性清单保留「特性状态说明」和「状态流转」两个子节，但「当前迭代特性」表格初始为空（或添加一条占位说明）

4. **日期全用当前日期**：`{YYYY-MM-DD}` 替换为实际日期，`最后更新` 和 `创建日期` 使用当前日期

5. **代码库按实际填写**：产品规划范围表填入步骤 3.2 收集的代码库清单

6. **核心概念保留**：保留 spec 中模块与特性的定义说明，不需要修改

7. **分支策略保留模板**：分支策略使用模板中定义的标准分支命名

8. **迭代里程碑**：当前日期标记为「项目启动 ✅ 已完成」，其他阶段为 ⏳ 待开始

### 5. 输出完成摘要

```text
✅ {项目名称} 驾驭工作区初始化完成！

📄 overall-plan.md: ../../../.asdm/workspace/asdm-harness/overall-plan.md
📁 工作区目录: ../../../.asdm/workspace/asdm-harness/

📊 项目概览：
   项目名称: {从 index.md 读取}
   技术栈: {从 index.md 读取}
   服务数: {从 architecture.md 统计}
   模块数: {从 architecture.md 统计}

📌 后续流程：
   1. /asdm-harness-askme             → 需求访谈，消除需求歧义
   2. /asdm-harness-design-overall    → PRD 总体设计，生成总体概述 + 使用场景
   3. /asdm-harness-design-details    → PRD 详细设计，补充技术方案与验收条件
   4. /asdm-harness-plan              → 任务拆解，生成可执行开发计划
   5. /asdm-harness-develop           → 编码实施，逐任务实现与验证
   6. /asdm-harness-testplan          → 测试计划，生成功能测试套件
   7. /asdm-harness-verify            → 功能验收，生成验收报告

   推荐从 /asdm-harness-askme 开始 →
```

## Purpose

- 初始化 ASDM 驾驭工作区，为 AI 优先研发流程准备运行环境
- 从项目上下文自动采集并生成项目总体计划（overall-plan.md）
- 建立工作区目录骨架（feat / sessions / reports / cache）
- 为后续所有驾驭 action 提供统一的执行基础

## Input

- 项目上下文索引：`../../../.asdm/contexts/index.md`（自动读取）
- 项目 README：`../../../README.md`（自动读取）
- overall-plan 模板规范：`../specs/overall-plan-spec.md`（自动读取）

## Output

```json
{
  "phase": "init",
  "status": "success",
  "workspace_path": ".asdm/workspace/asdm-harness/",
  "files_created": [
    ".asdm/workspace/asdm-harness/overall-plan.md"
  ],
  "directories_created": [
    ".asdm/workspace/asdm-harness/feat/"
  ],
  "project_summary": {
    "name": "{从 index.md 读取}",
    "tech_stack": "{从 index.md 读取}",
    "services": "{从 architecture.md 统计}",
    "modules": "{从 architecture.md 统计}"
  },
  "next_steps": [
    "执行 /asdm-harness-askme 启动需求访谈",
    "或手动编辑 overall-plan.md 补充项目特定信息"
  ],
  "timestamp": "ISO 8601 datetime"
}
```

## Downstream Flow

```text
/asdm-harness-init                  ← 当前步骤：工作区初始化
        │
        ▼
/asdm-harness-askme                 ← 下一步：需求访谈
        │
        ▼
/asdm-harness-design-overall        ← PRD 总体设计
        │
        ▼
/asdm-harness-design-details        ← PRD 详细设计
```

## Spec Reference

- [overall-plan-spec.md](../specs/overall-plan-spec.md) — 项目总体计划模板规范与填充规则
