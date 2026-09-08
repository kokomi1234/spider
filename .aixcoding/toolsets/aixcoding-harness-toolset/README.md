# AIxCoding Toolset - AIxCoding Harness

toolset-id: aixcoding-harness-toolset
toolset-name: AIxCoding Harness
version: 0.0.1
updated-date: 2026-07-10
toolset-description: 提供从业务分析→技术设计→Story 拆分→测试规格→任务拆解→逐任务实现→Spec 校正→验收归档的 Feature 级端到端开发驾驭流水线（价值驱动的十步闭环），帮助模型按照统一节奏、质量门禁与可追溯性交付一个 Feature / Change，并生成 overall-plan.md、上下文分层、Story 卡片、.feature 测试规格、develop-log 与归档验收报告等全链路产物。

## Overview

AIxCoding Harness（toolset-id: aixcoding-harness-toolset）是一款面向**全栈开发工程师**与 **AI 编码助手**的 AIxCoding 工具集，提供一套"业务分析 → 技术设计 → Story 拆分 → 测试规格 → 任务拆解 → 逐任务实现 → Spec 校正 → 验收归档"的 **Feature 级端到端开发驾驭流水线**，以价值驱动的 **十步闭环**帮助模型按照统一节奏、质量门禁与可追溯性交付一个 Feature / Change。

在实际的"需求 → 代码"交付环节中，AI 编码助手往往缺乏统一的节奏与质量门禁：需求理解不充分就开始写码、Story 拆分随意、测试规格缺失、Spec 与源码漂移、验收无据可依，导致交付质量参差且难以追溯。本工具集通过结构化的十步流水线，将每一步的输入、流程、产物、质量门禁均显式化，把整个 Feature 交付过程拆解为可量化、可追踪、可验收的闭环，有效降低理解偏差并提升交付可追溯性。

工具集以自然语言业务描述作为起点，各动作可独立调用，依次执行项目初始化、需求澄清、技术设计、Story 拆分、测试规格、任务拆解、逐任务实现、Spec 校正与验收归档，最终生成 `overall-plan.md`、分层上下文、Story 卡片、`.feature` 测试规格、`develop-log` 与归档验收报告等全链路产物，供开发人员或 AI 编码助手直接参考使用。

**关于步骤编号的说明**：本工具集每个动作的**身份是动作名**（如 `aixcoding-init`），不含硬编码的序号前缀（00/01/02…），以便新增、删除或重排步骤时无需大范围重命名。文档中出现的执行顺序仅为**推荐顺序**，作为有序列表呈现；增删步骤时只需调整该列表，而无需改动任何动作文件。

## Features

### Common features

- 覆盖需求到代码的 Feature 级完整生命周期，价值驱动的十步闭环
- 结构化输出，每步产出规范化中间产物（overall-plan / Story 卡片 / .feature / develop-log 等）
- 内置质量门禁（INVEST 自评、DoD 验收、漂移检测、归档前置检查）
- 支持全链路正向/逆向追溯与变更影响分析
- 面向全栈开发人员与 AI 编码助手双向输出
- 各动作可独立调用，按需组合使用
- 支持全流程线性串联执行，单一命令完成完整交付闭环
- 可与其他工具集集成（aixcoding-asdm-test-automation / aixcoding-asdm-harness-toolset / aixcoding-asdm-context）

### Feature 1: 项目初始化（aixcoding-init）

扫描项目→识别技术栈→检测已有文件状态（🟢一致/🟡过时/🔴缺失）→生成 L1+L2 分层上下文→初始化驾驭工作区。全生命周期仅一次。

**Input**: 当前项目根目录（自动识别）
**Output**: `.aixcoding/contexts/`（index.md + layer-2/ 六类文档）+ `.aixcoding/workspace/overall-plan.md`
**Use Case**: 首次接入项目、需要建立全局上下文与整体规划时使用。

### Feature 2: 业务分析与需求澄清（aixcoding-discover）

通过结构化访谈澄清需求，遵循"优先探索代码库 → AI 推荐 → 用户确认"模式，输出业务需求文档。纯业务视角。

