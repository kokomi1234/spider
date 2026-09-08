# ASDM Action: User Story Plan Breakdown

> **🔗 前置依赖**：本 action 的输入依赖于 **User Story 卡片**（`<feature-id>-US-{序号}-<story-name>.md`，由 `asdm-feature-split` 工具集的 `/asdm-us-split` 产出，经 `/asdm-us-evaluate`、`/asdm-us-rank` 处理后使用）。卡片中的用户故事、验收标准（AC）以及「技术依据」小节（如有）是任务拆解的直接输入来源。

## Metadata

```json
{
   "name": "asdm-harness-us-plan",
   "displayName": "US 级开发任务拆解",
   "description": "基于单条 User Story 卡片，将其拆解为可执行、可验证的细粒度任务清单，生成结构化的 US 级实施计划文档（Plan），任务粒度小于 Feature 级 Plan，验证步骤与 AC 强关联",
   "toolset": {
      "id": "asdm-harness-toolset",
      "name": "ASDM 驾驭工程工具集",
      "version": "0.0.1"
   },
   "scenario": "user-story-planning"
}
```

## Language Setting

默认使用**中文（简体中文）**作为输出语言。所有生成的内容均使用中文，并遵循中文写作规范。

## Context Injection

使用 [context-loader](../../../.asdm/skills/context-loader/SKILL.md) 技能进行渐进式上下文加载。

### 本 Action 的加载策略

| Phase | Context | 用途 |
|:-----:|---------|------|
| L1 必读 | `index.md` | 建立项目全局认知 |
| L2 按需 | `architecture.md` | 判断任务是否跨模块，辅助确定任务顺序 |
| L2 按需 | `standard-project-structure.md` | 定位任务代码路径 |
| Source | User Story 卡片 | 任务拆解核心输入（用户故事 / AC / 技术依据） |
| Source | PRD 文档（条件性） | 仅当卡片「技术依据」小节缺失或版本漂移时，回退读取原文兜底 |

**IMPORTANT**：在开始拆解之前必须先读取 `../../../.asdm/contexts/index.md`。任务的具体技术参数必须从 US 卡片的「技术依据」小节提取；该小节缺失或不足以支撑时，方可回退读取 PRD 原文，不得凭空编造。

## Description

读取已完成拆分与评估的 User Story 卡片（`<feature-id>-US-{序号}-<story-name>.md`），分析其用户故事、验收标准（AC）与技术依据，将其拆解为**可执行、可验证的细粒度任务清单**，生成 US 级实施计划文档（Plan）。

与 `/asdm-harness-plan`（Feature 级）的核心差异：

| 维度 | Feature 级 Plan | US 级 Plan（本 action） |
|------|------------------|--------------------------|
| 输入 | 完整 PRD 文档 | 单条 US 卡片（技术依据小节已按 US 过滤） |
| 组织结构 | Phase → 任务（两层） | 任务（单层，US 本身已是原子单元） |
| 验证步骤 | 拆解者自行设计验收命令 | 每条验证步骤须追溯到具体 AC |
| 前置条件 | PRD 文档必须存在 | US 卡片必须存在；PRD 仅条件性需要 |
| 完成后动作 | 更新 overall-plan.md 特性状态 | 额外初始化 US 级 develop-log.json，供 `/asdm-harness-us-develop` 消费 |

> **⚠️ 前置条件**：使用本 action 前，US 卡片必须已通过 `/asdm-us-split` 生成。建议（非强制）已经过 `/asdm-us-evaluate` 评估，避免对 INVEST 不达标的 story 做任务拆解。

## Usage

```text
/asdm-harness-us-plan <FT-XXX 编码> <US-XX 编号>
```

## Parameters

| 参数 | 必填 | 说明 |
| ------ | :----: | ------ |
| `feature_id` | ✅ | 特性编号，FT-XXX 格式 |
| `us_id` | ✅ | User Story 编号，格式 `<feature-id>-US-{两位序号}`，如 `F-001-US-01` |

## Process

### ⛔ 前置条件检查

1. **检查 Git 工作区状态**（同 Feature 级要求，US 级 develop-log.json 同样需要记录 `base_commit`）：

    ```bash
    git status --porcelain
    ```

   - **输出为空** → 继续。
   - **输出不为空** → 终止，提示先提交当前变更。

