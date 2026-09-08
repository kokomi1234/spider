# Step Registry Specification

## Language Guidelines

本规范定义的 Step 注册表为 JSON 格式数据文件，字段值使用英文（与代码中的 step 文本一致），元信息字段（如日期）使用标准格式。

---

## Overview

本规范定义了 `step-registry.json`（全局共享）的结构和格式要求。Step 注册表是测试代码生成阶段的核心数据文件，记录所有已生成的 Step Definitions 信息，用于跨 Story 的步骤复用检测。

**主要用途**:
- `asdm-test-code-generate` 查询注册表，检测已有 Step 是否可复用，避免重复生成
- `asdm-test-step-sync` 扫描实际代码与注册表对比，识别新增、删除、冲突的 Step
- `asdm-test-automation-scaffold` 初始化空的注册表

---

## Document Structure

使用以下 JSON 结构作为 `step-registry.json` 的模板：

```json
{
  "version": "1.0",
  "updated_date": "<YYYY-MM-DD>",
  "last_sync_date": "<YYYY-MM-DD>",
  "total_steps": <integer>,
  "steps": [
    {
      "step_text": "<step-text-with-params>",
      "step_type": "<given|when|then>",
      "file_path": "steps/<file-name>.py",
      "function_name": "<function-name>",
      "feature_source": "<feature-file-name|manual>",
      "created_date": "<YYYY-MM-DD>",
      "updated_date": "<YYYY-MM-DD>"
    }
  ]
}
```

**Key Elements**:
- `version`: 注册表格式版本号（当前为 `1.0`）
- `updated_date`: 注册表最后更新日期
- `last_sync_date`: 最后一次执行 `asdm-test-step-sync` 的日期
- `total_steps`: `steps` 数组的长度
- `steps`: Step 条目数组，每个条目记录一个 Step Definition

---

## Section Guidelines

### 顶层元信息

注册表顶层的元信息字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `version` | string | 是 | 注册表格式版本，当前为 `"1.0"` |
| `updated_date` | string | 是 | 最后更新日期，格式 `YYYY-MM-DD` |
| `last_sync_date` | string | 否 | 最后同步日期，由 `asdm-test-step-sync` 写入 |
| `total_steps` | integer | 是 | Step 总数，等于 `steps` 数组长度 |
| `steps` | array | 是 | Step 条目数组 |

**Important**:
- `total_steps` 必须与 `steps` 数组实际长度一致
- 每次更新注册表时必须同步更新 `updated_date`

### Step 条目结构

每个 `steps` 数组元素的字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `step_text` | string | 是 | Step 文本，含 `{param}` 占位符（如 `"I create a booking for \"{firstname}\" \"{lastname}\""`） |
| `step_type` | string | 是 | Step 类型：`"given"`、`"when"` 或 `"then"` |
| `file_path` | string | 是 | Step Definition 文件的相对路径（如 `"steps/ui_steps.py"`） |
| `function_name` | string | 是 | Step 对应的 Python 函数名（如 `"step_create_booking"`） |
| `feature_source` | string | 是 | 来源 feature 文件名，或 `"manual"` 表示手动创建 |
| `created_date` | string | 是 | 创建日期，格式 `YYYY-MM-DD` |
| `updated_date` | string | 否 | 最后修改日期，由 `asdm-test-step-sync` 在修复冲突时写入 |

**Important**:
- `step_text` 保留 behave 装饰器中的原始文本，包括 `{param}` 占位符
- `file_path` 是相对于测试项目根目录的路径
- `step_type` 使用小写

### step_text 格式规范

`step_text` 必须与 behave 装饰器中的文本完全一致：

```python
# 代码中的装饰器
@given('a booking exists for "{firstname}" "{lastname}"')

# 注册表中的 step_text
"step_text": "a booking exists for \"{firstname}\" \"{lastname}\""
```

**规则**:
- 无参数的 Step：直接使用完整文本
- 有参数的 Step：保留 `{param}` 占位符，不替换为实际值
- 文本中的双引号在 JSON 中转义为 `\"`

