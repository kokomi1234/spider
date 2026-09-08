# AIxCoding Agents Installation

**Agents ID:** `aixcoding-agents`

## Overview

本文档提供了 AIxCoding **阶段编排 Agents**（`harness-ba` / `harness-architect` / `harness-test` / `harness-dev`）的安装与设置说明。这四个命令是对 **AIxCoding Harness 工具集**（toolset-id: `aixcoding-harness-toolset`）的**角色编排层**：它们不直接实现业务/技术动作，而是按用户意图路由到 `/.aixcoding/toolsets/` 下工具集的对应 action（discover / design / split / specify / plan / build / check / done），并自动补全前置、逐步引导用户走完"业务分析 → 技术设计 → 测试验收 → 开发实现"的完整闭环。

**前提**：底层工具集的 action 指令必须已就位于 `../toolsets/aixcoding-harness-toolset/actions/`（该工具集安装后固定在 `../toolsets/` 下）。本 Agents 不重复安装工具集，而是在运行时**直接读取**该目录下的 action 指令文件执行，因此不产生额外的"先安装工具集"依赖。

## AI Guided Installation

要使用 AI 引导安装，请将以下提示复制并粘贴到 AI 编码工具的聊天窗口中：

```shell
Follow instructions in agents/INSTALL.md
```

安装时会要求你**读取并遵循** `.aixcoding/toolsets/aixcoding-harness-toolset/actions/*.md` 中的底层 action 指令（`aixcoding-discover.md` / `aixcoding-split.md` / `aixcoding-design.md` / `aixcoding-specify.md` / `aixcoding-check.md` / `aixcoding-done.md` / `aixcoding-plan.md` / `aixcoding-build.md`）。

> **关于 `aixcoding-init` / `aixcoding-done`**：项目初始化与归档**不属于任何角色**的编排范围，而是**流程上的步骤**，由用户/工具集层面显式触发，不由 agents 角色编排——故角色列表（下同）均不含二者；但它们**随 INSTALL 一并安装**为独立于角色的流程步骤命令（`/aixcoding-init` / `/aixcoding-done`），见下方 Installation Steps。

## Installation Steps

### 1. 校验前置：确认底层工具集 action 已就位

安装 Agents 前，确认底层工具集的 action 指令文件已位于 `.aixcoding/toolsets/` 下：
- `.aixcoding/toolsets/aixcoding-harness-toolset/actions/` 目录存在
- 该目录下存在 agents 所需 8 个 action 指令文件（`aixcoding-discover.md` / `aixcoding-split.md` / `aixcoding-design.md` / `aixcoding-specify.md` / `aixcoding-check.md` / `aixcoding-done.md` / `aixcoding-plan.md` / `aixcoding-build.md`；不含作为流程步骤的 `aixcoding-init.md`）

> 若缺失，请将 `aixcoding-harness-toolset` 工具集部署到 `.aixcoding/toolsets/aixcoding-harness-toolset/`（见其自带 INSTALL）。本 Agents 本身不安装工具集，只依赖其 action 指令已就位。

### 2. 创建 shortcuts commands for AIxCoding Agents (Agents ID: `aixcoding-agents`) in provider's entry point

根据检测到的 provider，在对应位置创建快捷命令。AIxCoding 使用 Markdown 命令文件及 YAML 前置元数据。直接**复制**编排指令文件（含 frontmatter 与门禁逻辑）到 `.aixcoding/commands/`，而非薄引用。
除 4 个角色命令外，还将**独立于角色**的流程步骤命令 `/aixcoding-init` 与 `/aixcoding-done` 一并复制到 `.aixcoding/commands/`：

#### For AIxCoding (`.aixcoding/commands/`):

```bash
mkdir -p .aixcoding/commands/

# 复制阶段编排命令（源文件自带 YAML frontmatter、全量上下文门禁与编排逻辑，直接复制完整内容）
cp agents/harness-ba.md .aixcoding/commands/harness-ba.md
cp agents/harness-architect.md .aixcoding/commands/harness-architect.md
cp agents/harness-test.md .aixcoding/commands/harness-test.md
cp agents/harness-dev.md .aixcoding/commands/harness-dev.md

# 复制独立于角色的流程步骤命令（项目初始化 / 归档），直接以底层工具集 action 原始文件为源（agents/ 下不再保留副本），确保确定性进入模型上下文
cp toolsets/aixcoding-harness-toolset/actions/aixcoding-init.md .aixcoding/commands/aixcoding-init.md
cp toolsets/aixcoding-harness-toolset/actions/aixcoding-done.md .aixcoding/commands/aixcoding-done.md
```

