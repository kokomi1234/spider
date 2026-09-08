# Step Definitions Specification

## Language Guidelines

本规范定义的 Step Definitions 为 Python 代码文件。代码中的标识符使用英文，docstring 和注释使用中文。

---

## Overview

本规范定义了 Step Definitions 文件的结构和格式要求。Step Definitions 文件实现 `.feature` 文件中 Gherkin Step 的 Python 代码，由 `asdm-test-code-generate` 根据 `.feature` 文件和 Step 注册表生成。

**主要用途**:
- 实现 Given Step 的数据准备逻辑（通过 API 创建测试数据 + 注册清理）
- 实现 When Step 的用户操作逻辑（通过 POM 方法调用）
- 实现 Then Step 的断言逻辑（通过 POM getter 或 ResponseValidator）
- 管理测试数据的生命周期（创建 → 使用 → 清理）

---

## Document Structure

使用以下模板结构生成 Step Definitions 文件：

```python
"""
Step definitions for <Feature Name> feature.

<Feature 描述摘要>
"""

from behave import given, when, then

from pages.<page_module> import <PageName>Page
from services.<service_module> import <Resource>Service
from factories.<builder_module> import <Resource>Builder
from core.response_validator import ResponseValidator


# === Given Steps (数据准备) ===


@given("<step-text>")
def step_<function_name>(context, <params>):
    """<步骤描述>。"""
    <service> = <Resource>Service()
    response, validator = <service>.<create_method>(<params>)

    assert response.status_code == <expected_status>, f"<错误信息>: {response.text}"

    <resource>_id = validator.get_field("<id-field>")
    context.<resource>_to_cleanup.append(<resource>_id)
    context.created_<resource>_id = <resource>_id


# === When Steps (用户操作) ===


@when("<step-text>")
def step_<function_name>(context, <params>):
    """<步骤描述>。"""
    context.<page>_page = <PageName>Page(context.page)
    context.<page>_page.<action_method>(<params>)


# === Then Steps (断言) ===


@then("<step-text>")
def step_<function_name>(context, <params>):
    """<步骤描述>。"""
    context.<page>_page.assert_<assertion_method>(<params>)
```

**Key Elements**:
- 文件头：模块 docstring，说明对应的 Feature
- 导入：behave 装饰器、POM 类、Service 类、Builder 类
- Given Steps：数据准备，调用 API 创建资源并注册清理
- When Steps：用户操作，调用 POM action 方法
- Then Steps：断言，调用 POM assertion 方法或 ResponseValidator
- 分组注释：用 `# === Given/When/Then Steps ===` 分隔三类 Step

---

## Section Guidelines

### 文件头和导入

```python
"""
Step definitions for Booking Management feature.

管理预订的创建、查询、更新和删除操作。
"""

from behave import given, when, then

from pages.booking_page import BookingPage
from pages.admin_page import AdminPage
from services.booking_service import BookingService
from factories.booking_builder import BookingBuilder
```

**Guidelines**:
- 模块 docstring 说明对应的 Feature 名称和简要描述
- 导入按字母顺序排列：先标准库/第三方，再项目内模块
- 只导入文件中实际使用的类

### Given Steps（数据准备）

**实现策略**: 通过调用真实 API 创建测试数据，把创建的资源 ID 存入 `context` 供 `after_scenario` 清理。

```python
@given('a booking exists for "{firstname}" "{lastname}"')
def step_booking_exists(context, firstname, lastname):
    """通过 API 创建预订作为测试前置数据。"""
    from datetime import date, timedelta

    booking_service = BookingService()
    check_in = date.today() + timedelta(days=7)
    check_out = check_in + timedelta(days=2)

    response, validator = booking_service.create_booking(
        firstname=firstname,
        lastname=lastname,
        check_in=check_in,
        check_out=check_out,
        total_price=150,
        deposit_paid=True,
    )

    assert response.status_code == 200, f"创建预订失败: {response.text}"

    booking_id = validator.get_field("bookingid")
    context.bookings_to_cleanup.append(booking_id)
    context.created_booking_id = booking_id
```

**Guidelines**:
- 使用 `@given` 装饰器（小写）
- 调用 Service 类的 create 方法通过 API 创建数据
- 创建成功后将资源 ID 追加到 `context.<resource>_to_cleanup` 列表
- 同时存入 `context.created_<resource>_id` 供后续 Step 引用
- 使用 `assert` 验证创建成功
- 函数名以 `step_` 开头，使用 snake_case

