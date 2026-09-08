---
name: aixcoding-init
description: '项目初始化：扫描项目→识别技术栈→检测已有文件状态(🟢🟡🔴)→生成L1+L2分层上下文→初始化驾驭工作区。全生命周期一次。'
---

# AIxCoding Init — 项目初始化

## 整合

| 原步骤 | 集成方式 |
|--------|----------|
| asdm-context-init | 扫描代码结构→生成 L1 index + L2 分层上下文 |
| asdm-context-update | 检测已有文件状态（🟢一致/🟡过时/🔴缺失）→增量更新 |
| asdm-harness-init | 创建驾驭工作区 `overall-plan.md` |

## Input

| 输入项 | 来源 | 必填 | 说明 |
|--------|------|:--:|------|
| 项目根目录 | 当前工作区 | 自动 | |
| 已有 contexts/ | `.aixcoding/contexts/`（如存在） | 自动 | 判断状态 |

## Workflow

### 0. 前置检查：已有文件状态扫描

列出 `.aixcoding/contexts/` 及 `layer-2/` 中所有文件，判断一致性：

| 状态 | 条件 | 处理 |
|:--:|------|------|
| 🟢 一致 | 内容与当前项目匹配 | 跳过 |
| 🟡 过时 | 存在但内容不匹配 | **暂停询问用户**：覆盖/合并 |
| 🔴 缺失 | 目标位置无此文件 | 生成 |

**一致性判断**（快速启发式）：
- `index.md`：目录树顶层名是否与 `list_dir` 结果匹配
- L2 文件：引用的关键路径/类名/端点是否仍存在

### 1. 识别技术栈

```
pom.xml / build.gradle → Java Spring Boot / Gradle
package.json → Node.js / TypeScript
go.mod → Go
requirements.txt / pyproject → Python
```

### 2. 生成 L1 + L2 上下文

```
.aixcoding/contexts/
├── index.md                          # L1: 项目索引+技术栈+目录树+L2导航+编译/构建/调试指令
└── layer-2/
    ├── architecture.md               # 架构概述+服务拓扑+模块依赖关系
    ├── api.md                        # API 端点定义（扫描 Controller 提取）
    ├── data-models.md                # 数据模型（扫描 Entity/DTO 提取字段+约束）
    ├── standard-project-structure.md # 标准项目结构+命名规范
    ├── standard-coding-style.md      # 编码规范
    └── deployment.md                 # 部署配置
```

### 3. 初始化驾驭工作区

```
.aixcoding/workspace/
└── overall-plan.md
```

### 4. 验证

确认所有文件生成、内部链接有效、技术栈识别正确。

## Output

```
.aixcoding/contexts/ (7 文件) + .aixcoding/workspace/overall-plan.md
```

## 完成摘要与后续流程建议

全部生成后，输出完成摘要并给出后续流程建议。

> **定位说明**：`aixcoding-init` 内部调用 `asdm-harness-init` 的能力（创建 `overall-plan.md` 驾驭工作区），但**顶层面向用户的后续流程推荐**使用阶段编排 Agent `/harness-*`，而非底层 `/asdm-harness-*` action；`aixcoding-asdm-harness-toolset` 保持独立自足，无需知道顶层 agents。

```text
✅ 项目初始化完成！

📂 上下文: .aixcoding/contexts/ (index.md + layer-2/ 6 文件)
📄 总体计划: .aixcoding/workspace/overall-plan.md

📌 后续流程（阶段编排 Agent，推荐）：
   1. /harness-ba             → 业务分析：需求澄清 / 用户故事拆分
   2. /harness-architect      → 技术设计：技术方案 + API / 数据模型 + DoD
   3. /harness-test           → 测试验收：生成测试规格（.feature）
   4. /harness-dev            → 开发实现：任务拆解 + 逐任务实现
   5. /harness-test           → 测试验收：全局验收 / 归档

   推荐从 /harness-ba 开始 →
```

> 上述 Agent 为**编排/路由层**：运行时读取 `aixcoding-harness-toolset` 的底层 action（discover/design/split/specify/plan/build/check/done）执行。不要向用户推荐底层 `/asdm-harness-*` 命令。

## Guardrails

- 生成内容必须具体（实际类名/路径/端点），不用模板占位符
- 🟡 状态必须用户确认后才覆盖
- 中文输出
- 一次性全部生成，不等用户逐文件确认

## 使用

`/aixcoding-init`
