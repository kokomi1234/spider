# Manifest 规范（manifest-spec）

## 概述

`manifest.json` 是上下文构建工具集的**版本锚点文件**，记录当前上下文对应的代码库 Git 状态。每次执行 `asdm-context-validate` 或 `asdm-context-update` 时覆盖写入。

**位置**：`.asdm/contexts/manifest.json`

## JSON 结构

```json
{
  "commitSha": "38bd8d85154e84c99c94332bf356098596849927",
  "commitShort": "38bd8d8",
  "branch": "feat/leixu/0516-build-harness-toolset",
  "validatedAt": "2026-05-16T13:39:32+00:00",
  "isDirty": false
}
```

## 字段定义

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `commitSha` | string (40 hex) | 是 | 工作区当前 HEAD 完整 SHA，作为增量 diff 基准锚点 |
| `commitShort` | string (8 hex) | 是 | 短 hash，用于日志可读性 |
| `branch` | string | 是 | 当前分支名 |
| `validatedAt` | string (ISO 8601) | is | 本次验证/更新的时间戳 |
| `isDirty` | boolean | 是 | 工作区是否有未提交变更 |

## 用途

### 增量更新检测

`asdm-context-update` 读取 `commitSha`，执行：

```bash
git diff {commitSha} HEAD --name-only
```

据此判定哪些上下文文件可能需要同步更新。

### 脏工作区处理

若 `isDirty === true` 或当前 `git status --porcelain` 非空，额外检查未提交变更。

### 写入时机

| 操作 | 写入者 | 说明 |
|------|--------|------|
| `asdm-context-validate` | validate | 全量验证完成后写入 |
| `asdm-context-update` | update | 更新操作完成后刷新锚点至当前 HEAD |

> **前置条件**：非 Git 仓库时跳过生成，在报告中注明「非 Git 仓库，未生成 Manifest」。
