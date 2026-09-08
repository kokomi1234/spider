---
name: aixcoding-check
description: '验收+仪表盘+追溯+上下文校验。对照PRD DoD逐项审查(✅🟡❌)，一键查看全局状态。只读。'
---

# AIxCoding Check — 验收 + 仪表盘 + 追溯

## 整合

| 原步骤 | 集成方式 |
|--------|----------|
| asdm-harness-verify | PRD DoD 逐项验收 |
| asdm-context-validate | 上下文与代码一致性校验 |
| dashboard(新) | 全局状态、覆盖率、同步率 |
| trace(新) | 全链路正向+逆向追溯 |
| impact(新) | 源码变更影响分析 |

## Input

| 输入项 | 来源 | 必填 |
|--------|------|:--:|
| Feature/Story ID/源码路径 | 用户 | 否 |
| workspace/ 全量 | init → build 产出 | 自动 |
| PRD + Plan | discover + plan | 验收模式 |
| contexts/ | init | 上下文校验 |

## 四种模式

### 模式 A: 仪表盘（无参数）

```markdown
📊 AIxCoding Dashboard — 2026-07-03

| Feature | Story | .feature | 覆盖率 | 同步率 | 验收 |
|:------:|:-----:|:--------:|:----:|:----:|:----:|
| E1 | 7 | 7 | 100% | 60% ⚠️ | 4/7 |

需关注:
  ❌ E1-S04: .feature缺失 → /aixcoding-specify E1-S04
```

### 模式 B: 验收报告（Feature ID）

对照 PRD DoD 逐项审查，生成结构化验收报告：

```markdown
## 验收概览
| 总验收项 | ✅ 通过 | 🟡 部分 | ❌ 未实现 |
|:------:|:-----:|:-----:|:------:|
| 12 | 10 | 1 | 1 |

## DoD 逐项检查
| # | 验收条件 | 状态 | 实际情况 | 源码位置 |
|---|---------|:--:|------|------|
| 1 | 团队名称必填且唯一 | ✅ | @NotBlank + unique约束 | TeamSpaceRequest.java:12 |
| 2 | 描述选填≤1000字符 | 🟡 | 后端已加，前端未限制 | CreateForm.vue:34 |
| 3 | 离开需二次确认 | ❌ | 未实现 | — |

## 关键缺失
| 影响 | 说明 |
|------|------|
| 高 | 离开确认会导致用户误操作 |

## 改进建议（按优先级）
1. [P0] 实现离开确认对话框
2. [P1] 前端描述字段添加 maxlength
```

### 模式 C: 全链路追溯（任意 ID）

- 正向：Feature → Story → AC → Scenario → .feature → 源码
- 逆向：源码路径 → 影响哪些 Story/AC → 建议的修复命令

### 模式 D: 上下文校验

检查 `.aixcoding/contexts/` 与代码一致性，标记过时文件。

## Guardrails

- 只读，不修改任何文件
- 每个问题附带可执行修复命令
- 影响分析给出具体的修复命令

## 使用

```
/aixcoding-check              # 全量仪表盘
/aixcoding-check E1           # E1 验收报告
/aixcoding-check E1-S01       # 追溯
/aixcoding-check TeamSpace.java --impact
/aixcoding-check --drift --detail
```
