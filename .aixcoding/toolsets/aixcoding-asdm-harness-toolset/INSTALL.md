# ASDM 驾驭工程工具集 安装说明

**Toolset ID:** `asdm-harness-toolset`

## 概述
本文档提供 ASDM 驾驭工程工具集的安装与配置说明。该工具集为你的项目提供完整的 AI 辅助软件工程支持，覆盖从需求分析、设计、编码、测试到验收审查的全流程。

## AI 引导安装
如需使用 AI 引导安装，请将以下提示复制粘贴到 AI 编码工具的聊天窗口：

```shell
Follow instructions in .aixcoding/toolsets/aixcoding-asdm-harness-toolset/INSTALL.md
```

## 安装步骤

### 1. 创建工作区目录

创建 ASDM 驾驭工作区的目录结构：

```bash
mkdir -p .aixcoding/workspace/asdm-harness/feat
```

### 2. 检测当前 `Agentic Engine` 提供商

检测当前 AI 编码助手提供商，按以下规则判断：

- 如果 `.aixcoding` 目录存在，使用 `AIxCoding`
- 如果以上目录均不存在，提示用户手动选择提供商

### 3. 为 ASDM 驾驭工程工具集（toolset ID: `asdm-harness-toolset`）创建快捷命令

> **设计原则**：命令文件应直接**复制** `.aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/` 下的实际 action 文件内容，而非薄引用（`follow`）。这样命令文件即为完整的 action 指令，不依赖文件工具读取虚拟目录。

#### 对于 AIxCoding（`.aixcoding/commands/`）：

AIxCoding 使用 Markdown 命令文件及 YAML 前置元数据，支持通过 `$ARGUMENTS` 传递参数：

```bash
mkdir -p .aixcoding/commands/

# 项目初始化：创建目录骨架并生成项目总体计划
cp .aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/asdm-harness-init.md .aixcoding/commands/asdm-harness-init.md

# 需求访谈追问：结构化追问澄清需求
cp .aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/asdm-harness-askme.md .aixcoding/commands/asdm-harness-askme.md

# PRD 总体设计：生成 PRD 总体概述与使用场景
cp .aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/asdm-harness-design-overall.md .aixcoding/commands/asdm-harness-design-overall.md

# 设计图解析（可选）：将 UI 设计图解析为结构化规格
cp .aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/asdm-harness-design-parse.md .aixcoding/commands/asdm-harness-design-parse.md

# PRD 详细设计：Code Research + 技术方案/数据模型/验收条件
cp .aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/asdm-harness-design-details.md .aixcoding/commands/asdm-harness-design-details.md

# 开发任务拆解：拆解为可执行可验证任务清单
cp .aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/asdm-harness-plan.md .aixcoding/commands/asdm-harness-plan.md

# 开发实施：实现→验证→修复→确认闭环
cp .aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/asdm-harness-develop.md .aixcoding/commands/asdm-harness-develop.md

# 测试计划生成：生成结构化功能测试计划
cp .aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/asdm-harness-testplan.md .aixcoding/commands/asdm-harness-testplan.md

# 功能验收审查：对照 PRD 验收条件生成验收报告
cp .aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/asdm-harness-verify.md .aixcoding/commands/asdm-harness-verify.md

# US 级任务拆解：拆解为 US 级实施计划
cp .aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/asdm-harness-us-plan.md .aixcoding/commands/asdm-harness-us-plan.md

# US 级开发实施：完成后回写 US 卡片状态
cp .aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/asdm-harness-us-develop.md .aixcoding/commands/asdm-harness-us-develop.md

```
### 4. 安装所需 Skills

使用 `asdm` CLI 安装工具集所需的 skills：

```bash
asdm skill install context-loader
asdm skill install path-validator
asdm skill install markdownlint
```

这将安装以下 skills：
- **context-loader**：加载项目上下文和知识库，帮助 AI Agent 准确理解项目现状
- **path-validator**：验证文件路径和引用有效性，确保文档中的链接和引用准确无误
- **markdownlint**：对 Markdown 文档进行 lint 检查，保证文档格式规范和质量

### 5. 其他提供商的 Manual Usage

如果您的 AI 编码助手不在自动检测逻辑覆盖范围内（AIxCoding），仍可手动使用本工具集：

#### 直接指令使用
您可以直接使用指令文件，将其相对路径复制粘贴到 AI 编码助手的聊天窗口：

1. **进入指令文件目录**：
   ```bash
   cd .aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/
   ```

