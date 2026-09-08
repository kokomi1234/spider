---
name: aixcoding-test
description: '测试代码生成：把已生成的 .feature 规格落地为可运行的端到端测试代码（POM / Step Definitions / API Service / 数据 Builder）。按开发进度分层：开发完成后生成 API 测试代码；ui.feature 生成后生成 UI 测试代码。基于 aixcoding-test-automation 工具集（scaffold→code-generate→step-sync）。'
---

# AIxCoding Test-Code-Generate — 测试代码生成

## 定位

把 **已生成的 `.feature` 规格**（`aixcoding-specify` 产物）转化为**可直接运行的端到端测试代码**。这是「规格 → 代码」的落地环节，**独立于 `.feature` 生成、由用户显式触发**，以避免在源码尚未实现时产出低质量测试代码。

**核心原则（违反即为 Bug）**：
- **绝不自动衔接在 .feature 生成之后**。`aixcoding-specify` 只产出规格，不产出代码。
- **代码实现完成之后才允许生成测试代码**，且按层路由：
  - 有 `api.feature`（开发前已生成）+ 源码已实现 → 可生成 **API 测试代码**。
  - 有 `ui.feature`（开发完成后生成）→ 可生成 **UI 测试代码**。

## 整合

| 原步骤 | 工具集                                  | 集成方式 |
|--------|----------------------------------------|----------|
| asdm-test-automation-scaffold | aixcoding-asdm-test-automation | 首次搭建测试仓库骨架（整个仓库生命周期只执行一次） |
| asdm-test-code-generate | aixcoding-asdm-test-automation | 核心代码生成：解析 .feature → POM / Step Definitions / API Service / 数据 Builder |
| asdm-test-step-sync | aixcoding-asdm-test-automation | 定期同步 Step 注册表与实际代码（维护用） |

## Input

| 输入项 | 来源 | 必填 |
|--------|------|:--:|
| Story ID / Feature 文件路径 | 用户 | ⚠️（未提供必须让用户选择） |
| api.feature / ui.feature | `aixcoding-specify` 产物 | 按层 |

## Workflow

### 1. 校验前置：测试仓库骨架（scaffold）

检查测试项目是否已初始化（存在 `behave` 配置 / `core/` 基础设施 / `step-registry.json`）：
- **未初始化** → 先执行 `asdm-test-automation-scaffold` 搭建仓库骨架（只执行一次），再继续。
- **已初始化** → 跳过。

> 校验方式：检查 Step 注册表 `./.aixcoding/workspace/test/step-registry.json`（用 `./` 前缀路径，避免命中隐藏目录判断失败）。缺失 → 需先 scaffold。

### 2. 解析意图并按层路由

读取用户指令 `{arguments}`，结合 `.feature` 产物确定生成哪一层：

- **API 测试代码**：基于 `<story-id>.api.feature`（开发前生成的接口契约）生成。**前提：源码已实现**（否则提示用户先 `/dev` 实现）。
- **UI 测试代码**：基于 `<story-id>.ui.feature`（开发完成后生成的 UI 场景）生成。**前提：ui.feature 已存在**。
- **未指定层**：按已存在的 `.feature` 判断——两者都存在则询问用户生成 API 还是 UI（或 `--all` 全部生成）；只有 ui.feature 则生成 UI。

> 判断源码实现进度的方式：检查对应 Feature/Story 源码是否已写入工作区（如 controller/service/前端文件存在）；无法确认时引导用户说明开发进度。

### 3. 执行测试代码生成

对每个待生成的 `.feature` 文件：

1. 读取并严格遵循 `asdm-test-code-generate` 指令文件（`../toolsets/aixcoding-asdm-test-automation/actions/asdm-test-code-generate.md`）：
   - 读取 Step 注册表 + `.feature` 文件，生成 Step 复用分析报告。
   - 生成 **Page Object Model 类**（UI 层：选择器必须溯源被测项目真实源码，禁止占位符）。
   - 生成 **API Service 类**（给定/API 数据准备）。
   - 生成 **测试数据 Builder**（如需）。
   - 生成 **Step Definitions** 文件。
   - 更新 **Step 注册表**。
   - 验证生成代码（`py_compile` + `behave --dry-run` + 选择器溯源检查）。
   - 呈现生成摘要（含选择器溯源情况）。

### 4. 可选维护：Step 注册表同步

若用户在生成后手动修改过 Step Definitions，可执行 `asdm-test-step-sync` 同步注册表与实际代码（定期维护，非每次必做）。

## Output

```
<test-project>/
├── pages/<page-name>.py               # POM（UI 层，选择器溯源）
├── services/<resource>_service.py     # API Service（API/给定数据准备）
├── factories/<resource>_builder.py    # 测试数据 Builder（如需）
├── steps/<feature-name>_steps.py      # Step Definitions
├── environment.py / core/…            # scaffold 产物（首次）
└── .aixcoding/workspace/test/step-registry.json   # 更新
```

## Guardrails

- **不在 .feature 生成后自动生成测试代码**；生成代码必须由用户显式触发，且源码已实现。
- **开发前只生成 api.feature（规格），不生成 api 测试代码**（源码未实现时生产环境不可执行）。
- **API 测试代码**在源码实现后生成；**UI 测试代码**在 ui.feature 生成后生成。
- UI 层 POM 选择器**必须溯源被测项目真实源码**（`sourceProject.path` + 组件读取），禁止占位符。
- 只处理测试代码生成，**绝不执行** design / plan / build。

## 使用

- `/test 请为 Feature <feature-id> 生成 api 测试代码`（源码实现后）
- `/test 请为 Feature <feature-id> 生成 ui 测试代码`（ui.feature 生成后）
- `/test 请为 Feature <feature-id> 生成全部测试代码`（api + ui）
