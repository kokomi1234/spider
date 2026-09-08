# ASDM Action: User Story Develop

> **🔗 前置依赖**：本 action 的输入依赖于 **US 级 Plan 文档**（`FT-{id}-{name}-US-{序号}-{us名字}-Plan.md`），即 `/asdm-harness-us-plan` 产出的实施计划。Plan 中的任务顺序和验证步骤（含 AC 追溯）是开发实施的直接指引。

## Metadata

```json
{
   "name": "asdm-harness-us-develop",
   "displayName": "US 级开发实施",
   "description": "基于 US 级 Plan 文档按序执行开发任务，严格遵循 实现→验证→修复→人工确认 闭环，任务完成后回写 User Story 卡片状态并同步 story-list.md",
   "toolset": {
      "id": "asdm-harness-toolset",
      "name": "ASDM 驾驭工程工具集",
      "version": "0.0.1"
   },
   "scenario": "user-story-develop"
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
| L2 按需 | `standard-coding-style.md` | 编码规范 |
| L2 按需 | `architecture.md` | 确认任务涉及的服务和模块边界 |
| Source | US 卡片（用户故事 + AC + 技术依据小节） | 实现上下文的**首选来源** |
| Source | PRD + CodeResearch（条件性） | 技术依据缺失/不足时的兜底来源 |
| Source | `FT-{id}-{name}-DesignSpec.md`（可选） | UI 相关任务时复核字段/交互/状态提示细节 |

**IMPORTANT**：在开始编码之前必须先读取 `../../../.asdm/contexts/index.md`。严格按 Plan 描述实现，遵循 standard-coding-style.md 编码规范。

## Description

基于 US 级 Plan 文档驱动开发实施——Agent 读取该 User Story 的实施计划，按任务顺序引导用户逐个完成。每个任务严格遵循 **实现→验证→修复→人工确认** 的四阶段闭环，与 `/asdm-harness-develop`（Feature 级）共用同一套闭环机制（详见 [develop-spec.md](../specs/develop-spec.md)），核心差异在于：

| 维度 | Feature 级 develop | US 级 develop（本 action） |
|------|---------------------|------------------------------|
| 定位 Plan 文档 | 目录下唯一的 `FT-{id}-{name}-Plan.md` | 需按 US 标识在同目录多份 Plan 中精确匹配 |
| 进度展示 | 按 Phase 分组 | 扁平任务列表，无 Phase 层 |
| 实现阶段上下文 | 优先读 PRD + CodeResearch | 优先读 US 卡片技术依据，缺失才回退 PRD |
| 验证结果展示 | 仅展示通过/失败 | 额外标注对应 AC |
| 任务全部完成后 | 提示可进入 `/asdm-harness-testplan` | 回写 US 卡片状态 + 同步 story-list.md + 跨 US 完成判定 |

> **⚠️ 前置条件**：使用本 action 前，**必须先通过 `/asdm-harness-us-plan` 完成该 User Story 的实施计划**。如 Plan 文档不存在，将终止执行。

## Usage

```text
/asdm-harness-us-develop <FT-XXX 编码> <US-XX 编号>
```

## Process

### 0. 入口与定位

1. **解析输入**：提取 FT-XXX 编码与 US-XX 编号
2. **定位特性目录**：`../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/`
3. **精确匹配 US 级 Plan 文档**：在该目录下查找 `FT-{id}-{name}-US-{序号}-*-Plan.md`
   - **匹配到唯一文件** → 继续
   - **匹配到 0 个文件** → 终止：

    ```text
    ❌ 前置条件不满足：未找到 US-{序号} 对应的实施计划文档。

    请先执行 /asdm-harness-us-plan FT-{id} US-{序号} 完成开发任务拆解。
    ```

   - **匹配到多个文件**（异常情况，如命名冲突）→ 终止，列出所有匹配项供用户手动指定：

    ```text
    ⚠️ 找到多个匹配 US-{序号} 的 Plan 文档，请确认具体路径：

    1. FT-{id}-{name}-US-{序号}-方案A-Plan.md
    2. FT-{id}-{name}-US-{序号}-方案B-Plan.md
    ```

4. **定位并读取对应 develop-log.json**：同目录下 `FT-{id}-{name}-US-{序号}-{us名字}-develop-log.json`
   - 格式严格遵循 **[develop-log.json](../specs/develop-log.json)** 规范，`scope` 字段应为 `"user_story"`
   - **存在** → 读取进度，定位当前任务
   - **不存在**（异常兜底）→ 从 Plan 初始化，`scope` 设为 `"user_story"`，并补全 `us_id`/`us_card_path`/`story_list_path` 三个字段（从 Plan 文档头部的关联信息中提取；如 Plan 中未记录，回退到扫描 US 卡片目录匹配同一 `us_id`）

---

### 1. 任务定位与展示

读取 US 级 Plan 文档和 develop-log.json，定位下一个待执行任务：

1. 从 develop-log.json 读 `current_task`
2. 若已完成 → 自动切换至下一个 `pending` 任务
3. **依赖检查**：同 Feature 级逻辑，检查 `depends_on` 列表，未满足则不允许执行并提示
4. **展示当前状态**（扁平列表，无 Phase 分组）：

    ```text
    📊 开发进度 — FT-{id} {特性名称} / {us-id} {US 名称}

    ✅ 1 {任务名} — 已完成
    ⏳ 2 {任务名} — 待执行       ← 当前
    🔲 3 {任务名} — 待执行
    🔲 4 {任务名} — 待执行

    📌 当前任务: 2 {任务名}
    📋 剩余任务: N 个
    ```

5. 若所有任务 `completed` → 进入 Step 7 完成流程

---

### 2. 用户确认

```text
📌 即将执行: 任务 2 {任务名}

   核心逻辑: {从 Plan 文档提取}
   交付物: {从 Plan 文档提取}
   验证步骤: N 条（对应 AC: AC-1, AC-2）