2. **右键点击所需指令文件**并复制其相对路径：
   - 需求访谈：`asdm-harness-askme.md`
   - PRD 总体设计：`asdm-harness-design-overall.md`
   - 设计图解析：`asdm-harness-design-parse.md`
   - PRD 详细设计：`asdm-harness-design-details.md`
   - 任务拆解：`asdm-harness-plan.md`
   - 开发实施：`asdm-harness-develop.md`
   - US 级任务拆解：`asdm-harness-us-plan.md`
   - US 级开发实施：`asdm-harness-us-develop.md`
   - 测试计划：`asdm-harness-testplan.md`
   - 验收审查：`asdm-harness-verify.md`

3. **在 AI 编码助手中输入提示**：
   ```
   follow .aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/asdm-harness-askme.md
   ```

## 工具集初始化

### 步骤〇：初始化工作区

安装完成后，首先初始化驾驭工作区：

```shell
/asdm-harness-init
```

这将：
- 创建工作区目录骨架（feat/、sessions/、reports/、cache/）
- 从项目上下文自动采集信息
- 生成项目总体计划（overall-plan.md）

### 步骤一：需求访谈

```shell
/asdm-harness-design-overall FT-XXX
```

这将：
- 基于 AskMe 文档生成 PRD 核心章节
- （阶段二）执行代码调研并补充详细设计
- 生成完整的 PRD 产品需求文档

### 步骤三：任务规划

```shell
/asdm-harness-plan FT-XXX
```

这将：
- 基于 PRD 拆解可执行任务
- 采用纵向拆分，每个任务端到端可验证
- 生成 Plan 实施计划文档

### 步骤五：编码实施

```shell
/asdm-harness-develop FT-XXX
```

这将：
- 按 Plan 任务顺序逐个执行
- 严格遵循 实现→验证→修复→人工确认 闭环
- 自动记录开发进度

### 步骤六：测试验证

```shell
/asdm-harness-testplan FT-XXX
```

这将：
- 基于 PRD 生成结构化测试计划
- 每个用例包含明确的测试步骤

### 步骤七：验收审查

```shell
/asdm-harness-verify FT-XXX
```

这将：
- 对照 PRD 验收条件逐项审查
- 生成功能验收报告

### 可用命令

安装完成后，可使用以下命令：

1. **`/asdm-harness-init`** — 工作区初始化：创建目录骨架并生成项目总体计划
2. **`/asdm-harness-askme`** — 需求访谈追问：通过结构化追问消除需求中的模糊点
3. **`/asdm-harness-design-overall`** — PRD 总体设计：生成总体概述与使用场景
4. **`/asdm-harness-design-parse`** — 设计图解析（可选）：将 UI 设计图解析为结构化规格文档
5. **`/asdm-harness-design-details`** — PRD 详细设计：Code Research + 技术方案 + 验收条件
6. **`/asdm-harness-plan`** — 开发任务拆解：基于 PRD 拆解可执行开发计划
7. **`/asdm-harness-develop`** — 开发实施：按 Plan 启动编码闭环
8. **`/asdm-harness-us-plan`** — US 级任务拆解：基于单条 US 卡片拆解可执行计划
9. **`/asdm-harness-us-develop`** — US 级开发实施：按 US 级 Plan 编码，完成后回写卡片状态
10. **`/asdm-harness-testplan`** — 测试计划生成：生成功能测试套件与用例
11. **`/asdm-harness-verify`** — 功能验收审查：生成验收报告

## 工具集工作区结构

本工具集在 `.aixcoding/workspace/asdm-harness/` 下创建以下结构：

```
.aixcoding/workspace/asdm-harness/
├── overall-plan.md                        # 项目总体计划
└── feat/                                  # 特性工作目录
    └── FT-{id}-{name}/                    # 单个特性全流程文档
        ├── FT-{id}-{name}-AskMe.md        # 需求访谈文档
        ├── FT-{id}-{name}-PRD.md          # 产品需求文档
        ├── design/                         # 原始设计图目录（UI 特性）
        ├── FT-{id}-{name}-DesignSpec.md   # 设计图解析规格（可选）
        ├── FT-{id}-{name}-CodeResearch-{module}.md  # 代码调研
        ├── FT-{id}-{name}-Plan.md         # 开发任务计划
        ├── FT-{id}-{name}-develop-log.json    # 开发进度跟踪
        ├── FT-{id}-{name}-US-{序号}-{us名字}-Plan.md           # US 级实施计划（可选）
        └── FT-{id}-{name}-US-{序号}-{us名字}-develop-log.json  # US 级开发进度跟踪
```

## 规范文档

本工具集使用以下规范文档作为模板：

1. **`overall-plan-spec.md`** — 总体计划模板，定义 overall-plan.md 的结构与填充规则
2. **`prd-spec.md`** — PRD 文档规范，定义产品需求文档的结构与质量标准
3. **`design-spec.md`** — DesignSpec 文档规范，定义设计图解析规格的结构与校验规则
4. **`plan-spec.md`** — Plan 文档规范，定义开发计划的拆解粒度与内容要求
5. **`develop-spec.md`** — 编码规范，定义 AI 编码产出质量与开发流程状态管理
6. **`test-spec.md`** — 测试规范，定义测试计划结构与步骤规范
7. **`review-spec.md`** — 审查规范，定义验收报告与路径验证规则

