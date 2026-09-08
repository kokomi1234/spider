---
name: aixcoding-plan
description: 'Change+任务拆解。默认 Feature 级拆解(asdm-harness-plan)，支持 --story-level Story 级拆解(asdm-harness-us-plan)。'
---

# AIxCoding Plan — Change + 任务拆解

## 整合

| 原步骤 | 工具集                            | 使用场景 |
|--------|--------------------------------|----------|
| aixcoding-propose | aixcoding-harness-toolset      | 创建 change |
| asdm-harness-plan | aixcoding-asdm-harness-toolset | Feature 级任务拆解（默认） |
| asdm-harness-us-plan | aixcoding-asdm-harness-toolset | Story 级任务拆解（`--story-level`） |

## 前置条件

- Git 工作区干净
- discover / design / split / specify 的产出已存在（按推荐顺序执行的前置步骤）

## 两种粒度

### Feature 级（默认）

```bash
/aixcoding-plan <change-name>
```

Follow asdm-harness-plan: 将整个 Feature 拆解为 Phase→Task。

### Story 级（`--story-level`）

```bash
/aixcoding-plan <change-name> --story-level <story-id>
```

Follow asdm-harness-us-plan: 将单条 Story 拆解为细粒度任务，任务验证步骤与 AC 强关联。

## Output

```
.aixcoding/workspace/changes/<change-name>/
├── proposal.md / design.md / specs/
├── tasks.md              # Feature级或Story级任务清单
└── develop-log.json
```

## 使用

```bash
/aixcoding-plan <change-name>                     # Feature级
/aixcoding-plan <change-name> --story-level S01   # Story级
```
