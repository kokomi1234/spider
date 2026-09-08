---
name: aixcoding-archive
description: '归档 change：工件检查→delta specs 同步评估→移动到 .aixcoding/workspace/archive/。由 aixcoding-done 第 4 步调用。'
---

# AIxCoding Archive — 归档 Change

实现完成后将 change 归档：前置检查 → delta specs 同步评估 → 移动到 archive。

## 整合

| 原步骤 | 集成方式 |
|--------|----------|
| openspec-archive-change | 去除 CLI 依赖，直接操作 `.aixcoding/workspace/changes/` 与 `.aixcoding/workspace/archive/` |

## Input

| 输入项 | 来源 | 必填 | 说明 |
|--------|------|:--:|------|
| Change 名称 | 用户/上下文 | ⚠️ | 未提供必须让用户选择，不猜测 |

## Workflow

### 1. 确定 change

- 未提供名称 → 列出 `.aixcoding/workspace/changes/` 下未归档 change，让用户选择
- **不自动猜测或自动选择**

### 2. 工件与任务完整性检查

- 工件齐全性：proposal.md / design.md / specs/ / tasks.md 是否存在
- `tasks.md`：统计未完成 `- [ ]`
- `develop-log.json`：检查是否存在非 `completed` 状态

存在未完成项 → 展示警告清单 → 用户确认后继续（不强制阻塞，但必须确认）

### 3. Delta specs 同步评估

- `changes/<name>/specs/` 下有 delta specs → 与主 specs（`.aixcoding/workspace/specs/`）对比
- 展示合并摘要（ADDED / MODIFIED / REMOVED / RENAMED）
- 询问：同步（推荐）/ 不同步归档
- 选择同步 → Follow aixcoding-sync-specs action

### 4. 归档（收集 + 移动）

- 目标：`.aixcoding/workspace/archive/YYYY-MM-DD-<name>/`
- 目标已存在 → 报错，建议重命名或换日期
- 归档内容来自**两处**（归档是合并收集，不是单一目录移动）：
  - `changes/<name>/`：tasks.md / develop-log.json / delta specs 等 change 专属工件 → 整体移动
  - 顶层 feature 工件：`workspace/stories/<feature>/`、`workspace/design/<feature>/`、`workspace/discovery/<feature>/`、`workspace/specs/<feature>/` → **复制**进 archive 对应子目录
- 归档后的目录应能独立复现该 feature 的完整交付物（proposal/design/stories/discovery/specs/tasks/develop-log）

### 5. 完整性校验（删除前置条件）

归档后、删除源前，**必须**校验 archive 与源完全一致：

- 对每个归档来源目录执行 `diff -rq <源> <archive 对应目录>`，要求无差异
- 校验 archive 工件齐全：proposal/design/stories/discovery/specs/tasks.md/develop-log.json
- **任一 diff 有差异或工件缺失 → 阻止删除源**，先补齐 archive 再继续

### 6. 删除顶层残留（仅校验通过后）

完整性校验通过后，删除已归档的顶层源目录，避免数据重复：

- 删除 `workspace/stories/<feature>/`、`workspace/design/<feature>/`、`workspace/discovery/<feature>/`、`workspace/specs/<feature>/`
- 清理生成的空目录（`rmdir` 父链）
- **绝不删除 archive 内容**；archive 是唯一完整副本

### 7. 摘要

归档完成摘要：change 名称、归档位置、specs 是否已同步、完整性校验结果、已删除的顶层残留目录、存在的警告项。

## Output

```
## Archive Complete

**Change:** <change-name>
**Archived to:** .aixcoding/workspace/archive/YYYY-MM-DD-<name>/
**Specs:** ✓ Synced to main specs / 无 delta specs / 跳过同步
**Integrity:** ✓ archive 与源一致（diff -rq 无差异）
**Source cleaned:** ✓ 已删除 stories/design/discovery/specs 顶层残留
```

## Guardrails

- 未提供 change 名称必须让用户选择
- 未完成任务/工件缺失 → 警告 + 确认，不静默跳过
- delta specs 存在时必须展示同步评估摘要
- 归档为**合并收集**：移动 `changes/<name>/` + 复制顶层 stories/design/discovery/specs，两者都进 archive
- **删除顶层残留前必须通过完整性校验**（diff -rq 无差异），校验失败 → 阻止删除、先补齐 archive
- 归档完成后顶层 sources 不得残留（避免数据重复），软校验：删除后复查无残留

## 使用

由 `/aixcoding-done [change-name]` 第 4 步调用；也可单独 `/aixcoding-archive <name>`。
