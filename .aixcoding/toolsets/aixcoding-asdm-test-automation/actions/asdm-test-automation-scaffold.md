# Instructions for asdm-test-automation-scaffold action

## Metadata

```json
{
  "guid": "f2a3b4c5-d6e7-8f9a-0b1c-2d3e4f5a6b7c",
  "name": "asdm-test-automation-scaffold",
  "displayName": "仓库初始化",
  "description": "搭建整个测试仓库的基础设施骨架，生成 behave + Playwright 配置、environment.py hooks、core 基础设施代码，并初始化 Step 注册表",
  "toolset": {
    "guid": "d4e5f6a7-b8c9-0d1e-2f3a-4b5c6d7e8f9a",
    "id": "asdm-test-automation",
    "name": "Test Automation",
    "version": "0.0.1"
  },
  "scenario": "测试代码生成"
}
```

## Purpose

本指令引导 AI 模型搭建测试仓库的基础设施骨架。它生成 behave 配置文件、Python 项目配置、`environment.py`（behave hooks）、`core/` 基础设施模块（API Client、Browser Factory、Config、Logger 等），并初始化空的 Step 注册表。这套骨架不依赖任何 `.feature` 文件，是后续 `asdm-test-code-generate` 生成 Step Definitions 的前置依赖。

整个仓库生命周期只执行一次。

## Language Setting

默认使用**中文（简体中文）**作为输出语言。所有生成的内容均使用中文，并遵循中文写作规范。

如需切换语言，可在工作区根目录创建 `.aixcoding/config.json` 配置：
```json
{
  "language": "zh"
}
```
支持的语言：`zh`（中文，默认）、`en`（英文）。

## Context Injection

在开始搭建骨架之前，AI 模型应读取并理解项目上下文（如果可用），以确保生成的配置与项目实际情况一致。

### Context Files to Read (Optional)

1. **index.md** (Recommended - 建议首先读取)
   - Path: `.aixcoding/contexts/index.md`
   - Purpose: 了解项目整体结构和技术栈

2. **Progressive Context Reading** (Optional - 按需加载)
   - `.aixcoding/contexts/api.md` — 了解被测系统的 API 约定，生成 `api_client.py` 时参考
   - `.aixcoding/contexts/architecture.md` — 了解系统架构，判断是否需要额外的测试基础设施

### Reference Project (Recommended)

- Path: `automation-framework-example/`（如工作区中存在）
- Purpose: 作为代码模板参考，确保生成的骨架与参考项目的模式一致

**IMPORTANT**: 上下文加载遵循渐进式原则，仅在需要时读取，避免一次性加载过多信息。

## Steps to 仓库初始化

### 1. 接收初始化参数

接收用户提供的初始化参数：

**必需信息**：
- **目标项目路径**：测试代码的生成目录（如 `./test-automation/`）
- **被测系统 Base URL**：UI 测试的目标地址（如 `https://automationintesting.online`）
- **被测系统 API Base URL**：API 测试的目标地址（如 `https://restful-booker.herokuapp.com`）

**可选信息**（使用默认值 if 未提供）：
- **浏览器类型**：默认 `chromium`（可选 `chromium`/`firefox`/`webkit`）
- **Headless 模式**：默认 `true`
- **默认超时**：默认 `30000` 毫秒
- **behave 版本**：默认 `1.2.6`
- **Playwright 版本**：默认 `1.49.1`

如果用户未提供必需信息，则通过交互式提问收集。

### 2. 创建项目目录结构

在目标项目路径下创建以下目录结构：

```
mkdir -p <target-project>/
mkdir -p <target-project>/core
mkdir -p <target-project>/pages
mkdir -p <target-project>/steps
mkdir -p <target-project>/services
mkdir -p <target-project>/factories
mkdir -p <target-project>/features/api
mkdir -p <target-project>/features/ui
mkdir -p <target-project>/reports/screenshots
```

为每个 Python 包目录创建 `__init__.py`：
- `core/__init__.py`
- `pages/__init__.py`
- `steps/__init__.py`
- `services/__init__.py`
- `factories/__init__.py`

### 3. 生成项目配置文件

#### 3.1 生成 behave.ini

创建 `<target-project>/behave.ini`：

```ini
[behave]
paths = features
format = pretty
show_timings = true
stdout_capture = false
stderr_capture = false
log_capture = false
color = true

[behave.formatters]
html = behave_html_formatter:HTMLFormatter

[behave.userdata]
# Enable detailed error reporting
detailed_errors = true
error_log_max_body_size = 5000
```