2. **检查 US 卡片是否存在**：
   - 路径：`../../../.asdm/workspace/features/<feature-id>-<feature-name>/user_stories/<feature-id>-US-{序号}-<story-name>.md`

   > 注意：该路径位于 `asdm-feature-split` 工具集的 workspace 下，与本 toolset（`asdm-harness`）目录结构不同，需按 `feature_id` 反查 Feature 目录名后拼接。

   - **仅检查文件存在性**，不检查卡片「状态」字段（草稿态也可执行本 action）。
   - **如不存在** → 终止，提示：

    ```text
    ❌ 前置条件不满足：未找到 User Story 卡片。

    预期路径: ../../../.asdm/workspace/features/<feature-id>-<feature-name>/user_stories/<us-id>-<story-name>.md

    请先执行 /asdm-us-split <feature-id> 完成 User Story 拆分。
    ```

3. **读取 US 卡片，判断「技术依据」小节情况**：
   - 卡片中存在「技术依据」小节 → 记录其「关联 PRD 章节」引用路径与摘录版本号，进入第 4 步做版本漂移检测
   - 卡片中不存在该小节 → 标记 `tech_basis_available = false`，进入第 5 步回退检查 PRD

4. **PRD 版本漂移检测**（仅当第 3 步存在技术依据小节时执行）：
   - 定位技术依据小节引用的 `FT-{id}-{name}-PRD.md`，读取其修订记录中的**当前版本号**
   - 与卡片中标注的「摘录自 PRD vX.X.X」比对：
      - **版本一致或 PRD 更旧** → 技术依据可直接使用，跳过第 5 步
      - **PRD 版本更新** → 提示：

         ```text
         ⚠️ 技术依据可能已过期
 
         US 卡片记录摘录版本：v1.1.0
         PRD 当前版本：v1.2.0
 
         建议核对 PRD 原文后再继续。是否仍使用卡片中的技术依据摘要？(继续 / 重新核对)
         ```

      - 用户选择"重新核对" → 回退读取 PRD 原文对应章节，以 PRD 最新内容为准生成任务
      - 用户选择"继续" → 使用卡片技术依据小节，任务拆解正常进行

5. **PRD 兜底检查**（仅当 `tech_basis_available = false` 时执行）：
   - 定位 `../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-PRD.md`
   - **存在** → 读取与本 US 相关的章节内容作为技术参考（不整篇读取，按用户故事关键词定位相关章节）
   - **不存在** → 不终止，提示：

    ```text
    ⏭️ 未找到技术依据小节，且未关联 PRD 文档。

    本次拆解将仅基于 US 卡片的用户故事与验收标准（AC）进行，
    任务描述中的技术细节部分可能需要在实现阶段进一步明确。
    ```

6. **前置检查通过**：

    ```text
    ✅ 前置条件检查通过：
    ✓ 工作区干净
    ✓ US 卡片存在
    ✓ 技术依据来源已确认（技术依据小节 / PRD 兜底 / 无）

    继续进入拆解流程...
    ```

---

### Step 1: 读取并理解 US 卡片

1. 读取 `<feature-id>-US-{序号}-<story-name>.md` 完整内容
2. 提取：
   - 用户故事（作为一个…我想要…以便…）
   - 验收标准 AC-1 ~ AC-N（Given-When-Then）
   - 依赖关系（依赖于 / 被依赖）
   - 技术依据小节（如有，或 Step 0 兜底读取的 PRD 相关章节）
3. 建立 **AC 清单**，用于 Step 3 的验证步骤追溯校验
4. 通过语义理解定位：
   - 变更范围 / 受影响模块
   - 技术方案 / 设计决策
   - API 定义 / 接口设计
   - 数据模型 / 存储结构
   - 验收条件 DoD

---

### Step 2: 规划任务序列（无 Phase 层）

US 本身已是 1~3 天的原子交付单元，**不再划分 Phase**，直接规划一条线性任务序列。

#### 2.1 任务顺序原则

| 优先级 | 原则 | 说明 |
| :------:|------|------|
| 1 | 依赖关系优先 | 被依赖的先做（如数据库 → API → 前端） |
| 2 | 技术层次排序 | 底层基础 → 中层服务 → 上层集成 → 前端展示 |
| 3 | 风险前置 | 高风险任务尽早启动 |
| 4 | 可交付性 | 每个任务完成即可独立验证 |
| 5 | 任务粒度 | 任务粒度控制在半天~1天              |

#### 2.2 拆分方法论：纵向拆分

**必须采用纵向拆分，禁止按技术层横向分层。** 每个任务 = 一个端到端可验证的功能切片，而非"先搭 DB 再写 Service 再写 Controller"。

| ❌ 横向拆分（禁止） | ✅ 纵向拆分（必须） |
| -------------------|-------------------|
| 按层拆分：DB → Service → Controller → Client | 按能力拆分：每个任务 = 一个端到端可验证的功能 |
| 多任务完成才能验证 | 每个任务完成即可验证 |
| 前期任务无外部可见产出 | 每个任务有独立可演示价值 |