### 3. Manual Usage for Other Providers

如果您的 AI 编码助手未检测到 `.aixcoding` 目录，您仍然可以手动使用。请按以下步骤操作：

1. **导航到指令文件目录**：
   ```bash
   cd agents/
   ```

2. **右键点击所需的指令文件**，复制其相对路径：
   - 业务分析编排: `harness-ba.md`
   - 技术设计编排: `harness-architect.md`
   - 测试验收编排: `harness-test.md`
   - 开发实现编排: `harness-dev.md`
   - 项目初始化（流程步骤，独立于角色）: `aixcoding-init.md`
   - 归档（流程步骤，独立于角色）: `aixcoding-done.md`

3. **在 AI 编码助手中输入提示**：
   ```
   Follow the instructions in {指令文件的相对路径}
   ```

> 各编排命令在运行时**读取 `.aixcoding/toolsets/aixcoding-harness-toolset/actions/*.md`** 获取底层 action 的 Workflow / Output / Guardrails，无需再次安装工具集。

## Available Agents

安装完成后，您可以使用以下命令（建议按推荐执行顺序执行，形成完整交付闭环）：

| 命令 | 阶段 | 编排的底层 actions | 用途 |
|------|------|--------------------|------|
| `/harness-ba` | 业务分析 | discover / split | 全量上下文门禁检查，按意图路由需求澄清或 Story 拆分 |
| `/harness-architect` | 技术设计 | design | 校验业务前置，路由技术方案设计 |
| `/harness-test` | 测试验收 | specify / check / done | 路由测试规格 / 验收 / 归档 |
| `/harness-dev` | 开发实现 | plan / build | 自动补全任务拆解，路由任务拆解 / 逐任务实现 |

**推荐执行顺序**：`/aixcoding-init`（流程步骤，建立全量上下文索引，全生命周期一次）→ `/harness-ba` → `/harness-architect` → `/harness-test`（生成规格）→ `/harness-dev`（实现）→ `/harness-test`（验收）→ `/aixcoding-done`（流程步骤，归档）。

## Usage Examples

### Example 1: 完整驾驭一个 Feature（推荐）
```shell
# 安装 Agents（底层工具集 action 已就位于 .aixcoding/toolsets/ 下，无需单独安装）
Follow instructions in agents/INSTALL.md

# 业务分析与 Story 拆分
/harness-ba 请帮我澄清需求：实现团队空间管理功能
/harness-ba 请帮我对 Feature E1 拆分用户故事

# 技术设计
/harness-architect 请为 Feature E1 设计技术方案

# 生成测试规格（开发前仅生成 API 层，可逐个用户故事生成）
/harness-test 请为 Feature E1 生成测试规格
/harness-test 请为 Feature E1 的用户故事 E1-S01 生成测试规格

# Change + 任务拆解 + 逐任务实现
/harness-dev 请为变更 team-space 拆解任务
/harness-dev 请为 Feature E1 实现

# 生成 UI 层测试规格 + 验收 + 归档（开发完成后追加 UI 层，不再做 Code→Spec 校正）
/harness-test 请为 Feature E1 生成测试规格      # 开发完成后 -> 追加生成 ui.feature
/harness-test 请做全局验收检查
/harness-test 请归档变更 team-space
```

### Example 2: 用户故事 级开发
```shell
/harness-dev 请为 用户故事 S01 逐用户故事 开发       # 自动 plan --story-level S01 + build --story-level S01
/harness-test 请为 用户故事 S01 生成测试规格          # 开发完成后 -> 追加生成 ui.feature
```

### Example 3: 构建相关辅助命令（经 dev 编排路由到底层 build）
```shell
/harness-dev 请生成源码骨架                      # build --scaffold
/harness-dev 请为变更 <change-name> 拆解任务     # plan
```

## Toolset Structure

该协议将 4 个**角色编排命令**及 2 个**独立于角色的流程步骤命令**安装为 AIxCoding 快捷命令（通过 `cp` 复制文件）：

```
.aixcoding/commands/
├── harness-ba.md        # 业务分析编排（复制自 agents/harness-ba.md）
├── harness-architect.md  # 技术设计编排（复制自 agents/harness-architect.md）
├── harness-test.md              # 测试验收编排（复制自 agents/harness-test.md）
├── harness-dev.md        # 开发实现编排（复制自 agents/harness-dev.md）
├── aixcoding-init.md    # 项目初始化（流程步骤，独立于角色，复制自 toolsets/aixcoding-harness-toolset/actions/aixcoding-init.md）
└── aixcoding-done.md    # 归档（流程步骤，独立于角色，复制自 toolsets/aixcoding-harness-toolset/actions/aixcoding-done.md）
```

