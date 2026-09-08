# Review 业务验收规范

## 概述

此规范定义功能验收审查（Review）文档的结构模板，供 `asdm-harness-verify` action 基于 PRD 和 Plan 文档生成验收报告时参照。核心关注**功能实现的业务验收**——对照 PRD 定义的验收条件（DoD），验证代码实际实现情况。

## 文档命名

```text
FT-{id}-{name}-Review.md
```

存放路径：`.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/`

## Review 文档标准结构

```markdown
# FT-{id} {特性名称} — 功能验收报告

> **🔗 前置依赖**：本文档基于 [FT-{id}-{name}-PRD.md](./FT-{id}-{name}-PRD.md) 和 [FT-{id}-{name}-Plan.md](./FT-{id}-{name}-Plan.md) 生成。

> **验收时间**：{YYYY-MM-DD HH:MM}
> **验收结论**：✅ 验收通过 / ⚠️ 有条件通过 / ❌ 未通过

> **代码基线**：`{base_commit_short}` → `{current_commit_short}` | {commit_count} commits | {files_changed} files | +{lines_added}/-{lines_deleted}

---

## 1. 代码变更基线

> 基准 commit 来自 `develop-log.json`，由 `/asdm-harness-plan` 初始化时记录。当前 HEAD 为验收时的最新提交。以下统计基于 `git diff {base_commit}..HEAD` 和 `git log` 生成。

### 1.1 基线信息

| 项目 | 值 |
| ------ | ------ |
| Base Commit | `{base_commit}` ({base_commit_short}) |
| Current Commit | `{current_commit}` ({current_commit_short}) |
| 提交次数 | {commit_count} |
| 提交者 | {authors_list} |

### 1.2 变更统计

| 指标 | 数值 |
| ------ | :----: |
| 变更文件数 | {files_changed} |
| 新增行数 | +{lines_added} |
| 删除行数 | -{lines_deleted} |

### 1.3 变更文件明细

| 文件路径 | + | - |
| ------ | :----: | :----: |
| {filepath} | {added} | {deleted} |

### 1.4 提交历史

| Commit | 作者 | 时间 | 说明 |
| ------ | ------ | ------ | ------ |
| `{hash_short}` | {author} | {datetime} | {subject} |

> ⚠️ 若无代码提交（base = HEAD），本节标注 "⚠️ 本特性尚无代码提交，基线对比无差异"。

### 1.5 开发时长

> 开发时长基于 `develop-log.json` 中所有任务历史记录的时间戳计算：取最早时间戳为开发起点，最晚时间戳为开发终点。

| 项目 | 值 |
| ------ | ------ |
| 开发开始 | {first_timestamp_iso} |
| 开发结束 | {last_timestamp_iso} |
| 总耗时 | {duration_human_readable} |

**时长格式规则**：
- 小于 1 小时：`"45 分钟"`
- 1 小时以上：`"1 小时 55 分钟"`
- 跨天：`"2 天 3 小时"`

> ⚠️ 若无开发记录（tasks 为空或无 history），本节标注 "⚠️ 无开发记录可用"。

---

## 2. 验收概览

### 总体完成度

| 指标 | 数值 |
| ------ | :----: |
| DoD 总项数 | N |
| 已完成 | N |
| 部分完成 | N |
| 未实现 | N |
| 完成率 | N% |

**计算公式**：完成率 = (已完成 × 1.0 + 部分完成 × 0.5) / 总项数 × 100%

### 主要发现

<!-- 列出关键发现和改进建议 -->

---

## 3. 功能实现检查

> 逐项对照 PRD 使用场景和验收条件

### 3.1 场景一：{场景名称}

| 功能点 | 预期行为 | 实际实现 | 状态 |
| :----: | ------ | ------ | :----: |
| 1 | {PRD 描述} | {代码验证结论} | ✅/🟡/❌ |
| 2 | {PRD 描述} | {代码验证结论} | ✅/🟡/❌ |

### 3.2 场景二：{场景名称}

<!-- 同上格式 -->

---

## 4. DoD 逐项检查

| 编号 | 完成点 | PRD 说明 | 状态 | 实际实现情况 |
| :----: | -------- | ---------- | :----: | ---------- |
| N.1.1 | {完成点名称} | {说明} | ✅/🟡/❌ | {代码验证结论} |

### 状态说明

| 状态 | 图标 | 判断标准 |
|:----:|:----:|----------|
| 已完成 | ✅ | 代码扫描确认功能完整存在 |
| 部分完成 | 🟡 | 代码扫描确认部分功能存在 |
| 未实现 | ❌ | 代码扫描确认功能不存在 |

---

## 5. 代码文件清单

> 按 DoD 验收点逐一列出相关代码文件（路径已通过 path-validator 验证）

### N.1.1 {完成点名称}

| 文件名 | 链接 |
| ------ | ------ |
| `文件名.java` | [查看代码](相对路径) |

---

## 6. 关键缺失分析

| 缺失项 | 影响范围 | 优先级 | 建议 |
| ------ | ------ | :----: | ------ |
| {缺失描述} | {影响} | P0/P1/P2 | {建议} |

---

## 7. 实施建议

### 高优先级
- {建议项}

### 中优先级
- {建议项}

---


## 附录

- **验收工具**：asdm-harness-verify action + path-validator skill
- **相关文档**：[PRD](./FT-{id}-{name}-PRD.md) | [Plan](./FT-{id}-{name}-Plan.md) | [TestPlan](./FT-{id}-{name}-TestPlan.md)
```

## 路径验证规则

**在列出代码文件路径之前，必须使用 path-validator 技能验证路径正确性**：

```bash
cd /home/azureuser/source/demo515/qa-healthcare/.asdm/skills/path-validator
python3 main.py --batch files.json
```

仅对验证通过（exists=true）的文件生成 Markdown 链接。不存在的文件标注为"文件不存在"。

## 代码扫描规则

| 优先级 | 对象 | 要求 |
|:------:|------|------|
| 高 | DoD 标记 ✅/🟡 的功能 | 必须执行 code-explorer 扫描，验证代码实际存在 |
| 中 | DoD 标记 ❌ 的功能 | 确认功能确实不存在，检查是否有相关基础设施 |
