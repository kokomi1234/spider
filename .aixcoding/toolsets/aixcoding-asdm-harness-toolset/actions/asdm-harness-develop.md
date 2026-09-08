# ASDM Action: Feature Develop

> **🔗 前置依赖**：本 action 的输入依赖于 **Plan 文档**（`FT-{id}-{name}-Plan.md`），即 `/asdm-harness-plan` 产出的实施计划。Plan 中的 Phase 划分、任务顺序和验证步骤是开发实施的直接指引。

## Metadata

```json
{
  "name": "asdm-harness-develop",
  "displayName": "开发实施",
  "description": "基于 Plan 文档按序执行开发任务，严格遵循 实现→验证→修复→人工确认 闭环，逐任务推进并记录进度",
  "toolset": {
    "id": "asdm-harness-toolset",
    "name": "ASDM 驾驭工程工具集",
    "version": "0.0.1"
  },
  "scenario": "feature-develop"
}
```

## Language Setting

默认使用**中文（简体中文）**作为输出语言。

## Context Injection

使用 [context-loader](../../../.asdm/skills/context-loader/SKILL.md) 技能进行渐进式上下文加载。

### 本 Action 的加载策略

| Phase | Context | 用途 |
|:-----:|---------|------|
| L1 必读 | `index.md` | 建立项目全局认知 |
| L2 按需 | `standard-coding-style.md` | 编码规范，确保生成代码符合项目约定 |
| L2 按需 | `architecture.md` | 确认任务涉及的服务和模块边界 |
| Source | PRD + CodeResearch + 当前任务源码 | 功能上下文 + 仅加载与任务直接相关的文件 |
| Source | `FT-{id}-{name}-DesignSpec.md`（可选，来自 `/asdm-harness-design-parse`） | UI 视觉结构规格，实现 UI 相关任务时复核字段/交互/状态提示细节 |

**IMPORTANT**: 在开始编码之前必须先读取 `../../../.asdm/contexts/index.md`。严格按 Plan 描述实现，遵循 standard-coding-style.md 编码规范。

## Description

基于 Plan 文档驱动开发实施——Agent 读取实施计划，按任务依赖顺序引导用户逐个完成。每个任务严格遵循 **实现→验证→修复→人工确认** 的四阶段闭环：验证失败或人工确认不通过，不允许标记为完成。每个任务完成后提示用户开启新会话继续。

> **⚠️ 前置条件**：使用本 action 前，**必须先通过 `/asdm-harness-plan` 完成实施计划**，生成对应的 Plan 文档。如该文件不存在，将终止执行。

## Usage

```text
/asdm-harness-develop <FT-XXX 编码 | 特性名称 | Plan 路径>
```

## Process

### 0. 入口与定位

1. **解析输入**：提取 FT-XXX 编码或搜索特性目录
2. **定位 Plan 文档**：`../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-Plan.md`
3. **Plan 不存在** → 终止：

    ```text
    ❌ 前置条件不满足：未找到实施计划文档。

    请先执行 /asdm-harness-plan FT-{id} 完成开发任务拆解。
    ```

4. **读取/初始化开发进度**：
   - `develop-log.json` 正常由 `/asdm-harness-plan` 创建，格式严格遵循 **[develop-log.json](../specs/develop-log.json)** 规范。每个任务必须包含 `phase`、`phase_name`、`depends_on`、`status`、`history` 字段
   - Plan 文档标题下方应包含指向 `develop-log.json` 的引用链接（格式：`📋 开发进度：[develop-log.json](./develop-log.json)`）
   - 检查文件是否存在 → 存在则读取进度，定位当前任务
   - 不存在（异常兜底）→ 从 Plan 初始化，所有任务设 `pending`，并补充 `depends_on` 信息。初始化格式必须符合 **[develop-log.json](../specs/develop-log.json)** 规范

---

### 1. 任务定位与展示

读取 Plan 文档和 `develop-log.json`，定位下一个待执行任务：

1. 从 `develop-log.json` 读 `current_task`
2. 若 `current_task` 已完成 → 自动切换至下一个 `pending` 任务
3. **依赖检查**：定位到待执行任务后，检查该任务的 `depends_on` 列表：
   - 若存在未完成的依赖任务 → 不允许执行，提示：

    ```text
    ⛔ 任务 {P}.{T} 依赖未满足，无法执行。

    依赖任务:
    ❌ {dep1-id} {dep1-name} — 未完成
    ✅ {dep2-id} {dep2-name} — 已完成

    请先完成所有依赖任务后再执行当前任务。
    ```

   - 若全部依赖已完成 → 继续展示当前状态

4. 展示当前状态：

    ```text
    📊 开发进度 — FT-{id} {特性名称}

    Phase 1: {名称}
    ✅ 1.1 {任务名} — 已完成
    ⏳ 1.2 {任务名} — 待执行       ← 当前
    🔲 1.3 {任务名} — 待执行

    Phase 2: {名称}
    🔲 2.1 {任务名} — 待执行
    ...

    📌 当前任务: 1.2 {任务名}
    📋 剩余任务: N 个
    ```

