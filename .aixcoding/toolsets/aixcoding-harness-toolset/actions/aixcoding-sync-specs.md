---
name: aixcoding-sync-specs
description: '同步 delta specs → 主 specs（.aixcoding/workspace/specs/）。智能合并 ADDED/MODIFIED/REMOVED/RENAMED。由 aixcoding-archive 调用。'
---

# AIxCoding Sync-Specs — Delta Specs 同步

把 change 的 delta specs 智能合并到主 specs。**AI 驱动**：读取 delta，直接编辑主 spec 应用变更（如新增一个 Scenario 无需复制整个需求）。

## 整合

| 原步骤 | 集成方式 |
|--------|----------|
| openspec-sync-specs | 去除 CLI 依赖；主 specs 位置 `.aixcoding/workspace/specs/` |

## Input

| 输入项 | 来源 | 必填 |
|--------|------|:--:|
| Change 名称 | 用户/上下文 | ⚠️（未提供必须让用户选择） |

## Workflow

### 1. 确定 change

未提供 → 列出含 `specs/` 目录的未归档 change 让用户选择。

### 2. 定位 delta specs

`changes/<name>/specs/**` 下的所有 delta spec 文件。

### 3. 逐 delta spec 应用变更

对每个 delta spec：

a. **读 delta spec**，识别变更意图
b. **读主 spec**（`.aixcoding/workspace/specs/` 下对应路径，可能不存在）
c. **智能合并**：

| 段 | 处理 |
|----|------|
| ADDED | 主 spec 不存在该需求 → 添加；已存在 → 更新（视为隐式 MODIFIED） |
| MODIFIED | 只合并 delta 提及的 Scenario/内容，**保留其余未提及内容** |
| REMOVED | 删除整个需求块 |
| RENAMED | FROM: 旧名 → TO: 新名 |

d. **主 spec 不存在** → 创建新文件：Purpose 段（可简略，标 TBD）+ Requirements 段（ADDED 需求）

### 4. 摘要

汇报：更新了哪些路径、增/改/删/改名各多少。

## Delta Spec 格式参考

```markdown
## ADDED Requirements
### Requirement: New Feature
The system SHALL do something new.
#### Scenario: Basic case
- **WHEN** user does X
- **THEN** system does Y

## MODIFIED Requirements
### Requirement: Existing Feature
#### Scenario: New scenario to add
- **WHEN** user does A
- **THEN** system does B

## REMOVED Requirements
### Requirement: Deprecated Feature

## RENAMED Requirements
- FROM: `### Requirement: Old Name`
- TO: `### Requirement: New Name`
```

## Guardrails

- 先读 delta 与主 spec，再动手
- 保留 delta 未提及的现有内容（delta 是意图，不是整体替换）
- 内容不清先澄清
- 幂等：重复执行结果一致

## 使用

由 `/aixcoding-archive` 调用；也可单独 `/aixcoding-sync-specs <name>`（不同步归档 change）。