#### 3.2 生成 requirements.txt

创建 `<target-project>/requirements.txt`：

```text
# Test Framework
behave==1.2.6
behave-html-formatter==0.9.10

# Browser Automation
playwright==1.49.1

# API Testing
requests==2.32.3

# Configuration & Environment
python-dotenv==1.0.1

# Assertions
assertpy==1.1

# Utilities
colorama==0.4.6
Faker==33.1.0

# Reporting
allure-behave==2.13.5
```

#### 3.3 生成 pyproject.toml

创建 `<target-project>/pyproject.toml`：

```toml
[project]
name = "test-automation"
version = "0.1.0"
description = "BDD Test Automation Framework with Python, Behave, and Playwright"
requires-python = ">=3.10"

[tool.black]
line-length = 100
target-version = ['py310', 'py311', 'py312']

[tool.isort]
profile = "black"
line_length = 100
```

#### 3.4 生成 .env.example

创建 `<target-project>/.env.example`：

```env
# Application Under Test
BASE_URL=<被测系统 Base URL>
API_BASE_URL=<被测系统 API Base URL>

# Browser Configuration
BROWSER=chromium
HEADLESS=true
SLOW_MO=0

# Timeouts (milliseconds)
DEFAULT_TIMEOUT=30000
NAVIGATION_TIMEOUT=60000

# Viewport
VIEWPORT_WIDTH=1920
VIEWPORT_HEIGHT=1080

# Admin Credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=password123

# Screenshots
SCREENSHOT_ON_FAILURE=true
SCREENSHOT_DIR=reports/screenshots

# Logging
LOG_LEVEL=INFO
LOG_API_REQUESTS=true
LOG_API_RESPONSES=true
```

### 4. 生成 core/ 基础设施代码

#### 4.1 生成 core/config.py

生成 `Config` 单例类，负责从 `.env` 加载配置，提供类型安全的 getter 方法（`get`、`get_required`、`get_int`、`get_bool`、`get_list`），以及常用配置的便利属性（`base_url`、`api_base_url`、`browser`、`headless`、`default_timeout`、`viewport_width`、`viewport_height`、`screenshot_dir` 等）。

参考模板：`automation-framework-example/core/config.py`

#### 4.2 生成 core/logger.py

生成日志工具模块，提供 `get_logger(name)` 函数和 `mask_sensitive_data(data)` 函数（用于在日志中脱敏敏感数据如 token、密码等）。

#### 4.3 生成 core/api_client.py

生成 `APIClient` 单例类，基于 `requests.Session`，提供：
- 连接池和重试策略（`Retry` with `backoff_factor`、`status_forcelist`）
- Token 管理（`set_token`、`clear_token`）
- Cookie 管理（`set_cookie`、`clear_cookies`）
- 请求/响应日志（带敏感数据脱敏）
- HTTP 方法封装（`get`、`post`、`put`、`patch`、`delete`）
- `reset()` 类方法（用于测试隔离）

参考模板：`automation-framework-example/core/api_client.py`

#### 4.4 生成 core/browser_factory.py

生成 `BrowserFactory` 单例类，基于 Playwright `sync_api`，提供：
- `initialize()` — 启动 Playwright 和浏览器（在 `before_feature` 中调用）
- `new_context()` — 创建新的浏览器上下文（隔离 cookies/localStorage）
- `new_page()` — 创建新的 Page（在 `before_scenario` 中调用）
- `take_screenshot(name)` — 截图
- `close_context()` — 关闭上下文（在 `after_scenario` 中调用）
- `close()` — 关闭浏览器和 Playwright（在 `after_feature` 中调用）
- `reset()` 类方法 — 重置单例

参考模板：`automation-framework-example/core/browser_factory.py`

#### 4.5 生成 core/response_validator.py

生成 `ResponseValidator` 类，封装 `requests.Response`，提供断言方法：
- `status_code` 属性
- `json` 属性（解析响应体）
- `get_field(field_name, raise_on_missing=True)` — 获取 JSON 字段
- `assert_status_code(expected)` — 断言状态码
- `assert_json_field(field, value)` — 断言 JSON 字段值
- `assert_response_time(max_seconds)` — 断言响应时间

#### 4.6 生成 core/wait_utils.py

