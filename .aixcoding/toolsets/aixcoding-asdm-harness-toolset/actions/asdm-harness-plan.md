# ASDM Action: Feature Plan Breakdown

> **🔗 前置依赖**：本 action 的输入依赖于 **PRD 文档**（`FT-{id}-{name}-PRD.md`），即 `/asdm-harness-design-overall` 和 `/asdm-harness-design-details` 产出的完整产品需求文档。PRD 中的总体概述、使用场景、技术方案、验收条件等是任务拆解的直接输入来源。

## Metadata

```json
{
  "name": "asdm-harness-plan",
  "displayName": "开发任务拆解",
  "description": "基于 PRD 文档，将设计方案拆解为可执行、可验证的细粒度任务清单，生成结构化的实施计划文档（Plan）",
  "toolset": {
    "id": "asdm-harness-toolset",
    "name": "ASDM 驾驭工程工具集",
    "version": "0.0.1"
  },
  "scenario": "feature-planning"
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
| L2 按需 | `architecture.md` | 服务间依赖，确定 Phase 划分的依赖顺序 |
| L2 按需 | `standard-project-structure.md` | 定位各任务代码路径 |
| Source | PRD 文档 + CodeResearch | 任务拆解核心输入 + 技术上下文 |

**IMPORTANT**: 在开始拆解之前必须先读取 `../../../.asdm/contexts/index.md`。任务的具体参数值必须从 PRD 文档提取，不得凭空编造。

## Description

读取已完成 PRD 设计的特性文档（`FT-{id}-{name}-PRD.md`），分析其内容，将设计方案拆解为**可执行、可验证的细粒度任务清单**，生成标准化的实施计划文档（Plan）。

> **⚠️ 前置条件**：使用本 action 前，**必须先通过 `/asdm-harness-design-overall` 和 `/asdm-harness-design-details` 完成 PRD 完整设计**，生成对应的 PRD 文档。如该文件不存在，将终止执行并提示用户。

生成的 Plan 文档包含：

- **进度概要表**：Phase → 任务 → 状态 → 交付物
- **逐任务分解**：每个任务包含部署要求/核心逻辑、交付物、验证步骤
- **验证步骤**：checkbox 列表格式（操作描述 + 预期结果 + 验证命令），**验证步骤即该任务的验收标准**

## Usage

```text
/asdm-harness-plan <FT-XXX 编码>
```

## Parameters

| 参数 | 必填 | 说明 |
| ------ | :----: | ------ |
| `feature_id` | ✅ | 特性编号，FT-XXX 格式 |

## Process

### ⛔ 前置条件检查

1. **检查 Git 工作区状态**：Plan 初始化 `develop-log.json` 时需要记录当前 HEAD 作为 `base_commit`，因此工作区必须干净（所有代码变更已提交）。

    ```bash
    git status --porcelain
    ```

    - **输出为空** → 工作区干净，继续。
    - **输出不为空** → 终止，提示：

    ```text
    ❌ 工作区不干净：存在未提交的代码变更。

    git status 输出：
    （列出未提交文件）

    Plan 需要记录当前 HEAD 作为代码基线（base_commit），所有变更必须已提交到 Git。
    请先执行 git add + git commit 提交当前变更，然后重新运行 /asdm-harness-plan。
    ```

2. **确定特性目录**：`../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/`

3. **检查 PRD 文档是否存在**：
   - 检查 `../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-PRD.md`
   - **如不存在** → 终止，提示：

    ```text
    ❌ 前置条件不满足：未找到 PRD 文档。

    特性目录: ../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/
    缺失文件: FT-{id}-{name}-PRD.md

    请先执行 /asdm-harness-design-overall FT-{id} 和 /asdm-harness-design-details FT-{id} 完成 PRD 设计后再执行本拆解工具。
    ```

4. **检查 CodeResearch 文件**（如 PRD 引用了调研结果）：
   - 读取 PRD 中的相关文档链接，确认引用的 CodeResearch 文件存在
   - 如有缺失，提示但不阻塞流程

5. **前置检查通过**：

    ```text
    ✅ 前置条件检查通过：
    ✓ 工作区干净
    ✓ PRD 文档存在

    继续进入拆解流程...
    ```

---

### Step 1: 读取并理解 PRD 文档

1. 读取 `FT-{id}-{name}-PRD.md` 完整内容
2. 扫描文档全部标题层级，建立实际目录结构
3. 通过语义理解定位：
   - 变更范围 / 受影响模块
   - 技术方案 / 设计决策
   - API 定义 / 接口设计
   - 数据模型 / 存储结构
   - 验收条件 DoD
4. 如有 CodeResearch 文件，一并读取获取技术上下文

> **不得对 PRD 章节结构做任何预设**——不同 PRD 可能采用不同组织方式。AI 必须基于实际文档内容工作。

---

### Step 2: 分析并规划 Phase 结构

#### 2.1 识别变更项

通读全文，通过语义推断识别所有受影响模块和变更项。

#### 2.2 Phase 划分原则

| 优先级 | 原则 | 说明 |
| :------:|------|------|
| 1 | 依赖关系优先 | 被依赖的先做（如数据库 → API → 前端） |
| 2 | 技术层次排序 | 底层基础 → 中层服务 → 上层集成 → 前端展示 |
| 3 | 风险前置 | 高风险任务尽早启动 |
| 4 | 可交付性 | 每个 Phase 结束有可验证的中间产出 |

#### 2.3 拆分方法论：纵向拆分

**必须采用纵向拆分，禁止按技术层横向分层。**

| ❌ 横向拆分（禁止） | ✅ 纵向拆分（必须） |
| -------------------|-------------------|
| 按层拆分：DB → Service → Controller → Client | 按能力拆分：每个任务 = 一个端到端可验证的功能 |
| 多任务完成才能验证 | 每个任务完成即可验证 |
| 前期任务无外部可见产出 | 每个任务有独立可演示价值 |

---

### Step 3: 生成任务分解

对每个 Phase 拆解为编号任务（格式 `{P}.{T}`，如 `1.1`、`2.3`）。

#### 每个任务的标准结构

**（A）任务标题**：`### 任务 {P.T}: {简短名称}`

