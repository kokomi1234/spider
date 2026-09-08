---
name: aixcoding-done
description: '归档change：前置检查→DoD逐项验收(✅🟡❌)→上下文校验→移动archive。'
isToolset: true
---

# AIxCoding Done — 归档

## 整合

| 原步骤 | 集成方式 |
|--------|----------|
| aixcoding-archive | 检查完成→同步specs→归档 |
| asdm-harness-verify | PRD DoD 逐项验收 |
| asdm-context-validate | 上下文与代码一致性 |

## 前置条件

- build 全部任务 completed
- 建议先 check

## Input

| 输入项 | 来源 | 必填 |
|--------|------|:--:|
| Change 名称 | 用户(可选) | 否 |
| tasks.md | plan | 自动 |
| develop-log.json | build | 自动 |
| PRD | discover | 自动 |
| 验收报告 | check | 自动 |

## Workflow

### 1. 前置检查

- 所有 artifact 状态 `done`
- tasks.md 全部 `- [x]`
- develop-log.json 全部 `completed`
- 任一不满足 → **阻止归档**，展示未完成清单

### 2. DoD 逐项验收

对照 design 的 DoD 和 discover 的 PRD 逐项审查：

```markdown
## 验收概览
| 总验收项 | ✅ 通过 | 🟡 部分 | ❌ 未实现 |
|:------:|:-----:|:-----:|:------:|
| 12 | 10 | 1 | 1 |

## 逐项详情
| # | DoD | 状态 | 实际情况 | 源码 |
|---|-----|:--:|------|------|
| 1 | ... | ✅ | ... | ... |
```

- ❌ 未实现项 → 警告但可继续（用户确认后）
- 关键缺失影响分析

### 3. 上下文校验

检查 `.aixcoding/contexts/` 与最终代码一致性，标记过时文件。

### 4. 同步 specs + 归档

```bash
aixcoding archive "<name>"
```
- 同步 delta specs → 主 specs
- **合并收集归档**：整体移动 `changes/<name>/` + 复制顶层 `stories/design/discovery/specs/<feature>/` 到 archive

### 5. 完整性校验 + 删除顶层残留

- 对每个归档来源 `diff -rq <源> <archive 对应目录>`：要求无差异；有差异 → 先补齐 archive，**阻止删除源**
- 校验通过后删除已归档的顶层残留：`stories/<feature>/`、`design/<feature>/`、`discovery/<feature>/`、`specs/<feature>/`
- 删除后复查：顶层不再残留 stories/design/discovery/specs（archive 是唯一完整副本）

## Output

```
.aixcoding/workspace/archive/YYYY-MM-DD-<name>/
├── proposal.md / design.md / specs/ / tasks.md
└── 验收概览（✅/🟡/❌）

顶层残留已删除 ✓：stories/design/discovery/specs 不再保留副本
```

## Guardrails

- 未完成 tasks/develop-log → 阻止归档
- DoD 未实现 → 警告但可继续（用户确认）
- 上下文过时 → 提示更新
- 删除顶层残留前必须通过完整性校验（diff 无差异），校验失败 → 阻止删除、先补齐 archive
- 归档后复查无顶层 stories/design/discovery/specs 残留（避免数据重复）

## 使用

`/aixcoding-done [change-name]`