5. 若所有任务 `completed` → 报告开发完成，退出：

    ```text
    🎉 特性 FT-{id} 全部开发任务已完成！

    可执行 /asdm-harness-testplan FT-{id} 进入测试验证阶段。
    ```

---

### 2. 用户确认

展示当前任务的详细信息后，等待用户确认：

```text
📌 即将执行: 任务 1.2 {任务名}

   核心逻辑: {从 Plan 文档提取}
   交付物: {从 Plan 文档提取}
   验证步骤: N 条

是否开始？(输入 "开始" / "继续" 确认)
```

用户确认后进入实现阶段。**未确认不得开始实现。**

---

### 3. 阶段一：实现 (Implement)

1. **加载上下文**：
   - 读取 `FT-{id}-{name}-PRD.md` 获取功能设计
   - 读取相关 `CodeResearch-*.md` 获取技术上下文
   - 读取 `../../../.asdm/contexts/index.md` 了解项目结构
   - **若当前任务涉及 UI**：读取 `FT-{id}-{name}-DesignSpec.md`（如存在）复核字段清单、交互元素、状态提示等视觉结构细节；若 DesignSpec 不存在但 `design/` 目录有图片，提示用户可先执行 `/asdm-harness-design-parse`

2. **编码实现**：
   - 基于 Plan 中该任务的「核心逻辑」/「部署要求」/「工程属性」等描述
   - 直接在项目代码库中编写/修改代码
   - 完成后报告改动摘要

3. **更新状态（双文件同步）**：
   - `develop-log.json`：`in_progress` → `implemented`
   - `Plan.md`：进度概要表中对应任务 `⏳` → `🔄`（表示实施中）
   > ⚠️ **每次状态变更必须同步更新 develop-log.json 和 Plan.md 两个文件**

---

### 4. 阶段二：验证 (Verify)

严格按 Plan 文档中该任务的**验证步骤**逐条执行：

1. 逐条执行验证步骤（checkbox 列表项）
2. 每步记录通过/失败结果
3. 展示验证结果：

    ```text
    🔍 验证结果 — 任务 1.2

    ✅ V1.2.1 编译通过 → BUILD SUCCESS
    ✅ V1.2.2 单元测试通过 → 12/12 passed
    ❌ V1.2.3 API 响应格式 → 预期 {"code":200} 实际 {"status":"ok"}
    ✅ V1.2.4 数据库写入 → 记录已写入
    ...

    通过: 3/4  失败: 1/4
    ```

4. **标注 Plan.md 验证步骤**：对 Plan.md 中该任务的每条验证步骤，将 `- [ ]` 更新为 `- [x]`，并在描述末尾追加 `✅` 或 `❌` 状态标记。
   > ⚠️ **验证步骤的 checkbox 和状态标记必须写回 Plan.md**，确保文档持久化记录每一步的通过/失败结果。

5. 全部通过 → `implemented` → `verified`，进入人工确认
6. 有任何失败 → `fixing`，进入修复阶段

---

### 5. 阶段三：修复 (Fix)

验证失败时进入此阶段：

1. 分析失败原因，定位根因
2. 修复代码
3. 更新状态：`fixing` → `verifying`，重新进入验证阶段

> **限制**：同一任务连续修复达到 3 次后仍失败 → 标记 `blocked`，向用户报告阻塞：

```text
⛔ 任务 1.2 进入阻塞状态

   连续修复 3 次后仍未通过验证，失败项：
   - V1.2.3: API 响应格式不一致

   建议：人工介入检查代码逻辑或调整验证预期。
   阻塞原因和上下文已记录在 develop-log.json 中。
```

---

### 6. 阶段四：人工确认 (Human Confirm)

验证全部通过后，进入人工确认：

```text
✅ 任务 1.2 验证全部通过 (4/4)

   实现摘要: {改动了哪些文件，新增了什么功能}
   验证摘要: 4 条验证步骤全部通过

👉 请确认此任务完成（输入 "通过" / "确认" 进入下一任务，或输入 "拒绝" 返回修复）
```

**必须等待用户明确确认**。不允许自动标定完成状态。

- 用户确认 `approved` → `human_confirming` → `completed`
- 用户否决 `rejected` → `fixing`，返回修复阶段

---

### 7. 完成与切换

任务 `completed` 后：

