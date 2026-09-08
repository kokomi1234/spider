> **⚠️ 模板文件声明**
>
> - **本文件性质**：`.asdm/toolsets/asdm-context-builder/specs/layer-2/api.md` 是**规范模板（Spec Template）**，非最终上下文内容。
> - **生成规则**：执行 `/asdm-context-init` 时，AI 应扫描各 `server/qa-service-{domain}/src/main/java/.../controller/` 下的 Controller 类，提取真实的 API 端点定义（方法、路径、参数、请求/响应类型）、数据结构 JSON 示例、CORS 配置等信息，按 Controller 分组组织，生成完整 API 文档并写入 `.asdm/contexts/layer-2/api.md`。
> - **更新规则**：API 端点增删改时，通过 `/asdm-context-update` 同步更新已生成的上下文文件。
> - **验证规则**：使用 `/asdm-context-validate` 对比上下文中的端点定义与 Controller 源码是否一致。
>
> ---

# API 接口文档（L2 层）

## 概述

本文档提供项目各后端服务的 API 接口定义，包括端点列表、数据结构、配置信息和调用示例。

## 来源信息

| 项目        | 内容      |
|-----------|---------|
| **项目名称**  | {项目名称}  |
| **构建时间戳** | {生成日期}  |
| **版本号**   | {服务版本}  |
| **技术框架**  | {主技术框架} |

---

## 一、服务基础信息

| 属性 | 值                     |
|------|-----------------------|
| 服务名称 | {service name}           |
| 版本 | {x.x.x-SNAPSHOT}      |
| 端口 | {端口号}                 |
| 基础路径 | http://localhost:{端口} |

---qa-service-xxx

## 二、{ControllerName}（{控制器描述}）

**文件位置：** `{controllerPath}/{ControllerName}.java`

### 2.1 API 端点列表

| 方法 | 端点 | 描述 | 参数 | 请求体 | 响应类型 |
|------|------|------|------|--------|----------|
| GET | `/api/{resource}` | 获取所有{资源} | 无 | 无 | List<{Resource}Response> |
| GET | `/api/{resource}/{id}` | 根据ID获取{资源} | id（路径参数） | 无 | {Resource}Response |
| POST | `/api/{resource}` | 创建{资源} | 无 | {Resource}CreateRequest | {Resource}Response |
| PUT | `/api/{resource}/{id}` | 更新{资源} | id（路径参数） | {Resource}UpdateRequest | {Resource}Response |
| DELETE | `/api/{resource}/{id}` | 删除{资源} | id（路径参数） | 无 | 无内容 |

### 2.2 数据结构示例

#### {Resource}Response（{资源}响应）
```json
{
  "id": "xxx001",
  "name": "示例数据",
  "createdAt": "2026-05-16T10:00:00"
}
```

#### {Resource}CreateRequest（创建{资源}请求）
```json
{
  "name": "新数据",
  "description": "描述信息"
}
```

---

## 三、{AnotherControllerName}（{另一个控制器描述}）

**文件位置：** `{AnotherControllerPath}/{AnotherControllerName}.java`

### 3.1 API 端点列表

| 方法 | 端点 | 描述 | 参数 | 请求体 | 响应类型 |
|------|------|------|------|--------|----------|
| GET | `/api/{another-resource}` | 获取{资源}列表 | 无 | 无 | List<{AnotherResource}Response> |
| POST | `/api/{another-resource}` | 创建{资源} | 无 | {AnotherResource}Request | {AnotherResource}Response |

### 3.2 数据结构示例

#### {AnotherResource}Response
```json
{
  "id": "yyy001",
  "field": "值"
}
```

---

## 四、Spring Boot Actuator 端点

如果项目集成了 Spring Boot Actuator，提供监控和管理端点。

### 4.1 端点列表

| 方法 | 端点                | 描述                   |
|------|-------------------|----------------------|
| GET | `{endpoint-path}` | endpoint description |


### 4.2 数据结构示例

#### HealthResponse（健康检查响应）
```json
{
  "status": "UP",
  "components": {
    "diskSpace": {
      "status": "UP",
      "details": {
        "total": 499963174912,
        "free": 123456789012,
        "threshold": 10485760,
        "exists": true
      }
    },
    "ping": {
      "status": "UP"
    }
  }
}
```

#### InfoResponse（应用信息响应）
```json
{
  "app": {
    "name": "{service-name}",
    "description": "{服务描述}",
    "version": "{x.x.x-SNAPSHOT}",
    "encoding": "UTF-8",
    "java": { "version": "17" }
  },
  "team": "{team-name}",
  "environment": "development",
  "build": { "timestamp": "{构建时间}" }
}
```

---

## 五、CORS 配置

| 配置项 | 值 |
|--------|-----|
| 允许的源 | `{允许的源}` |
| 允许的方法 | `GET, POST, PUT, DELETE, OPTIONS` |
| 允许的头部 | `*`（所有头部） |
| 允许凭证 | `false` |
| 最大缓存时间 | `3600` 秒 |

---

## 六、错误响应格式

```json
{
  "timestamp": "2026-05-16T10:15:30.000+00:00",
  "status": 400,
  "error": "Bad Request",
  "message": "详细错误信息",
  "path": "/api/{endpoint}"
}
```

---

## 七、使用示例（curl 命令）

### 7.1 {资源名称} API

**获取所有{资源}：**
```bash
curl -X GET http://localhost:{port}/api/{resource}
```

**根据ID获取{资源}：**
```bash
curl -X GET http://localhost:{port}/api/{resource}/xxx001
```

**创建{资源}：**
```bash
curl -X POST http://localhost:{port}/api/{resource} \
  -H "Content-Type: application/json" \
  -d '{
    "name": "新数据",
    "description": "描述信息"
  }'
```

**更新{资源}：**
```bash
curl -X PUT http://localhost:{port}/api/{resource}/xxx001 \
  -H "Content-Type: application/json" \
  -d '{
    "name": "更新后的数据"
  }'
```

**删除{资源}：**
```bash
curl -X DELETE http://localhost:{port}/api/{resource}/xxx001
```

### 7.2 健康检查

**应用健康检查：**
```bash
curl -X GET http://localhost:{port}/actuator/health
```

**应用信息：**
```bash
curl -X GET http://localhost:{port}/actuator/info
```

---

## 八、注意事项

1. 所有 API 端点的具体实现请参考各服务的 controller 目录下的源码
2. 所有 API 端点都支持 CORS（具体配置见上方第五章）
3. 生产环境中建议限制 CORS 配置和 Actuator 端点的访问权限
4. 敏感数据（如密码）在生产环境中必须加密存储

---

## 九、版本历史

| 版本 | 更新内容 |
|------|----------|
| **v{x.x.x-SNAPSHOT}** | 初始版本 |

---

> **说明**：本模板遵循标准 API 文档格式。使用 `/asdm-context-init` 或 `/asdm-context-update` 生成实际内容时，将自动扫描各模块下的 Controller 类并填充上述模板。
