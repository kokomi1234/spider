# Test Automation Installation

**Toolset ID:** `asdm-test-automation`

## Overview

This document provides instructions for installing and setting up the Test Automation toolset. 本工具集覆盖从需求实例化到测试代码生成的完整测试自动化流水线：基于 Specification by Example（SBE）方法论，将 User Story 验收标准实例化为 Gherkin .feature 文件（asdm-test-scenario-analyze/generate/api/validate），并基于 Python + behave + Playwright 技术栈将 .feature 文件自动转化为可直接运行的端到端测试代码（asdm-test-automation-scaffold/generate/sync）。

## AI Guided Installation

To install this toolset using AI Guided Installation, copy and paste the following prompt into your AI Coding tool's chat window:

```shell
Follow instructions in .aixcoding/toolsets/asdm-test-automation/INSTALL.md
```

## Installation Steps

### 1. Create workspace directories

Create the directories for storing Test Automation workspace data:

```bash
# User Story 卡片工作区
mkdir -p .aixcoding/workspace/stories

# 需求实例化阶段工作区（specs/<feature-id>/<story-id>）
mkdir -p .aixcoding/workspace/specs

# 测试代码生成阶段工作区（Step 注册表，全局共享于 test 根下）
```

### 2. Detect the current `Agentic Engine` provider

Detect the current AI coding assistant provider (e.g., AIxCoding). Using the following guidelines to detect the provider:

- If `.aixcoding` directory exists, use `AIxCoding`
- If no such folder is found in the current workspace, give user a prompt to select a provider manually

### 3. Create shortcuts commands for Test Automation (toolset ID: `asdm-test-automation`) in provider's entry point

Create shortcut commands in the appropriate location based on the detected provider. The installation process is consistent across all providers - we use `cat` to concatenate provider-specific frontmatter with the actual instruction content:

#### For AIxCoding (`.aixcoding/commands/`):
AIxCoding doesn't support frontmatter, so simply copy the instruction files as-is:

```bash
mkdir -p .aixcoding/commands/

# Copy instruction files directly (no frontmatter needed)
cp .aixcoding/toolsets/asdm-test-automation/actions/asdm-test-scenario-analyze.md .aixcoding/commands/
cp .aixcoding/toolsets/asdm-test-automation/actions/asdm-test-spec-ui-generate.md .aixcoding/commands/
cp .aixcoding/toolsets/asdm-test-automation/actions/asdm-test-spec-api-generate.md .aixcoding/commands/
cp .aixcoding/toolsets/asdm-test-automation/actions/asdm-test-spec-validate.md .aixcoding/commands/
cp .aixcoding/toolsets/asdm-test-automation/actions/asdm-test-automation-scaffold.md .aixcoding/commands/
cp .aixcoding/toolsets/asdm-test-automation/actions/asdm-test-code-generate.md .aixcoding/commands/
cp .aixcoding/toolsets/asdm-test-automation/actions/asdm-test-step-sync.md .aixcoding/commands/
```

### 4. Manual Usage for Other Providers

If your AI coding assistant provider is not detected by the automatic detection logic (AIxCoding), you can still use the Test Automation toolset manually. Follow these steps:

#### Direct Instruction Usage
You can directly use the instruction files by copying their relative paths and pasting them into your AI coding assistant's chat window:

1. **Navigate to the instruction files**:
   ```bash
   cd .aixcoding/toolsets/asdm-test-automation/actions/
   ```

2. **Right-click on the desired instruction file** and copy its relative path:
   - For 示例分析: `asdm-test-scenario-analyze.md`
   - For 示例生成: `asdm-test-spec-ui-generate.md`
   - For API 层示例生成: `asdm-test-spec-api-generate.md`
   - For 示例校验: `asdm-test-spec-validate.md`
   - For 仓库初始化: `asdm-test-automation-scaffold.md`
   - For 核心代码生成: `asdm-test-code-generate.md`
   - For 注册表同步: `asdm-test-step-sync.md`

3. **Enter a prompt** in your AI coding assistant:
   ```
   Follow the instructions in {relative path to instruction file}
   ```

## Initializing Test Automation

### 需求实例化阶段

#### 示例分析（asdm-test-scenario-analyze）
After installation, you can start by running the first action:

```shell
Follow the instructions in .aixcoding/toolsets/asdm-test-automation/actions/asdm-test-scenario-analyze.md
```

This will:
- 读取 User Story 卡片，提取用户故事和验收标准（AC）
- 逐条分析 AC，识别待实例化的变量并标注约束来源
- 为每条 AC 定义正常值、边界值、异常值三类测试维度
- 产出示例分析文档（`example-analysis.md`）