## 验证

安装完成后，请验证：

1. `.aixcoding/workspace/asdm-harness/` 目录及其子目录已创建
2. ASDM 驾驭工程工具集（toolset ID: `asdm-harness-toolset`）的快捷命令已创建在对应提供商目录中（如果使用 AIxCoding）
3. 每个命令文件为对应 action 文件的**完整复制**（`cp .aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/<action>.md .aixcoding/commands/<action>.md`），而非薄引用（`follow`）
4. 本工具集文件位于 `.aixcoding/toolsets/aixcoding-asdm-harness-toolset`（toolset ID: `asdm-harness-toolset`）

**对于其他提供商**：请验证是否可以访问以下指令文件：
- `.aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/asdm-harness-init.md`
- `.aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/asdm-harness-askme.md`
- `.aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/asdm-harness-design-overall.md`
- `.aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/asdm-harness-design-parse.md`
- `.aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/asdm-harness-design-details.md`
- `.aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/asdm-harness-plan.md`
- `.aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/asdm-harness-develop.md`
- `.aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/asdm-harness-us-plan.md`
- `.aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/asdm-harness-us-develop.md`
- `.aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/asdm-harness-testplan.md`
- `.aixcoding/toolsets/aixcoding-asdm-harness-toolset/actions/asdm-harness-verify.md`

## 使用示例

### 完整开发流程

```shell
# 第〇步：初始化工作区
/asdm-harness-init

# 第一步：需求访谈，澄清需求
/asdm-harness-askme

# 第二步：基于澄清结果生成 PRD
/asdm-harness-design-overall FT-001

# （可选）若特性涉及 UI，解析设计图
/asdm-harness-design-parse FT-001

# 第三步：拆解开发任务
/asdm-harness-plan FT-001

# 第四步：逐个任务编码实施
/asdm-harness-develop FT-001
# 或按 US 粒度开发（循环执行所有 US）：
#   /asdm-harness-us-plan FT-001 US-01
#   /asdm-harness-us-develop FT-001 US-01
#   ... 重复直至全部 US 完成

# 第五步：生成测试计划并验证
/asdm-harness-testplan FT-001

# 第六步：功能验收审查
/asdm-harness-verify FT-001
```

## 使用方式

### 对于受支持的提供商（AIxCoding）
安装完成后，可直接使用以下快捷命令：
- `/asdm-harness-init`：工作区初始化
- `/asdm-harness-askme`：需求访谈追问
- `/asdm-harness-design-overall`：PRD 总体设计
- `/asdm-harness-design-parse`：设计图解析（可选）
- `/asdm-harness-design-details`：PRD 详细设计
- `/asdm-harness-plan`：开发任务拆解
- `/asdm-harness-develop`：开发实施
- `/asdm-harness-us-plan`：US 级任务拆解
- `/asdm-harness-us-develop`：US 级开发实施
- `/asdm-harness-testplan`：测试计划生成
- `/asdm-harness-verify`：功能验收审查

### 对于其他提供商（Manual Usage）
如果您的提供商未被自动检测到，可按上面"其他提供商的 Manual Usage"中的步骤手动使用指令文件。

## 备注

- 本安装过程假设您拥有创建目录和文件的必要权限
- 命令文件为对应 action 文件的**完整复制**（`cp`），因此 action 文件更新后需重新复制命令以生效
- 使用本工具集前请确保 `asdm-context-builder` 工具集已安装并生成项目上下文
- 工具集 ID 在所有命令和文档中需保持一致

## 与其他工具集的集成

ASDM 驾驭工程工具集可与以下 ASDM 工具集协同工作：
- **asdm-context-builder**：提供项目上下文知识库，确保 AI Agent 准确理解项目现状
- **toolset-builder**：如需扩展或定制本工具集的功能

### 获取帮助
如遇到问题，请参考：
- [ASDM 文档](https://asdm.ai/docs)
- 工具集 README：`.aixcoding/toolsets/aixcoding-asdm-harness-toolset/README.md`
- 规范文档在 `.aixcoding/toolsets/aixcoding-asdm-harness-toolset/specs/`

## 许可
Copyright (c) 2026 LeansoftX.com & iSoftStone. All rights reserved.

Licensed under the PROPRIETARY SOFTWARE LICENSE. See [LICENSE](LICENSE) in the project root for license information.

---

*本安装文档是 ASDM 驾驭工程工具集的一部分。使用本工具集为你的项目提供完整的 AI 优先研发流水线。*
