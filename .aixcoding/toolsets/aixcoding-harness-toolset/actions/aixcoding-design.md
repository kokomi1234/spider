---
name: aixcoding-design
description: '技术方案设计：Code Research → 架构决策 → API/数据模型设计 → 验收条件 DoD。纯技术视角。'
---

# AIxCoding Design — 技术方案设计

纯技术设计。基于 discover 的业务需求，通过 Code Research 制定技术方案。
**不访谈用户、不拆 Story、不写测试用例**。

## 整合

| 原步骤 | 集成方式 |
|--------|----------|
| asdm-harness-design-overall | PRD 总体概述 + 使用场景 + 非功能需求 |
| asdm-harness-design-details | Code Research + 技术方案 + 验收条件 DoD |

## Input

| 输入项 | 来源 | 必填 | 说明 |
|--------|------|:--:|------|
| Feature ID | 用户 | ✅ | 与 discover 相同 |
| 业务需求文档 | 01 `.aixcoding/workspace/discovery/<id>/business-requirements.md` | 自动 | 核心输入 |
| 项目上下文 | 00 `.aixcoding/contexts/` | 自动 | L1+L2 全量 |
| 访谈记录 | 01 `.aixcoding/workspace/discovery/<id>/interview-notes.md` | 自动 | 假设+约束 |

## Workflow

### 1. Code Research

针对每个业务场景，探索源码：
- 现有相似功能实现模式
- 可复用的组件/Service/工具类
- API 约定（路径格式、响应结构、错误处理）
- 数据库表结构和命名规范
- **记录探索发现的文件路径和关键代码片段**

### 2. 总体概述

- 项目背景与技术目标
- 功能范围（与技术边界）
- 非功能需求（性能指标、安全要求、可用性 SLA）
- 使用场景与 Mermaid 流程图

### 3. 技术方案

- **架构决策**：服务/模块划分，新增 vs 修改
- **API 设计**：端点列表（method、path、request/response）
- **数据模型变更**：新增 Entity/DTO/Enum，字段约束
- **前端路由与组件树**：页面结构、组件拆分
- **关键技术决策**：为什么选这个方案（ADR 格式）

### 4. 验收条件（DoD）

从业务需求推导可测试的完成标准：

```markdown
| # | 验收条件 | 优先级 | 验证方式 |
|---|---------|:---:|------|
| 1 | 团队名称必填且全局唯一 | P0 | 自动化测试 |
| 2 | 创建者自动成为 Owner | P0 | 集成测试 |
```

## Output

```
.aixcoding/workspace/design/<feature-id>/
├── tech-design.md             # 技术方案
│   ├── 总体概述（背景+范围+非功能需求）
│   ├── 使用场景（角色+操作+Mermaid 流程图）
│   ├── Code Research 摘要（找到什么、在哪里）
│   ├── 架构决策
│   ├── API 设计（端点表+请求/响应结构）
│   ├── 数据模型变更（Entity/DTO/Enum 变更清单）
│   └── 验收条件 DoD（逐项表格）
└── architecture-decisions.md  # 架构决策记录（ADR：问题→方案→理由→后果）
```

## Guardrails

- 技术方案必须覆盖所有业务场景（对照 discover 输出）
- 每个架构决策记录 Why
- API/数据模型设计要具体到字段级别
- DoD 必须是可测试的完成标准
- **Feature ID 复用 discover 产出**（形如 `FT-001`），不新建编号，目录名一致

## 使用

`/aixcoding-design <feature-id>`