**Input**: 需求描述 / 业务目标（自然语言，可粗略）
**Output**: `.aixcoding/workspace/discovery/<feature-id>/business-requirements.md` + `interview-notes.md`
**Use Case**: 需要澄清"用户要什么"、收敛需求边界时使用。

### Feature 3: 技术方案设计（aixcoding-design）

执行 Code Research → 架构决策 → API / 数据模型设计 → 验收条件 DoD，输出技术方案。纯技术视角。

**Input**: Feature ID（与 discover 相同）+ 业务需求文档
**Output**: `.aixcoding/workspace/design/<feature-id>/tech-design.md` + `architecture-decisions.md`
**Use Case**: 需要制定可测试的技术方案、架构决策与验收 DoD 时使用。

### Feature 4: Story 拆分（aixcoding-split）

AI 自动选择 7 种拆分策略之一，生成 INVEST 合格的 Story 卡片（含 Given-When-Then AC），并内建 INVEST 六维度自评。

**Input**: Feature ID + discover 业务需求 + design 技术方案 DoD
**Output**: `.aixcoding/workspace/stories/<feature-id>/`（feature-prep / story-list / story 卡片 / evaluation-report）
**Use Case**: 需要将 Feature 拆解为可独立交付的纵向 Story 切片时使用。

### Feature 5: 测试规格（aixcoding-specify）

将 Story AC 转化为测试计划与示例分析，并行生成 UI + API 层 Gherkin `.feature`，并执行语法与覆盖率校验。

**Input**: Story ID / `--all`
**Output**: `.aixcoding/workspace/specs/<feature-id>/<story-id>/`（test-plan / example-analysis / .ui.feature / .api.feature / validation-report）
**Use Case**: 需要生成可执行的测试规格时使用。

### Feature 6: 测试代码生成（aixcoding-test）

将 `aixcoding-specify` 产出的 `.feature` 规格落地为可运行的端到端测试代码（POM / Step Definitions / API Service / 数据 Builder）。按开发进度分层：开发完成后生成 API 测试代码、ui.feature 生成后生成 UI 测试代码；未初始化时先搭建测试仓库骨架（scaffold）。由用户显式触发。

**Input**: Story ID / Feature 文件路径
**Output**: `<test-project>/`（pages / services / factories / steps + `step-registry.json`）
**Use Case**: 需要在 `.feature` 规格与源码实现就绪后生成可运行测试代码时使用。

### Feature 7: Change + 任务拆解（aixcoding-plan）

创建 Change（proposal / design / specs），默认 Feature 级拆解为 Phase→Task，支持 `--story-level` 的 Story 级任务拆解。

**Input**: `[change-name]` + `[--story-level <story-id>]`
**Output**: `.aixcoding/workspace/changes/<change-name>/`（proposal / design / specs / tasks.md / develop-log.json）
**Use Case**: 需要将 Feature 或 Story 拆解为可执行的细粒度任务时使用。

### Feature 8: 逐任务实现（aixcoding-build）

默认四阶段闭环（实现→验证→修复→确认）逐任务实现并更新 develop-log；`--scaffold` 生成源码骨架、`--story-level` 逐 Story 开发。测试相关（仓库骨架 + 测试代码生成）统一由 `aixcoding-test` 负责。

**Input**: `[--scaffold|--story-level S01]`
**Output**: 源码实现 + `.aixcoding/workspace/changes/<change-name>/develop-log.json`
**Use Case**: 需要按任务清单驱动源码实现与验证时使用。

### Feature 9: 验收 + 仪表盘 + 追溯（aixcoding-check）

对照 PRD DoD 逐项验收（✅🟡❌），生成全局仪表盘，支持全链路正向/逆向追溯与源码变更影响分析。只读。

**Input**: `[feature/story-id]` 或 `[源码路径 --impact]` 或 `[--drift --detail]`（可选）
**Output**: 仪表盘 / 验收报告 / 追溯视图（只读，不写文件）
**Use Case**: 需要查看全局状态、逐项验收或追溯影响时使用。

### Feature 10: 归档（aixcoding-done）

执行前置检查（未完成任务阻止归档）→ DoD 逐项验收 → 上下文校验 → 同步 specs → 移动到 `.aixcoding/workspace/archive/YYYY-MM-DD-<name>/`。

