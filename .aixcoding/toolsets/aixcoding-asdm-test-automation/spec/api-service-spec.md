# API Service Specification

## Language Guidelines

本规范定义的 API Service 类为 Python 代码文件。代码中的标识符使用英文，docstring 和注释使用中文。

---

## Overview

本规范定义了 API Service 类的结构和格式要求。API Service 类封装被测系统 API 的 CRUD 操作，由 `asdm-test-code-generate` 根据 `.feature` 文件中 Given Step 的数据准备需求生成。

**主要用途**:
- 封装 API 端点的 CRUD 操作（创建、查询、更新、删除）
- 提供 Given Step 调用的数据准备方法
- 提供 `after_scenario` hooks 调用的清理方法（delete）
- 与 `APIClient` 集成，统一管理认证和请求

---

## Document Structure

使用以下模板结构生成 API Service 类文件：

```python
"""
<Resource> service for API operations.

<Resource> 相关的 API 操作封装。
"""

from datetime import date
from typing import Any, Optional

import requests

from core.api_client import APIClient
from core.logger import get_logger
from core.response_validator import ResponseValidator


class <Resource>Service:
    """
    Service for <resource>-related API operations.

    提供以下功能:
    - 创建 <resource>
    - 查询 <resource>
    - 更新 <resource>
    - 删除 <resource>
    """

    # API Endpoints
    ENDPOINT = "/<resource>"
    ENDPOINT_DETAIL = "/<resource>/{resource_id}"

    def __init__(self) -> None:
        """Initialize the <resource> service."""
        self.client = APIClient()
        self.logger = get_logger(__name__)

    # === Create ===

    def create_<resource>(self, **kwargs) -> tuple[requests.Response, ResponseValidator]:
        """创建一个新的 <resource>。"""
        self.logger.info(f"Creating <resource>: {kwargs}")
        payload = self._build_payload(**kwargs)
        response = self.client.post(self.ENDPOINT, json=payload)
        return response, ResponseValidator(response)

    # === Read ===

    def get_all_<resources>(self, **filters) -> tuple[requests.Response, ResponseValidator]:
        """获取所有 <resource> 列表。"""
        self.logger.info("Getting all <resources>")
        response = self.client.get(self.ENDPOINT, params=filters)
        return response, ResponseValidator(response)

    def get_<resource>(self, resource_id: int) -> tuple[requests.Response, ResponseValidator]:
        """获取指定 <resource> 的详情。"""
        self.logger.info(f"Getting <resource>: {resource_id}")
        response = self.client.get(f"{self.ENDPOINT}/{resource_id}")
        return response, ResponseValidator(response)

    # === Update ===

    def update_<resource>(self, resource_id: int, **kwargs) -> tuple[requests.Response, ResponseValidator]:
        """更新 <resource>（全量更新）。"""
        self.logger.info(f"Updating <resource>: {resource_id}")
        payload = self._build_payload(**kwargs)
        response = self.client.put(f"{self.ENDPOINT}/{resource_id}", json=payload)
        return response, ResponseValidator(response)

    def partial_update_<resource>(self, resource_id: int, **kwargs) -> tuple[requests.Response, ResponseValidator]:
        """部分更新 <resource>（PATCH）。"""
        self.logger.info(f"Partially updating <resource>: {resource_id}")
        payload = self._build_payload(**kwargs)
        response = self.client.patch(f"{self.ENDPOINT}/{resource_id}", json=payload)
        return response, ResponseValidator(response)

    # === Delete ===

    def delete_<resource>(self, resource_id: int) -> tuple[requests.Response, ResponseValidator]:
        """删除指定 <resource>。"""
        self.logger.info(f"Deleting <resource>: {resource_id}")
        response = self.client.delete(f"{self.ENDPOINT}/{resource_id}")
        return response, ResponseValidator(response)

    # === Helpers ===

    def _build_payload(self, **kwargs) -> dict[str, Any]:
        """构建 API 请求 payload。"""
        payload: dict[str, Any] = {}
        for key, value in kwargs.items():
            if value is not None:
                payload[key] = value
        return payload

    def <resource>_exists(self, resource_id: int) -> bool:
        """检查 <resource> 是否存在。"""
        response, _ = self.get_<resource>(resource_id)
        return response.status_code == 200

    def create_from_builder(self, <resource>: "<Resource>") -> tuple[requests.Response, ResponseValidator]:
        """从 Builder 对象创建 <resource>。"""
        return self.create_<resource>(**<resource>.to_api_payload())
```

