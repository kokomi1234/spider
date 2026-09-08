# ASDM 工具集 - ASDM 上下文构建器

## Overview

这个工具集是为项目设计的专用上下文构建工具，可以帮助项目完成上下文工程（Context Engineering）/知识工程的初始化，确保后续开发过程的稳定执行。同时提供更新工具，帮助项目在迭代过程中自动更新上下文知识库，确保上下文的持续准确性。

本工具集面向参与项目的开发团队和 AI 协作助手。它解决了 AI Agent 在辅助开发时对项目结构、技术栈、业务领域理解不足的问题——通过系统化的上下文采集、整理和维护机制，使 AI 能够准确理解项目全貌，从而在需求分析、代码编写、测试生成、代码审查等 SDLC 各阶段提供高质量的辅助支持。

## 功能特性

### 核心能力

本工具集的核心能力围绕项目上下文的生命周期管理展开，支持上下文的创建、更新和验证，确保 AI 代理始终拥有准确的项目知识。

### 功能一：上下文初始化（asdm-context-init）

自动扫描项目结构（包括前端、后端、数据库、配置等模块），采集关键信息并生成结构化的上下文文件。

**输入**：项目根目录路径
**输出**（L1/L2 两层结构）：
- **L1 层**：`.asdm/contexts/index.md` — 项目总览入口文件（必读）
- **L2 层**：`.asdm/contexts/layer-2/` 目录下：
  - `standard-project-structure.md` — 标准项目结构规范
  - `standard-coding-style.md` — 编码风格指南
  - `data-models.md` — 数据模型定义
  - `api.md` — API 接口文档
  - `architecture.md` — 系统架构说明
  - `deployment.md` — 部署配置说明

**使用场景**：首次接入项目、或需要重建项目上下文时使用

### 功能二：上下文更新（asdm-context-update）

在项目迭代过程中，检测代码变更并增量更新相关上下文文件，保持上下文与实际代码的同步。

**输入**：变更范围（如 git diff 范围、特定模块路径）或全量扫描模式
**输出**：已更新的上下文文件列表及变更摘要

**使用场景**：完成一次迭代发布后、重大重构后、或定期维护时使用

### 功能三：上下文验证（asdm-context-validate）

检查现有上下文文件的准确性，识别过时或不一致的内容，生成诊断报告。

**输入**：待验证的上下文文件或全量验证
**输出**：验证报告，包含过期项、不一致项和建议修复动作

**使用场景**：AI 辅助出现异常行为时、定期质量巡检时使用

## 安装说明

本工具集通过以下步骤完成安装：

1. 创建上下文存储目录 `.asdm/contexts/`
2. 检测当前 AI 助手类型（CodeBuddy / Claude Code / GitHub Copilot / Trae / Qoder / OpenCode）
3. 在对应目录注册工具集命令快捷方式
4. 复制动作指令文件到命令目录，使各命令可用

## 使用流程

安装完成后，用户可以使用以下命令：

| 命令 | 用途 |
|------|------|
| `/asdm-context-init` | 初始化项目上下文（首次使用或重建） |
| `/asdm-context-update [范围]` | 增量更新上下文（支持指定范围或全量） |
| `/asdm-context-validate` | 验证现有上下文的准确性 |

**推荐工作流**：
1. 项目首次接入 → 执行 `asdm-context-init` 完成初始化
2. 每次迭代结束后 → 执行 `asdm-context-update` 同步变更
3. 发现 AI 辅助异常时 → 执行 `asdm-context-validate` 诊断问题
4. 定期巡检（如每周）→ 执行 `asdm-context-validate` 确保质量

## 工具集结构

ASDM 上下文构建器工具集的目录结构如下：

```
.asdm/toolsets/asdm-context-builder/
├── README.md                              # 本文件 — 工具集说明文档
├── actions/
│   ├── asdm-context-init.md               # 上下文初始化动作指令
│   ├── asdm-context-update.md             # 上下文更新动作指令
│   └── asdm-context-validate.md           # 上下文验证动作指令
├── specs/
│   ├── layer-1/
│   │   └── index.md                       # L1 层入口规范模板（index.md 模板）
│   └── layer-2/
│       ├── standard-project-structure.md  # L2 层 — 项目结构规范模板
│       ├── standard-coding-style.md       # L2 层 — 编码风格规范模板
│       ├── data-models.md                 # L2 层 — 数据模型规范模板
│       ├── api.md                         # L2 层 — API 文档规范模板
│       ├── architecture.md                # L2 层 — 架构设计规范模板
│       └── deployment.md                  # L2 层 — 部署配置规范模板
└── docs/                                  # 扩展文档（预留）
```

## 工作区结构

ASDM 上下文构建器使用以下工作区结构来存储生成的上下文文件（采用 L1/L2 两层结构）：

```
.asdm/
├── contexts/                              # 项目上下文知识库
│   ├── index.md                           # ★ L1 层入口文件（必读）
│   │                                       #   — 全局概览、导航索引、开发指南
│   └── layer-2/                           # L2 层详细上下文
│       ├── standard-project-structure.md  # 标准项目结构与组织规范
│       ├── standard-coding-style.md       # 编码规范与风格指南
│       ├── data-models.md                 # 数据模型、关系与数据流
│       ├── api.md                         # API 接口定义与文档
│       ├── architecture.md                # 系统架构与技术决策
│       └── deployment.md                  # 部署配置与流程
└── workspace/
    └── asdm-context/                      # 工具集运行时工作区
        ├── scan-cache.json               # 扫描结果缓存
        └── validation-reports/           # 历次验证报告
            └── validation-{日期}.md
```

## 变更记录

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| v0.0.2 | 2026-05-28 | 扩展安装适配范围，新增 Trae、Qoder、OpenCode 三种代码助手支持 |
| v0.0.1 | 2026-05-16 | 初始版本，支持 CodeBuddy、Claude Code、GitHub Copilot |

## 版权与许可

Copyright (c) 2026 LeansoftX.com & iSoftStone. All rights reserved.

本软件受专有软件许可证保护。详见项目根目录下的 [LICENSE](LICENSE) 文件。