**Input**: `[change-name]`（可选）
**Output**: `.aixcoding/workspace/archive/YYYY-MM-DD-<name>/`（proposal / design / specs / tasks.md / 验收概览）
**Use Case**: 需要归档已完成 Change、沉淀验收报告时使用。

## Toolset Installation Process

`INSTALL.md` will setup the toolset with the following steps:

- 驾驭工作区（`.aixcoding/workspace/`，含 `harness/overall-plan.md`）由 `aixcoding-init` 动作首次运行时自动创建，安装过程不创建产物目录
- 检测当前 Agentic Engine provider（Claude Code / GitHub Copilot / Tencent CodeBuddy，或手动选择）
- 在对应 provider 入口创建快捷命令文件（`.claude/commands/` / `.github/prompts/` / `.codebuddy/commands/`）
- 支持通过复制指令文件相对路径进行手动使用

## Toolset Workflow

Once AIxCoding Harness is installed, user can use the following commands. 建议按**推荐执行顺序**执行以形成全链路可追溯的价值驱动闭环。支持两种方式：

#### 方式一：全流程线性串联（推荐）

按推荐顺序依次调用各动作，完成整个 Feature 交付闭环：

1. `/aixcoding-init` → 项目初始化（全生命周期仅一次）
2. `/aixcoding-discover` → 业务分析与需求澄清
3. `/aixcoding-design` → 技术方案设计
4. `/aixcoding-split` → Story 拆分
5. `/aixcoding-specify` → 测试规格（.feature + 测试计划）
6. `/aixcoding-test` → 测试代码生成（.feature → 可运行测试代码）
7. `/aixcoding-plan` → Change + 任务拆解
8. `/aixcoding-build` → 逐任务实现 + 源码骨架
9. `/aixcoding-check` → 验收 + 仪表盘 + 追溯 + 上下文校验
10. `/aixcoding-done` → 归档 Change

#### 方式二：独立调用（按需组合）

各命令可独立调用，按需更新对应环节：

| 命令 | 角色 | 说明 |
|------|------|------|
| `/aixcoding-init` | DevOps | 项目初始化（仅一次） |
| `/aixcoding-discover` | PO/BA | 业务分析与需求澄清 |
| `/aixcoding-design` | Tech Lead | 技术方案设计 |
| `/aixcoding-split` | Scrum Master | Story 拆分 |
| `/aixcoding-specify` | QA | 测试规格（.feature + 测试计划） |
| `/aixcoding-test` | QA | 测试代码生成（.feature → 测试代码） |
| `/aixcoding-plan` | Team | Change + 任务拆解 |
| `/aixcoding-build` | Dev | 逐任务实现（源码骨架） |
| `/aixcoding-check` | QA/TL | 验收 + 仪表盘 + 追溯 |
| `/aixcoding-done` | Team | 归档 |

各命令将产物写入 `.aixcoding/workspace/` 下对应子目录；命令本身不强制依次执行，但按推荐顺序执行能保证全链路可追溯性。所有命令需在前置步骤产出完成后调用（例如 build 依赖 plan 的 tasks.md）。

## Toolset Structure

The AIxCoding Harness toolset has the following structure:

```
.aixcoding/
└── toolsets/
    └── aixcoding-harness-toolset/
        ├── INSTALL.md
        ├── README.md
        ├── manifest.json
        └── actions/
            ├── aixcoding-init.md       # 项目初始化
            ├── aixcoding-discover.md   # 业务分析
            ├── aixcoding-design.md     # 技术方案设计
            ├── aixcoding-split.md      # Story 拆分
            ├── aixcoding-specify.md    # 测试规格
            ├── aixcoding-test.md       # 测试代码生成
            ├── aixcoding-plan.md       # Change + 任务拆解
            ├── aixcoding-propose.md    # 创建 Change（plan 内部调用）
            ├── aixcoding-build.md      # 逐任务实现
            ├── aixcoding-apply.md      # 逐任务实现（build 内部调用）
            ├── aixcoding-check.md      # 验收 + 仪表盘 + 追溯
            ├── aixcoding-done.md       # 归档
            ├── aixcoding-archive.md    # 归档 Change（done 内部调用）
            └── aixcoding-sync-specs.md # Delta Specs 同步（archive 内部调用）
```

