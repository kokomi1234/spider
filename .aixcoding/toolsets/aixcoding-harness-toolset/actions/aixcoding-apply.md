---
name: aixcoding-apply
description: '逐任务实现 change：实现→验证→修复(≤3轮)→确认 四阶段闭环，更新 tasks.md + develop-log.json。由 06-aixcoding-build 默认模式调用。'
---

# aixcoding Apply — 逐任务实现

从 change 的 tasks.md 逐任务实现源码，四阶段闭环：实现 → 验证 → 修复 → 确认。

## 整合

| 原步骤 | 集成方式 |
|--------|----------|
| openspec-apply-change | 去除 CLI 依赖，直接读取 `.aixcoding/workspace/changes/<name>/` 工件 |

## Input

| 输入项 | 来源 | 必填 | 说明 |
|--------|------|:--:|------|
| Change 名称 | 用户/上下文 | ⚠️ | 省略时从上下文推断，多义则列出让用户选 |
| tasks.md | 05 `.aixcoding/workspace/changes/<name>/` | ✅ | 任务清单 + checkbox 验证步骤 |
| develop-log.json | 05 初始化 | ✅ | 进度追踪 |
| proposal / design / specs | 05 | ✅ | 实现依据 |

## Workflow

### 1. 确定 change

- 已提供名称 → 使用
- 省略 → 从对话上下文推断；存在多个活跃 change 或无法判断 → 列出 `.aixcoding/workspace/changes/` 让用户选择
- 声明：`Using change: <name>`

### 2. 读取工件

- `proposal.md` / `design.md` / `specs/`：实现依据
- `tasks.md`：任务清单，统计 `- [ ]` vs `- [x]`
- `develop-log.json`：各任务当前状态

### 3. 展示进度

```
进度: N/M 任务完成
剩余任务概述 + 当前任务说明
```

### 4. 逐任务四阶段闭环

对每个未完成任务：

| 阶段 | 动作 |
|------|------|
| 实现 | 按任务改代码，改动最小且聚焦；对照 specs/ 中对应 AC |
| 验证 | 执行 tasks.md 中的 checkbox 验证步骤（编译/测试/手动验证） |
| 修复 | 验证失败 → 修复，**最多 3 轮**；仍失败 → 暂停上报 |
| 确认 | 更新 tasks.md `- [ ]` → `- [x]`；更新 develop-log.json（status: completed、时间、产出文件） |

### 5. 暂停条件

- 任务不清晰 → 追问澄清
- 实现暴露设计问题 → 建议回 02-design / 05-plan 更新工件
- 错误或阻塞 → 报告并等待指导
- 用户打断

## Output

```
## Implementing: <change-name>

Working on task 3/7: <task description>
[...实现过程...]
✓ Task complete

## Implementation Complete
Progress: 7/7 tasks complete ✓
All tasks complete! Ready to archive this change. (/09-aixcoding-done)
```

## Guardrails

- 逐任务推进直到完成或阻塞
- 实现前必读 proposal/design/specs
- 任务不清晰先暂停询问，不猜测
- 每完成一个任务立即更新 checkbox 与 develop-log
- 修复轮数上限 3 轮，避免死循环

## 使用

由 `/06-aixcoding-build` 默认模式调用；也可单独 `/aixcoding-apply <name>`。
