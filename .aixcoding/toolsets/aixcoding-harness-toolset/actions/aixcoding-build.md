---
name: aixcoding-build
description: '逐任务实现+骨架。--scaffold生成源码骨架，--story-level Story级开发(asdm-harness-us-develop)。测试仓库骨架与测试代码生成由 aixcoding-test 统一负责。'
---

# AIxCoding Build — 逐任务实现

## 整合

| 原步骤 | 工具集                            | 使用场景 |
|--------|--------------------------------|----------|
| aixcoding-apply | aixcoding-harness-toolset      | 逐任务实现 |
| asdm-harness-develop | aixcoding-asdm-harness-toolset | Feature 级开发（默认） |
| asdm-harness-us-develop | aixcoding-asdm-harness-toolset | Story 级开发（`--story-level`） |

## 前置条件

- aixcoding-plan 已完成

## 模式

### `--scaffold` — 源码骨架
从 .feature 生成 Controller/DTO/Enum 骨架。

### 默认 — 逐任务实现
四阶段闭环：实现→验证→修复→确认，更新 develop-log。

### `--story-level` — Story 级开发
Follow asdm-harness-us-develop: 逐 Story 开发，验证步骤与 AC 强关联。

## 使用

```bash
/aixcoding-build --scaffold           # 源码骨架
/aixcoding-build                      # 逐任务实现
/aixcoding-build --story-level S01    # Story级开发
```

> 测试仓库骨架（scaffold）与测试代码生成（spec → 可运行测试代码）统一由 **`/aixcoding-test`** 负责，build 不再承担测试相关职责。
