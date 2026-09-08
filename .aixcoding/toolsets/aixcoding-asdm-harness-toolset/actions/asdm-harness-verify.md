# ASDM Action: Feature Review

> **🔗 前置依赖**：本 action 依赖于 **PRD 文档**（`FT-{id}-{name}-PRD.md`）和 **Plan 文档**（`FT-{id}-{name}-Plan.md`），即 `/asdm-harness-design-overall` + `/asdm-harness-design-details` 和 `/asdm-harness-plan` 的产出。

## Metadata

```json
{
  "name": "asdm-harness-verify",
  "displayName": "功能验收审查",
  "description": "对照 PRD 验收条件审查功能实现情况，生成结构化验收报告（Review），逐项验证 DoD 完成度",
  "toolset": {
    "id": "asdm-harness-toolset",
    "name": "ASDM 驾驭工程工具集",
    "version": "0.0.1"
  },
  "scenario": "feature-review"
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
| L2 按需 | `architecture.md` | 确认 DoD 各项涉及的服务范围 |
| L2 按需 | `api.md` | 验证接口实现与设计一致性 |
| L2 按需 | `data-models.md` | 验证数据层实现完整性 |
| Source | PRD + Plan + code-explorer 扫描 | 验收条件对照 + 交付物清单 + 代码实现验证 |
| Skill | [path-validator](../../../.asdm/skills/path-validator/SKILL.md) | 验证代码文件路径后生成链接 |

**IMPORTANT**: 在开始验收审查之前必须先读取 `../../../.asdm/contexts/index.md`。验收结论必须基于实际代码扫描结果，不得凭空判断。

## Description

基于 PRD 和 Plan 文档，对特性功能实现情况进行**业务验收**——对照 PRD 定义的验收条件（DoD）和使用场景，通过代码扫描逐项验证实际实现状态，生成结构化验收报告。

验收报告包含：

- **验收概览**：总体完成度统计
- **功能实现检查**：按使用场景逐功能点对照
- **DoD 逐项检查**：逐条验收条件状态（✅/🟡/❌）及实际实现情况
- **代码文件清单**：path-validator 验证后的代码文件链接
- **关键缺失分析**：未实现或部分实现的影响评估
- **实施建议**：按优先级排序的改进建议

> **⚠️ 前置条件**：PRD 和 Plan 文档必须存在。

## Usage

```text
/asdm-harness-verify <FT-XXX 编码>
```

## Parameters

| 参数 | 必填 | 说明 |
| ------ | :----: | ------ |
| `feature_id` | ✅ | 特性编号，FT-XXX 格式 |

---

## Process

### ⛔ 前置条件检查

1. **定位特性目录**：`../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/`
2. **检查 PRD 文档**：`../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-PRD.md`
3. **检查 Plan 文档**：`../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-Plan.md`
4. **检查 develop-log.json**：`../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/develop-log.json`
5. 任一缺失 → 终止，提示先执行对应 action

    通过 → 继续：

    ```text
    ✅ 前置条件检查通过：
    ✓ PRD 文档存在
    ✓ Plan 文档存在
    ✓ develop-log.json 存在

    继续进入功能验收...
    ```

---

### Step 1: 读取设计文档

1. 读取 PRD 文档完整内容，提取：
   - **使用场景** 及每个场景的功能点
   - **验收条件 DoD**（全部完成点列表）
   - **总体概述** 中的核心概念

2. 读取 Plan 文档，提取：
   - 各任务交付物清单
   - 验证步骤（辅助判断实现状态）

---

### Step 2: 获取代码变更基线

从 `develop-log.json` 读取开发起点 commit，与当前 HEAD 对比，获取本特性所完成的代码变更范围。

#### 2.0 ⛔ 前置检查：工作区状态

在执行基线对比之前，**必须先确认 Git 工作区是干净的**（所有代码变更均已提交）。未提交的代码会导致 diff 统计失真，无法准确反映本特性的代码变更范围。

```bash
git status --porcelain
```

- **若输出为空** → 工作区干净，继续执行。
- **若输出不为空** → 终止，提示用户：

```text
❌ 工作区不干净：存在未提交的代码变更。

git status 输出：
（列出未提交文件）

代码基线对比要求工作区干净，所有变更必须已提交到 Git。
请先执行 git add + git commit 提交当前变更，然后重新运行 /asdm-harness-verify。
```

#### 2.1 读取基线 commit

解析 `develop-log.json`，提取 `base_commit` 字段——这是 `/asdm-harness-plan` 初始化时通过 `git rev-parse HEAD` 记录的开发起点 SHA-1。

#### 2.2 获取当前 HEAD commit

```bash
git rev-parse HEAD
```

得到完整的当前 HEAD SHA-1 作为 `current_commit`。

#### 2.3 比对代码变更范围

以 `base_commit` 为基线与 `HEAD` 进行 diff 对比，获取本特性期间产生的所有代码变更：

**（A）文件级变更统计**：
```bash
git diff --stat {base_commit}..HEAD
```
输出示例：
```text
 server/src/main/java/.../DoctorController.java | 45 +++++++++------
 web/src/views/Appointment.vue                  | 12 ++--
 8 files changed, 120 insertions(+), 35 deletions(-)