**Key Elements**:
- 类定义：封装特定资源的 API 操作
- API 端点常量：`ENDPOINT` 定义资源的基础路径
- CRUD 方法：`create_`、`get_all_`、`get_`、`update_`、`partial_update_`、`delete_`
- 返回值：统一返回 `tuple[requests.Response, ResponseValidator]`
- Helper 方法：`_build_payload`、`<resource>_exists`、`create_from_builder`

---

## Section Guidelines

### 类定义和初始化

```python
class BookingService:
    """Service for booking-related API operations."""

    ENDPOINT = "/booking"

    def __init__(self) -> None:
        self.client = APIClient()
        self.logger = get_logger(__name__)
```

**Guidelines**:
- 类名为 `<Resource>Service`，PascalCase
- `ENDPOINT` 定义资源基础路径（如 `/booking`、`/room`）
- `__init__` 中初始化 `APIClient` 单例和 logger
- 不在 `__init__` 中创建状态，Service 是无状态的

### Create 方法

```python
def create_booking(
    self,
    firstname: str,
    lastname: str,
    check_in: date,
    check_out: date,
    total_price: int = 100,
    deposit_paid: bool = False,
    additional_needs: Optional[str] = None,
) -> tuple[requests.Response, ResponseValidator]:
    """创建一个新的预订。"""
    self.logger.info(f"Creating booking for {firstname} {lastname}")

    booking_data: dict[str, Any] = {
        "firstname": firstname,
        "lastname": lastname,
        "totalprice": total_price,
        "depositpaid": deposit_paid,
        "bookingdates": {
            "checkin": check_in.isoformat(),
            "checkout": check_out.isoformat(),
        },
    }

    if additional_needs:
        booking_data["additionalneeds"] = additional_needs

    response = self.client.post(self.ENDPOINT, json=booking_data)
    return response, ResponseValidator(response)
```

**Guidelines**:
- 方法名 `create_<resource>`
- 参数明确列出所有字段，带类型注解
- 可选参数提供默认值
- 构建 payload 字典，字段名与 API 一致
- 记录日志
- 返回 `tuple[Response, ResponseValidator]`

### Read 方法

```python
def get_all_bookings(
    self,
    firstname: Optional[str] = None,
    lastname: Optional[str] = None,
) -> tuple[requests.Response, ResponseValidator]:
    """获取所有预订，可按姓名筛选。"""
    params = {}
    if firstname:
        params["firstname"] = firstname
    if lastname:
        params["lastname"] = lastname

    response = self.client.get(self.ENDPOINT, params=params)
    return response, ResponseValidator(response)

def get_booking(self, booking_id: int) -> tuple[requests.Response, ResponseValidator]:
    """获取指定预订详情。"""
    response = self.client.get(f"{self.ENDPOINT}/{booking_id}")
    return response, ResponseValidator(response)
```

**Guidelines**:
- `get_all_<resources>` 支持可选筛选参数
- `get_<resource>` 通过 ID 查询单个资源
- 筛选参数为 `Optional`，默认 `None`

### Delete 方法

```python
def delete_booking(self, booking_id: int) -> tuple[requests.Response, ResponseValidator]:
    """删除指定预订。需要认证。"""
    self.logger.info(f"Deleting booking: {booking_id}")
    response = self.client.delete(f"{self.ENDPOINT}/{booking_id}")
    return response, ResponseValidator(response)
```

**Guidelines**:
- 方法名 `delete_<resource>`
- 通过 ID 删除资源
- 如果 API 需要认证，在调用前确保 `APIClient` 已设置 token
- 此方法被 `environment.py` 的 `_cleanup_test_data` 调用

### Helper 方法