### When Steps（用户操作）

**实现策略**: 调用 POM 类的方法，POM 封装具体的 Playwright 操作和选择器。

```python
@when('I fill in the booking form')
def step_fill_booking_form(context):
    """填写预订表单。"""
    data = {row["field"]: row["value"] for row in context.table}
    context.booking_page = BookingPage(context.page)
    context.booking_page.fill_booking_form(
        firstname=data.get("firstname", "John"),
        lastname=data.get("lastname", "Doe"),
        email=data.get("email", "john@example.com"),
        phone=data.get("phone", "01234567890"),
    )
```

**Guidelines**:
- 使用 `@when` 装饰器
- 从 `context.page` 创建 POM 实例并存入 `context.<page>_page`
- 调用 POM 的 action 方法
- 如果 Step 含 DataTable，从 `context.table` 提取数据
- 对于 API When Step，调用 Service 方法并将结果存入 `context.response` 和 `context.validator`

### Then Steps（断言）

**实现策略**: 通过 POM 的 getter/assertion 方法或 ResponseValidator 断言。

**UI 断言示例**:

```python
@then('I should see the booking confirmation')
def step_see_booking_confirmation(context):
    """验证预订确认信息显示。"""
    context.booking_page.assert_confirmation_visible()

@then('I should see "{text}" on the page')
def step_see_text(context, text):
    """验证页面包含指定文本。"""
    assert context.page.get_by_text(text).is_visible(), f"页面未找到文本: {text}"
```

**API 断言示例**:

```python
@then('the response status code should be {status_code:d}')
def step_response_status(context, status_code):
    """验证 API 响应状态码。"""
    context.validator.assert_status_code(status_code)

@then('the response should contain field "{field}" with value "{value}"')
def step_response_field(context, field, value):
    """验证 API 响应包含指定字段和值。"""
    context.validator.assert_json_field(field, value)
```

**Guidelines**:
- 使用 `@then` 装饰器
- UI 断言调用 POM 的 `assert_` 方法或使用 `assert` + Playwright
- API 断言调用 `ResponseValidator` 的方法或使用 `assert`
- 可使用 `assertpy` 的链式断言（`assert_that(value).is_equal_to(expected)`）

### 参数化 Step

behave 自动从 Step 文本中提取参数：

```python
# 字符串参数
@when('I create a room "{room_name}" of type "{room_type}"')
def step_create_room(context, room_name, room_type):
    """通过 UI 创建房间。"""
    context.admin_page.create_room(room_number=room_name, room_type=room_type)

# 数字参数
@then('I should see at least {count:d} room(s)')
def step_see_rooms(context, count):
    """验证房间数量。"""
    actual = context.home_page.get_room_count()
    assert actual >= count, f"预期至少 {count} 个房间，实际 {actual} 个"
```

**Guidelines**:
- `{param}` → 字符串参数
- `{param:d}` → 整数参数
- `{param:f}` → 浮点数参数
- 参数名在函数签名中与 Step 文本一致

### DataTable Step

```python
@when('I fill in the guest details')
def step_fill_guest_details(context):
    """从表格填充客人信息。"""
    data = {row["field"]: row["value"] for row in context.table}
    context.booking_page.fill_guest_details(
        firstname=data.get("firstname"),
        lastname=data.get("lastname"),
        email=data.get("email"),
        phone=data.get("phone"),
    )
```

**Guidelines**:
- 从 `context.table` 读取 DataTable
- 使用字典推导式 `{row["field"]: row["value"] for row in context.table}`
- 为缺失字段提供默认值

### DocString Step（API 层 JSON 请求/响应体）

**背景**：`asdm-test-spec-api-generate` 产出的 `.api.feature` 文件用 DocString（`"""JSON"""`）传递请求体和响应体，而非 DataTable 或内嵌字符串。对应的 Step Definition 需要从 `context.text` 读取 DocString 内容并解析为 JSON。

```python
import json


@when('发送 POST 请求 "{path}"，请求体如下')
def step_send_post_with_body(context, path):
    """发送带 JSON 请求体的 POST 请求。"""
    payload = json.loads(context.text)
    context.response = context.api_client.post(path, json=payload)
    context.validator = ResponseValidator(context.response)


@then('返回如下团队空间列表')
def step_assert_response_body(context):
    """断言响应体与期望的 JSON 完全一致（或逐字段比对）。"""
    expected = json.loads(context.text)
    context.validator.assert_json_equals(expected)
```

