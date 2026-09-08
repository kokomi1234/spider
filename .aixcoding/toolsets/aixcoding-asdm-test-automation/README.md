# ASDM Toolset - Test Automation

toolset-id: asdm-test-automation
toolset-name: Test Automation
version: 0.0.1
updated-date: 2026-07-13
toolset-description: 覆盖从需求实例化到测试代码生成的完整测试自动化流水线。基于 Specification by Example（SBE）方法论，将 User Story 验收标准实例化为 Gherkin .feature 文件（asdm-test-scenario-analyze/generate/api/validate），并基于 Python + behave + Playwright 技术栈将 .feature 文件自动转化为可直接运行的端到端测试代码——包括 Page Object Model 类、Step Definitions、API Service 和测试数据 Builder（asdm-test-automation-scaffold/generate/sync）。

## Overview

Test Automation（toolset-id: asdm-test-automation）是一个覆盖"需求实例化 → 测试代码生成"完整流程的 ASDM 工具集。它由两大阶段组成：**需求实例化阶段**（asdm-test-scenario-analyze / asdm-test-spec-* 系列 action）和**测试代码生成阶段**（asdm-g2c-* 系列 action），形成从 User Story 到可执行自动化测试代码的标准化桥梁。

**需求实例化阶段**承接上游 User Story 卡片（位于 `.aixcoding/workspace/stories/<feature-id>/<us-id>.md`），将每条 User Story 卡片中以 Given-When-Then 格式描述的抽象验收标准（AC），基于 Specification by Example（SBE）方法论实例化为可直接执行的 Gherkin `.feature` 文件。核心价值在于把 SBE 这项依赖业务理解和测试设计经验的隐性技能，沉淀为显性的、分步骤的方法论与产出物：先分析 User Story 的验收标准，识别其中的变量、参数和待实例化的条件；再基于源码（UI 层依赖前端源码 / api 层依赖后端源码）为每条 AC 生成**具体 `Scenario`（非 Scenario Outline）**，测试数据直接内联；最后校验 Gherkin 语法正确性、测试覆盖完整性和 Cucumber 可执行性。每个阶段都有明确的输入、输出和质量校验标准。

**测试代码生成阶段**读取需求实例化阶段产出的 Gherkin `.feature` 文件，结合 Python + behave + Playwright 技术栈，自动生成可直接运行的端到端测试代码。它生成 Page Object Model 类（封装页面操作和选择器）、Step Definitions（含测试数据准备与清理逻辑）、API Service 和测试数据 Builder，并通过 Step 注册表机制支持跨 Story 的步骤复用检测。工具集覆盖测试仓库的完整生命周期：首次搭建基础设施骨架（scaffold）、每次新增 `.feature` 时增量生成代码（generate）、以及定期同步注册表与实际代码（sync）。

本工具集主要面向开发工程师、测试工程师（QA）以及参与 BDD/自动化验收测试的全功能团队成员。典型使用场景包括：User Story 拆分完成后将抽象验收标准转化为具体可执行测试场景；开发团队编写自动化验收测试前的需求实例化环节；以及将 `.feature` 文件落地为可执行测试代码的"最后一公里"问题。

User can install this toolset into a workspace and run `INSTALL.md` document using `AI Guided Installation` to initialize the toolset for the workspace.

## Features

### Common features

**需求实例化阶段**：
- 基于 Specification by Example（SBE）方法论，遵循"分析 → 实例化 → 校验"三阶段流程
- 承接上游拆分的 User Story 卡片（位于 `.aixcoding/workspace/stories/<feature-id>/<us-id>.md`），读取其中的 Given-When-Then 验收标准（AC）
- **asdm-test-scenario-analyze 不依赖源码**，可在源码实现前执行；`asdm-test-spec-ui-generate` 依赖**前端源码**（或前端上下文文档）生成 UI 层（`@layer:ui`）仅 Happy Path 场景；`asdm-test-spec-api-generate` 依赖**后端源码**（Controller/DTO/枚举/异常处理类）直接扫描生成 API 契约层（`@layer:api`）场景；`asdm-test-spec-validate` 不依赖源码
- 将抽象的验收标准实例化为具体的测试数据与可直接执行的 Gherkin `Scenario`（测试数据内联，不使用 Scenario Outline/Examples）
- 输出符合 Gherkin 语法、可直接被 Cucumber 执行的 `.feature` 文件
- 支持测试金字塔分层：`asdm-test-spec-ui-generate` 产出 UI 层（`@layer:ui`），`asdm-test-spec-api-generate` 产出 API 契约层（`@layer:api`）