#### 示例生成（asdm-test-spec-ui-generate）
After completing the analysis, run the generation action:

```shell
Follow the instructions in .aixcoding/toolsets/asdm-test-automation/actions/asdm-test-spec-ui-generate.md
```

This will:
- 读取 User Story 卡片与前端源码（或前端上下文文档）
- 为每条 AC 生成 Happy Path 的具体 `Scenario`，测试数据直接内联
- 页面元素命名以源码扫描结果为准
- 产出符合 Gherkin 语法的 `.feature` 文件（`@layer:ui`，仅 Happy Path）

#### API 层示例生成（asdm-test-spec-api-generate）
After generating the UI layer (or independently), run the API layer generation action:

```shell
Follow the instructions in .aixcoding/toolsets/asdm-test-automation/actions/asdm-test-spec-api-generate.md
```

This will:
- 读取 User Story 卡片并直接扫描后端源码（Controller/DTO/枚举/异常处理类）
- 建立 AC 与 API 端点的映射，按测试关注点（契约/边界/错误码）拆分场景
- 以 HTTP 语义实例化验收标准，生成具体 `Scenario`（DataTable + DocString）
- 产出 API 契约层 `.feature` 文件（`<story-id>.api.feature`，`@layer:api`）

#### 示例校验（asdm-test-spec-validate）
After generating the .feature file, run the validation action:

```shell
Follow the instructions in .aixcoding/toolsets/asdm-test-automation/actions/asdm-test-spec-validate.md
```

This will:
- 校验 Gherkin 语法正确性
- 检查测试覆盖率（AC 覆盖、数据类型覆盖、枚举覆盖）
- 验证 Cucumber 可执行性
- 产出校验报告（`validation-report.md`）和优化建议

### 测试代码生成阶段

#### 仓库初始化（asdm-test-automation-scaffold）

```shell
Follow the instructions in .aixcoding/toolsets/asdm-test-automation/actions/asdm-test-automation-scaffold.md
```

This will:
- 生成 behave 配置文件（`behave.ini`、`pyproject.toml`、`requirements.txt`、`.env.example`）
- 生成 `environment.py`（6 个 behave hooks，含测试数据清理逻辑）
- 生成 `core/` 基础设施模块（config、logger、api_client、browser_factory、response_validator、wait_utils）
- 生成 `pages/base_page.py` POM 基类
- 初始化空的 Step 注册表 `step-registry.json`

**注意**：此动作在整个仓库生命周期只执行一次，必须在 `asdm-test-code-generate` 之前执行。

#### 核心代码生成（asdm-test-code-generate）

```shell
Follow the instructions in .aixcoding/toolsets/asdm-test-automation/actions/asdm-test-code-generate.md
```

This will:
- 解析 `.feature` 文件中的 Scenario 和 Step
- 查询 Step 注册表检测已有 Step 是否可复用
- 生成 Page Object Model 类、Step Definitions、API Service 和测试数据 Builder
- 更新 Step 注册表

#### 注册表同步（asdm-test-step-sync）

```shell
Follow the instructions in .aixcoding/toolsets/asdm-test-automation/actions/asdm-test-step-sync.md
```

This will:
- 扫描 `steps/` 目录下所有 Python 文件
- 提取 `@given`/`@when`/`@then` 装饰器的 step 文本
- 与 `step-registry.json` 对比，补充新增、标记删除、修复冲突
- 输出同步报告

### Available Commands
Once installed, you can use the following commands:

**需求实例化阶段**：
1. **`/asdm-test-scenario-analyze`** - 分析 User Story 验收标准，识别变量和测试维度，产出示例分析文档
2. **`/asdm-test-spec-ui-generate`** - 基于前端源码生成 UI 层（`@layer:ui`）Happy Path 场景的 Gherkin .feature 文件
3. **`/asdm-test-spec-api-generate`** - 基于后端源码生成 API 契约层（`@layer:api`）Gherkin .feature 文件（HTTP 语义）
4. **`/asdm-test-spec-validate`** - 校验 Gherkin 语法、覆盖率和 Cucumber 可执行性

**测试代码生成阶段**：
5. **`/asdm-test-automation-scaffold`** - 初始化测试仓库基础设施骨架（整个仓库生命周期只执行一次）
6. **`/asdm-test-code-generate <feature-file-path>`** - 根据 .feature 文件生成完整可运行的测试代码
7. **`/asdm-test-step-sync`** - 同步 Step 注册表与实际代码状态

## Toolset Structure
The toolset will create the following structure in `.aixcoding/workspace/`:

