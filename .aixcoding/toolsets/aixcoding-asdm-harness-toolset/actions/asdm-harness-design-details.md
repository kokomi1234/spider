# ASDM Action: PRD 详细设计

> **🔗 前置依赖**：本 action 的输入依赖于 **PRD 总体设计文档**（`FT-{id}-{name}-PRD.md`），即 `/asdm-harness-design-overall` 的产出。PRD 中的总体概述和使用场景是详细设计的直接输入来源。

## Metadata

```json
{
  "name": "asdm-harness-design-details",
  "displayName": "PRD 详细设计",
  "description": "基于 PRD 总体设计进行 Code Research，补充技术方案、数据模型、接口设计、依赖关系、风险与缓解、验收条件 (DoD) 等详细设计章节",
  "toolset": {
    "id": "asdm-harness-toolset",
    "name": "ASDM 驾驭工程工具集",
    "version": "0.0.1"
  },
  "scenario": "feature-prd-design-details"
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
| L2 必读 | `architecture.md` | 确定变更影响范围 |
| L2 按需 | `api.md`, `data-models.md`, `structure.md` | 接口兼容性 + schema 变更评估 + 定位代码库 |
| Source | PRD 总体设计 + CodeResearch 源码 | 总体设计结果 + 按模块 code-explorer 扫描 |
| Source | `FT-{id}-{name}-DesignSpec.md`（可选，来自 `/asdm-harness-design-parse`） | UI 视觉结构规格，补充技术方案/接口设计等章节时参考 |

**IMPORTANT**: 在开始 PRD 详细设计之前必须先读取 `../../../.asdm/contexts/index.md`。必须执行 Code Research 后再补充详细设计章节。

## Description

ASDM 驾驭工程的 PRD 详细设计阶段——基于 `/asdm-harness-design-overall` 产出的总体概述和使用场景，对相关代码库进行 **Code Research**，然后补充完整的技术方案、数据模型、接口设计、依赖关系、风险与缓解、验收条件 (DoD) 等章节。

采用**两段模式**：

- **调研阶段（2.1）**：Code Research，逐代码库扫描并输出调研报告
- **详细设计阶段（2.2）**：基于调研结果补充 PRD 全部章节

> **⚠️ 前置条件**：使用本 action 前，必须先通过 `/asdm-harness-design-overall` 完成 PRD 总体设计，确保 PRD 文档存在且已包含 §1 总体概述和 §2 使用场景。

## Usage

```text
/asdm-harness-design-details <FT-XXX 编码>
```

必须提供特性编码 FT-XXX。

---

## Process

### ⛔ 前置条件检查

1. **确定特性编码**：从用户输入中提取 FT-XXX 格式编码

2. **检查 PRD 总体设计文档**：
   - 检查 `../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-PRD.md`
   - **如不存在** → 终止，提示用户先执行 `/asdm-harness-design-overall FT-{id}`

3. **检查 PRD 总体设计完成度**：
   - 验证 PRD 文档已包含 §1 总体概述（含 1.1~1.4 子节）和 §2 使用场景
   - **如缺失** → 终止，提示用户先执行 `/asdm-harness-design-overall FT-{id}` 补全总体设计

4. **检查是否已有 CodeResearch 调研文件**：
   - 检查 `../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/` 下是否已有 `FT-{id}-{name}-CodeResearch-*.md`
   - 有 → 跳过调研，直接进入详细设计阶段（2.2）
   - 无 → 从调研阶段（2.1）开始

5. **检测 DesignSpec 文档（可选输入）**：
   - 检查 `FT-{id}-{name}-DesignSpec.md` 是否存在
   - 存在 → 在前置条件通过提示中标注"DesignSpec 已就位"，后续补充章节时作为 UI 视觉结构参考
   - 不存在但 `design/` 目录有图片 → 提示用户可先执行 `/asdm-harness-design-parse FT-{id}`
   - 不存在且无设计图 → 正常继续（非 UI 特性，无需 DesignSpec）

   前置条件通过提示：

    ```text
    ✅ 前置条件检查通过：
    ✓ PRD 总体设计文档存在
    ✓ §1 总体概述、§2 使用场景 已就位
    ✓ CodeResearch 文件: [已有 / 无，将开始调研]
    ✓ DesignSpec: [已就位 / 不适用（非 UI 特性）]

    继续进入 PRD 详细设计流程...
    ```

---

### 2.1 调研阶段

> 目标：对相关代码库进行 Code Research，产出调研报告。**必须进行 Code Research。**

1. **确定代码库清单**：
   - 基于 PRD 中的变更范围和 AskMe 中的变更模块，列出需扫描的代码库
   - 从 L2 context（`architecture.md` + `structure.md`）获取项目的实际代码库结构和模块清单
   - 将匹配变更范围的代码库列出，向用户确认代码库清单

2. **逐库代码扫描**（一次一个代码库）：
   - 使用 code-explorer 扫描当前代码库：
     - 目录结构和文件组织
     - 与特性相关的现有实现（API、Service、Controller、前端组件等）
     - 数据模型定义
     - 配置文件
   - 将扫描结果写入：`../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-CodeResearch-{module}.md`
   - 内容包含：代码库概述、现有实现分析、关键发现和缺失项、待确认问题

3. **歧义澄清**：扫描中发现不清晰的部分，向用户确认

4. **调研完成提示**：

    ```text
    ✅ 代码调研已完成！共扫描 N 个代码库：

    - {module-1} → .../FT-{id}-{name}-CodeResearch-{module-1}.md
    - {module-2} → .../FT-{id}-{name}-CodeResearch-{module-2}.md
    ...

    ⚠️ 建议创建新会话继续详细设计部分。
    在新会话中执行 /asdm-harness-design-details FT-{id}，系统将检测到已有调研文件，直接进入详细设计。
    ```

---

### 2.2 详细设计阶段

> 在本会话中，检测到调研文件已就位后执行。

1. **校验调研完整性**：
   - 读取所有 `FT-{id}-{name}-CodeResearch-*.md` 文件
   - 如缺失或覆盖不全 → 回退到 2.1，仅扫描缺失的代码库

2. **补充 PRD 可选章节**：
   - 基于调研结果，按 `prd-spec.md` 的 Agent 自由扩展区规范，**自行决定添加**以下章节（Agent 应根据特性复杂度和调研发现选择相关章节，不必全部添加）：
     - 领域设计 / 技术方案
     - 系统架构
     - 数据模型
     - 接口设计
     - 依赖关系
     - 风险与缓解
     - 相关文档（链接 CodeResearch 文件）
   - **若 DesignSpec 已就位**：编写涉及 UI 的章节（如接口设计中前端所需的字段结构、数据模型中与表单对应的实体）时，应参考 `FT-{id}-{name}-DesignSpec.md` 中的场景/字段清单，并在 PRD 对应章节标注引用来源（如"字段定义参见 DesignSpec § 场景：XXX"），不复述字段清单原文
   - 更新目录以匹配实际章节

3. **编写验收条件 DoD**：
   - 按 `prd-spec.md` 中 DoD 模板，拆分为核心功能、体验一致性、非功能需求等子节
   - 每项标注当前状态（✅/🟡/❌）

4. **更新目录与版本号**：
   - 确保目录与实际章节完全一致（包含所有章节的可点击链接）
   - 修订记录新增一条（版本 1.1.0，修订人为 AI Agent，内容为"阶段二详细设计补充"）

5. **复杂度判断与下一步建议**：
   - 基于 PRD 详细设计的内容综合判断该特性的规模与复杂度，可参考以下信号：
     - 涉及的代码库/模块数量（跨越 2 个以上代码库通常提示较复杂）
     - 接口设计中新增/变更接口的数量
     - 数据模型中新增/变更实体的数量
     - DoD 中列出的核心功能子项数量
     - 是否存在多个相对独立、可分别交付的使用场景
   - 若判断为**大型或复杂特性**（例如：涉及多代码库、接口/实体数量较多、或包含多个可独立拆分的使用场景）→ 完成提示中优先建议使用 `asdm-feature-split` 工具集将该 Feature 拆分为多个 User Story 后再进入开发规划
   - 若判断为**规模适中、不复杂**的特性 → 完成提示中建议直接执行 `/asdm-harness-plan` 进入开发任务规划

6. **完成提示**：

    - 若判断为复杂特性：

    ```text
    ✅ PRD 详细设计已完成！

    📄 PRD 文档: ../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-PRD.md
    📄 调研总结: N 个代码库

    ⚠️ 复杂度提示：该特性涉及范围较广（如多代码库 / 多接口 / 多场景），建议先拆分为 User Story 再进入开发规划。

    👉 下一步（推荐）：执行 asdm-feature-split 工具集，将本 Feature 拆分为多个 User Story
    👉 或者：若确认无需拆分，可直接执行 /asdm-harness-plan FT-{id} 进入开发任务规划
    ```

    - 若判断为不复杂特性：

    ```text
    ✅ PRD 详细设计已完成！

    📄 PRD 文档: ../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-PRD.md
    📄 调研总结: N 个代码库

    👉 下一步：执行 /asdm-harness-plan FT-{id}
    系统将基于此 PRD 文档进入开发任务规划阶段。
    ```

---

## Purpose

- 通过 Code Research 确保设计方案与现有代码库兼容
- 补充完整的技术方案、数据模型、接口设计等详细设计
- 建立验收条件（DoD），明确完成标准
- 产出完整的、可执行的 PRD 文档

## Input

- 特性编码 FT-XXX（必填）
- PRD 总体设计文档（自动读取 §1 + §2）
- CodeResearch 调研文件（检测已有或新建）
- DesignSpec 文档（可选，自动检测，来自 `/asdm-harness-design-parse`）
- 项目代码库（Code Research 扫描目标）

## Output

### 调研完成后

```json
{
  "phase": "research",
  "status": "success",
  "feature_id": "FT-XXX",
  "repo_count": 2,
  "research_paths": [
    ".asdm/workspace/asdm-harness/feat/FT-XXX-name/FT-XXX-name-CodeResearch-{module-1}.md",
    ".asdm/workspace/asdm-harness/feat/FT-XXX-name/FT-XXX-name-CodeResearch-{module-2}.md"
  ],
  "message": "调研完成，建议创建新会话进入详细设计",
  "timestamp": "ISO 8601 datetime"
}
```

### 详细设计完成后

```json
{
  "phase": "prd_detailed",
  "status": "success",
  "feature_id": "FT-XXX",
  "feature_name": "string",
  "prd_path": ".asdm/workspace/asdm-harness/feat/FT-XXX-name/FT-XXX-name-PRD.md",
  "chapters_added": ["3. 技术方案", "4. 数据模型", "5. 接口设计", "6. 依赖关系", "7. 风险与缓解", "8. 验收条件 (DoD)"],
  "research_paths": ["path1", "path2"],
  "complexity_assessment": "complex | moderate",
  "next_steps": [
    "若特性复杂：建议先执行 asdm-feature-split 工具集拆分为 User Story，再进入开发规划",
    "若特性不复杂：执行 /asdm-harness-plan FT-XXX 进入开发任务规划"
  ],
  "timestamp": "ISO 8601 datetime"
}
```

## Downstream Flow

```text
/asdm-harness-design-overall        ← 上一步：PRD 总体设计
        │
        ▼
/asdm-harness-design-parse          ← 可选步骤：设计图解析（仅 UI 特性需要）
        │
        ▼
/asdm-harness-design-details        ← 当前步骤：PRD 详细设计
        │
        ├── 特性较大/复杂 ──▶ asdm-feature-split（拆分为 User Story）
        │                              │
        │                              ▼
        └── 特性不复杂 ────────────▶ /asdm-harness-plan   ← 下一步：开发任务规划
```

## Spec Reference

- [prd-spec.md](../specs/prd-spec.md) — PRD 文档结构与内容规范