**测试代码生成阶段**：
- 基于 Python + behave + Playwright 技术栈生成端到端测试代码
- 通过 Step 注册表机制支持跨 Story 的步骤复用检测
- 自动生成 Page Object Model 类，封装页面操作和选择器
- 测试数据准备与清理自动化（Given 创建、after_scenario 清理）
- 支持参数化 Step（`{param}` 占位符）和 DataTable
- 生成的代码遵循 PEP 8 规范，包含类型注解和 docstring

### Feature 1: 示例分析（asdm-test-scenario-analyze）

分析 User Story 卡片的验收标准，识别需要实例化的变量与测试维度，基于 AC 语义和业务常识生成初始数据需求清单，产出结构化的示例分析文档。此阶段不依赖源码。

**Input**: User Story ID（来自已拆分的 User Story 卡片 `.aixcoding/workspace/stories/<feature-id>/<us-id>.md`）
**Output**: 示例分析文档（`example-analysis.md`），包含变量识别（标注约束来源）、测试维度、数据需求清单（标注待源码验证项）
**Use Case**: 在 User Story 进入开发或测试设计前，需要先理解验收标准中哪些部分需要实例化、需要哪些测试数据

### Feature 2: 示例生成（asdm-test-spec-ui-generate）

基于前端源码（或前端上下文文档）与 User Story 卡片，为每条 AC 生成 **Happy Path（正常路径）** 的具体 `Scenario`，测试数据直接内联（引号字符串或数据表格），元素命名以源码扫描结果为准，输出符合 Gherkin 语法、可直接被 Cucumber 执行的 `.feature` 文件。本阶段只生成正常路径场景，不生成边界值/异常值。

**Input**: User Story ID + 前端源码（或前端上下文文档 `frontend.md`）
**Output**: Gherkin `.feature` 文件（`<story-id>.feature`），包含 Feature、Background、多条具体 `Scenario`（每条 AC 一个，数据内联，不使用 Scenario Outline）
**Use Case**: 开发团队编写 BDD/Cucumber 自动化验收测试前的需求实例化环节；源码实现前的初始 .feature 文件生成

### Feature 3: 示例校验（asdm-test-spec-validate）

对生成的 Gherkin `.feature` 文件进行语法校验、覆盖率检查和 Cucumber 可执行性验证，产出校验报告和优化建议。此阶段不依赖源码，聚焦于 Gherkin 语法正确性和测试覆盖完整性。

**Input**: User Story ID（已通过 `asdm-test-spec-ui-generate` 完成 .feature 文件生成）
**Output**: 校验报告（`validation-report.md`）+ 更新的示例状态
**Use Case**: `.feature` 文件生成后的质量把关，确保 Gherkin 语法正确、测试覆盖完整、可被 Cucumber 直接执行

### Feature 4: API 层示例生成（asdm-test-spec-api-generate）

基于 User Story 卡片与**后端源码**（Controller / 请求·响应 DTO / Entity / 枚举 / 全局异常处理类），以 HTTP 语义实例化验收标准，生成 API 契约层 Gherkin `.feature` 文件。与 `asdm-test-spec-ui-generate`（UI 层）平行，覆盖接口契约测试、字段级边界值与错误码覆盖三个测试关注点。

**Input**: User Story ID + 后端源码仓库（必需，直接扫描，不依赖预先提取的契约文档）
**Output**: API 层 Gherkin `.feature` 文件（`<story-id>.api.feature`），携带 `@layer:api` 标签
**Use Case**: 需要以 HTTP 语义实例化验收标准、生成测试金字塔 API 契约层测试的场景

### Feature 5: 仓库初始化（asdm-test-automation-scaffold）

搭建整个测试仓库的基础设施骨架，不依赖任何 .feature 文件，根据用户指定的技术栈生成基础代码。

**职责**：
- 生成 behave + Playwright 基础配置文件
- 生成 environment.py（hooks）、Browser Factory、API Client 等支撑代码
- 初始化 Step 注册表（空）
- 创建 POM、Step Definitions、Services、Factories 目录结构

**Input**: 技术栈配置（behave 版本、Playwright 版本、目标项目路径等）
**Output**: 完整的测试仓库骨架（behave.ini、environment.py、core/ 模块、pages/base_page.py、step-registry.json 等）
**Use Case**: 新测试仓库首次搭建时使用，整个仓库生命周期只执行一次

### Feature 6: 核心代码生成（asdm-test-code-generate）

这是测试代码生成阶段的主力 action，输入是一个 .feature 文件，产出是完整可运行的测试代码。

