# Instructions for asdm-test-code-generate action

## Metadata

```json
{
  "guid": "a3b4c5d6-e7f8-9a0b-1c2d-3e4f5a6b7c8d",
  "name": "asdm-test-code-generate",
  "displayName": "核心代码生成",
  "description": "解析 .feature 文件，查询 Step 注册表检测复用，生成 Page Object Model 类、Step Definitions、API Service 和测试数据 Builder，并更新 Step 注册表",
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

本指令引导 AI 模型将 Gherkin `.feature` 文件转化为可直接运行的端到端测试代码。它解析 `.feature` 中的 Scenario 和 Step，查询 Step 注册表检测已有 Step 是否可复用，生成 Page Object Model 类（封装 Playwright 操作和选择器）、Step Definitions（含测试数据准备与清理逻辑）、API Service（封装接口调用）和测试数据 Builder（构造测试数据），最后更新 Step 注册表。

这是工具集的主力 action，每次新增 `.feature` 文件时执行。

## Language Setting

默认使用**中文（简体中文）**作为输出语言。所有生成的内容均使用中文，并遵循中文写作规范。

如需切换语言，可在工作区根目录创建 `.aixcoding/config.json` 配置：
```json
{
  "language": "zh"
}
```
支持的语言：`zh`（中文，默认）、`en`（英文）。

## 被测项目源码配置

**MUST**: 生成涉及 UI 操作的 POM 类之前，AI 模型必须读取被测项目的真实前端源码来提取选择器，而不是凭 Step 文本臆造。这是本 action 的强约束，不可跳过。

在工作区根目录的 `.aixcoding/config.json` 中配置被测项目信息：

```json
{
  "language": "zh",
  "sourceProject": {
    "path": "../frontend",
    "framework": "vue2",
    "pageComponentMap": {
      "预约页面": "src/views/Consultation.vue",
      "首页": "src/views/Home.vue",
      "登录页": "src/views/Login.vue"
    }
  }
}
```

字段说明：
- **`path`**（必需）：被测前端项目根目录，相对于工作区或绝对路径
- **`framework`**（可选，默认 `vue2`）：当前固定支持 `vue2`（Vue2 单文件组件 `.vue`）。选择器提取规则按此字段切换
- **`pageComponentMap`**（推荐）：页面名称 → 组件文件相对路径（相对于 `sourceProject.path`）的显式映射表，是定位组件最可靠的方式。首次为某个页面生成代码时，若映射表中没有对应条目，AI 模型应在定位到组件后主动询问用户是否要写入该映射，减少后续重复搜索

若 `.aixcoding/config.json` 中未配置 `sourceProject.path`，且当前 .feature 涉及 UI Step，禁止跳过源码读取直接用占位符生成选择器，按以下兜底流程处理：

1. **询问用户提供被测前端项目地址**（本地路径或仓库地址均可，一次性输入即可，不要求提前写好配置文件）
2. 拿到路径后，**优先读取该项目下的 `.aixcoding/contexts/index.md`**（如存在）—— 这是该前端仓库已整理好的模块/路由索引，语义定位准确率高于直接扫描源码目录
3. 若用户明确希望后续复用该路径，主动询问是否写入 `.aixcoding/config.json` 的 `sourceProject.path`（写入后不必每次都问）

具体的语义定位方法见第 4.2 节。

## Context Injection

在开始生成代码之前，AI 模型应读取并理解项目上下文和已有代码。

### Context Files to Read (Required)

1. **Step 注册表** (Required - MUST be read first)
   - Path: `.aixcoding/workspace/test/step-registry.json`
   - Purpose: 查询已有 Step，检测复用机会

2. **.feature 文件** (Required)
   - Path: 用户指定的 `.feature` 文件路径
   - Purpose: 解析 Scenario 和 Step，作为代码生成的输入

### Context Files to Read (Recommended)

3. **environment.py** (Recommended)
   - Path: `<test-project>/environment.py`
   - Purpose: 了解 hooks 结构，确保生成的 Step 与清理机制一致

4. **pages/base_page.py** (Recommended)
   - Path: `<test-project>/pages/base_page.py`
   - Purpose: 了解 POM 基类，生成的 POM 类需继承此类

### Context Files to Read (Optional - 按需加载)

5. **已有 POM 类** (Optional)
   - Path: `<test-project>/pages/*.py`
   - Purpose: 检测是否已有相同页面的 POM 类可复用

6. **已有 Step Definitions** (Optional)
   - Path: `<test-project>/steps/*.py`
   - Purpose: 检测是否已有相同 Step 可复用

7. **已有 API Service** (Optional)
   - Path: `<test-project>/services/*.py`
   - Purpose: 检测是否已有相同资源的 Service 可复用

8. **被测项目上下文** (Optional)
   - `.aixcoding/contexts/index.md` — 了解项目整体结构，语义定位相关组件源码
   - Purpose: 提取真实的 DOM 选择器（`data-testid`、`id`、`class`、表单绑定字段、按钮/标签文本等），生成的 POM 选择器必须来自此处，而非猜测
   - **不可跳过**：这是本 action 与 Step 注册表、.feature 文件同级的必读项，缺失会导致选择器不可用；无法找到前端项目地址，需先向用户询问项目地址（见"被测项目源码配置"章节）

### Reference Project (Recommended)

- Path: `automation-framework-example/`（如工作区中存在）
- Purpose: 作为代码模式参考

**IMPORTANT**: 始终先读取 Step 注册表和 .feature 文件；如涉及 UI Step，在生成 POM 类之前必须先定位并读取被测项目的源码组件（见第 4.2 节），再按需加载其他上下文。

## Steps to 核心代码生成

### 1. 接收 .feature 文件路径

接收用户提供的 `.feature` 文件路径：

**必需信息**：
- **.feature 文件路径**：要生成代码的 Gherkin 文件路径

**可选信息**：
- **测试类型**：`ui`（UI 测试）或 `api`（API 测试），默认通过 .feature 文件的 tag 或路径推断
- **目标项目路径**：测试代码生成目录，默认为当前工作区下的测试项目

如果用户未提供 .feature 文件路径，则提示用户提供。

### 2. 解析 .feature 文件

读取并解析 `.feature` 文件，提取以下信息：

#### 2.1 提取 Feature 元信息

- **Feature 名称**：`Feature:` 行的描述
- **Feature 描述**：Feature 下的描述文本
- **Tags**：`@ui`、`@api`、`@smoke` 等 tag
- **背景**：`Background:` 部分（如有）

#### 2.2 提取 Scenario 和 Step

对每个 `Scenario`（本工具集不使用 `Scenario Outline`，测试数据直接内联）：
- **Scenario 名称**
- **Tags**（如 `@smoke`、`@regression`、`@AC-<编号>`）
- **Step 列表**：每个 Step 包含：
  - 关键字（`Given`/`When`/`Then`/`And`/`But`）
  - 文本内容
  - 是否含参数（`{param}` 占位符或 DataTable）

#### 2.3 分类 Step

将所有 Step 按类型分类：
- **Given Steps**：数据准备/前置条件
- **When Steps**：用户操作/触发动作
- **Then Steps**：断言/验证

### 3. 查询 Step 注册表检测复用

读取 `.aixcoding/workspace/test/step-registry.json`，对 .feature 中的每个 Step：

#### 3.1 精确匹配

检查 Step 文本是否在注册表中已存在：
- 如果**存在**，记录该 Step 为**可复用**，引用已有的 `file_path` 和 `function_name`
- 如果**不存在**，标记为**需新生成**

#### 3.2 模糊匹配（参数化）

对于含参数的 Step，检查是否有参数化的已有 Step 可匹配：
- 例如 `.feature` 中 `I create a booking for "John" "Doe"` 可能匹配注册表中的 `I create a booking for "{firstname}" "{lastname}"`
- 如果找到模糊匹配，提示用户确认是否复用

#### 3.3 生成复用报告

```markdown
# Step 复用分析报告

## 可复用 Steps (3)
| Step 文本 | 类型 | 来源文件 | 函数名 |
|-----------|------|----------|--------|
| I am on the home page | given | steps/ui_steps.py | step_on_home_page |
| I login as admin | when | steps/ui_steps.py | step_login_admin |
| I should see the hotel name | then | steps/ui_steps.py | step_see_hotel_name |

## 需新生成 Steps (5)
| Step 文本 | 类型 | 拟生成函数名 |
|-----------|------|-------------|
| I create a room "101" of type "Single" | when | step_create_room_single |
| ... | ... | ... |
```

### 4. 生成 Page Object Model 类

对于涉及 UI 操作的 **When** 和 **Then** Step，生成或更新 POM 类。

#### 4.1 识别页面

从 Step 文本中推断涉及的页面：
- "home page" → `HomePage`
- "admin page" → `AdminPage`
- "booking page" → `BookingPage`

#### 4.2 定位并读取源码组件（MUST，UI Step 必经步骤）

在生成任何选择器之前，必须先定位到被测项目中对应的 Vue2 单文件组件并完整读取，禁止跳过此步直接进入 4.4 用占位符生成。

**定位策略**（按优先级依次尝试，命中即停止）：

0. **获取项目路径**：若 `.aixcoding/config.json` 未配置 `sourceProject.path`，先询问用户提供被测前端项目地址，拿到路径后再继续下述定位

1. **显式映射**：用 4.1 识别出的页面名称精确匹配 key

2. **索引语义匹配**：若显式映射未命中，检查 `<sourceProject.path>/.aixcoding/contexts/index.md` 是否存在。若存在，读取该索引文件，结合当前 US / .feature 的业务语义——包括：
   - **关键词**：Feature 名称、Scenario 描述、页面名称中的业务术语（如"预约"、"问诊"、"处方"）
   - **路由片段**：.feature 或 US 卡片中提到的 URL 路径片段（如 `/consultation`、`/booking`）
   - **模块目录名**：index.md 中登记的模块/目录结构（如 `src/views/consultation/`）
   
   在 index.md 登记的模块索引中做语义匹配，定位到候选页面/路由文件。index.md 是项目已整理的结构化索引，语义定位准确率通常高于直接扫描源码目录，**应优先于第 3、4 步使用**

3. **路由匹配**：若 index.md 不存在或未匹配到，读取 `<sourceProject.path>/src/router/index.js`（或 `router/routes.js` 等常见路径），根据 .feature 中出现的 URL / 页面路径关键词匹配 `component:` 指向的文件

4. **关键词模糊搜索**：在 `<sourceProject.path>/src/views/`、`src/pages/` 等目录下，按页面名称的中英文关键词（如"预约"↔`Consultation`、`Appointment`）搜索文件名或搜索 `.vue` 文件 `<template>` 内的标题文本

5. **全部失败**：明确告知用户"未能在 <sourceProject.path> 下定位到『<页面名>』对应的组件文件"，请用户提供路径或补充 `pageComponentMap`。**此时才允许退化为占位符选择器**，并在生成摘要（第10步）中显著标注"⚠️ 未溯源，需人工核对"

**读取与提取**（定位成功后）：

完整读取该 `.vue` 文件的 `<template>` 部分（必要时结合 `<script>` 中的 `data`/`computed`/`methods` 理解绑定关系），针对 .feature 中该页面涉及的每个元素，按以下优先级提取选择器：

| 优先级 | 来源 | 示例 |
|--------|------|------|
| 1 | `data-testid` 属性（如有） | `[data-testid="submit-btn"]` |
| 2 | `id` 属性 | `#patient-name-input` |
| 3 | 唯一的语义化 `class`（结合父级限定，避免命中多个元素） | `.consultation-form .submit-button` |
| 4 | `v-model` 绑定字段名 + 标签文本，转为 Playwright 语义定位 | `get_by_label("患者姓名")`、`get_by_role("button", name="提交")` |
| 5 | 均不满足唯一性时，用最小化结构选择器并标注风险 | `.form-item:nth-child(2) input`（需在代码注释标注"⚠️ 非唯一，建议源码补充 data-testid"）|

**记录来源**：每个提取到的选择器，在 4.4 生成的 POM 常量旁以注释标注来源文件与大致位置，例如 `# 来源: src/views/Consultation.vue`，便于后续核对和维护。

如果组件内表单较复杂（动态渲染、`v-for` 循环项等），应在生成摘要中说明哪些选择器是基于静态模板结构推断的，可能需要结合实际渲染结果二次确认。

#### 4.3 检查已有 POM

检查 `pages/` 目录下是否已有对应的 POM 类：
- 如果**已有**，读取并分析需要新增的方法
- 如果**没有**，创建新的 POM 类文件

#### 4.4 生成 POM 类

每个 POM 类继承 `BasePage`，选择器全部来自 4.2 提取结果（禁止使用未溯源的占位符，除非 4.2 已明确降级并标注警告）：

```python
"""
<Page Name> page object.

Selectors sourced from: <sourceProject.path>/<component-path>
"""

from playwright.sync_api import Page, expect

from pages.base_page import BasePage


class <PageName>Page(BasePage):
    """
    Page object for the <Page Name> page.
    """

    # Selectors（来源: <component-path>）
    SELECTOR_EXAMPLE = "[data-testid=\"example-field\"]"  # 来源: <component-path> <input data-testid="example-field">
    SELECTOR_BUTTON = "#submit-btn"  # 来源: <component-path> <button id="submit-btn">

    @property
    def url_path(self) -> str:
        """URL path for this page."""
        return "<page-path>"

    # Action methods (for When steps)

    def perform_action(self, param: str) -> None:
        """Perform an action on the page."""
        self.fill(self.SELECTOR_EXAMPLE, param)
        self.click(self.SELECTOR_BUTTON)

    # Getter methods (for Then steps)

    def get_some_value(self) -> str:
        """Get a value from the page."""
        return self.get_text(self.SELECTOR_EXAMPLE)

    # Assertion methods (for Then steps)

    def assert_something_visible(self) -> None:
        """Assert something is visible."""
        self.assert_element_visible(self.SELECTOR_EXAMPLE)
```

**POM 设计原则**：
- 选择器定义为类常量（`SELECTOR_XXX`），且必须能在源码注释中追溯到具体文件
- When Step 对应 action 方法（动词开头，如 `click_submit`、`fill_form`）
- Then Step 对应 getter 或 assertion 方法（如 `get_error_message`、`assert_success_visible`）
- 方法返回 POM 实例（`self`）以支持链式调用（action 方法）

### 5. 生成 API Service 类

对于涉及 API 调用的 **Given** Step（数据准备），生成或更新 API Service 类。

#### 5.1 识别资源

从 Step 文本中推断涉及的 API 资源：
- "booking" → `BookingService`
- "room" → `RoomService`
- "auth" → `AuthService`

#### 5.2 检查已有 Service

检查 `services/` 目录下是否已有对应的 Service 类：
- 如果**已有**，读取并分析需要新增的方法
- 如果**没有**，创建新的 Service 类文件

#### 5.3 生成 Service 类

每个 Service 类封装对应资源的 CRUD 操作：

```python
"""
<Resource> service for API operations.
"""

from typing import Any, Optional

import requests

from core.api_client import APIClient
from core.logger import get_logger
from core.response_validator import ResponseValidator


class <Resource>Service:
    """
    Service for <resource>-related API operations.
    """

    ENDPOINT = "/<resource>"

    def __init__(self) -> None:
        self.client = APIClient()
        self.logger = get_logger(__name__)

    def create_<resource>(self, **kwargs) -> tuple[requests.Response, ResponseValidator]:
        """Create a new <resource>."""
        self.logger.info("Creating <resource>")
        response = self.client.post(self.ENDPOINT, json={...})
        return response, ResponseValidator(response)

    def delete_<resource>(self, resource_id: int) -> tuple[requests.Response, ResponseValidator]:
        """Delete a <resource>."""
        self.logger.info(f"Deleting <resource>: {resource_id}")
        response = self.client.delete(f"{self.ENDPOINT}/{resource_id}")
        return response, ResponseValidator(response)

    def get_<resource>(self, resource_id: int) -> tuple[requests.Response, ResponseValidator]:
        """Get a specific <resource>."""
        response = self.client.get(f"{self.ENDPOINT}/{resource_id}")
        return response, ResponseValidator(response)
```

参考模板：`automation-framework-example/services/booking_service.py`

### 6. 生成测试数据 Builder

如果 Given Step 需要构造复杂测试数据，生成 Builder 类。

#### 6.1 生成 Builder

```python
"""
<Resource> data builder for test scenarios.
"""

from dataclasses import dataclass
from typing import Any, Optional

from faker import Faker


@dataclass
class <Resource>:
    """<Resource> data object."""
    field1: str
    field2: int
    # ...

    def to_api_payload(self) -> dict[str, Any]:
        """Convert to API request payload."""
        return {...}


class <Resource>Builder:
    """
    Builder for creating <resource> test data.

    Usage:
        resource = <Resource>Builder().with_field("value").build()
    """

    def __init__(self) -> None:
        self._fake = Faker()
        # Initialize defaults

    def with_field(self, value: str) -> "<Resource>Builder":
        """Set a specific field."""
        return self

    def build(self) -> <Resource>:
        """Build and return the <Resource> object."""
        return <Resource>(...)
```

参考模板：`automation-framework-example/factories/booking_builder.py`

### 7. 生成 Step Definitions

生成 `<test-project>/steps/<feature-name>_steps.py` 文件，实现所有**需新生成**的 Step。

#### 7.1 文件头部

```python
"""
Step definitions for <Feature Name> feature.
"""

from behave import given, when, then

from pages.<page_module> import <PageName>Page
from services.<service_module> import <Resource>Service
from factories.<builder_module> import <Resource>Builder
```

#### 7.2 Given Steps（数据准备）

**实现策略**：通过调用真实 API 创建测试数据，把创建的资源 ID 存入 `context` 供 `after_scenario` 清理。

```python
@given('a booking exists for "{firstname}" "{lastname}"')
def step_booking_exists(context, firstname, lastname):
    """Create a booking via API for test setup."""
    booking_service = BookingService()
    response, validator = booking_service.create_booking(
        firstname=firstname,
        lastname=lastname,
        # ... other params
    )

    assert response.status_code == 200, f"Failed to create booking: {response.text}"

    booking_id = validator.get_field("bookingid")
    context.bookings_to_cleanup.append(booking_id)
    context.created_booking_id = booking_id
```

**关键点**：
- 创建成功后将资源 ID 追加到 `context.<resource>_to_cleanup` 列表
- `environment.py` 的 `after_scenario` 会自动遍历此列表进行清理
- 使用 `assert` 验证创建成功

#### 7.3 When Steps（用户操作）

**实现策略**：调用 POM 类的方法，POM 封装具体的 Playwright 操作和选择器。

```python
@when('I fill in the booking form')
def step_fill_booking_form(context):
    """Fill the booking form with data from table."""
    data = {row["field"]: row["value"] for row in context.table}
    context.booking_page.fill_booking_form(
        firstname=data.get("firstname", "John"),
        lastname=data.get("lastname", "Doe"),
        # ... other params
    )
```

**关键点**：
- 从 `context.page` 创建 POM 实例：`context.<page>_page = <PageName>Page(context.page)`
- 调用 POM 的 action 方法执行操作
- 如果 Step 含 DataTable，从 `context.table` 提取数据

#### 7.4 Then Steps（断言）

**实现策略**：通过 POM 的 getter 方法获取页面状态，用 `assert` 或 `assertpy` 断言。

```python
@then('I should see the booking confirmation')
def step_see_booking_confirmation(context):
    """Verify booking confirmation is displayed."""
    context.booking_page.assert_confirmation_visible()
```

对于 API 测试的 Then Step：

```python
@then('the response status code should be {status_code:d}')
def step_response_status(context, status_code):
    """Verify response status code."""
    context.validator.assert_status_code(status_code)
```

**关键点**：
- UI 断言调用 POM 的 assertion 方法（内部使用 Playwright `expect`）
- API 断言调用 `ResponseValidator` 的方法
- 也可以使用 Python 原生 `assert` 或 `assertpy`

#### 7.5 参数化 Step

对于含参数的 Step（`{param}` 占位符），behave 会自动提取参数：

```python
@when('I create a room "{room_name}" of type "{room_type}"')
def step_create_room(context, room_name, room_type):
    """Create a room via UI."""
    context.admin_page.create_room(
        room_number=room_name,
        room_type=room_type,
    )
```

### 8. 更新 Step 注册表

将所有**新生成**的 Step 追加到 `step-registry.json`：

```python
# 伪代码
for step in new_steps:
    registry["steps"].append({
        "step_text": step.text,
        "step_type": step.type,  # given / when / then
        "file_path": f"steps/{feature_name}_steps.py",
        "function_name": step.function_name,
        "feature_source": feature_file_name,
        "created_date": today
    })
    registry["updated_date"] = today
```

**注册表更新原则**：
- 只追加新 Step，不修改已有 Step
- 可复用的 Step 不重复添加
- 更新 `updated_date` 字段

### 9. 验证生成代码

验证生成的代码：

#### 9.1 语法检查

- 所有 `.py` 文件语法正确（无 SyntaxError）
- 导入语句完整（所有引用的模块都存在）

#### 9.2 一致性检查

- POM 类继承 `BasePage`
- Service 类使用 `APIClient`
- Given Step 将资源 ID 追加到 `context.<resource>_to_cleanup`
- When Step 使用 POM 方法
- Then Step 使用断言

#### 9.3 选择器溯源检查（MUST，UI Step 必查）

- 每个 `SELECTOR_XXX` 常量是否都带有"来源: <component-path>"注释
- 是否存在未标注来源、疑似占位符的选择器（如 `#element-id`、`.submit`等模板默认值）——如有，视为生成未完成，需返回 4.2 重新定位源码
- 标注为"⚠️ 未溯源"或"⚠️ 非唯一"的选择器数量，需在生成摘要中如实汇总，不得省略

#### 9.4 运行验证

**CRITICAL**: 验证必须通过实际执行命令完成，而非仅展示命令。

执行以下验证命令：
```bash
cd <test-project>
python -m py_compile steps/<feature-name>_steps.py
python -m py_compile pages/<page-name>.py
python -m py_compile services/<resource>_service.py
```

如果语法检查通过，尝试运行 feature：
```bash
cd <test-project>
behave features/<feature-file>.feature --dry-run
```

### 10. 呈现生成摘要

向用户展示生成结果：

```markdown
# 代码生成完成

## Feature 信息
- **Feature**: <feature-name>
- **Scenarios**: <count>
- **测试类型**: UI / API

## Step 复用分析
- **可复用 Steps**: <count>
- **新生成 Steps**: <count>

## 生成文件
| 文件 | 类型 | 说明 |
|------|------|------|
| pages/<page>.py | POM | 新增/更新 |
| services/<resource>_service.py | Service | 新增/更新 |
| factories/<resource>_builder.py | Builder | 新增 |
| steps/<feature>_steps.py | Steps | 新增 |
| step-registry.json | 注册表 | 更新 |

## Step 实现策略
- **Given**: <count> 个（API 数据准备 + cleanup 注册）
- **When**: <count> 个（POM 方法调用）
- **Then**: <count> 个（POM/API 断言）

## 选择器溯源情况
- **已溯源选择器**: <count> 个（来自 <component-path>）
- **⚠️ 未溯源/需人工核对**: <count> 个（<原因，如"未找到组件文件" / "结构选择器非唯一">）

## 下一步
1. 运行 `behave features/<feature-file>.feature` 执行测试
2. 如手动修改了 Step Definitions，运行 `/asdm-test-step-sync` 同步注册表
```
若"⚠️ 未溯源/需人工核对"数量为 0，**不再**提示用户人工检查选择器；仅当存在未溯源项时，在摘要中列出对应 Step 和文件位置，明确提示"需人工核对"。

## Execution Guidelines

### When to Use This Action

使用本 action 的场景：
- `.feature` 文件经 `asdm-test-spec-ui-generate`（或 `asdm-test-spec-api-generate`）实例化完成后，需要落地为测试代码
- 测试仓库持续生长过程中，新增 `.feature` 文件时的增量代码生成
- 已有 `.feature` 文件需要重新生成代码（如重构后）

### 三类 Step 实现策略

| Step 类型 | 实现策略 | 关键点 |
|-----------|----------|--------|
| **Given（数据准备）** | 调用真实 API 创建测试数据 | 资源 ID 存入 `context.<resource>_to_cleanup`，供 `after_scenario` 清理 |
| **When（用户操作）** | 调用 POM 类的方法 | POM 封装 Playwright 操作和选择器；从 `context.page` 创建 POM 实例 |
| **Then（断言）** | 通过 POM getter 或 ResponseValidator 断言 | UI 用 Playwright `expect`；API 用 `ResponseValidator` |

### POM 设计原则

1. **选择器集中管理**：定义为类常量 `SELECTOR_XXX`
2. **方法命名清晰**：action 方法用动词（`click_submit`），getter 方法用名词（`get_error_message`）
3. **继承 BasePage**：复用基类的通用方法
4. **单一职责**：每个 POM 只负责一个页面

### 复用检测原则

1. **精确匹配优先**：Step 文本完全一致才标记为可复用
2. **参数化匹配次之**：含参数的 Step 检查是否有参数化版本可匹配
3. **用户确认**：模糊匹配时提示用户确认
4. **不修改已有 Step**：复用时不修改已有代码

### 错误处理

- **.feature 文件不存在**：提示用户提供正确的文件路径
- **Step 注册表不存在**：提示用户先执行 `/asdm-test-automation-scaffold`
- **`sourceProject.path` 未配置（且 .feature 含 UI Step）**：不暂停不跳过，询问用户提供被测前端项目地址；获取后优先查该项目 `.aixcoding/contexts/index.md` 做语义定位（见 4.2 节），并询问是否写入 `.aixcoding/config.json` 供下次复用
- **定位不到对应组件文件**：显式映射、index.md 语义匹配、路由匹配、关键词模糊搜索均失败后，提示用户提供组件路径或补充 `pageComponentMap`；用户明确表示放弃溯源时，才允许退化为占位符选择器并在摘要中标注警告
- **语法错误**：自动修复并重新生成
- **behave dry-run 失败**：检查 Step 匹配，修正 Step 文本或装饰器

## Usage

To use this instruction, the AI model should:
1. 检测响应语言
2. 接收用户的 .feature 文件路径
3. 读取 Step 注册表和 .feature 文件
4. 按需读取 environment.py、base_page.py、已有 POM/Service/Steps
5. 解析 .feature 文件，提取 Scenario 和 Step
6. 查询注册表，生成复用分析报告
7. 如涉及 UI Step：定位并读取被测项目源码组件，按优先级提取真实选择器（不可跳过）
8. 生成 POM 类（选择器均来自源码，标注来源；如需）
9. 生成 API Service 类（如需）
10. 生成测试数据 Builder（如需）
11. 生成 Step Definitions 文件
12. 更新 Step 注册表
13. 验证生成代码（语法检查 + 选择器溯源检查 + behave dry-run）
14. 呈现生成摘要（含选择器溯源情况）

## Output Summary

完成代码生成后，将生成以下产出：
- POM 类文件：`pages/<page-name>.py`（新增或更新）
- API Service 文件：`services/<resource>_service.py`（新增或更新）
- 测试数据 Builder：`factories/<resource>_builder.py`（如需，新增）
- Step Definitions 文件：`steps/<feature-name>_steps.py`（新增）
- 更新的 Step 注册表：`.aixcoding/workspace/test/step-registry.json`
- Step 复用分析报告

所有文件保存在测试项目目录下。

### Downstream Flow

```text
/asdm-test-automation-scaffold                    ← 前置步骤：搭建仓库骨架
        │
        ▼
/asdm-test-code-generate <feature-file>     ← 当前步骤：生成测试代码
        │
        ▼
/asdm-test-step-sync                        ← 后续维护：同步注册表
```
