# AIxCoding Harness Toolset Installation

**Toolset ID:** `aixcoding-harness-toolset`

## Overview

本文档提供了 AIxCoding Harness 工具集的安装和设置说明。该工具集将一套完整的"业务分析 → 技术设计 → Story 拆分 → 测试规格 → 任务拆解 → 逐任务实现 → Spec 校正 → 验收归档"的 Feature 级端到端开发驾驭流水线（价值驱动的十步闭环）封装为可复用的 AI 编码助手指令，帮助模型按照统一节奏、质量门禁与可追溯性交付一个 Feature / Change，最终形成 `overall-plan.md`、上下文分层、Story 卡片、.feature 测试规格、develop-log 与归档验收报告等全链路产物。

## AI Guided Installation

要使用 AI 引导安装，请将以下提示复制并粘贴到 AI 编码工具的聊天窗口中：

```shell
Follow instructions in .aixcoding/toolsets/aixcoding-harness-toolset/INSTALL.md
```

## Installation Steps

### 1. Create workspace directories

驾驭工作区（`.aixcoding/workspace/`）不在此处创建——由 `aixcoding-init` 动作首次运行时自动生成（含 `contexts/` 分层上下文与 `harness/overall-plan.md`）。

### 2. Detect the current `Agentic Engine` provider

检测当前 AI 编码助手类型（AIxCoding）。使用以下规则检测：

- 如果 `.aixcoding` 目录存在，使用 `AIxCoding`
- 如果当前工作区未找到 `.aixcoding` 目录，提示用户手动选择 provider

### 3. Create shortcuts commands for AIxCoding Harness (toolset ID: `aixcoding-harness-toolset`) in provider's entry point

根据检测到的 provider，在对应位置创建快捷命令。

> **设计原则**：命令文件应直接**复制** `.aixcoding/toolsets/aixcoding-harness-toolset/actions/` 下的实际 action 文件内容，而非薄引用（`follow`）。这样命令文件即为完整的 action 指令，不依赖文件工具读取虚拟目录。

#### For AIxCoding (`.aixcoding/commands/`):

AIxCoding 使用 Markdown 命令文件及 YAML 前置元数据。每个命令文件为对应 action 文件的**完整复制**（action 文件自带 YAML frontmatter），而非薄引用：

```bash
mkdir -p .aixcoding/commands/

# 项目初始化命令
cp .aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-init.md .aixcoding/commands/aixcoding-init.md

# 业务分析与需求澄清命令
cp .aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-discover.md .aixcoding/commands/aixcoding-discover.md

# 技术方案设计命令
cp .aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-design.md .aixcoding/commands/aixcoding-design.md

# Story 拆分命令
cp .aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-split.md .aixcoding/commands/aixcoding-split.md

# 测试规格命令
cp .aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-specify.md .aixcoding/commands/aixcoding-specify.md

# 测试代码生成命令
cp .aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-test.md .aixcoding/commands/aixcoding-test.md

# Change + 任务拆解命令
cp .aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-plan.md .aixcoding/commands/aixcoding-plan.md

# 逐任务实现命令
cp .aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-build.md .aixcoding/commands/aixcoding-build.md

# 验收 + 仪表盘 + 追溯命令
cp .aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-check.md .aixcoding/commands/aixcoding-check.md

# 归档命令
cp .aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-done.md .aixcoding/commands/aixcoding-done.md
```

### 4. Manual Usage for Other Providers

如果您的 AI 编码助手未检测到 `.aixcoding` 目录，您仍然可以手动使用 AIxCoding Harness。请按以下步骤操作：

#### 直接使用指令文件

您可以通过复制指令文件的相对路径，粘贴到 AI 编码助手的聊天窗口中直接使用：

1. **导航到指令文件目录**：
   ```bash
   cd .aixcoding/toolsets/aixcoding-harness-toolset/actions/
   ```