---

### Step 3: 生成任务分解

对整条 US 拆解为编号任务（格式 `{N}`，如 `1`、`2`、`3`），**不含 Phase 前缀**。

#### 每个任务的标准结构

**（A）任务标题**：`### 任务 {N}: {简短名称}`

**（B）根据任务类型选择描述子节**：

| 类型 | 子节标题 | 内容 |
| ------|---------|------|
| 基础设施部署 | `#### 部署要求` | 属性表格 |
| 模块新建 | `#### 工程属性` | 包路径/端口/技术栈表格 |
| 功能实现 | `#### 核心逻辑` | 处理流程描述 |
| 校验验证 | `#### 校验范围` | 字段→规则表 |
| 配置变更 | `#### 配置要点` | 变量/用途表 |

> **关键要求**：具体参数值必须从 US 卡片「技术依据」小节或兜底读取的 PRD 相关章节提取，不得凭空编造；技术依据缺失时，该部分可标注"待实现阶段明确"，不得虚构。

**（C）交付物**：`#### 交付物` — 无序列表，列出具体可检验产出物。

**（D）验证步骤**：`#### 验证步骤` — checkbox 列表格式，**每条须标注对应 AC**：

```text
- [ ] **V{N}.{M}** {操作描述} → {预期结果}（对应 AC-{X}）
  `{验证命令}`
```

| 规范项 | 要求 |
| --------|------|
| 编号格式 | `V{任务序号}.{验证步骤序号}` |
| 格式 | checkbox 列表，禁止表格 |
| 命令 | 优先可复制的 shell 命令 |
 数量 | 每任务 3~6 条 |
| 覆盖面 | 正常路径、异常路径、边界条件 |
| AC 追溯 | 每条验证步骤必须标注对应哪条 AC；无直接对应 AC 的技术性验证（如编译通过）可标注"（技术前置）” |


#### 3.1 AC 覆盖检查（本 action 特有的质量门）

全部任务生成后，执行一次交叉校验：

1. 汇总所有任务验证步骤中标注的 AC 引用
2. 对照 Step 1 建立的 AC 清单，检查是否每条 AC 都至少被一条验证步骤覆盖
3. **存在未覆盖的 AC** → 不允许直接进入 Step 4，必须补充相应任务或验证步骤：

    ```text
    ⚠️ AC 覆盖检查未通过

    AC-3「无效验证链接」未被任何任务的验证步骤覆盖。

    请补充对应任务/验证步骤后重新生成。
    ```

4. **全部覆盖** → 继续 Step 4

#### 任务粒度控制

| 标准 | 要求 |
| ------|------|
| 可独立验证 | 完成后能通过一条命令确认正常 |
| 半天~1 天工作量 | 理想工作量（小于 Feature 级任务粒度） |
| 单一能力 | 每个任务只交付一种可验证能力 |

---

### Step 4: 组装并写入 US 级 Plan 文档

读取 `../specs/plan-spec.md` 中「US 级 Plan 文档结构」一节，按该结构生成 Plan 文档。

**输出路径**：`../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-US-{序号}-{us名字}-Plan.md`

**US 级 Plan 文档章节**（详见 plan-spec.md）：

- User Story 概述（直接引用卡片中的用户故事三段式，不重复 PRD 背景）
- **develop-log.json 链接**（blockquote 引用，链接到同目录下 `FT-{id}-{name}-US-{序号}-{us名字}-develop-log.json`）
- 进度概要表（无 Phase 列）
- 任务分解（单层编号）
- AC 覆盖对照表（本节为 US 级特有：列出每条 AC 对应哪些验证步骤，供后续 develop 阶段核对）
- 实施顺序建议
- 风险与挑战
- 变更模块总览

**初始化 US 级 develop-log.json**：

1. **获取 Git 基线 commit**：通过 `git rev-parse HEAD` 获取当前代码库 HEAD 的完整 SHA-1 commit ID，作为本次开发的工作起点（base commit）。

2. **创建 develop-log.json**（同目录，命名 `FT-{id}-{name}-US-{序号}-{us名字}-develop-log.json`），将所有任务初始状态设为 `pending`，并将获取到的 commit ID 写入 `base_commit` 字段。

> 📋 **develop-log.json 的完整结构规范**参见 **[develop-log.json](../specs/develop-log.json)**。初始化时必须严格遵循该规范中的所有字段定义、类型和约束。核心要点：
> - 顶层必须包含 `base_commit` 字段，值为 `git rev-parse HEAD` 的完整 40 字符 SHA-1 输出
> - 每个任务必须包含 `name`、`phase`、`phase_name`、`depends_on`、`status`（初始 `"pending"`）、`history`（初始 `[]`）六个字段
> - `depends_on` 无依赖时为空数组 `[]`，有依赖时必须与 Plan 中「实施顺序建议 → 关键依赖链」一致
> - `last_updated` 使用 ISO 8601 带时区偏移格式
> - history 条目格式为 `{"timestamp": "...", "from": "...", "to": "...", "reason": "..."}`（旧格式 `step/result/detail` 已废弃）
    > US 级需额外写入：