### 需求实例化阶段工作区
```
.aixcoding/workspace/specs/
└── <feature-id>/                         # 如 FT-001
    └── <story-id>/                       # 如 FT-001-US-02
        ├── <story-id>.example-analysis.md   # 示例分析文档（asdm-test-scenario-analyze 产出）
        ├── <story-id>.feature               # UI 层 .feature 文件（asdm-test-spec-ui-generate 产出，@layer:ui）
        ├── <story-id>.api.feature           # API 契约层 .feature 文件（asdm-test-spec-api-generate 产出，@layer:api）
        └── <story-id>.validation-report.md  # 校验报告（asdm-test-spec-validate 产出）
```

### 测试代码生成阶段工作区
```
.aixcoding/workspace/test/
└── step-registry.json      # Step 注册表（全局共享），记录所有已生成的 step 文本及对应文件位置
```

**生成的测试代码结构**（位于用户指定的测试项目目录）：

```
<test-project>/
├── behave.ini                 # behave 配置
├── pyproject.toml             # Python 项目配置
├── requirements.txt           # 依赖清单
├── environment.py             # behave hooks
├── core/                      # 测试基础设施
│   ├── api_client.py
│   ├── browser_factory.py
│   ├── config.py
│   ├── logger.py
│   ├── response_validator.py
│   └── wait_utils.py
├── pages/                     # POM 目录
│   ├── base_page.py
│   └── <page-name>.py
├── steps/                     # Step Definitions 目录
│   └── <feature-name>_steps.py
├── services/                  # API 服务层
│   └── <resource>_service.py
├── factories/                 # 测试数据构造器
│   └── <resource>_builder.py
└── .aixcoding/workspace/test/
    └── step-registry.json     # Step 注册表（全局共享）
```

## Spec Documents
The toolset uses the following spec documents as templates:

**需求实例化阶段规范**：
1. **`example-analysis-spec.md`** - 示例分析文档（`example-analysis.md`）的结构规范
2. **`feature-file-spec.md`** - UI 层（`@layer:ui`）Gherkin `.feature` 文件的结构规范
3. **`api-feature-spec.md`** - API 契约层（`@layer:api`）Gherkin `.feature` 文件的结构规范
4. **`validation-report-spec.md`** - 校验报告（`validation-report.md`）的结构规范

**测试代码生成阶段规范**：
5. **`step-registry-spec.md`** - Step 注册表 JSON 结构规范，定义 `step-registry.json` 的格式
6. **`pom-spec.md`** - Page Object Model 类结构规范，定义 POM 类的代码模板
7. **`step-definitions-spec.md`** - Step Definitions 文件结构规范，定义 `_steps.py` 的代码模板
8. **`api-service-spec.md`** - API Service 类结构规范，定义 `_service.py` 的代码模板
9. **`test-data-builder-spec.md`** - 测试数据 Builder 结构规范，定义 `_builder.py` 的代码模板

## Verification

After installation, verify that:

1. The `.aixcoding/workspace/specs` directory exists for 需求实例化阶段；`.aixcoding/workspace/test` 目录存在用于测试代码生成阶段
2. User Story 卡片位于 `.aixcoding/workspace/stories/<feature-id>/<us-id>.md`
3. Shortcut commands for Test Automation (toolset ID: `asdm-test-automation`) are created in the appropriate provider directory (if using AIxCoding)
4. The Test Automation toolset files are located in `.aixcoding/toolsets/asdm-test-automation` (toolset ID: `asdm-test-automation`)

**For other providers**: Verify that you can access the instruction files at:
- `.aixcoding/toolsets/asdm-test-automation/actions/asdm-test-scenario-analyze.md`
- `.aixcoding/toolsets/asdm-test-automation/actions/asdm-test-spec-ui-generate.md`
- `.aixcoding/toolsets/asdm-test-automation/actions/asdm-test-spec-api-generate.md`
- `.aixcoding/toolsets/asdm-test-automation/actions/asdm-test-spec-validate.md`
- `.aixcoding/toolsets/asdm-test-automation/actions/asdm-test-automation-scaffold.md`
- `.aixcoding/toolsets/asdm-test-automation/actions/asdm-test-code-generate.md`
- `.aixcoding/toolsets/asdm-test-automation/actions/asdm-test-step-sync.md`

## Usage Examples

### Example 1: 完整的 User Story 示例化流程
```shell
# First, install the toolset using AI Guided Installation
Follow instructions in .aixcoding/toolsets/asdm-test-automation/INSTALL.md

# 前置：需先存在 User Story 卡片 .aixcoding/workspace/stories/FT-001/FT-001-US-02.md

# Step 1: 示例分析（分析 AC，识别变量和测试维度，无源码依赖）
/asdm-test-scenario-analyze FT-001-US-02

# Step 2: 示例生成（基于前端源码生成 UI 层 .feature 文件；平行可选 /asdm-test-spec-api-generate 扫描后端源码）
/asdm-test-spec-ui-generate FT-001-US-02

# Step 3: 示例校验（校验语法、覆盖率、Cucumber 可执行性）
/asdm-test-spec-validate FT-001-US-02
```

