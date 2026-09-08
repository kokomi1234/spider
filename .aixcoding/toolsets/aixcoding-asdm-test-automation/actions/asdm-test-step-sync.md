# Instructions for asdm-test-step-sync action

## Metadata

```json
{
  "guid": "b4c5d6e7-f8a9-0b1c-2d3e-4f5a6b7c8d9e",
  "name": "asdm-test-step-sync",
  "displayName": "注册表同步",
  "description": "扫描 steps/ 目录下所有 Python 文件，提取 @given/@when/@then 装饰器的 step 文本，与 step-registry.json 对比，补充新增、标记删除，并输出同步报告",
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

本指令引导 AI 模型同步 Step 注册表与实际代码状态。随着开发者手动修改或重构 Step Definitions，注册表会和实际代码出现漂移。本 action 扫描 `steps/` 目录下所有 Python 文件，提取 `@given`/`@when`/`@then` 装饰器的 step 文本，与 `step-registry.json` 对比，补充新增、标记删除，并输出同步报告。

这确保 `asdm-test-code-generate` 的复用检测始终基于真实的代码状态，而非历史快照。

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

在开始同步之前，AI 模型应读取 Step 注册表和实际的 Step Definitions 代码。

### Context Files to Read (Required)

1. **Step 注册表** (Required - MUST be read first)
   - Path: `.aixcoding/workspace/test/step-registry.json`
   - Purpose: 获取当前注册的 Step 列表

2. **Step Definitions 代码** (Required)
   - Path: `<test-project>/steps/*.py`
   - Purpose: 扫描实际代码中的所有 step 装饰器

### Context Files to Read (Optional)

3. **项目上下文** (Optional)
   - `.aixcoding/contexts/index.md` — 了解项目整体结构

**IMPORTANT**: 始终先读取 Step 注册表，再扫描实际代码。

## Steps to 注册表同步

### 1. 接收同步参数

接收用户提供的参数：

**可选信息**：
- **目标项目路径**：测试代码根目录路径，默认为当前工作区下的测试项目
- **同步模式**：默认 `update`（更新注册表），可选 `report-only`（仅生成报告不更新）

如果用户未提供目标项目路径，使用默认值或提示用户提供。

### 2. 读取当前 Step 注册表

读取 `.aixcoding/workspace/test/step-registry.json`：

```python
# 伪代码
import json

with open("step-registry.json", "r") as f:
    registry = json.load(f)

registered_steps = registry.get("steps", [])
```

记录当前注册的 Step：
- 每个 Step 的 `step_text`、`step_type`、`file_path`、`function_name`
- 构建 `step_text → entry` 的映射，用于后续对比

### 3. 扫描 steps/ 目录

扫描 `<test-project>/steps/` 目录下所有 `.py` 文件（排除 `__init__.py`）：

```python
# 伪代码
import os
import re

step_files = []
for root, dirs, files in os.walk("<test-project>/steps/"):
    for file in files:
        if file.endswith(".py") and file != "__init__.py":
            step_files.append(os.path.join(root, file))
```

### 4. 提取 Step 装饰器

对每个 Step 文件，提取所有 `@given`、`@when`、`@then` 装饰器的 step 文本和对应函数名：

#### 4.1 解析装饰器

使用正则表达式或 AST 解析，提取以下信息：

```python
# 伪代码 - 使用正则表达式
patterns = {
    "given": r'@given\(["\'](.+?)["\']\)',
    "when": r'@when\(["\'](.+?)["\']\)',
    "then": r'@then\(["\'](.+?)["\']\)',
}

# 或使用 AST 解析（更准确）
import ast

def extract_steps(file_path):
    with open(file_path, "r") as f:
        tree = ast.parse(f.read())

    steps = []
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            for decorator in node.decorator_list:
                # 解析 @given/@when/@then 装饰器
                # 提取 step 文本和函数名
                pass
    return steps
```

#### 4.2 提取的信息

对每个 Step 提取：
- **step_text**：装饰器中的文本（如 `"I am on the home page"`）
- **step_type**：`given`、`when` 或 `then`
- **file_path**：相对于项目根的文件路径（如 `steps/ui_steps.py`）
- **function_name**：装饰器下方的函数名（如 `step_on_home_page`）

#### 4.3 处理参数化 Step

对于含参数的 Step（如 `@when('I login with username "{username}" and password "{password}"')`），保留原始文本（含 `{param}` 占位符），用于与注册表对比。

### 5. 对比注册表与实际代码

将扫描到的实际 Step 与注册表中的 Step 对比：

#### 5.1 识别新增 Step

实际代码中存在，但注册表中不存在的 Step：

```markdown
## 新增 Steps (3)
| Step 文本 | 类型 | 文件 | 函数 |
|-----------|------|------|------|
| I navigate to the dashboard | when | steps/ui_steps.py | step_navigate_dashboard |
| ... | ... | ... | ... |
```

#### 5.2 识别已删除 Step

注册表中存在，但实际代码中不存在的 Step：

```markdown
## 已删除 Steps (2)
| Step 文本 | 类型 | 原文件 | 原函数 |
|-----------|------|--------|--------|
| I click the old button | when | steps/ui_steps.py | step_click_old_button |
| ... | ... | ... | ... |
```

#### 5.3 识别冲突 Step

注册表和实际代码中都存在，但 `file_path` 或 `function_name` 不一致的 Step（说明代码被重构/移动）：

```markdown
## 冲突 Steps (1)
| Step 文本 | 注册表记录 | 实际代码 | 冲突类型 |
|-----------|-----------|----------|----------|
| I login as admin | steps/ui_steps.py:step_login_admin | steps/auth_steps.py:step_login | 文件路径变更 |
```

#### 5.4 识别未变更 Step

注册表和实际代码中完全一致的 Step（仅统计数量，不详细列出）。

### 6. 更新 Step 注册表

如果同步模式为 `update`（默认），更新 `step-registry.json`：

#### 6.1 追加新增 Step

```json
{
  "step_text": "I navigate to the dashboard",
  "step_type": "when",
  "file_path": "steps/ui_steps.py",
  "function_name": "step_navigate_dashboard",
  "feature_source": "manual",
  "created_date": "<today>"
}
```

#### 6.2 移除已删除 Step

从 `steps` 数组中移除已删除的 Step 条目。

#### 6.3 更新冲突 Step

对于冲突 Step，用实际代码的信息覆盖注册表记录：
- 更新 `file_path` 和 `function_name`
- 更新 `updated_date`（新增此字段记录最近修改日期）

#### 6.4 更新注册表元信息

```json
{
  "version": "1.0",
  "updated_date": "<today>",
  "last_sync_date": "<today>",
  "total_steps": <updated_count>,
  "steps": [...]
}
```

### 7. 生成同步报告

生成详细的同步报告：

```markdown
# Step 注册表同步报告

## 同步时间
{YYYY-MM-DD HH:MM:SS}

## 同步摘要
- **注册表 Step 总数（同步前）**: {before_count}
- **实际代码 Step 总数**: {after_count}
- **新增**: {new_count}
- **删除**: {deleted_count}
- **冲突（已修复）**: {conflict_count}
- **未变更**: {unchanged_count}

## 新增 Steps ({new_count})
| Step 文本 | 类型 | 文件 | 函数 |
|-----------|------|------|------|
| {step_text} | {type} | {file} | {function} |

## 已删除 Steps ({deleted_count})
| Step 文本 | 类型 | 原文件 | 原函数 |
|-----------|------|--------|--------|
| {step_text} | {type} | {file} | {function} |

## 冲突 Steps ({conflict_count}) — 已自动修复
| Step 文本 | 变更内容 |
|-----------|----------|
| {step_text} | {file_path}: {old} → {new} |

## 未变更 Steps
{unchanged_count} 个 Step 保持不变。

## 注册表状态
- **同步后 Step 总数**: {after_count}
- **注册表文件**: .aixcoding/workspace/test/step-registry.json
- **同步模式**: {update | report-only}
```

### 8. 验证同步结果

验证更新后的注册表：

#### 8.1 JSON 格式验证

- `step-registry.json` 是合法的 JSON
- 每个 Step 条目包含必需字段（`step_text`、`step_type`、`file_path`、`function_name`）

#### 8.2 一致性验证

- 注册表中的每个 Step 在实际代码中都能找到
- 实际代码中的每个 Step 在注册表中都有记录
- `file_path` 指向的文件确实存在

#### 8.3 执行验证命令

**CRITICAL**: 验证必须通过实际执行命令完成。

```bash
# 验证 JSON 格式
python -c "import json; json.load(open('.aixcoding/workspace/test/step-registry.json'))"

# 验证注册表中的文件路径都存在
python -c "
import json, os
with open('.aixcoding/workspace/test/step-registry.json') as f:
    registry = json.load(f)
for step in registry['steps']:
    path = os.path.join('<test-project>', step['file_path'])
    assert os.path.exists(path), f'File not found: {path}'
print(f'All {len(registry[\"steps\"])} steps validated.')
"
```

### 9. 呈现同步摘要

向用户展示同步结果：

```markdown
# 注册表同步完成

## 同步结果
- **新增 Steps**: {new_count}
- **删除 Steps**: {deleted_count}
- **冲突修复**: {conflict_count}
- **未变更**: {unchanged_count}
- **同步后总数**: {total_count}

## 注册表已更新
文件: .aixcoding/workspace/test/step-registry.json

## 影响
同步后，`/asdm-test-code-generate` 的复用检测将基于最新的代码状态。

## 下一步
- 继续使用 `/asdm-test-code-generate <feature-file>` 生成新测试代码
- 定期运行 `/asdm-test-step-sync` 保持注册表与代码同步
```

## Execution Guidelines

### When to Use This Action

使用本 action 的场景：
- 开发者手动修改或重构了 Step Definitions 后
- Step Definitions 文件被移动或重命名后
- 定期维护（如每周/每迭代结束时）保持注册表与代码同步
- 在执行 `asdm-test-code-generate` 之前，确保复用检测基于最新状态

### 扫描原则

1. **递归扫描**：扫描 `steps/` 目录下所有子目录
2. **排除 __init__.py**：不扫描 `__init__.py` 文件
3. **AST 解析优先**：使用 Python AST 模块解析，比正则表达式更准确
4. **保留参数化文本**：含 `{param}` 的 Step 保留原始文本

### 对比原则

1. **精确匹配**：`step_text` 完全一致才视为匹配
2. **不修改代码**：同步只更新注册表，不修改 Step Definitions 代码
3. **冲突自动修复**：文件路径或函数名变更自动更新注册表
4. **保留元信息**：`feature_source`、`created_date` 等字段不被覆盖

### 错误处理

- **注册表不存在**：提示用户先执行 `/asdm-test-automation-scaffold`
- **steps/ 目录为空**：提示用户先执行 `/asdm-test-code-generate` 生成代码
- **JSON 格式错误**：提示用户注册表已损坏，建议重新初始化
- **文件路径不存在**：标记为冲突，提示用户检查

### report-only 模式

如果用户指定 `report-only` 模式：
- 只生成同步报告，不更新 `step-registry.json`
- 用于预览同步结果，确认后再执行实际同步

## Usage

To use this instruction, the AI model should:
1. 检测响应语言
2. 接收用户参数（目标项目路径、同步模式）
3. 读取当前 Step 注册表
4. 扫描 `steps/` 目录下所有 `.py` 文件
5. 提取所有 `@given`/`@when`/`@then` 装饰器的 step 文本和函数名
6. 对比注册表与实际代码（识别新增、删除、冲突）
7. 如非 report-only 模式，更新 `step-registry.json`
8. 生成同步报告
9. 验证同步结果（JSON 格式 + 文件路径存在性）
10. 呈现同步摘要

## Output Summary

完成注册表同步后，将生成以下产出：
- 更新的 Step 注册表：`.aixcoding/workspace/test/step-registry.json`（report-only 模式下不更新）
- 同步报告（新增/删除/冲突/未变更的 Step 列表）

所有更新保存在测试项目目录下的 `.aixcoding/workspace/test/` 目录。

### Downstream Flow

```text
/asdm-test-automation-scaffold                    ← 前置步骤：搭建仓库骨架
        │
        ▼
/asdm-test-code-generate <feature-file>     ← 生成测试代码
        │
        ▼
/asdm-test-step-sync                        ← 当前步骤：同步注册表（定期维护）
        │
        ▼
/asdm-test-code-generate <new-feature>      ← 基于最新注册表继续生成（复用检测准确）
```