- `scope`: `"user_story"`
- `us_id`: 如 `F-001-US-01`
- `us_card_path`: US 卡片相对路径
- `story_list_path`: 该 Feature 的 `story-list.md` 相对路径
- 任务条目的 `phase` 固定为 `1`，`phase_name` 固定为 `"-"`

**US 卡片状态联动**：
- 若卡片当前状态为「草稿」，本 action 完成后不强制变更其状态（是否评估通过与是否已拆解为可执行任务是两件事）；US 卡片状态的正式流转仍由 `/asdm-us-evaluate`（评估类状态）和 `/asdm-harness-us-develop`（开发完成后回写「已完成」）负责。

**overall-plan.md 状态联动**（幂等）：
- 检查该 Feature 在 `overall-plan.md` 中的状态
- 若仍为 🟠 设计中 → 更新为 🟡 实现中（与 Feature 级 Plan 的联动动作一致，任一路径先触发都可完成此转换）
- 若已是 🟡 实现中或更后的状态 → 不重复触发，不报错


### Step 5: 完成提示

```text
✅ US 级实施计划已生成！

📄 Plan 文档: ../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-US-{序号}-{us名字}-Plan.md
📋 develop-log.json 已初始化（scope: user_story）

📊 拆解概要：
- User Story: <us-id> <us名称>
- 任务数: N 个
- 验证步骤数: N 条（AC 覆盖：M/M 全部覆盖）

👉 下一步：执行 /asdm-harness-us-develop FT-{id} US-{序号} 启动编码实现。
```

---

## Purpose

- 将单条 User Story 拆解为可执行任务
- 采用纵向拆分确保每个任务端到端可验证
- 验证步骤与 AC 强关联，保证任务清单不偏离验收标准
- 复用 US 卡片已过滤的技术依据，避免重复解析整篇 PRD
- 为 `/asdm-harness-us-develop` 提供独立的 US 级进度跟踪文件

## Input

- 特性编码 FT-XXX（必填）
- User Story 编号 US-XX（必填）
- US 卡片（自动读取）：`../../../.asdm/workspace/features/<feature-id>-<feature-name>/user_stories/<feature-id>-US-{序号}-<story-name>.md`
- PRD 文档（条件性读取，技术依据缺失或版本漂移时）
- CodeResearch 文件（如有, 条件性读取，技术依据缺失或版本漂移时）
- 项目总体计划：`../../../.asdm/workspace/asdm-harness/overall-plan.md`

## Output

```json
{
  "scope": "user_story",
  "status": "success",
  "feature_id": "FT-XXX",
  "us_id": "F-XXX-US-01",
  "source_doc": ".asdm/workspace/features/FT-XXX-name/user_stories/F-XXX-US-01-<story-name>.md",
  "task_count": 5,
  "total_verifications": 22,
  "ac_coverage": "4/4",
  "plan_path": ".asdm/workspace/asdm-harness/feat/FT-XXX-name/FT-XXX-name-US-01-xxx-Plan.md",
  "develop_log_path": ".asdm/workspace/asdm-harness/feat/FT-XXX-name/FT-XXX-name-US-01-xxx-develop-log.json",
  "next_steps": [
    "执行 /asdm-harness-us-develop FT-XXX US-01 启动编码实现"
  ],
  "timestamp": "ISO 8601 datetime"
}
```

## Downstream Flow

```text
/asdm-us-split                     ← User Story 拆分
        │
        ▼
/asdm-us-evaluate                  ← INVEST 评估（建议但非强制）
        │
        ▼
/asdm-us-rank                      ← WSJF 优先级排序
        │
        ▼
/asdm-harness-us-plan               ← 当前步骤：US 级开发任务拆解
        │
        ▼
/asdm-harness-us-develop            ← 下一步：US 级编码实现
```

## Spec Reference

- [plan-spec.md](../specs/plan-spec.md) — 实施计划文档结构与内容规范（含「US 级 Plan 文档结构」一节）
- [develop-log.json](../specs/develop-log.json) — develop-log.json 数据结构规范（含 scope=user_story 相关字段, plan 初始化 develop-log.json 时必须遵循）
- User Story 卡片规范（来自 `asdm-feature-split` 工具集）— US 卡片结构与「技术依据」小节定义
