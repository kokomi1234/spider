# ASDM Action: Design Parse

> **🔗 定位**：本 action 位于 `/asdm-harness-design-overall`（概要设计）**之后**、`/asdm-harness-design-details`（详细设计）**之前**，是**可选步骤**——仅当特性涉及 UI/前端实现且已获得设计图时执行。
>
> **🔗 前置依赖**：本 action 的输入依赖于 `/asdm-harness-design-overall` 的产出（PRD 总体设计文档，确认 Feature/Story 语境已就位）与用户提供的原始设计图文件。
>
> **产出用途**：`FT-{id}-{name}-DesignSpec.md` 作为 `/asdm-harness-design-details` 编写「技术方案」「数据模型」「接口设计」等章节时的补充输入，并供 `/asdm-harness-develop` 在实现 UI 相关任务时复核细节。

## Metadata

```json
{
  "name": "asdm-harness-design-parse",
  "displayName": "设计图解析",
  "description": "将 UI 设计图解析为结构化设计规格文档，为详细设计和开发实施提供视觉结构依据；与 develop 解耦，支持使用多模态模型独立执行",
  "toolset": {
    "id": "asdm-harness-toolset",
    "name": "ASDM 驾驭工程工具集",
    "version": "0.0.1"
  },
  "scenario": "feature-prd-design-parse",
  "recommendedCapability": "multimodal-vision"
}
```

> `recommendedCapability` 仅作执行建议标注：本 action 核心工作是图像语义理解，建议选用具备多模态能力的模型执行；`/asdm-harness-develop` 核心工作是代码生成，建议选用编码能力更强的模型执行。两个 action 之间只通过文件（`FT-{id}-{name}-DesignSpec.md`）交互，不共享会话上下文，因此可以自由搭配不同模型。

## Language Setting

默认使用**中文（简体中文）**作为输出语言。

## Context Injection

使用 [context-loader](../../../.asdm/skills/context-loader/SKILL.md) 技能进行渐进式上下文加载。

### 本 Action 的加载策略

| Phase | Context | 用途 |
|:-----:|---------|------|
| L1 必读 | `index.md` | 建立项目全局认知（技术栈、是否有既有组件库/Design System） |
| Source | 特性目录下 `design/*.{png,jpg,svg}` | 待解析的原始设计图，本 action 的核心输入 |
| Source | `FT-{id}-{name}-PRD.md`（§1 总体概述 + §2 使用场景） | 确认 Feature/Story 语境，用于建立场景与 Story 的对应关系 |
| Source | 对应 Story 卡片（含 AC） | 用于建立字段/区块与 AC 的初步映射提示，仅作参考标注，不作为解析权威 |
| Skill 必读 | `azure-devops-skill/SKILL.md` | **ADS 工作项管理规范**：添加设计图解析完成评论 |

**IMPORTANT**：本 action **不读取、不修改**代码库中的业务代码，也不做编码规范相关的上下文加载——这些属于 `/asdm-harness-develop` 的职责。本 action 的唯一交付物是 `FT-{id}-{name}-DesignSpec.md`。

## Description

读取特性目录下的原始设计图，提取为结构化、可复用的 UI 规格文档。只提取语义结构（布局、字段、交互、状态提示），不做像素级度量还原。解析结果需经人工确认后落盘，作为后续所有涉及该设计的开发任务的统一依据，避免每个任务重复识图导致理解漂移。

## Usage

```text
/asdm-harness-design-parse <FT-XXX 编码>
```

## Process

### ⛔ 前置条件检查

1. **确定特性编码**：从用户输入中提取 FT-XXX 格式编码（如 `FT-8331`），从中解析出 ADS workItemId

2. **检查 PRD 总体设计文档**：
    - 检查 `../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-PRD.md`
    - 验证已包含 §1 总体概述 和 §2 使用场景
    - **如不存在或未完成** → 终止，提示用户先执行 `/asdm-harness-design-overall FT-{id}`