2. **右键点击所需的指令文件**，复制其相对路径：
   - 项目初始化: `aixcoding-init.md`
   - 业务分析与需求澄清: `aixcoding-discover.md`
   - 技术方案设计: `aixcoding-design.md`
   - Story 拆分: `aixcoding-split.md`
   - 测试规格: `aixcoding-specify.md`
   - 测试代码生成: `aixcoding-test.md`
   - Change + 任务拆解: `aixcoding-plan.md`
   - 逐任务实现: `aixcoding-build.md`
   - 验收 + 仪表盘 + 追溯: `aixcoding-check.md`
   - 归档: `aixcoding-done.md`

3. **在 AI 编码助手中输入提示**：
   ```
   Follow the instructions in {指令文件的相对路径}
   ```

## Initializing AIxCoding Harness

### 项目初始化
安装完成后，建议首先运行初始化：

```shell
Follow the instructions in .aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-init.md
```

这将：
- 扫描项目并识别技术栈（pom.xml / package.json / go.mod / requirements.txt）
- 检测已有 `contexts/` 文件状态（🟢 一致 / 🟡 过时 / 🔴 缺失）并增量更新
- 生成 L1 + L2 分层上下文（index.md + layer-2/ 六类文档）
- 初始化驾驭工作区 `overall-plan.md`

### 业务分析
运行业务分析：

```shell
Follow the instructions in .aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-discover.md
```

这将：
- 基于代码库证据进行结构化访谈澄清需求
- 输出业务需求文档与访谈记录

### 技术方案设计
运行技术设计：

```shell
Follow the instructions in .aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-design.md
```

这将：
- 执行 Code Research 探索现有实现
- 制定架构决策、API 设计与数据模型变更
- 产出可测试的验收条件 DoD

### Story 拆分
运行 Story 拆分：

```shell
Follow the instructions in .aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-split.md
```

这将：
- AI 自动选择 7 种拆分策略之一
- 生成 INVEST 合格的 Story 卡片（Given-When-Then AC）

### 测试规格
运行测试规格：

```shell
Follow the instructions in .aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-specify.md
```

这将：
- 生成测试计划与示例分析
- 并行生成 UI + API 层 Gherkin .feature
- 执行语法 + 覆盖率校验

### 测试代码生成
运行测试代码生成：

```shell
Follow the instructions in .aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-test.md
```

这将：
- 将 .feature 规格落地为可运行的测试代码（POM / Step Definitions / API Service / 数据 Builder）
- 按开发进度分层：源码实现后生成 API 测试代码、ui.feature 生成后生成 UI 测试代码
- 未初始化时先搭建测试仓库骨架（scaffold）

### Change + 任务拆解
运行任务拆解：

```shell
Follow the instructions in .aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-plan.md
```

这将：
- 创建 Change（proposal / design / specs）
- 默认 Feature 级拆解为 Phase→Task，或 `--story-level` Story 级拆解

### 逐任务实现
运行逐任务实现：

```shell
Follow the instructions in .aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-build.md
```

这将：
- 默认四阶段闭环：实现→验证→修复→确认，更新 develop-log
- `--scaffold` 生成源码骨架，`--story-level` 逐 Story 开发

### 验收 + 仪表盘 + 追溯
运行验收检查：

```shell
Follow the instructions in .aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-check.md
```

这将：
- 对照 PRD DoD 逐项验收（✅🟡❌）
- 生成全局仪表盘，支持全链路正向/逆向追溯与影响分析（只读）

### 归档
最后，归档 Change：

```shell
Follow the instructions in .aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-done.md
```

这将：
- 执行前置检查（未完成任务阻止归档）
- DoD 逐项验收 + 上下文校验
- 同步 specs 并移动到 `.aixcoding/workspace/archive/YYYY-MM-DD-<name>/`

### Available Commands
安装完成后，您可以使用以下命令（建议按推荐执行顺序执行）：