```

**（B）逐文件增删行数**：
```bash
git diff --numstat {base_commit}..HEAD
```
格式：`{added}\t{deleted}\t{filepath}`，用于精确统计每个文件的变更量。

**（C）提交历史**：
```bash
git log --format="%H|%an|%ae|%ai|%s" {base_commit}..HEAD
```
输出格式：`commit_hash|author_name|author_email|datetime|subject`，用于提取提交者信息和提交意图。

#### 2.4 汇总基线数据

将上述命令输出整理为以下结构化数据，供 Review 文档使用：

```json
{
  "base_commit": "a1b2c3d4...",
  "current_commit": "e5f6a7b8...",
  "commit_count": 5,
  "authors": ["张三", "李四"],
  "files_changed": 8,
  "lines_added": 120,
  "lines_deleted": 35,
  "changed_files": [
    {
      "path": "server/src/main/java/.../DoctorController.java",
      "added": 30,
      "deleted": 15
    }
  ],
  "commits": [
    {
      "hash": "c1d2e3f4...",
      "author": "张三",
      "email": "zhangsan@example.com",
      "datetime": "2026-05-20T10:30:00+08:00",
      "subject": "feat: 新增医生排班接口"
    }
  ]
}
```

> ⚠️ **边界情况处理**：
> - 若 `base_commit` 与 `HEAD` 相同（即 `git diff --stat` 输出为空），说明本特性尚无代码提交，`files_changed` / `lines_added` / `lines_deleted` 均为 0，报告中标注 ⚠️ 警告。
> - 若 `base_commit` 字段缺失或格式不正确，终止执行并报错。

#### 2.5 计算开发时长

从 `develop-log.json` 中提取所有任务的历史记录时间戳，计算本特性的开发总耗时。

##### 2.5.1 提取时间戳

遍历 `develop-log.json` 中所有 `tasks.*.history[]` 数组，收集全部 `timestamp` 字段：

```python
import json
from datetime import datetime

log = json.load(open('develop-log.json'))
timestamps = []
for task_id, task in log['tasks'].items():
    for entry in task['history']:
        timestamps.append(datetime.fromisoformat(entry['timestamp']))

timestamps.sort()
first_ts = timestamps[0]   # 开发起点：最早的历史记录
last_ts = timestamps[-1]   # 开发终点：最晚的历史记录
duration = last_ts - first_ts
```

##### 2.5.2 格式化输出

将 `timedelta` 转换为人类可读的时长字符串：

- **小于 1 小时**：显示分钟，如 `"45 分钟"`
- **1 小时以上**：显示小时和分钟，如 `"1 小时 55 分钟"`
- **跨天**：显示天和小时，如 `"2 天 3 小时"`

格式化规则：

```python
def format_duration(td):
    total_minutes = int(td.total_seconds() / 60)
    if total_minutes < 60:
        return f"{total_minutes} 分钟"
    elif total_minutes < 1440:  # 不到 1 天
        hours = total_minutes // 60
        minutes = total_minutes % 60
        if minutes > 0:
            return f"{hours} 小时 {minutes} 分钟"
        else:
            return f"{hours} 小时"
    else:
        days = total_minutes // 1440
        remaining = total_minutes % 1440
        hours = remaining // 60
        if hours > 0:
            return f"{days} 天 {hours} 小时"
        else:
            return f"{days} 天"