3. **定位设计图目录**：`../../../.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/design/`
    - **目录不存在或为空** → 终止，提示无需执行本 action：

      ```text
      ℹ️ 未找到设计图，无需执行设计图解析。

      可直接执行 /asdm-harness-design-details FT-{id} 进入详细设计。
      ```

4. **已存在 `FT-{id}-{name}-DesignSpec.md`** → 询问用户是重新解析（设计图已更新）还是保留现状：

    ```text
    ⚠️ 检测到 FT-{id}-{name}-DesignSpec.md 已存在。

    design/ 目录下的原始图片：{N} 张
    已生成规格覆盖：{M} 张

    是否重新解析？(输入 "重新解析" 覆盖 / "跳过" 保留现有文件)
    ```

   用户选择「跳过」→ 终止，提示可直接进入 design-details

5. **前置条件通过**：

    ```text
    ✅ 前置条件检查通过：
    ✓ PRD 总体设计文档存在（§1 + §2 已就位）
    ✓ 检测到设计图 {N} 张

    继续进入设计图解析流程...
    ```

---

### 1. 读取设计图与关联上下文

1. 逐张读取 `design/` 目录下的原始设计图
2. 读取该特性下所有 US 文档的 AC，用于后续建立参考性的字段/区块映射（**仅供标注，不参与解析结果的取舍判断**）
3. 若单个特性下有多张设计图（如列表页 + 创建弹窗 + 详情页），需先根据文件名或图片内容判断每张图对应的页面/交互场景；无法判断时向用户确认：

    ```text
    ❓ 检测到 {N} 张设计图，无法从文件名判断对应场景，请补充说明：

    - Pasted_Graphic_1.png → ?
    - Pasted_Graphic_2.png → ?
    ```

---

### 2. 结构化提取

对每张设计图提取以下信息：

| 提取项 | 说明 |
|:------|------|
| 场景归属 | 该图对应哪个页面/组件/交互点（如"创建团队空间弹窗"） |
| 布局区块 | 页面/弹窗的区域划分（标题栏、表单区、操作区等） |
| 字段清单 | 每个输入字段的名称、是否必填（含视觉标记如红色星号）、输入类型（单行/多行/选择等） |
| 交互元素 | 按钮（含主次样式）、tab、开关等，及其可辨识的默认状态 |
| 状态提示位置 | 错误提示、校验反馈在图中出现的位置和样式（仅记录位置和样式，不臆测具体文案） |
| 关联 AC（参考） | 若能从字段/交互合理对应到某条 AC，标注对应关系，供实现阶段参考 |

**约束**：
- 只提取图中**明确可见**的结构信息，不脑补图中未出现的字段或交互
- 图中出现的具体文案（如示例数据"前端协作组"）如实记录为"示例值"，并明确标注其为示例而非规则，避免被后续开发误当作业务硬编码
- 不做颜色数值、像素间距等精确度量，只记录相对关系（如"主按钮位于右下角，次按钮在其左侧"）

---

### 3. 生成 FT-{id}-{name}-DesignSpec.md

按以下结构组织输出（单文件，多图共用同一文件，按场景分节）：

```markdown
# Design Spec — FT-{id} {特性名称}

> 来源设计图：{图片文件名列表}
> 生成时间：{ISO 8601}
> 解析场景数：{N}

## 场景：{场景名称}（来源：{图片文件名}）

### 布局
{区块划分描述}

### 字段清单
| 字段 | 必填 | 类型 | 备注 |
|:----|:----|:----|:----|
| ... | ... | ... | 示例值："..."（非业务要求）|

### 交互元素
- {按钮/控件}：{位置、样式、说明}

### 状态提示
- {提示类型}：{出现位置}

### 参考 AC 映射（仅供参考，非权威）
- {字段/交互} ↔ {AC 编号}
```

---

### 4. 人工确认

展示提取摘要，等待用户确认后才写入最终文件——**本文件是后续所有任务的复用基础，一旦有误会传导到每个下游任务**：