生成 `WaitUtils` 工具类，提供静态方法：
- `wait_for_element_visible(page, selector, timeout)` — 等待元素可见
- `wait_for_element_hidden(page, selector, timeout)` — 等待元素隐藏
- `wait_for_network_idle(page)` — 等待网络空闲

### 5. 生成 environment.py（behave hooks）

这是**最关键的产出文件**。生成 `<target-project>/environment.py`，包含以下 hooks：

#### 5.1 before_all(context)

- 初始化 `Config` 单例并存入 `context.config_obj`
- 创建截图目录
- 记录启动日志

#### 5.2 after_all(context)

- 记录测试套件完成日志

#### 5.3 before_feature(context, feature)

- 判断是否为 UI feature（通过 `@ui` tag 或文件路径包含 `/ui/`）
- 如果是 UI feature，初始化 `BrowserFactory` 并存入 `context.browser_factory`

#### 5.4 after_feature(context, feature)

- 如果 `context.browser_factory` 存在，调用 `close()` 关闭浏览器

#### 5.5 before_scenario(context, scenario)

- 重置 `APIClient` 状态（`clear_token()`、`clear_cookies()`）
- 清空 `context.response` 和 `context.validator`
- 初始化测试数据清理列表：`context.bookings_to_cleanup = []`、`context.rooms_to_cleanup = []`（根据实际业务资源调整）
- 如果是 UI 测试，创建新的 Page：`context.page = context.browser_factory.new_page()`

#### 5.6 after_scenario(context, scenario)

- 如果场景失败，调用 `_capture_failure_screenshot()` 截图
- 调用 `_cleanup_test_data()` 清理测试数据（遍历 `context.bookings_to_cleanup` 等列表，调用对应 Service 的 delete 方法）
- 如果是 UI 测试，调用 `context.browser_factory.close_context()`

#### 5.7 辅助函数

- `_is_ui_feature(feature)` — 判断是否为 UI feature
- `_capture_failure_screenshot(context, scenario)` — 失败截图
- `_log_failure_details(context, scenario)` — 记录失败详情（API 响应状态、当前 URL 等）
- `_cleanup_test_data(context)` — 清理测试数据

参考模板：`automation-framework-example/environment.py`

### 6. 生成 pages/base_page.py

生成 `BasePage` 抽象基类，所有 POM 类继承此类：

- `__init__(page)` — 接收 Playwright Page 实例
- `url_path` 抽象属性 — 子类必须实现，返回页面 URL 路径
- `full_url` 属性 — 拼接 base_url 和 url_path
- `navigate()` — 导航到页面并等待加载
- 通用操作方法：`click`、`fill`、`clear_and_fill`、`select_option`、`check`、`uncheck`、`get_text`、`get_input_value`、`get_attribute`、`is_visible`、`is_enabled`、`hover`、`scroll_to`、`press_key`
- 重试方法：`retry_action`、`retry_click`、`retry_fill`
- 断言方法：`assert_url_contains`、`assert_title_contains`、`assert_element_visible`、`assert_element_text`、`assert_element_contains_text`、`assert_input_value`

参考模板：`automation-framework-example/pages/base_page.py`

### 7. 初始化 Step 注册表

创建全局共享注册表 `.aixcoding/workspace/test/step-registry.json`：

```json
{
  "version": "1.0",
  "updated_date": "<today>",
  "steps": []
}
```

`steps` 数组初始为空，后续由 `asdm-test-code-generate` 填充。每个 step 条目的结构：

```json
{
  "step_text": "I am on the home page",
  "step_type": "given",
  "file_path": "steps/ui_steps.py",
  "function_name": "step_on_home_page",
  "feature_source": "home_page_navigation.feature",
  "created_date": "<date>"
}
```

### 8. 验证骨架完整性

验证生成的文件结构：

```
<target-project>/
├── behave.ini
├── pyproject.toml
├── requirements.txt
├── .env.example
├── environment.py
├── core/
│   ├── __init__.py
│   ├── api_client.py
│   ├── browser_factory.py
│   ├── config.py
│   ├── logger.py
│   ├── response_validator.py
│   └── wait_utils.py
├── pages/
│   ├── __init__.py
│   └── base_page.py
├── steps/
│   └── __init__.py
├── services/
│   └── __init__.py
├── factories/
│   └── __init__.py
├── features/
│   ├── api/
│   └── ui/
├── reports/
│   └── screenshots/
```
> Step 注册表为全局共享文件，位于 `.aixcoding/workspace/test/step-registry.json`（不在 target-project 内）。