各编排命令的底层动作与产物写入 `.aixcoding/workspace/` 下对应子目录（与 `aixcoding-harness-toolset` 约定一致）。已复制的命令文件内含编排逻辑，运行时读取 `.aixcoding/toolsets/aixcoding-harness-toolset/actions/*.md` 获取底层 action 指令。`aixcoding-init` / `aixcoding-done` 为流程步骤命令，独立于 4 个角色，同样为底层工具集 `aixcoding-init` / `aixcoding-done` action 的**完整复制**，直接进入命令上下文。

## Verification

安装完成后，请验证：

1. `.aixcoding/commands/` 下存在 4 个角色命令文件：`harness-ba.md` / `harness-architect.md` / `harness-test.md` / `harness-dev.md`；以及 2 个独立于角色的流程步骤命令：`aixcoding-init.md` / `aixcoding-done.md`
2. 每个角色命令文件为 `agents/*.md` 的**完整内容复制**（`cp`），包含 YAML frontmatter 与全量上下文门禁，而非薄引用；`aixcoding-init.md` / `aixcoding-done.md` 为独立于角色的流程步骤命令，直接复制自 `toolsets/aixcoding-harness-toolset/actions/` 下的原始 action 文件
3. 底层工具集 action 指令文件位于 `.aixcoding/toolsets/aixcoding-harness-toolset/actions/`，且 agents 引用的 8 个动作指令文件（`aixcoding-discover.md` / `aixcoding-split.md` / `aixcoding-design.md` / `aixcoding-specify.md` / `aixcoding-check.md` / `aixcoding-done.md` / `aixcoding-plan.md` / `aixcoding-build.md`）均可读取
4. 触发 `/harness-ba` 可正常编排业务分析（自动读取 `.aixcoding/toolsets/aixcoding-harness-toolset/actions/aixcoding-discover.md` 等动作）

**对于其他 provider**：验证您可以复制并访问以下指令文件：
- `agents/harness-ba.md`
- `agents/harness-architect.md`
- `agents/harness-test.md`
- `agents/harness-dev.md`
- `toolsets/aixcoding-harness-toolset/actions/aixcoding-init.md`（独立于角色的流程步骤）
- `toolsets/aixcoding-harness-toolset/actions/aixcoding-done.md`（独立于角色的流程步骤）

## Notes

- 本安装过程假设您拥有创建目录和文件的必要权限
- 命令的实际实现将由 AI 模型使用 **AIxCoding Harness 工具集**（toolset-id: `aixcoding-harness-toolset`）中的指令来完成
- Agents 是**编排/路由层**，不直接实现动作；具体 Workflow / Output / Guardrails 直接**读取** `.aixcoding/toolsets/aixcoding-harness-toolset/actions/*.md` 中的底层 action 指令
- 命令文件为 `agents/*.md` 的**完整复制**（`cp`），源文件自带 YAML frontmatter 与硬性门禁（HARD GATE）逻辑；更新后需重新复制以生效
- 本 Agents **不依赖"先安装工具集"的独立步骤**——只要工具集 action 已按约定就位于 `.aixcoding/toolsets/` 下，即可直接读取使用
- Agents ID `aixcoding-agents` 应在命令和文档中保持一致使用
- 各编排命令最终引导至底层 action，产物写入 `.aixcoding/workspace/` 下对应子目录
- 建议按推荐执行顺序调用以形成全链路可追溯的价值驱动闭环

## Integration with Other Toolsets

AIxCoding Agents 编排的是 **`aixcoding-harness-toolset`** 的 actions（读取自 `.aixcoding/toolsets/aixcoding-harness-toolset/actions/`），其底层进一步可与以下工具集集成（详见 `aixcoding-harness-toolset` 的 INSTALL）：
- **`aixcoding-test-automation`**：specify 与 build 依赖其生成 .feature 与测试代码
- **`aixcoding-asdm-harness-toolset`**：plan、build、split 复用其 harness 动作；harness-init 由作为流程步骤的 `aixcoding-init` 在工具集层面调用，不属于 agents 编排
- **`aixcoding-asdm-context`（上下文能力）**：init 生成的分层上下文被后续所有步骤全程引用

## License
Copyright (c) 2026 LeansoftX.com & iSoftStone. All rights reserved.

Licensed under the PROPRIETARY SOFTWARE LICENSE. See [LICENSE](LICENSE) in the project root for license information.

---

*This installation document is part of the AIxCoding Agents (aixcoding-agents). 各编排命令独立调用，建议按推荐执行顺序执行以形成全链路可追溯的价值驱动开发闭环。*