### Spec Documents

The toolset uses the following spec documents as templates:

- **`business-requirements.md`** — 业务需求文档结构模板（discover 输出）
- **`tech-design.md`** — 技术方案文档结构模板（design 输出）
- **`story-card.md`** — Story 卡片模板（User Story + AC + INVEST 自评，split 输出）
- **`.feature`** — Gherkin 测试规格文件（specify 输出，UI / API 两层）
- **`tasks.md` / `develop-log.json`** — 任务清单与开发日志（plan / build 输出）
- **`验收报告`** — DoD 逐项验收概览（check / done 输出）

## Toolset Workspace

The AIxCoding Harness toolset creates the following workspace structure under `.aixcoding/workspace/`（各步骤产物分布在不同子目录）：

```
.aixcoding/workspace/
├── contexts/                  # init: L1+L2 分层项目上下文
│   ├── index.md
│   └── layer-2/
│       ├── architecture.md
│       ├── api.md
│       ├── data-models.md
│       ├── standard-project-structure.md
│       ├── standard-coding-style.md
│       └── deployment.md
├── harness/
│   └── overall-plan.md        # init: 全局规划
├── discovery/<feature-id>/    # discover: 业务需求 + 访谈记录
├── design/<feature-id>/       # design: 技术方案 + 架构决策
├── stories/<feature-id>/    # split: Story 卡片 + INVEST 评估
├── specs/<feature-id>/<story-id>/  # specify: .feature + 测试计划
├── test/step-registry.json          # test: 全局 Step 注册表（测试代码生成到 <test-project>/）
├── changes/<change-name>/     # plan + build: proposal/design/specs/tasks.md/develop-log.json
└── archive/YYYY-MM-DD-<name>/ # done: 归档产物 + 验收概览
```

各环节关键产物：

1. **L1+L2 分层上下文**（init） — 全局上下文与项目理解
2. **业务需求文档**（discover） — 业务背景、用户角色、核心场景
3. **技术方案 + 架构决策**（design） — 技术实现与验收 DoD
4. **Story 卡片 + INVEST 自评**（split） — 可独立交付的用户故事切片
5. **.feature 测试规格**（specify） — UI / API 两层 Gherkin
6. **测试代码**（test） — POM / Step Definitions / API Service / 数据 Builder
7. **tasks.md / develop-log.json**（plan / build） — 任务清单与开发日志
8. **验收报告**（check / done） — DoD 逐项验收概览

## Integration with Other Toolsets

AIxCoding Harness 可以与其他 AIxCoding 工具集集成：

- **`aixcoding-asdm-test-automation`**：specify 与 test 依赖其生成 .feature 与测试代码（asdm-test-scenario-analyze / asdm-test-spec-ui-generate / asdm-test-spec-api-generate / asdm-test-spec-validate / asdm-test-automation-scaffold / asdm-test-code-generate / asdm-test-step-sync）
- **`aixcoding-asdm-harness-toolset`**：init、plan、build、split 复用其 asdm-harness-init / asdm-harness-askme / asdm-harness-design-overall / asdm-harness-design-details / asdm-harness-plan / asdm-harness-us-plan / asdm-harness-develop / asdm-harness-us-develop / asdm-harness-testplan / asdm-harness-verify 等动作
- **`aixcoding-asdm-context-builder`（上下文能力）**：init 生成的分层上下文被后续所有步骤全程引用，以保持模型对项目的持续理解

## Getting Help

如遇 AIxCoding Harness 工具集问题，请参考：
- [AIxCoding Documentation](https://AIxCoding.ai/docs)
- Toolset README: `.aixcoding/toolsets/aixcoding-harness-toolset/README.md`
- Action 指令文件位于 `.aixcoding/toolsets/aixcoding-harness-toolset/actions/`

## Copyright & License

Copyright (c) 2026 LeansoftX.com & iSoftStone. All rights reserved.

Licensed under the PROPRIETARY SOFTWARE LICENSE. See [LICENSE](LICENSE) in the project root for license information.