验证检查项：
- [ ] `behave.ini` 配置正确
- [ ] `requirements.txt` 依赖完整
- [ ] `environment.py` 包含所有 6 个 hooks
- [ ] `core/` 下所有模块可正常导入
- [ ] `pages/base_page.py` 可正常继承
- [ ] `step-registry.json` 格式正确

### 9. 呈现初始化摘要

向用户展示初始化结果：

```markdown
# 仓库骨架初始化完成

## 项目信息
- **项目路径**: <target-project>
- **被测系统 URL**: <base_url>
- **API URL**: <api_base_url>
- **浏览器**: chromium (headless)

## 生成文件
- 配置文件: behave.ini, pyproject.toml, requirements.txt, .env.example
- Hooks: environment.py (6 个 hooks)
- 基础设施: core/ (7 个模块)
- POM 基类: pages/base_page.py
- Step 注册表: .aixcoding/workspace/test/step-registry.json

## 关键说明
- environment.py 的 after_scenario 会自动清理 context.bookings_to_cleanup 等列表中的测试数据
- 后续生成的 Step Definitions 应将创建的资源 ID 追加到对应清理列表
- 请先复制 .env.example 为 .env 并填写实际配置

## 下一步
执行 `/asdm-test-code-generate <feature-file-path>` 为 .feature 文件生成测试代码。
```

## Execution Guidelines

### When to Use This Action

使用本 action 的场景：
- 新建测试仓库，需要首次搭建基础设施
- 整个仓库生命周期只执行一次
- 必须在 `asdm-test-code-generate` 之前执行

### 代码生成原则

1. **参考 automation-framework-example**：所有生成的代码应与参考项目的模式一致
2. **单例模式**：`Config`、`APIClient`、`BrowserFactory` 使用单例模式
3. **类型注解**：所有 Python 代码使用类型注解（`from typing import ...`）
4. **文档字符串**：每个类和方法包含 docstring
5. **日志记录**：关键操作使用 `get_logger(__name__)` 记录日志

### environment.py 关键设计

- **测试数据清理列表**：在 `before_scenario` 中初始化（如 `context.bookings_to_cleanup = []`），在 `after_scenario` 中遍历清理
- **UI/API 区分**：通过 `@ui` tag 或文件路径判断是否需要浏览器
- **失败截图**：场景失败时自动截图并记录详情
- **资源隔离**：每个 scenario 使用新的 browser context 和 page

### 错误处理

- **目标路径已存在**：提示用户该目录已有内容，询问是否覆盖
- **依赖版本冲突**：如果用户指定了与参考项目不兼容的版本，提示风险
- **配置缺失**：如果 `.env` 文件不存在，提示用户从 `.env.example` 复制

## Usage

To use this instruction, the AI model should:
1. 检测响应语言
2. 接收用户的初始化参数（目标路径、Base URL、API URL 等）
3. 按需读取项目上下文和参考项目
4. 创建项目目录结构
5. 生成配置文件（behave.ini、requirements.txt、pyproject.toml、.env.example）
6. 生成 core/ 基础设施代码（config、logger、api_client、browser_factory、response_validator、wait_utils）
7. 生成 environment.py（behave hooks）
8. 生成 pages/base_page.py（POM 基类）
9. 初始化 step-registry.json
10. 验证骨架完整性
11. 呈现初始化摘要并提示下一步

## Output Summary

完成仓库初始化后，将生成以下产出：
- 配置文件：`behave.ini`、`pyproject.toml`、`requirements.txt`、`.env.example`
- Hooks 文件：`environment.py`（含 6 个 hooks 和辅助函数）
- 基础设施模块：`core/` 下 7 个 Python 模块
- POM 基类：`pages/base_page.py`
- 空目录：`steps/`、`services/`、`factories/`、`features/api/`、`features/ui/`
- Step 注册表：`.aixcoding/workspace/test/step-registry.json`（初始为空）

所有文件保存在用户指定的目标项目路径下。

### Downstream Flow

```text
/asdm-test-automation-scaffold                    ← 当前步骤：搭建仓库骨架
        │
        ▼
/asdm-test-code-generate <feature-file>     ← 为 .feature 生成测试代码
        │
        ▼
/asdm-test-step-sync                        ← 同步注册表（定期维护）
```