**（B）根据任务类型选择描述子节**：

| 类型 | 子节标题 | 内容 |
| ------|---------|------|
| 基础设施部署 | `#### 部署要求` | 属性表格 |
| 模块新建 | `#### 工程属性` | 包路径/端口/技术栈表格 |
| 功能实现 | `#### 核心逻辑` | 处理流程描述 |
| 校验验证 | `#### 校验范围` | 字段→规则表 |
| 配置变更 | `#### 配置要点` | 变量/用途表 |

> **关键要求**：具体参数值必须从 PRD 文档提取，不得凭空编造。

**（C）交付物**：`#### 交付物` — 无序列表，列出具体可检验产出物。

**（D）验证步骤**：`#### 验证步骤` — **checkbox 列表格式**（非表格）：

```text
- [ ] **V{P.T.{N}}** {操作描述} → {预期结果}
  `{验证命令}`
```

| 规范项 | 要求 |
| --------|------|
| 编号格式 | `V{P}.{T}.{N}` |
| 格式 | checkbox 列表，禁止表格 |
| 命令 | 优先可复制的 shell 命令 |
| 数量 | 每任务 4~8 条 |
| 覆盖面 | 正常路径、异常路径、边界条件 |

#### 任务粒度控制

| 标准 | 要求 |
| ------|------|
| 可独立验证 | 完成后能通过一条命令确认正常 |
| 1~3 天工作量 | 理想工作量 |
| 单一能力 | 每个任务只交付一种用户可见能力 |
| 不过度拆分 | 不将同一能力的内部步骤拆成多个任务 |

---

### Step 4: 组装并写入 Plan 文档

读取 `../specs/plan-spec.md`，按模板生成 Plan 文档。

**输出路径**：`../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-Plan.md`

**Plan 文档章节**：

- 项目概述（含前置依赖 / 后续依赖）
- **develop-log.json 链接**（紧接标题下方，以 blockquote 引用格式 `📋 开发进度：` 链接到 `./develop-log.json`）
- 进度概要表
- 各 Phase 任务分解
- 实施顺序建议
- 风险与挑战
- 变更模块总览