1. **`/aixcoding-init`** - 项目初始化（全生命周期仅一次）
2. **`/aixcoding-discover`** - 业务分析与需求澄清
3. **`/aixcoding-design`** - 技术方案设计
4. **`/aixcoding-split`** - Story 拆分
5. **`/aixcoding-specify`** - 测试规格（.feature + 测试计划）
6. **`/aixcoding-test`** - 测试代码生成（.feature → 可运行测试代码）
7. **`/aixcoding-plan`** - Change + 任务拆解
8. **`/aixcoding-build`** - 逐任务实现 + 源码骨架
9. **`/aixcoding-check`** - 验收 + 仪表盘 + 追溯 + 上下文校验
10. **`/aixcoding-done`** - 归档 Change

## Toolset Structure
该工具集将在 `.aixcoding/workspace/` 中创建以下结构（各步骤产物分布在不同子目录）：

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

## Spec Documents
该工具集使用以下 spec 文档作为模板：

1. **`business-requirements.md`** - 业务需求文档结构模板（discover 输出）
2. **`tech-design.md`** - 技术方案文档结构模板（design 输出）
3. **`story-card.md`** - Story 卡片模板（User Story + AC + INVEST 自评，split 输出）
4. **`.feature`** - Gherkin 测试规格文件（specify 输出，UI / API 两层）
5. **测试代码**（test 输出） - POM / Step Definitions / API Service / 数据 Builder
6. **`tasks.md` / `develop-log.json`** - 任务清单与开发日志（plan / build 输出）
6. **`验收报告`** - DoD 逐项验收概览（check / done 输出）

## Verification

安装完成后，请验证：

1. AIxCoding Harness（toolset ID: `aixcoding-harness-toolset`）的快捷命令已创建在 `.aixcoding/commands/` 目录中
2. 每个命令文件为对应 action 文件的**完整复制**（`cp .aixcoding/toolsets/aixcoding-harness-toolset/actions/<action>.md .aixcoding/commands/<action>.md`），而非薄引用（`follow`）
3. AIxCoding Harness 工具集文件位于 `.aixcoding/toolsets/aixcoding-harness-toolset`（toolset ID: `aixcoding-harness-toolset`）

**对于其他 provider**：验证您可以访问以下指令文件：
- `.aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-init.md`
- `.aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-discover.md`
- `.aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-design.md`
- `.aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-split.md`
- `.aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-specify.md`
- `.aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-plan.md`
- `.aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-build.md`
- `.aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-check.md`
- `.aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-done.md`

## Usage Examples

### Example 1: 完整驾驭一个 Feature（推荐）
```shell
# 首先，使用 AI Guided Installation 安装工具集
Follow instructions in .aixcoding/toolsets/aixcoding-harness-toolset/INSTALL.md

# 项目初始化（全生命周期仅一次）
/aixcoding-init

# 业务分析（以"团队空间管理"为例）
/aixcoding-discover 实现团队空间管理功能

# 技术设计
/aixcoding-design E1

# Story 拆分
/aixcoding-split E1

# 测试规格（逐 Story 或全量）
/aixcoding-specify E1-S01
/aixcoding-specify --all

# Change + 任务拆解
/aixcoding-plan team-space

# 逐任务实现
/aixcoding-build

# 验收 + 仪表盘
/aixcoding-check E1

# 归档
/aixcoding-done team-space
```

### Example 2: Story 级开发
```shell
/aixcoding-plan team-space --story-level S01   # Story 级任务拆解
/aixcoding-build --story-level S01             # Story 级逐 Story 开发
```

### Example 3: 构建与测试命令
```shell
/aixcoding-build --scaffold   # 从 .feature 生成 Controller/DTO/Enum 骨架
/aixcoding-test               # 测试代码生成（建仓库骨架 + .feature → POM/Step/API Service）
```

