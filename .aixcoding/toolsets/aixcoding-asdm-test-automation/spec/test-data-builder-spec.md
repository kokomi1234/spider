# Test Data Builder Specification

## Language Guidelines

本规范定义的测试数据 Builder 为 Python 代码文件。代码中的标识符使用英文，docstring 和注释使用中文。

---

## Overview

本规范定义了测试数据 Builder 类的结构和格式要求。Builder 类使用建造者模式构造复杂测试数据，由 `asdm-test-code-generate` 根据 `.feature` 文件中 Given Step 的复杂数据准备需求生成。

**主要用途**:
- 构造复杂嵌套的测试数据对象（如含子对象的预订数据）
- 提供链式 API 灵活配置测试数据
- 生成随机测试数据（通过 Faker）
- 将数据对象转换为 API 请求 payload

---

## Document Structure

使用以下模板结构生成测试数据 Builder 文件：

```python
"""
<Resource> data builder for test scenarios.

<Resource> 测试数据构造器，使用 Builder 模式。
"""

import random
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Optional

from faker import Faker


@dataclass
class <Resource>:
    """
    <Resource> data object.

    <Resource> 数据对象，由 Builder 构建。
    """

    field1: str
    field2: int
    field3: Optional[str] = None

    @property
    def computed_field(self) -> int:
        """计算属性。"""
        return <computation>

    def to_api_payload(self) -> dict[str, Any]:
        """转换为 API 请求 payload 格式。"""
        payload: dict[str, Any] = {
            "field1": self.field1,
            "field2": self.field2,
        }
        if self.field3:
            payload["field3"] = self.field3
        return payload


class <Resource>Builder:
    """
    Builder for creating <resource> test data.

    使用示例:
        # 基本数据（使用默认值）
        resource = <Resource>Builder().build()

        # 自定义数据
        resource = (
            <Resource>Builder()
            .with_field1("value")
            .with_field2(100)
            .build()
        )

        # 多个数据对象
        resources = <Resource>Builder().build_many(3)
    """

    # 预设选项
    OPTIONS = ["option1", "option2", "option3", None]

    def __init__(self) -> None:
        """初始化 Builder，设置合理的默认值。"""
        self._fake = Faker()
        self._field1: Optional[str] = None
        self._field2: Optional[int] = None
        self._field3: Optional[str] = None

    # === Configuration Methods ===

    def with_field1(self, value: str) -> "<Resource>Builder":
        """设置 field1。"""
        self._field1 = value
        return self

    def with_field2(self, value: int) -> "<Resource>Builder":
        """设置 field2。"""
        self._field2 = value
        return self

    def with_random_field3(self) -> "<Resource>Builder":
        """随机设置 field3。"""
        self._field3 = random.choice(self.OPTIONS)
        return self

    # === Build Methods ===

    def build(self) -> <Resource>:
        """构建并返回 <Resource> 对象。"""
        field1 = self._field1 or self._fake.word()
        field2 = self._field2 or random.randint(1, 100)

        return <Resource>(
            field1=field1,
            field2=field2,
            field3=self._field3,
        )

    def build_many(self, count: int) -> list[<Resource>]:
        """构建多个 <Resource> 对象，数据各不相同。"""
        resources = []
        for _ in range(count):
            resources.append(
                <Resource>Builder()
                .with_random_field3()
                .build()
            )
        return resources

    def reset(self) -> "<Resource>Builder":
        """重置 Builder 到初始状态。"""
        self._field1 = None
        self._field2 = None
        self._field3 = None
        return self
```

**Key Elements**:
- 数据对象 `@dataclass`：不可变的数据容器
- `to_api_payload()` 方法：转换为 API 请求格式
- Builder 类：链式配置方法 + build 方法
- `with_<field>` 方法：设置特定字段
- `with_random_<field>` 方法：随机生成字段值
- `build()` 方法：构建单个数据对象
- `build_many(count)` 方法：构建多个数据对象
- `reset()` 方法：重置 Builder 状态

---

## Section Guidelines

### 数据对象（@dataclass）

```python
@dataclass
class Booking:
    """Booking data object."""

    guest: Guest
    check_in: date
    check_out: date
    total_price: int
    deposit_paid: bool
    additional_needs: Optional[str] = None

    @property
    def nights(self) -> int:
        """计算住宿天数。"""
        return (self.check_out - self.check_in).days

    def to_api_payload(self) -> dict[str, Any]:
        """转换为 API 请求 payload 格式。"""
        payload: dict[str, Any] = {
            "firstname": self.guest.firstname,
            "lastname": self.guest.lastname,
            "totalprice": self.total_price,
            "depositpaid": self.deposit_paid,
            "bookingdates": {
                "checkin": self.check_in.isoformat(),
                "checkout": self.check_out.isoformat(),
            },
        }
        if self.additional_needs:
            payload["additionalneeds"] = self.additional_needs
        return payload
```

**Guidelines**:
- 使用 `@dataclass` 装饰器
- 必填字段在前，可选字段在后（带默认值）
- 字段类型使用类型注解
- 提供计算属性（`@property`）用于派生值
- `to_api_payload()` 方法将字段名映射为 API 格式（如 `total_price` → `totalprice`）

### Builder 初始化

```python
class BookingBuilder:
    """Builder for creating Booking test data."""

    ADDITIONAL_NEEDS_OPTIONS = [
        "Breakfast", "Late checkout", "Airport pickup", None,
    ]

    def __init__(self) -> None:
        self._fake = Faker()
        self._guest: Optional[Guest] = None
        self._check_in: Optional[date] = None
        self._check_out: Optional[date] = None
        self._days_from_now: int = 7
        self._nights: int = 2
        self._total_price: Optional[int] = None
        self._deposit_paid: bool = False
        self._additional_needs: Optional[str] = None
```