1. **更新 Plan 文档**：进度概要表中对应任务 `⏳` → `✅`
2. **更新 develop-log.json**：记录完成时间，切换到下一任务
3. **格式一致性检查**：更新后校验 `develop-log.json` 是否符合 **[develop-log.json](../specs/develop-log.json)** 格式规范：

   (A) **顶层字段检查** — 必填字段存在且类型正确：
   ```python
   import json
   log = json.load(open('develop-log.json'))

   # 必填字段及类型
   required_top = {
       'feature_id': str, 'feature_name': str, 'plan_path': str,
       'base_commit': str, 'current_phase': int, 'current_task': str,
       'tasks': dict, 'last_updated': str
   }
   for field, typ in required_top.items():
       assert field in log, f"顶层缺少必填字段: {field}"
       assert isinstance(log[field], typ), f"顶层字段 {field} 类型应为 {typ.__name__}"
   ```

   (B) **任务条目检查** — 每个 task 的必填字段及类型：
   ```python
   for tid, task in log['tasks'].items():
       # 必填字段
       assert isinstance(task['name'], str), f"{tid}: name 应为 string"
       assert isinstance(task['phase'], int), f"{tid}: phase 应为 int"
       assert isinstance(task['phase_name'], str), f"{tid}: phase_name 应为 string"
       assert isinstance(task['depends_on'], list), f"{tid}: depends_on 应为 array"
       assert isinstance(task['status'], str), f"{tid}: status 应为 string"
       assert isinstance(task['history'], list), f"{tid}: history 应为 array"
   ```

   (C) **status 枚举校验** — 所有任务状态值必须在合法枚举内：
   ```python
   VALID_STATUSES = {
       'pending', 'in_progress', 'implemented', 'verifying',
       'verified', 'fixing', 'human_confirming', 'completed',
       'rejected', 'blocked'
   }
   for tid, task in log['tasks'].items():
       assert task['status'] in VALID_STATUSES, f"{tid}: 非法 status '{task['status']}'"
   ```

   (D) **status 与 history 一致性** — `status` 必须等于最后一条 history 的 `to` 值：
   ```python
   for tid, task in log['tasks'].items():
       if task['history']:
           last_to = task['history'][-1]['to']
           assert task['status'] == last_to, \
               f"{tid}: status='{task['status']}' 但最后一条 history.to='{last_to}'"
   ```

   (E) **history 条目检查** — 每条记录 `timestamp/from/to/reason` 齐全：
   ```python
   from datetime import datetime
   for tid, task in log['tasks'].items():
       for i, entry in enumerate(task['history']):
           assert isinstance(entry['timestamp'], str), f"{tid}.history[{i}]: timestamp 缺失"
           assert isinstance(entry['from'], str), f"{tid}.history[{i}]: from 缺失"
           assert isinstance(entry['to'], str), f"{tid}.history[{i}]: to 缺失"
           assert isinstance(entry['reason'], str), f"{tid}.history[{i}]: reason 缺失"
           # ISO 8601 时间戳格式
           try:
               datetime.fromisoformat(entry['timestamp'])
           except:
               raise AssertionError(f"{tid}.history[{i}]: timestamp 非 ISO 8601 格式")
   ```

   > ⚠️ **若任一检查失败** → 输出具体不一致项并自动修复，修复后重新校验直到全部通过。格式检查必须在完成提示之前通过。

4. **输出完成提示**：

    ```text
    ✅ 任务 1.2 已完成！

    📄 Plan 文档已更新
    📊 进度: 2/8 任务完成，剩余 6 个

    ⚠️ 请创建新的 Agent 会话（清空上下文），
    在新会话中执行 /asdm-harness-develop FT-{id} 继续下一个任务。

    下一个任务: 1.3 {任务名}
    ```

---

## Purpose

- 基于 Plan 文档按依赖顺序执行开发任务
- 保证每个任务经过 实现→验证→修复→人工确认 完整闭环
- 通过进度文件持久化开发状态
- **每次状态变更同步更新 develop-log.json（进度记录）和 Plan.md（进度概要表 + 验证步骤标注）**
- 每个任务完成后强制上下文刷新，保持 Agent 高效

## Input

- 特性编码 FT-XXX / 特性名称 / Plan 路径
- Plan 文档（自动读取）
- PRD 文档和 CodeResearch（按需读取）
- DesignSpec 文档（可选，UI 相关任务时读取，来自 `/asdm-harness-design-parse`）
- `develop-log.json`（自动读取/创建）

## Output

### 单任务完成

```json
{
  "feature_id": "FT-XXX",
  "task_id": "1.2",
  "task_name": "任务名",
  "status": "completed",
  "summary": {
    "files_changed": 5,
    "verification_passed": "4/4",
    "fix_attempts": 1
  },
  "progress": "2/8",
  "next_task": "1.3",
  "next_task_name": "下一个任务名",
  "session_switch_required": true,
  "timestamp": "ISO 8601 datetime"
}
```

### 全部完成

```json
{
  "feature_id": "FT-XXX",
  "status": "all_completed",
  "total_tasks": 8,
  "completed_tasks": 8,
  "next_steps": [
    "执行 /asdm-harness-testplan FT-XXX 进入测试验证"
  ],
  "timestamp": "ISO 8601 datetime"
}
```

## Downstream Flow

```text
/asdm-harness-plan             ← 上一步：实施计划
        │
        ▼
/asdm-harness-develop          ← 当前步骤：开发实施
        │
        ▼
/asdm-harness-testplan          ← 下一步：测试验证
```

## Spec Reference

- [develop-spec.md](../specs/develop-spec.md) — 开发实施流程规范与状态管理
- [develop-log.json](../specs/develop-log.json) — develop-log.json 数据结构规范（字段定义、类型、约束、状态枚举）
