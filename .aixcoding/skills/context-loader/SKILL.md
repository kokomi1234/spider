---
name: context-loader
description: 'Progressive context loading methodology for AI agents. Implements L1 → L2 → Source three-layer architecture to load only relevant project context, minimizing token waste and maximizing AI decision quality. Use this skill whenever an action needs to read project context from .aixcoding/contexts/. Triggers for: (1) Loading project overview before any task, (2) Navigating to domain-specific L2 indices, (3) Locating source files guided by L2 navigation'
license: Proprietary. See LICENSE.txt for complete terms
---

# Context Loader Skill — 渐进式上下文加载

## Overview

本技能封装 **L1 → L2 → Source** 三层渐进式加载方法论，为 AI 代理提供标准化的项目上下文导航能力。核心原则：不追求让 AI "知道一切"，而是建立高效的导航系统，让 AI 在需要时快速定位相关信息。

## 三层架构

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: 项目顶层索引 (L1)                                  │
│  ─────────────────────────────────────────────────────────   │
│  大小限制: < 2 KB                                            │
│  加载时机: AI 启动时必读                                      │
│  文件位置: .aixcoding/contexts/index.md                           │
│  内容: 项目概述 + 技术栈 + 服务拓扑 + L2 导航入口              │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: 领域/模块索引 (L2)                                 │
│  ─────────────────────────────────────────────────────────   │
│  大小限制: < 8 KB / 领域                                     │
│  加载时机: 任务涉及该领域时按需加载                             │
│  文件位置: .aixcoding/contexts/layer-2/*.md                       │
│  内容: 领域概述 + 子模块列表 + 入口文件路径 + 核心实体摘要     │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: 源码 (Source)                                      │
│  ─────────────────────────────────────────────────────────   │
│  大小限制: 无硬性限制（按单个文件读取）                         │
│  加载时机: 根据 L2 索引导航，直接定位到具体文件                  │
│  内容: 源码文件 + DDL + 配置文件                              │
└─────────────────────────────────────────────────────────────┘
```

## 黄金数字：粒度控制标准

| 层级 | 大小上限 | 设计理由 |
|------|---------|---------|
| **L1 顶层索引** | **< 2 KB** | 启动必读，必须极致轻量 |
| **L2 领域索引** | **< 8 KB / 领域** | 平衡完整性与效率 |
| **单次加载总量** | **< 50 KB** | 为对话和推理预留空间 |
| **领域数量** | **5-10 个** | 符合人类认知负荷（Miller's Law: 7±2） |

## 渐进式披露工作流

```
用户启动 AI 会话
       │
       ▼
Phase 0: 初始化 → 读取 .aixcoding/contexts/index.md (L1)
       │           获知: 项目名称、技术栈、服务拓扑、L2 导航
       │
       ▼
用户输入任务
       │
       ▼
Phase 1: 领域定位 → AI 分析 L1，识别任务涉及的服务/模块
       │             匹配到对应的 L2 索引文件
       │
       ▼
Phase 2: 领域展开 → 读取 .aixcoding/contexts/layer-2/<domain>.md (L2)
       │             获知: 子模块列表、入口文件、数据模型摘要
       │
       ▼
Phase 3: 精准定位 → 根据 L2 索引导航到具体源码文件
       │             仅读取与当前任务直接相关的文件
       │
       ▼
Phase 4: 任务执行 → AI 基于精准上下文执行操作
```

## Token 预算分配（以 100K 窗口为例）

| 用途 | Token 数 | 占比 |
|------|---------|:----:|
| System prompt | 2,000 | 2% |
| Conversation history | 15,000 | 15% |
| **Context loading** ★ | **10,000** | **10%** |
| Reasoning space | 40,000 | 40% |
| Output generation | 33,000 | 33% |

## 任务粒度与加载深度匹配

| 任务类型 | 加载策略 | 典型场景 |
|---------|---------|---------|
| 理解项目全貌 | 仅 L1 | 新成员 onboarding |
| 规划新功能 | L1 + 相关 L2 × N | PRD 编写 |
| 修改单组件 | L1 + 单个 L2 + 少量源码 | Bug 修复 |
| 跨域逻辑修改 | L1 + 多个 L2 + 接口 | 状态机改造 |
| 架构重构 | L1 + 全部 L2 + 依赖图 | 模块解耦 |

## 项目 L2 索引清单

| L2 文件 | 用途 | 适用 Phase |
|---------|------|-----------|
| `layer-2/architecture.md` | 系统架构和服务间依赖关系 | Planning |
| `layer-2/standard-project-structure.md` | 项目完整目录结构 | Planning |
| `layer-2/api.md` | API 端点定义和响应格式 | Execution |
| `layer-2/data-models.md` | 数据模型定义（TypeScript interface） | Execution |
| `layer-2/standard-coding-style.md` | 编码规范（Vue SFC / Java） | Execution |
| `layer-2/deployment.md` | 部署配置和运维信息 | Execution |

## 加载规则

1. **L1 必读**：任何 action 开始执行前必须先读取 `.aixcoding/contexts/index.md`
2. **L2 按需**：仅加载与当前任务直接相关的 L2 文件，不超过 3 个
3. **Source 精准**：根据 L2 索引导航，一次只读取与任务相关的单个源码文件
4. **禁止全量**：严禁一次性读取全部 6 个 L2 文件或扫描整个代码库

## 与 Action 集成

Action 文件应使用薄引用方式集成本技能：

```markdown
## Context Injection

使用 [context-loader](~/.aixcoding/skills/context-loader/SKILL.md) 技能进行渐进式上下文加载。

### 本 Action 的加载策略

| Phase | Context | 用途 |
|:-----:|---------|------|
| L1 必读 | `index.md` | 建立项目全局认知 |
| L2 按需 | `<l2-file>.md` | <具体用途> |
| Source | <按需文件> | <具体用途> |

**IMPORTANT**: 在开始执行步骤之前必须先读取 `.aixcoding/contexts/index.md`。
```

## 最佳实践

| 推荐 | 避免 |
|------|------|
| L1 启动即读，耗时 <100ms | 跳过 L1 直接读 L2 或源码 |
| 一次最多加载 3 个 L2 文件 | 一次性加载全部 L2 |
| 按 L2 索引导航到具体文件 | 全量扫描代码库 |
| 索引与源码定期同步 | 索引过期后仍使用 |

## 常见陷阱

| 陷阱 | 症状 | 解决方案 |
|------|------|---------|
| L1 过胖 (>5KB) | 启动变慢，注意力分散 | 精简描述，移除细节到 L2 |
| L2 过碎 (<1KB) | 频繁切换，加载次数多 | 合并相关小领域 |
| 跳过 L1 直接读源码 | 缺乏全局视角，决策错误 | 强制 L1 为第一步 |
| 全量加载 | Token 超限，AI 幻觉增加 | 严格遵循三层加载 |