**Guidelines**:
- 类名为 `<Resource>Builder`
- `__init__` 中初始化 Faker 和所有字段的默认值
- 使用 `Optional` 类型，默认 `None` 表示"未设置，build 时随机生成"
- 预设选项定义为类常量（如 `ADDITIONAL_NEEDS_OPTIONS`）

### Configuration 方法

```python
def with_field(self, value: str) -> "BookingBuilder":
    """设置特定字段。"""
    self._field = value
    return self

def with_random_field(self) -> "BookingBuilder":
    """随机设置字段。"""
    self._field = random.choice(self.OPTIONS)
    return self

def for_weekend(self) -> "BookingBuilder":
    """配置为周末住宿（周五到周日）。"""
    today = date.today()
    days_until_friday = (4 - today.weekday()) % 7
    if days_until_friday == 0:
        days_until_friday = 7
    self._check_in = today + timedelta(days=days_until_friday)
    self._check_out = self._check_in + timedelta(days=2)
    return self
```

**Guidelines**:
- 方法名使用 `with_` 前缀
- 返回 `self` 支持链式调用
- `with_<field>` 设置特定值
- `with_random_<field>` 随机生成值
- 语义化方法（如 `for_weekend`、`for_next_week`）封装常用配置

### Build 方法

```python
def build(self) -> Booking:
    """构建并返回 Booking 对象。"""
    guest = self._guest or GuestBuilder().build()

    if self._check_in:
        check_in = self._check_in
    else:
        check_in = date.today() + timedelta(days=self._days_from_now)

    if self._check_out:
        check_out = self._check_out
    else:
        check_out = check_in + timedelta(days=self._nights)

    if self._total_price is not None:
        total_price = self._total_price
    else:
        nights = (check_out - check_in).days
        total_price = nights * random.randint(80, 150)

    return Booking(
        guest=guest,
        check_in=check_in,
        check_out=check_out,
        total_price=total_price,
        deposit_paid=self._deposit_paid,
        additional_needs=self._additional_needs,
    )

def build_many(self, count: int) -> list[Booking]:
    """构建多个 Booking 对象，数据各不相同。"""
    bookings = []
    for i in range(count):
        booking = (
            BookingBuilder()
            .starting_in_days(self._days_from_now + (i * 3))
            .for_nights(self._nights)
            .with_random_extras()
            .build()
        )
        bookings.append(booking)
    return bookings
```

**Guidelines**:
- `build()` 方法处理所有未设置字段的默认值生成
- 优先使用用户显式设置的值，否则使用随机/默认值
- `build_many(count)` 通过错开参数（如日期偏移）确保数据不重复
- `reset()` 方法重置所有字段到初始状态

---

## Usage Guidelines

当生成测试数据 Builder 时：

1. **识别数据需求**: 从 Given Step 分析需要的测试数据结构
2. **检查已有**: 检查 `factories/` 目录是否已有同名 Builder
3. **定义数据对象**: 先定义 `@dataclass` 数据对象
4. **实现 Builder**: 实现 Builder 类的配置方法和 build 方法
5. **与 Service 集成**: 确保对应 Service 有 `create_from_builder` 方法

**Important**:
- 复杂数据（含嵌套对象、多字段）才需要 Builder；简单数据直接在 Step 中构造
- 一个资源对应一个 Builder 文件
- 文件名使用 snake_case（如 `booking_builder.py`），类名使用 PascalCase
- 参考 `automation-framework-example/factories/` 的现有实现

---

## Output Format

**Format**: Python (.py)
**Location**: `<test-project>/factories/<resource>_builder.py`
**Naming**: snake_case，以 `_builder.py` 结尾，如 `booking_builder.py`、`guest_builder.py`、`room_builder.py`

**Format Details**:
- UTF-8 编码
- 遵循 PEP 8 规范
- 行宽不超过 100 字符
- 使用类型注解

---

## Best Practices

1. **链式调用**: 所有配置方法返回 `self`
2. **合理默认值**: `build()` 时为未设置字段生成合理默认值
3. **随机性**: 使用 Faker 生成随机数据，避免测试数据固定
4. **语义化方法**: 提供语义化的配置方法（如 `for_weekend`），不仅仅是 `with_field`
5. **不可变数据对象**: 数据对象使用 `@dataclass`，构建后不修改

### Common Pitfalls to Avoid

- **配置方法不返回 self**: 忘记 `return self` → 链式调用中断
- **build_many 数据重复**: 多个对象使用相同参数 → 错开参数确保唯一
- **缺少 to_api_payload**: 数据对象无法直接用于 API 调用 → 必须实现此方法
- **字段映射错误**: `to_api_payload` 中字段名与 API 不一致 → 仔细核对 API 文档

---

## Related Documents

This spec template works with:
- **api-service-spec.md**: Service 的 `create_from_builder` 方法使用 Builder 构建的数据
- **step-definitions-spec.md**: Given Step 可使用 Builder 构造测试数据

This spec is used by:
- **Action: asdm-test-code-generate**: 生成测试数据 Builder 类

---

## Checklist

Before finalizing test data Builder, check:

- [ ] 定义了 `@dataclass` 数据对象
- [ ] 数据对象包含 `to_api_payload()` 方法
- [ ] Builder 类名为 `<Resource>Builder`
- [ ] 所有配置方法返回 `self`
- [ ] `build()` 方法处理所有未设置字段的默认值
- [ ] 提供了 `build_many(count)` 方法
- [ ] 提供了 `reset()` 方法
- [ ] 使用 Faker 生成随机数据
- [ ] 方法包含类型注解和 docstring
- [ ] 文件名为 snake_case，以 `_builder.py` 结尾
- [ ] 遵循 PEP 8 规范