**Guidelines**:
- 使用 `context.text` 读取 DocString 原始文本，`json.loads(context.text)` 解析为 Python 对象
- Given/When 步骤：解析后的 JSON 作为请求体传给 Service/APIClient
- Then 步骤：解析后的 JSON 作为期望值，通过 `ResponseValidator` 逐字段或整体比对实际响应体
- 若 DocString JSON 解析失败（`json.JSONDecodeError`），应在 Step 中抛出清晰的断言错误，而非静默失败
- DocString 与 DataTable 可在同一 Scenario 中共存（如 Given 用 DataTable 描述前置资源列表，When 用 DocString 描述请求体）

---

## Usage Guidelines

当生成 Step Definitions 时：

1. **文件命名**: `<feature-name>_steps.py`（如 `booking_management_steps.py`）
2. **检查复用**: 先查询 Step 注册表，可复用的 Step 不重复生成
3. **分组组织**: 按 Given → When → Then 顺序组织，用注释分隔
4. **导入管理**: 只导入文件中实际使用的类
5. **函数命名**: `step_<动作描述>`，snake_case，描述性强

**Important**:
- 一个 `.feature` 文件对应一个 `_steps.py` 文件（可拆分到多个文件如 `ui_steps.py`、`api_steps.py`）
- Given Step 必须将创建的资源 ID 追加到 `context.<resource>_to_cleanup`
- When Step 创建 POM 实例时存入 `context.<page>_page`
- 所有 Step 函数包含 docstring

---

## Output Format

**Format**: Python (.py)
**Location**: `<test-project>/steps/<feature-name>_steps.py`
**Naming**: snake_case，以 `_steps.py` 结尾，如 `booking_steps.py`、`ui_steps.py`、`api_steps.py`

**Format Details**:
- UTF-8 编码
- 遵循 PEP 8 规范
- 行宽不超过 100 字符
- 使用类型注解（context 参数标注为 `context`）

---

## Best Practices

1. **清理注册**: Given Step 创建资源后必须追加到 `context.<resource>_to_cleanup`
2. **POM 委托**: When/Then Step 委托给 POM 方法，不直接操作 Playwright
3. **断言明确**: Then Step 使用明确的断言信息，失败时提供上下文
4. **Step 粒度**: 一个 Step 函数对应一个 Gherkin Step，不合并多个 Step
5. **复用优先**: 能复用已有 Step 就不重新生成

### Common Pitfalls to Avoid

- **忘记注册清理**: Given Step 创建资源后未追加到 cleanup 列表 → 测试数据残留
- **直接操作 Playwright**: When Step 中直接调用 `context.page.click()` → 应委托给 POM
- **Step 文本不匹配**: 装饰器文本与 .feature 中不一致 → behave 报 undefined step
- **缺少 assert**: Then Step 无断言 → 测试无实际验证

---

## Related Documents

This spec template works with:
- **pom-spec.md**: POM 类被 When/Then Step 调用
- **api-service-spec.md**: API Service 被 Given Step 调用
- **test-data-builder-spec.md**: Builder 被 Given Step 用于构造测试数据
- **step-registry-spec.md**: 生成的 Step 注册到注册表

This spec is used by:
- **Action: asdm-test-code-generate**: 生成 Step Definitions 文件
- **Action: asdm-test-step-sync**: 扫描 Step Definitions 同步注册表

---

## Checklist

Before finalizing Step Definitions, check:

- [ ] 文件包含模块 docstring
- [ ] 导入语句完整（所有引用的模块都存在）
- [ ] Given Step 将资源 ID 追加到 `context.<resource>_to_cleanup`
- [ ] When Step 通过 POM 方法执行操作
- [ ] Then Step 包含明确的断言
- [ ] 所有 Step 函数包含 docstring
- [ ] Step 按 Given → When → Then 分组，用注释分隔
- [ ] 涉及 API 层 DocString（JSON 请求/响应体）的 Step 使用 `context.text` + `json.loads` 解析，未误用 `context.table`
- [ ] 装饰器文本与 .feature 文件中的 Step 一致
- [ ] 参数名在函数签名中与 Step 文本一致
- [ ] 函数名以 `step_` 开头，使用 snake_case
- [ ] 遵循 PEP 8 规范