是否开始？(输入 "开始" / "继续" 确认)
```

用户确认后进入实现阶段。**未确认不得开始实现。**

---

### 3. 阶段一：实现 (Implement)

1. **加载上下文（优先级与 Feature 级不同）**：
   - **首选**：读取 US 卡片（用户故事 + AC + 技术依据小节），作为本任务实现的主要依据
   - **兜底**：技术依据小节缺失，或当前任务所需信息超出技术依据小节覆盖范围时，读取 `FT-{id}-{name}-PRD.md` 相关章节补充；若 develop-log.json 中记录了 Step 0 生成时的 PRD 版本，实现前建议核对是否已过期
   - 读取相关 `CodeResearch-*.md`（如有）
   - 读取 `../../../.asdm/contexts/index.md` 了解项目结构
   - **若当前任务涉及 UI**：读取 `FT-{id}-{name}-DesignSpec.md`（如存在）

2. **编码实现**：基于 Plan 中该任务的描述，直接在项目代码库中编写/修改代码，完成后报告改动摘要

3. **更新状态（双文件同步）**：
   - develop-log.json：`in_progress` → `implemented`
   - US 级 Plan.md：进度概要表中对应任务 `⏳` → `🔄`

---

### 4. 阶段二：验证 (Verify)

严格按 US 级 Plan 文档中该任务的验证步骤逐条执行：

1. 逐条执行验证步骤 (checkbox 列表项），每步记录通过/失败结果
2. 展示验证结果时**与AC相关联时，附带 AC 标注**：

    ```text
    🔍 验证结果 — 任务 2.1

    ✅ V2.1.1 编译通过 → BUILD SUCCESS
    ✅ V2.1.2 单元测试通过 → 12/12 passed
    ❌ V2.1.3 API 响应格式 → 预期 {"code":200} 实际 {"status":"ok"}
    ✅ V2.1.4 数据库写入 → 记录已写入
    ✅ V2.1.5 邮箱格式校验 → 通过（对应 AC-2）
    ✅ V2.1.6 验证链接生成 → 通过（对应 AC-2）
    ❌ V2.1.7 过期链接提示文案 → 预期"已过期"实际返回空文案（对应 AC-3）

    通过: 5/7  失败: 2/7
    ```

3. **标注 Plan.md 验证步骤**：对 Plan.md 中该任务的每条验证步骤，将 `- [ ]` 更新为 `- [x]`，并在描述末尾追加 `✅` 或 `❌` 状态标记。
   > ⚠️ **验证步骤的 checkbox 和状态标记必须写回 Plan.md**，确保文档持久化记录每一步的通过/失败结果。

4. 全部通过 → `implemented` → `verified`，进入人工确认
5. 有任何失败 → `fixing`，进入修复阶段

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

1. **更新 US 级 Plan 文档**：进度概要表中对应任务 `⏳` → `✅`
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

   (F) **US 级专属字段检查**：

   ```python
   if log.get('scope') == 'user_story':
       for field in ('us_id', 'us_card_path', 'story_list_path'):
           assert field in log, f"scope=user_story 时顶层缺少必填字段: {field}"
   ```

4. **若本次是该 US 的最后一个任务（全部任务 completed）**，额外执行 **US 级完成联动**（详见 [develop-spec.md](../specs/develop-spec.md)「US 级完成判定与状态回写」一节）：

   a. **回写 US 卡片状态**：读取 `us_card_path` 指向的卡片，将「状态」字段更新为「已完成」

   b. **同步 story-list.md**：读取 `story_list_path`，更新该 US 对应行的状态列为「已完成」

   c. **跨 US 完成判定**：读取 story-list.md 中该 Feature 下全部 US 的状态列
   - **仍有未完成的 US** → 提示：

     ```text
     ✅ US-{序号} {US 名称} 开发完成！

     📊 该 Feature 下 User Story 进度：M/N 已完成

     ⚠️ 请创建新的 Agent 会话，执行 /asdm-harness-us-plan FT-{id} US-{下一个序号}
     为下一条 User Story 生成实施计划。
     ```

   - **全部 US 均已完成** → 提示：

     ```text
     🎉 该 Feature 下所有 User Story（共 N 条）均已完成开发！

     👉 可执行 /asdm-harness-testplan FT-{id} 进入测试验证阶段。
     ```

   > ⚠️ 单条 US 完成 ≠ Feature 验收完成。本 action 不写入 `feature_status`/`review_*` 系列字段，这些字段仍只由 Feature 级流程或验收环节维护。

5. **常规单任务完成提示**（未到最后一个任务时）：

    ```text
    ✅ 任务 2 已完成！

    📄 US 级 Plan 文档已更新
    📊 进度: 2/5 任务完成，剩余 3 个

    ⚠️ 请创建新的 Agent 会话（清空上下文），
    在新会话中执行 /asdm-harness-us-develop FT-{id} US-{序号} 继续下一个任务。

    下一个任务: 3 {任务名}
    ```

---

## Purpose

- 基于 US 级 Plan 文档按依赖顺序执行开发任务
- 保证每个任务经过 实现→验证→修复→人工确认 完整闭环
- 验证结果与 AC 强关联，便于追溯验收标准的落实情况
- US 全部任务完成后自动回写卡片状态与 story-list.md，维持"按 US 交付"的可追踪性
- 每个任务完成后强制上下文刷新，保持 Agent 高效

## Input

- 特性编码 FT-XXX + User Story 编号 US-XX
- US 级 Plan 文档（自动读取）
- US 卡片（自动读取，实现阶段首选上下文来源）
- PRD 文档和 CodeResearch（按需/兜底读取）
- DesignSpec 文档（可选，UI 相关任务时读取，来自 `/asdm-harness-design-parse`）
- develop-log.json（自动读取/创建，`scope=user_story`）

## Output

### 单任务完成

```json
{
   "scope": "user_story",
   "feature_id": "FT-XXX",
   "us_id": "F-XXX-US-01",
   "task_id": "2",
   "task_name": "任务名",
   "status": "completed",
   "summary": {
      "files_changed": 3,
      "verification_passed": "3/3",
      "ac_covered": ["AC-1", "AC-2"],
      "fix_attempts": 0
   },
   "progress": "2/5",
   "next_task": "3",
   "next_task_name": "下一个任务名",
   "session_switch_required": true,
   "timestamp": "ISO 8601 datetime"
}
```

### US 全部完成

```json
{
   "scope": "user_story",
   "feature_id": "FT-XXX",
   "us_id": "F-XXX-US-01",
   "status": "us_completed",
   "total_tasks": 5,
   "completed_tasks": 5,
   "feature_us_progress": "2/6",
   "all_us_completed": false,
   "next_steps": [
      "执行 /asdm-harness-us-plan FT-XXX US-02 为下一条 User Story 生成计划"
   ],
   "timestamp": "ISO 8601 datetime"
}
```

### Feature 下全部 US 完成（触发测试阶段）

```json
{
   "scope": "user_story",
   "feature_id": "FT-XXX",
   "status": "all_us_completed",
   "total_user_stories": 6,
   "completed_user_stories": 6,
   "next_steps": [
      "执行 /asdm-harness-testplan FT-XXX 进入测试验证"
   ],
   "timestamp": "ISO 8601 datetime"
}
```

## Downstream Flow

```text
/asdm-harness-us-plan           ← 上一步：US 级实施计划
        │
        ▼
/asdm-harness-us-develop        ← 当前步骤：US 级开发实施
        │
        ▼
（循环执行下一条 US，直至该 Feature 下所有 US 完成）
        │
        ▼
/asdm-harness-testplan           ← 下一步：测试验证（全部 US 完成后）
```

## Spec Reference

- [develop-spec.md](../specs/develop-spec.md) — 开发实施流程规范与状态管理（含「US 级完成判定与状态回写」一节）
- [develop-log.json](../specs/develop-log.json) — develop-log.json 数据结构规范（含 scope=user_story 相关字段）
- [plan-spec.md](../specs/plan-spec.md) — Plan 文档结构规范（含「US 级 Plan 文档结构」一节）
- User Story 卡片规范（来自 `asdm-feature-split` 工具集）— US 卡片状态字段定义，本 action 完成后回写的目标结构