### Example 4: 验收与追溯
```shell
/aixcoding-check                    # 全量仪表盘
/aixcoding-check E1                 # E1 验收报告
/aixcoding-check E1-S01             # 全链路追溯
/aixcoding-check TeamSpace.java --impact   # 源码变更影响分析
/aixcoding-check --drift --detail   # 漂移详情
```

## Usage

### For AIxCoding
安装完成后，您可以使用以下命令（建议按推荐执行顺序执行）：

- `/aixcoding-init`: 项目初始化（全生命周期仅一次）
- `/aixcoding-discover`: 业务分析与需求澄清
- `/aixcoding-design`: 技术方案设计
- `/aixcoding-split`: Story 拆分
- `/aixcoding-specify`: 测试规格（.feature + 测试计划）
- `/aixcoding-plan`: Change + 任务拆解
- `/aixcoding-build`: 逐任务实现 + 骨架 + 测试代码
- `/aixcoding-check`: 验收 + 仪表盘 + 追溯 + 上下文校验
- `/aixcoding-done`: 归档 Change

### For Other Providers (Manual Usage)
如果您的 provider 未被自动检测，请按照上方"Manual Usage for Other Providers"部分的步骤手动使用指令文件。

## Notes

- 本安装过程假设您拥有创建目录和文件的必要权限
- 命令的实际实现将由 AI 模型使用 AIxCoding Harness（toolset ID: `aixcoding-harness-toolset`）中的指令来完成
- 请根据您实际的 AI 编码助手自定义 provider 专属设置
- 工具集 ID `aixcoding-harness-toolset` 应在命令和文档中保持一致使用
- **对于未被检测逻辑覆盖的 provider**：用户可通过复制指令文件的相对路径并输入类似"Follow the instructions in .aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-init.md"的提示来手动使用
- 各步骤产物写入 `.aixcoding/workspace/` 下对应子目录，各命令独立调用、按序组合
- 所有命令需在前置步骤产出完成后调用（例如 build 依赖 plan 的 tasks.md）
- 工具集本身并不强制依次执行，但 推荐执行顺序能保证全链路可追溯性
- 构建/实现产物写入源码仓库，驾驭相关产物写入 `.aixcoding/workspace/`

## Integration with Other Toolsets
AIxCoding Harness 可以与其他 AIxCoding 工具集集成：

- **`aixcoding-asdm-test-automation`**：specify 与 build 依赖其生成 .feature 与测试代码（asdm-test-scenario-analyze / asdm-test-spec-ui-generate / asdm-test-spec-api-generate / asdm-test-spec-validate / asdm-test-automation-scaffold / asdm-test-code-generate）
- **`aixcoding-asdm-harness-toolset`**：init、plan、build、split 复用其 asdm-harness-init / asdm-harness-askme / asdm-harness-design-overall / asdm-harness-design-details / asdm-harness-plan / asdm-harness-us-plan / asdm-harness-develop / asdm-harness-us-develop / asdm-harness-testplan / asdm-harness-verify 等动作
- **`aixcoding-asdm-context-builder`（上下文能力）**：init 生成的分层上下文被后续所有步骤全程引用，以保持模型对项目的持续理解

### Getting Help
如遇 AIxCoding Harness 工具集问题，请参考：
- [AIxCoding Documentation](https://AIxCoding.ai/docs)
- Toolset README: `.aixcoding/toolsets/aixcoding-harness-toolset/README.md`
- Action 指令文件位于 `.aixcoding/toolsets/aixcoding-harness-toolset/actions/`

## License
Copyright (c) 2026 LeansoftX.com & iSoftStone. All rights reserved.

Licensed under the PROPRIETARY SOFTWARE LICENSE. See [LICENSE](LICENSE) in the project root for license information.

---

*This installation document is part of the AIxCoding Harness toolset. 各命令独立调用，建议按推荐执行顺序执行以形成全链路可追溯的价值驱动开发闭环。*