---

## Usage Guidelines

当操作 Step 注册表时：

1. **读取（查询复用）**: `asdm-test-code-generate` 读取 `steps` 数组，对每个 .feature 中的 Step 检查是否已存在
2. **追加（新增 Step）**: `asdm-test-code-generate` 生成新代码后，将新 Step 追加到 `steps` 数组末尾
3. **更新（同步）**: `asdm-test-step-sync` 对比实际代码，追加新增、移除已删除、修复冲突
4. **初始化**: `asdm-test-automation-scaffold` 创建空注册表（`steps: []`）

**Important**:
- 追加 Step 时不修改已有条目
- 移除 Step 时只删除条目，不修改其他条目
- 冲突修复时只更新 `file_path`、`function_name` 和 `updated_date`

---

## Output Format

**Format**: JSON
**Location**: `.aixcoding/workspace/test/step-registry.json`（全局共享）
**Naming**: 固定文件名 `step-registry.json`

**Format Details**:
- UTF-8 编码
- 缩进 2 空格
- 字段顺序遵循上述模板

**Example**:

```json
{
  "version": "1.0",
  "updated_date": "2026-07-03",
  "last_sync_date": "2026-07-03",
  "total_steps": 3,
  "steps": [
    {
      "step_text": "I am on the home page",
      "step_type": "given",
      "file_path": "steps/ui_steps.py",
      "function_name": "step_on_home_page",
      "feature_source": "home_navigation.feature",
      "created_date": "2026-07-03"
    },
    {
      "step_text": "I create a booking for \"{firstname}\" \"{lastname}\"",
      "step_type": "when",
      "file_path": "steps/api_steps.py",
      "function_name": "step_create_booking",
      "feature_source": "booking_creation.feature",
      "created_date": "2026-07-03"
    },
    {
      "step_text": "the response status code should be {status_code:d}",
      "step_type": "then",
      "file_path": "steps/api_steps.py",
      "function_name": "step_response_status",
      "feature_source": "manual",
      "created_date": "2026-07-03"
    }
  ]
}
```

---

## Best Practices

1. **保持同步**: 手动修改 Step Definitions 后及时运行 `asdm-test-step-sync`
2. **不手动编辑**: 注册表应由工具集的 action 自动维护，避免手动编辑
3. **版本控制**: 将 `step-registry.json` 纳入版本控制，便于追踪变更
4. **唯一性**: 同一 `step_text` + `step_type` 组合在 `steps` 数组中应唯一

### Common Pitfalls to Avoid

- **step_text 不一致**: 注册表中的文本与代码装饰器中的文本不匹配 → 使用 `asdm-test-step-sync` 修复
- **total_steps 错误**: `total_steps` 与实际数组长度不一致 → 同步时自动修正
- **路径过时**: 代码文件移动后 `file_path` 未更新 → `asdm-test-step-sync` 自动修复

---

## Related Documents

This spec template works with:
- **pom-spec.md**: POM 类结构规范
- **step-definitions-spec.md**: Step Definitions 文件结构规范
- **api-service-spec.md**: API Service 类结构规范

This spec is used by:
- **Action: asdm-test-automation-scaffold**: 初始化空注册表
- **Action: asdm-test-code-generate**: 查询和追加 Step 条目
- **Action: asdm-test-step-sync**: 同步注册表与实际代码

---

## Checklist

Before finalizing step-registry.json, check:

- [ ] JSON 格式合法（可被 `json.load()` 解析）
- [ ] `version` 字段为 `"1.0"`
- [ ] `updated_date` 格式为 `YYYY-MM-DD`
- [ ] `total_steps` 等于 `steps` 数组实际长度
- [ ] 每个 Step 条目包含所有必填字段
- [ ] `step_type` 值为 `given`、`when` 或 `then` 之一
- [ ] `file_path` 指向的文件确实存在
- [ ] `step_text` 与代码中装饰器文本一致
- [ ] 无重复的 `step_text` + `step_type` 组合