```python
def create_from_builder(self, booking: "Booking") -> tuple[requests.Response, ResponseValidator]:
    """从 BookingBuilder 对象创建预订。"""
    from factories.booking_builder import Booking

    return self.create_booking(
        firstname=booking.guest.firstname,
        lastname=booking.guest.lastname,
        check_in=booking.check_in,
        check_out=booking.check_out,
        total_price=booking.total_price,
        deposit_paid=booking.deposit_paid,
        additional_needs=booking.additional_needs,
    )

def booking_exists(self, booking_id: int) -> bool:
    """检查预订是否存在。"""
    response, _ = self.get_booking(booking_id)
    return response.status_code == 200
```

**Guidelines**:
- `create_from_builder` 接收 Builder 构建的数据对象
- `<resource>_exists` 通过 GET 请求检查资源是否存在
- Helper 方法简化常见操作

---

## Usage Guidelines

当生成 API Service 类时：

1. **识别资源**: 从 Given Step 文本推断 API 资源（如 "booking" → `BookingService`）
2. **检查已有**: 检查 `services/` 目录是否已有同名 Service，如有则更新
3. **参考被测项目上下文**: 从被测项目后端源码或项目上下文获取 API 端点信息
4. **CRUD 完整**: 尽量提供完整的 CRUD 方法，即使当前 Step 只用到部分
5. **与 Builder 集成**: 提供 `create_from_builder` 方法支持 Builder 模式

**Important**:
- 一个 API 资源对应一个 Service 类文件
- 文件名使用 snake_case（如 `booking_service.py`），类名使用 PascalCase（如 `BookingService`）
- 所有方法返回 `tuple[requests.Response, ResponseValidator]`
- 参考 `automation-framework-example/services/` 的现有实现

---

## Output Format

**Format**: Python (.py)
**Location**: `<test-project>/services/<resource>_service.py`
**Naming**: snake_case，以 `_service.py` 结尾，如 `booking_service.py`、`room_service.py`、`auth_service.py`

**Format Details**:
- UTF-8 编码
- 遵循 PEP 8 规范
- 行宽不超过 100 字符
- 使用类型注解

---

## Best Practices

1. **无状态**: Service 类不持有状态，每次调用都是独立的
2. **统一返回**: 所有 API 调用方法返回 `tuple[Response, ResponseValidator]`
3. **日志记录**: 关键操作记录日志
4. **认证管理**: 不在 Service 中硬编码 token，由 `APIClient` 统一管理
5. **Builder 集成**: 提供 `create_from_builder` 支持 Builder 模式

### Common Pitfalls to Avoid

- **硬编码 URL**: 在方法中写死 URL → 使用 `ENDPOINT` 常量
- **不返回 Validator**: 只返回 Response 不返回 Validator → 调用方需要手动创建
- **状态泄漏**: 在 Service 中存储请求间状态 → Service 应无状态
- **缺少日志**: 关键操作无日志 → 难以调试

---

## Related Documents

This spec template works with:
- **step-definitions-spec.md**: Given Step 调用 Service 方法
- **test-data-builder-spec.md**: Builder 构建的数据通过 `create_from_builder` 创建
- **step-registry-spec.md**: Service 不直接注册到 Step 注册表

This spec is used by:
- **Action: asdm-test-code-generate**: 生成 API Service 类
- **environment.py**: `after_scenario` 调用 Service 的 delete 方法清理数据

---

## Checklist

Before finalizing API Service class, check:

- [ ] 类名为 `<Resource>Service`
- [ ] 定义了 `ENDPOINT` 常量
- [ ] `__init__` 中初始化 `APIClient` 和 logger
- [ ] 提供了 CRUD 方法（create、get_all、get、update、delete）
- [ ] 所有方法返回 `tuple[requests.Response, ResponseValidator]`
- [ ] 方法包含类型注解
- [ ] 方法包含 docstring
- [ ] 提供了 `create_from_builder` 方法（如有对应 Builder）
- [ ] 提供了 `<resource>_exists` helper 方法
- [ ] 文件名为 snake_case，以 `_service.py` 结尾
- [ ] 遵循 PEP 8 规范