```

##### 2.5.3 汇总为结构化数据

将开发时长的起止时间和耗时纳入基线汇总数据：

```json
{
  "dev_span": {
    "first_timestamp": "2026-05-24T14:21:00+08:00",
    "last_timestamp": "2026-05-24T16:00:30+08:00",
    "duration": "1 小时 39 分钟"
  }
}
```

##### 2.5.4 边界情况

- 若 `tasks` 为空或无 `history` 条目 → 报告中标注 `"⚠️ 无开发记录可用"`
- 若只有一个时间戳 → 标注 `"⚠️ 仅单条记录，无法计算时长"`

---

### Step 3: 代码扫描

使用 code-explorer 扫描项目代码库，对照 PRD 使用场景和 DoD 逐项验证：

1. **扫描范围确认**：
   - 从 L2 context（`architecture.md` + `standard-project-structure.md`）获取项目实际代码库清单
   - 根据 PRD 变更范围确定具体扫描目录

2. **按优先级扫描**：
   - 高优先级：DoD 标记为「核心功能」的项
   - 中优先级：边界条件和异常处理
   - 低优先级：辅助功能

3. **记录扫描结果**：

   ```text
   检查项：N.1.1 {完成点名称}
   代码扫描：
   - 文件：{模块目录}/src/main/java/.../{ClassName}.java
   - 发现：{实际实现情况}
   结论：✅ 已实现 / 🟡 部分实现 / ❌ 未实现
   ```

---

### Step 4: DoD 逐项检查

对照 PRD 中「验收条件 DoD」章节，逐条检查：

| 状态 | 图标 | 判断标准 |
|:----:|:----:|----------|
| 已完成 | ✅ | 代码扫描确认功能完整存在且符合 PRD 描述 |
| 部分完成 | 🟡 | 代码扫描确认部分功能存在 |
| 未实现 | ❌ | 代码扫描确认功能不存在 |

**完成度计算**：

```text
完成率 = (已完成项 × 1.0 + 部分完成项 × 0.5) / 总项数 × 100%
```

---

### Step 5: 功能实现对照

按 PRD 使用场景逐场景对照：

1. 列出场景中每个功能点的预期行为
2. 报告代码实际实现情况
3. 标注差异（如有）

---

### Step 6: 路径验证与代码清单生成

**在生成代码文件链接前，必须使用 path-validator 技能验证路径**：

1. **准备文件列表**：

    ```json
    {
      "files": [
        "{模块目录}/src/main/java/{包路径}/{ClassName}.java",
        "{模块目录}/src/main/java/{包路径}/{ClassName}.java"
      ]
    }
    ```

2. **执行验证**：

    ```bash
    cd ../../../.asdm/skills/path-validator
    python3 main.py --batch files.json
    ```

3. **仅对验证通过的文件生成链接**；不存在的文件标注为"文件不存在"

---

### Step 7: 组装并写入 Review 文档

读取 `../specs/review-spec.md`，按模板生成。

**输出路径**：`../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-Review.md`

**文档章节**：

- 代码变更基线（base commit / current commit / 变更统计 / 提交者信息，来自 Step 2 汇总数据）
- 开发时长（来自 Step 2.5 汇总数据）
- 验收概览（总体完成度）
- 功能实现检查（按场景逐功能点）
- DoD 逐项检查（逐条验收条件 + 实际实现情况）
- 代码文件清单（path-validator 验证）
- 关键缺失分析
- 实施建议

---

### Step 8: 完成提示

```text
✅ 功能验收报告已生成！

📄 Review 文档: ../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-Review.md

📊 验收概览：
- DoD 总项数: N
- 已完成: N (✅)
- 部分完成: N (🟡)
- 未实现: N (❌)
- 完成率: N%

⏱️ 开发时长：
- 开始: {first_timestamp}
- 结束: {last_timestamp}
- 耗时: {duration_human_readable}

📐 代码变更基线：
- base: {base_commit_short}
- HEAD: {current_commit_short}
- commits: N 个
- files changed: N 个
- +{lines_added} / -{lines_deleted}
- 提交者: {作者列表}

🔴 关键缺失: N 项
🟡 建议改进: N 项
```

---

## Purpose

- 对照 PRD 验收条件审查功能实际实现状态
- 生成结构化验收报告，量化完成度
- 通过代码扫描确保验收结论基于实际代码
- 为发布决策提供可靠依据

## Input

- 特性编码 FT-XXX（必填）
- PRD 文档（自动读取）
- Plan 文档（自动读取）
- **develop-log.json**（自动读取，提取 `base_commit` 作为代码基线起点）
- 项目代码库（code-explorer 扫描 + git diff 变更范围）

## Output

```json
{
  "phase": "review",
  "status": "success",
  "feature_id": "FT-XXX",
  "feature_name": "string",
  "dod_summary": {
    "total": 12,
    "completed": 8,
    "partial": 2,
    "not_implemented": 2,
    "completion_rate": "75%"
  },
  "code_baseline": {
    "base_commit": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    "current_commit": "e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0a1b2c3d4",
    "commit_count": 5,
    "authors": ["张三", "李四"],
    "files_changed": 8,
    "lines_added": 120,
    "lines_deleted": 35
  },
  "review_conclusion": "pass | conditional_pass | fail",
  "critical_gaps": 2,
  "review_path": ".asdm/workspace/asdm-harness/feat/FT-XXX-name/FT-XXX-name-Review.md",
  "timestamp": "ISO 8601 datetime"
}
```

## Downstream Flow

```text
/asdm-harness-develop          ← 上游：开发实施
/asdm-harness-testplan         ← 上游：测试计划（并行）
        │
        ▼
/asdm-harness-verify            ← 当前步骤：功能验收
```

## Spec & Skill Reference

- [review-spec.md](../specs/review-spec.md) — 验收报告文档结构与内容规范
- [path-validator](../../../.asdm/skills/path-validator/SKILL.md) — 代码路径验证技能