**职责**：
- 解析 .feature 文件中的 Scenario 和 Step
- 查询 Step 注册表，检测已有 Step 是否可复用
- 生成 Page Object Model 类（封装页面操作和选择器）
- 生成 Step Definitions（含测试数据准备与清理逻辑）
- 更新 Step 注册表

**Input**: .feature 文件路径
**Output**: POM 类文件、Step Definitions 文件、API Service 文件、测试数据 Builder 文件、更新的 Step 注册表
**Use Case**: `.feature` 文件经 asdm-test-spec-ui-generate 实例化完成后，需要落地为可执行测试代码时使用；也适用于测试仓库持续生长过程中新增 .feature 文件时的增量代码生成

### Feature 7: 注册表同步（asdm-test-step-sync）

随着开发者手动修改或重构 Step Definitions，注册表会和实际代码出现漂移。这个 action 负责同步注册表与实际代码状态。

**职责**：
- 扫描 `steps/` 目录下所有 `.py` 文件
- 提取所有 `@given`/`@when`/`@then` 装饰器的 step 文本
- 与 `step-registry.json` 对比，补充新增、标记删除
- 输出同步报告，告知哪些 step 是新增/删除/冲突

**Input**: 测试代码根目录路径
**Output**: 更新后的 `step-registry.json` + 同步报告（新增/删除/冲突的 step 列表）
**Use Case**: 开发者手动修改或重构 Step Definitions 后，定期运行以确保 `asdm-test-code-generate` 的复用检测始终基于真实的代码状态

## Toolset Installation Process

`INSTALL.md` will setup the toolset with the following steps:
- 创建 `.aixcoding/workspace/stories/<feature-id>` 目录（User Story 卡片）
- 创建 `.aixcoding/workspace/specs/<feature-id>/<story-id>` 工作区目录（需求实例化阶段产出物）
- 创建 `.aixcoding/workspace/test` 工作区根目录（含全局共享的 Step 注册表 `step-registry.json` 所在目录）
- 检测当前 AI 助手提供商
- 创建快捷命令（7 个命令）

## Toolset Workflow

Once Test Automation is installed, user can use the following commands:

**需求实例化阶段**：
- `/asdm-test-scenario-analyze`: 分析 User Story 验收标准，识别变量和测试维度，产出示例分析文档（无源码依赖）
- `/asdm-test-spec-ui-generate`: 基于前端源码生成 UI 层（`@layer:ui`）Happy Path 场景的 Gherkin .feature 文件（具体 Scenario，数据内联）
- `/asdm-test-spec-api-generate`: 基于后端源码生成 API 契约层（`@layer:api`）Gherkin .feature 文件（HTTP 语义，直接扫描 Controller/DTO）
- `/asdm-test-spec-validate`: 校验 Gherkin 语法、覆盖率和 Cucumber 可执行性（无源码依赖）

**测试代码生成阶段**：
- `/asdm-test-automation-scaffold`: 初始化测试仓库基础设施骨架（整个仓库生命周期只执行一次）
- `/asdm-test-code-generate <feature-file-path>`: 根据 .feature 文件生成完整可运行的测试代码
- `/asdm-test-step-sync`: 同步 Step 注册表与实际代码状态

**推荐完整流程**：

```
# === 需求实例化阶段 ===
1. /asdm-test-scenario-analyze <us-id>             → 生成示例分析文档（无源码依赖）
2. /asdm-test-spec-ui-generate <us-id>         → 基于前端源码生成 UI 层 Gherkin .feature 文件（@layer:ui，仅 Happy Path）
   /asdm-test-spec-api-generate <us-id>              → （平行可选）基于后端源码生成 API 契约层 .feature 文件（@layer:api）
3. /asdm-test-spec-validate <us-id>            → 校验 Gherkin 语法与覆盖率

# === 开发团队实现源码 ===

# === 测试代码生成阶段 ===
4. /asdm-test-automation-scaffold               → 首次搭建测试仓库骨架（只执行一次）
5. /asdm-test-code-generate <feature>     → 为每个 .feature 生成测试代码
6. /asdm-test-step-sync                   → 手动修改代码后同步注册表（定期维护）
```

## Toolset Structure

The Test Automation toolset has the following structure:

