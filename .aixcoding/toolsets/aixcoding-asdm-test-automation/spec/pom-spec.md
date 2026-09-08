# Page Object Model Specification

## Language Guidelines

本规范定义的 POM 类为 Python 代码文件。代码中的标识符（类名、方法名、变量名）使用英文，文档字符串（docstring）和注释使用中文。

---

## Overview

本规范定义了 Page Object Model（POM）类的结构和格式要求。POM 类封装页面的 Playwright 操作和选择器，由 `asdm-test-code-generate` 根据 `.feature` 文件中的 When 和 Then Step 生成。

**主要用途**:
- 封装页面 UI 元素的选择器
- 提供 When Step 调用的 action 方法（用户操作）
- 提供 Then Step 调用的 getter 和 assertion 方法（状态验证）
- 隔离测试逻辑与页面实现细节

---

## Document Structure

使用以下模板结构生成 POM 类文件：

```python
"""
<Page Name> page object.
"""

from typing import Optional

from playwright.sync_api import Page, Locator, expect

from pages.base_page import BasePage


class <PageName>Page(BasePage):
    """
    Page object for the <Page Name> page.

    封装 <Page Name> 页面的 UI 操作和元素选择器。
    """

    # === Selectors ===
    SELECTOR_<ELEMENT_NAME> = "<css-selector>"
    SELECTOR_<BUTTON_NAME> = "<css-selector>"
    SELECTOR_<INPUT_NAME> = "<css-selector>"

    # === Properties ===

    @property
    def url_path(self) -> str:
        """URL path for this page (relative to base URL)."""
        return "<page-path>"

    # === Action Methods (for When steps) ===

    def <action_method>(self, <params>) -> "<PageName>Page":
        """<动作描述>。"""
        # Playwright 操作
        self.fill(self.SELECTOR_<INPUT_NAME>, <value>)
        self.click(self.SELECTOR_<BUTTON_NAME>)
        return self

    # === Getter Methods (for Then steps) ===

    def <getter_method>(self) -> str:
        """获取<某值>。"""
        return self.get_text(self.SELECTOR_<ELEMENT_NAME>)

    # === Assertion Methods (for Then steps) ===

    def <assert_method>(self) -> None:
        """断言<某状态>。"""
        self.assert_element_visible(self.SELECTOR_<ELEMENT_NAME>)
```

**Key Elements**:
- 类定义：继承 `BasePage`，类名为 `<PageName>Page`
- 选择器常量：以 `SELECTOR_` 为前缀的类常量
- `url_path` 属性：抽象方法实现，返回页面 URL 路径
- Action 方法：When Step 调用，执行页面操作
- Getter 方法：Then Step 调用，获取页面状态
- Assertion 方法：Then Step 调用，断言页面状态

---

## Section Guidelines

### 选择器定义

选择器以类常量形式定义在类顶部：

```python
# === Selectors ===
SELECTOR_USERNAME_INPUT = "#username"
SELECTOR_PASSWORD_INPUT = "#password"
SELECTOR_LOGIN_BUTTON = "button[type='submit']"
SELECTOR_ERROR_MESSAGE = ".alert-danger"
SELECTOR_NAVBAR = "nav.navbar"
```

**Guidelines**:
- 命名：`SELECTOR_<元素描述>`，全大写，下划线分隔
- 使用 CSS 选择器优先（`#id`、`.class`、`tag`）
- 复杂选择器可用 Playwright 的 text 选择器（如 `"text=Login"`）
- 按功能分组，用注释分隔（如 `# === Form Selectors ===`）

### url_path 属性

每个 POM 类必须实现 `url_path` 抽象属性：

```python
@property
def url_path(self) -> str:
    """URL path for this page (relative to base URL)."""
    return "admin/login"
```

**Guidelines**:
- 返回相对于 `base_url` 的路径（不含开头的 `/`）
- 如果页面无固定 URL（如弹窗），返回空字符串 `""`
- 路径不含查询参数

### Action 方法（When Steps）

Action 方法对应 When Step 的用户操作：

```python
def fill_login_form(self, username: str, password: str) -> "LoginPage":
    """填写登录表单并提交。"""
    self.fill(self.SELECTOR_USERNAME_INPUT, username)
    self.fill(self.SELECTOR_PASSWORD_INPUT, password)
    self.click(self.SELECTOR_LOGIN_BUTTON)
    return self
```

**Guidelines**:
- 方法名使用动词开头（`click_`、`fill_`、`select_`、`navigate_to_`）
- 返回 `self` 以支持链式调用
- 参数名清晰描述（`username`、`password`，不使用 `param1`、`param2`）
- 复杂操作可使用 `retry_click`、`retry_fill` 处理不稳定元素
- 包含 docstring 说明方法用途

### Getter 方法（Then Steps）

Getter 方法对应 Then Step 的状态获取：

```python
def get_error_message(self) -> str:
    """获取错误提示文本。"""
    return self.get_text(self.SELECTOR_ERROR_MESSAGE)

def get_room_count(self) -> int:
    """获取房间列表数量。"""
    return self.get_element_count(self.SELECTOR_ROOM_ITEM)
```

**Guidelines**:
- 方法名使用 `get_` 前缀
- 返回值类型明确（`str`、`int`、`bool`）
- 不执行断言，只返回数据
- 包含 docstring 说明返回值