写入后更新 `overall-plan.md` 中特性状态：`🟠 设计中` → `🟡 实现中`。

**初始化 develop-log.json**：Plan 写入完成后，执行以下步骤：

1. **获取 Git 基线 commit**：通过 `git rev-parse HEAD` 获取当前代码库 HEAD 的完整 SHA-1 commit ID，作为本次开发的工作起点（base commit）。

2. **创建 develop-log.json**：在同目录创建 `develop-log.json`，将所有任务初始状态设为 `pending`，并将获取到的 commit ID 写入 `base_commit` 字段。

> 📋 **develop-log.json 的完整结构规范**参见 **[develop-log.json](../specs/develop-log.json)**。初始化时必须严格遵循该规范中的所有字段定义、类型和约束。核心要点：
> - 顶层必须包含 `base_commit` 字段，值为 `git rev-parse HEAD` 的完整 40 字符 SHA-1 输出
> - 每个任务必须包含 `name`、`phase`、`phase_name`、`depends_on`、`status`（初始 `"pending"`）、`history`（初始 `[]`）六个字段
> - `depends_on` 无依赖时为空数组 `[]`，有依赖时必须与 Plan 中「实施顺序建议 → 关键依赖链」一致
> - `last_updated` 使用 ISO 8601 带时区偏移格式
> - history 条目格式为 `{"timestamp": "...", "from": "...", "to": "...", "reason": "..."}`（旧格式 `step/result/detail` 已废弃）

### Step 5: 完成提示

```text
✅ 实施计划已生成！

📄 Plan 文档: ../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-Plan.md
📋 overall-plan.md 状态已更新：🟠 设计中 → 🟡 实现中

📊 拆解概要：
- Phase 数: N 个
- 任务数: N 个
- 验证步骤数: N 条

👉 下一步：执行 /asdm-harness-develop FT-{id} 启动编码实现。
```

---

## Purpose

- 将 PRD 设计方案拆解为可执行任务
- 采用纵向拆分确保每个任务端到端可验证
- 为每个任务生成明确的验证步骤作为验收标准
- 建立有序的开发实施路径

## Input

- 特性编码 FT-XXX（必填）
- PRD 文档（自动读取）：`../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-PRD.md`
- CodeResearch 文件（如有）
- 项目总体计划：`../../../.asdm/workspace/asdm-harness/overall-plan.md`

## Output

```json
{
  "phase": "planning",
  "status": "success",
  "feature_id": "FT-XXX",
  "feature_name": "string",
  "source_doc": ".asdm/workspace/asdm-harness/feat/FT-XXX-name/FT-XXX-name-PRD.md",
  "phases": [
    {
      "phase_number": 1,
      "phase_name": "基础设施搭建",
      "task_count": 3,
      "tasks": ["1.1", "1.2", "1.3"]
    }
  ],
  "total_tasks": 12,
  "total_verifications": 60,
  "plan_path": ".asdm/workspace/asdm-harness/feat/FT-XXX-name/FT-XXX-name-Plan.md",
  "next_steps": [
    "执行 /asdm-harness-develop FT-XXX 启动编码实现"
  ],
  "timestamp": "ISO 8601 datetime"
}
```

## Plan 文档中的 develop-log.json 引用规范

每个 Plan 文档在标题之后、进度概要表之前，**必须**包含指向 `develop-log.json` 的链接块：

```markdown
> **📋 开发进度**：[develop-log.json](./develop-log.json) — 任务执行状态与历史记录（由 `/asdm-harness-develop` 驱动更新）
```

此链接确保未来任何读取 Plan 的 agent/用户都能快速定位开发进度文件。`develop-log.json` 由 Step 4 的初始化步骤在同目录创建。

---

## Downstream Flow

```text
/asdm-harness-design-details       ← 上一步：PRD 详细设计
        │
        ▼
/asdm-harness-plan                 ← 当前步骤：开发任务拆解
        │
        ▼
/asdm-harness-develop              ← 下一步：编码实现
```

## Spec Reference

- [plan-spec.md](../specs/plan-spec.md) — 实施计划文档结构与内容规范
- [develop-log.json](../specs/develop-log.json) — develop-log.json 数据结构规范（plan 初始化 develop-log.json 时必须遵循）