### Example 2: 从 .feature 文件生成可执行测试代码
```shell
# Step 1: 初始化测试仓库骨架（只执行一次）
/asdm-test-automation-scaffold ./test-automation/

# Step 2: 为第一个 .feature 文件生成测试代码
/asdm-test-code-generate .aixcoding/workspace/specs/FT-001/FT-001-US-02/FT-001-US-02.feature

# Step 3: 为第二个 .feature 文件生成测试代码（复用已有 step）
/asdm-test-code-generate .aixcoding/workspace/specs/FT-001/FT-001-US-02/FT-001-US-02.api.feature

# Step 4: 手动修改代码后同步注册表
/asdm-test-step-sync ./test-automation/
```

## Usage

### For Supported Providers (AIxCoding)
Once installed, you can use the following commands:

**需求实例化阶段**：
- `/asdm-test-scenario-analyze`: 分析 User Story 验收标准，识别变量和测试维度，产出示例分析文档
- `/asdm-test-spec-ui-generate`: 基于前端源码生成 UI 层（`@layer:ui`）Happy Path 场景的 Gherkin .feature 文件
- `/asdm-test-spec-api-generate`: 基于后端源码生成 API 契约层（`@layer:api`）Gherkin .feature 文件（HTTP 语义）
- `/asdm-test-spec-validate`: 校验 Gherkin 语法、覆盖率和 Cucumber 可执行性

**测试代码生成阶段**：
- `/asdm-test-automation-scaffold [target-project-path]`: 初始化测试仓库基础设施骨架（整个仓库生命周期只执行一次）
- `/asdm-test-code-generate <feature-file-path>`: 根据 .feature 文件生成完整可运行的测试代码
- `/asdm-test-step-sync [test-project-path]`: 同步 Step 注册表与实际代码状态

### For Other Providers (Manual Usage)
If your provider is not automatically detected, you can manually use the instructions by following the steps in the "Manual Usage for Other Providers" section above.

## Notes

- This installation process assumes you have the necessary permissions to create directories and files
- The toolset ID `asdm-test-automation` should be used consistently when referring to Test Automation in commands and documentation
- **asdm-test-scenario-analyze / asdm-test-spec-validate** 不依赖源码；**asdm-test-spec-ui-generate** 依赖前端源码、**asdm-test-spec-api-generate** 依赖后端源码
- **asdm-test-automation-scaffold** 必须在 `asdm-test-code-generate` 之前执行，因为生成的 Step Definitions 依赖骨架中的 `environment.py` 和 `core/` 模块
- 所有产出文档存储于 `.aixcoding/workspace/specs/<feature-id>/<story-id>/` 工作区；User Story 卡片存储于 `.aixcoding/workspace/stories/<feature-id>/<us-id>.md`
- 生成的测试代码参考 `automation-framework-example/` 项目的代码模式

## Integration with Other Toolsets
Test Automation can integrate with other ASDM toolsets and context files.

### 上游
- **User Story 卡片**: 位于 `.aixcoding/workspace/stories/<feature-id>/<us-id>.md`（含 Given-When-Then 验收标准），作为 asdm-test-scenario-analyze 的输入

### 源码依赖
- **asdm-test-spec-ui-generate**: 依赖前端源码（或前端上下文文档 `frontend.md`）实例化页面元素
- **asdm-test-spec-api-generate**: 直接扫描后端源码（Controller/DTO/枚举/异常处理类），不依赖预先提取的契约文档

### 下游使用
- 产出的 `.feature` 文件可直接交付 Cucumber 执行
- `asdm-test-code-generate` 将 `.feature` 文件转化为可执行的 Python + behave + Playwright 测试代码
- QA 基于测试数据补充手动测试用例

### Getting Help
For issues with Test Automation toolset, refer to:
- [ASDM Documentation](https://asdm.ai/docs)
- Toolset README: `.aixcoding/toolsets/asdm-test-automation/README.md`
- Spec documents in `.aixcoding/toolsets/asdm-test-automation/spec/`

## License
Copyright (c) 2026 LeansoftX.com & iSoftStone. All rights reserved.

Licensed under the PROPRIETARY SOFTWARE LICENSE. See [LICENSE](LICENSE) in the project root for license information.

---

*This installation document is part of the Test Automation toolset. Use Test Automation to efficiently transform User Story acceptance criteria into executable Gherkin .feature files and runnable test code based on Specification by Example methodology.*
