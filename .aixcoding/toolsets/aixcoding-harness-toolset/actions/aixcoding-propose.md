---
name: aixcoding-propose
description: '创建 change：生成 proposal.md(what/why) + design.md(how) + specs/(delta specs)。由 aixcoding-plan 自动调用。'
---

# AIxCoding Propose — 创建 Change

基于 01~04 的产出创建 change 目录并生成提案工件。
**tasks.md 与 develop-log.json 由后续 asdm-harness-plan 生成，不在本 action 职责内。**

## 整合

| 原步骤 | 集成方式 |
|--------|----------|
| openspec-propose | 去除 CLI 依赖，直接操作 `.aixcoding/workspace/changes/` 目录 |

## Input

| 输入项 | 来源 | 必填 | 说明 |
|--------|------|:--:|------|
| Change 名称 | 用户 | ⚠️ | kebab-case，未提供则询问派生 |
| 业务需求文档 | 01 `.aixcoding/workspace/discovery/<id>/` | ✅ | proposal 的 What & Why |
| 技术方案 | 02 `.aixcoding/workspace/design/<id>/` | ✅ | design.md 的 How |
| Story 清单 | 03 `.aixcoding/workspace/stories/<id>/` | ✅ | specs/ 的 delta 来源 |
| .feature 文件 | 04 `.aixcoding/workspace/specs/<feature-id>/<story-id>/` | 按需 | delta specs 的验收细节 |

## Workflow

### 1. 确定 change 名称

- 用户已给名称 → 直接使用
- 未给 → 询问"要构建/修复什么？"→ 从描述派生 kebab-case 名称（如 "add user auth" → `add-user-auth`）
- 同名 change 已存在 → 询问用户：继续该 change 还是新建

### 2. 读取 01~04 产出

- `business-requirements.md` + `interview-notes.md`（01）
- `tech-design.md` + `architecture-decisions.md`（02）
- `story-list.md` + Story 卡片（03）
- `.feature` 文件（04，如存在）

### 3. 创建 change 目录

```
.aixcoding/workspace/changes/<name>/
└── specs/
```

### 4. 生成 proposal.md（What & Why）

- 业务背景与目标
- 变更范围（含非目标：明确"不做什么"）
- 关键用户场景

### 5. 生成 design.md（How）

- 技术方案摘要（架构决策、API/数据模型变更要点）
- 与 02-tech-design 的映射（不做二次设计，只做 change 级收窄）

### 6. 生成 specs/（delta specs）

从 03 Story AC + 04 .feature 汇总为 delta spec，采用标准段格式（供 aixcoding-sync-specs / aixcoding-archive 使用）：

- `## ADDED Requirements` / `## MODIFIED Requirements` / `## REMOVED Requirements` / `## RENAMED Requirements`

### 7. 校验

- 所有文件已写入且非空
- change 目录结构完整
- 与 01~04 产出一致（Story 无遗漏）

## Output

```
.aixcoding/workspace/changes/<name>/
├── proposal.md
├── design.md
└── specs/          # delta specs
```

## Guardrails

- 不重复设计：design.md 引用 02 的 tech-design 做收窄，而非重新设计
- delta specs 必须覆盖全部 Story（对照 03 story-list）
- 同名 change 不静默覆盖，先询问
- 每写一个文件立即校验存在性，再进入下一个

## 使用

由 `/aixcoding-plan <change-name>` 自动调用；也可单独 `/aixcoding-propose <name>`。