```
.aixcoding/
└── toolsets/
    └── asdm-test-automation/
        ├── INSTALL.md
        ├── README.md
        ├── manifest.json
        ├── actions/
        │   ├── asdm-test-scenario-analyze.md              # 示例分析阶段（无源码依赖）
        │   ├── asdm-test-spec-ui-generate.md             # UI 层示例生成（@layer:ui，依赖前端源码，仅 Happy Path）
        │   ├── asdm-test-spec-api-generate.md                  # API 契约层示例生成（@layer:api，依赖后端源码，HTTP 语义）
        │   ├── asdm-test-spec-validate.md             # 示例校验阶段（无源码依赖）
        │   ├── asdm-test-automation-scaffold.md        # 测试仓库初始化（只执行一次）
        │   ├── asdm-test-code-generate.md        # 核心代码生成（每次新增 .feature 时跑）
        │   └── asdm-test-step-sync.md            # 注册表同步（定期维护）
        └── spec/
            ├── example-analysis-spec.md    # 示例分析文档规范
            ├── feature-file-spec.md        # UI 层 Gherkin .feature 文件规范（@layer:ui）
            ├── api-feature-spec.md         # API 契约层 Gherkin .feature 文件规范（@layer:api）
            ├── validation-report-spec.md   # 校验报告规范
            ├── step-registry-spec.md       # Step 注册表 JSON 结构规范
            ├── pom-spec.md                 # Page Object Model 类结构规范
            ├── step-definitions-spec.md    # Step Definitions 文件结构规范
            ├── api-service-spec.md         # API Service 类结构规范
            └── test-data-builder-spec.md   # 测试数据 Builder 结构规范
```

### Spec Documents

The toolset uses the following spec documents as templates:

**需求实例化阶段规范**：
- **example-analysis-spec.md**: 示例分析文档（`example-analysis.md`）的结构规范
- **feature-file-spec.md**: UI 层（`@layer:ui`）Gherkin `.feature` 文件的结构规范
- **api-feature-spec.md**: API 契约层（`@layer:api`）Gherkin `.feature` 文件的结构规范
- **validation-report-spec.md**: 校验报告（`validation-report.md`）的结构规范

**测试代码生成阶段规范**：
- **step-registry-spec.md**: Step 注册表 JSON 结构规范，定义 `step-registry.json` 的格式
- **pom-spec.md**: Page Object Model 类结构规范，定义 POM 类的代码模板
- **step-definitions-spec.md**: Step Definitions 文件结构规范，定义 `_steps.py` 的代码模板
- **api-service-spec.md**: API Service 类结构规范，定义 `_service.py` 的代码模板
- **test-data-builder-spec.md**: 测试数据 Builder 结构规范，定义 `_builder.py` 的代码模板

## Toolset Workspace

The Test Automation toolset has the following workspace structure:

### 需求实例化阶段工作区

```
.aixcoding/workspace/specs/
└── <feature-id>/                         # 如 FT-001
    └── <story-id>/                       # 如 FT-001-US-02
        ├── <story-id>.example-analysis.md   # 示例分析文档（asdm-test-scenario-analyze 产出）
        ├── <story-id>.feature               # UI 层 Gherkin .feature 文件（asdm-test-spec-ui-generate 产出，@layer:ui）
        ├── <story-id>.api.feature           # API 契约层 Gherkin .feature 文件（asdm-test-spec-api-generate 产出，@layer:api）
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
├── behave.ini                 # behave 配置（含 formatter、输出选项）
├── pyproject.toml             # Python 项目配置（工具链、lint 规则）
├── requirements.txt           # 依赖清单（behave、playwright、requests、assertpy、Faker 等）
├── environment.py             # behave hooks（before_all/after_all/before_scenario/after_scenario）
├── core/                      # 测试基础设施
│   ├── __init__.py
│   ├── api_client.py          # 测试数据准备用的 HTTP 客户端封装
│   ├── browser_factory.py     # Playwright 浏览器工厂（持有 page/browser/context）
│   ├── config.py              # 配置管理（base_url、browser、headless 等）
│   ├── logger.py              # 日志工具
│   ├── response_validator.py  # API 响应校验器
│   └── wait_utils.py          # 等待工具
├── pages/                     # POM 目录
│   ├── __init__.py
│   ├── base_page.py           # POM 基类
│   └── <page-name>.py         # Page Object Model 类
├── steps/                     # Step Definitions 目录
│   ├── __init__.py
│   └── <feature-name>_steps.py
├── services/                  # API 服务层
│   ├── __init__.py
│   └── <resource>_service.py  # API 操作封装
├── factories/                 # 测试数据构造器
│   ├── __init__.py
│   └── <resource>_builder.py  # 测试数据 Builder
└── .aixcoding/workspace/test/
    └── step-registry.json     # Step 注册表（全局共享）
```

## Copyright & License

Copyright (c) 2026 LeansoftX.com & iSoftStone. All rights reserved.

Licensed under the PROPRIETARY SOFTWARE LICENSE. See [LICENSE](LICENSE) in the project root for license information.