```text
📋 设计图解析完成 — FT-{id}

解析场景：{N} 个
- {场景1名称}：{字段数} 个字段，{交互元素数} 个交互元素
- {场景2名称}：...

⚠️ 请重点核对：
{列出解析过程中不确定或需要用户澄清的项，如无法判断场景归属、疑似示例文案等}

是否确认写入 FT-{id}-{name}-DesignSpec.md？(输入 "确认" 写入 / 输入修改意见调整后重新确认)
```

用户确认后写入文件；用户提出修改意见 → 按意见调整后重新展示确认。

---

### 5. 同步至 ADS 工作项

添加设计图解析完成评论，**必须遵循 azure-devops-skill 的「评论格式规范」——使用 HTML `<br>` 换行，禁止 Markdown 语法**（本步骤仅添加评论，不变更工作项状态，状态流转由 design-overall/design-details 负责）：

```json
{
  "regUrl": "<auto>",
  "workItemId": "{workItemId}",
  "comment": "🎨 设计图解析完成<br><br>📌 特性: {Feature Name}<br>📄 文档: FT-{id}-{name}-DesignSpec.md<br>🖼️ 来源设计图: {N} 张<br>📊 解析场景: {N} 个<br><br>➡️ 下一步: /asdm-harness-design-details FT-{id}"
}
```

---

### 6. 完成

```text
✅ FT-{id}-{name}-DesignSpec.md 已生成 — FT-{id}

📄 路径：.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-DesignSpec.md
📊 覆盖场景：{N} 个
🔄 ADS 工作项 #{workItemId} — 评论已记录

👉 下一步：执行 /asdm-harness-design-details FT-{id}
系统将结合本文件与 Code Research 结果补充技术方案、数据模型、接口设计等章节。
```

## Purpose

- 将设计图解析这一多模态任务从 develop（编码任务）中解耦，允许两者使用不同模型执行
- 解析结果结构化、可追溯（每项标注来源图片），且经人工确认后落盘，避免"AI 看图理解漂移"污染下游多个任务
- 一次解析、跨任务复用，避免 develop 逐任务重复识图带来的 token 浪费和理解不一致
- 明确将设计图定位为"视觉结构补充"，不越权定义业务规则，从源头降低设计图示例文案被误当成业务要求硬编码进代码的风险

## Input

- 特性编码 FT-XXX（必填）
- PRD 总体设计文档（自动读取 §1 总体概述 + §2 使用场景，来自 `/asdm-harness-design-overall`）
- 设计图文件：`.asdm/workspace/asdm-harness/feat/FT-{id}-{name}/design/*.{png,jpg,svg}`
- 关联 Story 卡片（自动读取，用于参考性映射标注）

## Output

```json
{
  "phase": "design_parse",
  "status": "success",
  "feature_id": "FT-{id}",
  "spec_path": ".asdm/workspace/asdm-harness/feat/FT-{id}-{name}/FT-{id}-{name}-DesignSpec.md",
  "scenes_parsed": 2,
  "source_images": ["Pasted_Graphic_2.png"],
  "needs_review": ["场景归属需人工确认的图片列表（如有）"],
  "next_action": "/asdm-harness-design-details FT-{id}",
  "timestamp": "ISO 8601 datetime"
}
```

## Downstream Flow

```text
/asdm-harness-design-overall        ← 上一步：PRD 总体设计（总体概述 + 使用场景）
        │
        ▼
/asdm-harness-design-parse          ← 当前步骤：设计图解析（可选，仅 UI 特性需要）
        │
        ▼
/asdm-harness-design-details        ← 下一步：PRD 详细设计（结合 DesignSpec + Code Research）
        │
        ▼
/asdm-harness-plan                  ← 后续：开发任务规划
        │
        ▼
/asdm-harness-develop               ← 后续：开发实施（UI 相关任务按需读取 DesignSpec 复核细节）
```

## Spec Reference

- [design-spec.md](../specs/design-spec.md) — DesignSpec 文档的标准结构模板