### Assertion 方法（Then Steps）

Assertion 方法对应 Then Step 的状态断言：

```python
def assert_login_success(self) -> None:
    """断言登录成功（跳转到管理面板）。"""
    self.assert_url_contains("admin")
    self.assert_element_visible(self.SELECTOR_NAVBAR)

def assert_error_displayed(self, expected_message: str) -> None:
    """断言错误提示显示且文本匹配。"""
    self.assert_element_visible(self.SELECTOR_ERROR_MESSAGE)
    self.assert_element_contains_text(self.SELECTOR_ERROR_MESSAGE, expected_message)
```

**Guidelines**:
- 方法名使用 `assert_` 前缀
- 返回 `None`（执行断言，不返回值）
- 使用 `BasePage` 的 assert 方法或 Playwright `expect`
- 可包含参数用于预期值对比

---

## Usage Guidelines

当生成 POM 类时：

1. **识别页面**: 从 Step 文本推断页面名称（如 "home page" → `HomePage`）
2. **检查已有**: 检查 `pages/` 目录是否已有同名 POM 类，如有则更新而非重建
3. **继承 BasePage**: 所有 POM 类必须继承 `BasePage`
4. **选择器优先**: 选择器定义为类常量，不在方法中硬编码
5. **方法分类**: 按选择器 → 属性 → action → getter → assertion 顺序组织

**Important**:
- 一个页面对应一个 POM 类文件
- 文件名使用 snake_case（如 `home_page.py`），类名使用 PascalCase（如 `HomePage`）
- 参考 `automation-framework-example/pages/` 的现有实现

---

## Output Format

**Format**: Python (.py)
**Location**: `<test-project>/pages/<page-name>.py`
**Naming**: snake_case，如 `home_page.py`、`admin_page.py`、`booking_page.py`

**Format Details**:
- UTF-8 编码
- 遵循 PEP 8 规范
- 行宽不超过 100 字符
- 使用类型注解

**Example**:

```python
"""Admin page object."""

from playwright.sync_api import expect

from pages.base_page import BasePage


class AdminPage(BasePage):
    """Page object for the admin panel."""

    SELECTOR_USERNAME = "#username"
    SELECTOR_PASSWORD = "#password"
    SELECTOR_LOGIN_BUTTON = "button.doLogin"
    SELECTOR_LOGOUT_BUTTON = ".nav-link[href='/admin/logout']"

    @property
    def url_path(self) -> str:
        return "admin"

    def login(self, username: str, password: str) -> "AdminPage":
        """使用指定凭据登录。"""
        self.fill(self.SELECTOR_USERNAME, username)
        self.fill(self.SELECTOR_PASSWORD, password)
        self.click(self.SELECTOR_LOGIN_BUTTON)
        return self

    def login_as_admin(self) -> "AdminPage":
        """使用默认管理员凭据登录。"""
        return self.login(self.config.admin_username, self.config.admin_password)

    def logout(self) -> None:
        """退出登录。"""
        self.click(self.SELECTOR_LOGOUT_BUTTON)

    def assert_logged_in(self) -> None:
        """断言已登录。"""
        self.assert_element_visible(self.SELECTOR_LOGOUT_BUTTON)

    def assert_logged_out(self) -> None:
        """断言已退出。"""
        self.assert_element_visible(self.SELECTOR_LOGIN_BUTTON)
```

---

## Best Practices

1. **选择器集中管理**: 所有选择器定义为类常量，便于维护
2. **方法单一职责**: action 方法只做操作，getter 方法只取数据，assertion 方法只断言
3. **链式调用**: action 方法返回 `self`，支持 `page.navigate().fill_form().submit()`
4. **复用 BasePage**: 优先使用 BasePage 的通用方法，避免重复代码
5. **重试机制**: 对不稳定元素使用 `retry_click`、`retry_fill`

### Common Pitfalls to Avoid

- **选择器硬编码**: 在方法中直接写选择器字符串 → 定义为类常量
- **方法职责混乱**: 在 getter 方法中断言 → getter 只返回数据，断言放 assertion 方法
- **缺少类型注解**: 方法参数和返回值无类型 → 始终使用类型注解
- **忘记返回 self**: action 方法不返回 `self` → 无法链式调用

---

## Related Documents

This spec template works with:
- **step-definitions-spec.md**: Step Definitions 调用 POM 方法
- **api-service-spec.md**: API Service 类（与 POM 对应的 API 层）

This spec is used by:
- **Action: asdm-test-automation-scaffold**: 生成 `pages/base_page.py` 基类
- **Action: asdm-test-code-generate**: 生成具体 POM 类

---

## Checklist

Before finalizing POM class, check:

- [ ] 类继承 `BasePage`
- [ ] 实现了 `url_path` 属性
- [ ] 选择器定义为类常量（`SELECTOR_` 前缀）
- [ ] Action 方法返回 `self`
- [ ] 所有方法包含类型注解
- [ ] 所有方法包含 docstring
- [ ] 方法按 选择器 → 属性 → action → getter → assertion 顺序组织
- [ ] 文件名为 snake_case，类名为 PascalCase
- [ ] 遵循 PEP 8 规范
