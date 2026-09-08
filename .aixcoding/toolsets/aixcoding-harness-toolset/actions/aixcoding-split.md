---
name: aixcoding-split
description: 'Story拆分：AI自动选择拆分策略(7种模式)→生成Given-When-Then AC→INVEST内建自评。'
---

# AIxCoding Split — Story 拆分

基于 discover+design 的产出，将 Feature 拆解为 INVEST 合格的 Story 集合。
**AI 自动选择拆分策略，不展示菜单**。

## 整合

| 原步骤 | 集成方式 |
|--------|----------|
| f2s-prepare | Feature 三要素分析（从 discover+design 合成） |
| f2s-split | AI 自动选策略（7 种模式，基于特征信号匹配） |
| f2s-evaluate | INVEST 六维度内建自评（I/N/V/E/S/T） |

## Input

| 输入项 | 来源 | 必填 | 说明 |
|--------|------|:--:|------|
| Feature ID | 用户 | ✅ | |
| 业务需求文档 | 01 `.aixcoding/workspace/discovery/<id>/` | 自动 | |
| 技术方案 + DoD | 02 `.aixcoding/workspace/design/<id>/` | 自动 | |

## Workflow

### 1. 合成 Feature 三要素

从 discover+design 提取 Who/What/Why（不重复做），定义 Feature 边界。

### 2. AI 自动选择拆分策略

**七种拆分模式及信号检测规则**（Richard Lawrence）：

| # | 模式 | 信号关键词 | 权重触发 |
|---|------|-----------|:--:|
| 1 | Workflow Steps | 流程/步骤/先/再/然后 | +3 |
| 2 | Business Rule | 规则/策略/条件/是否/权限/角色 | +3 |
| 3 | Data Variations | 类型/格式/多种/CSV/PDF | +3 |
| 4 | Operations/CRUD | 管理/增删改查/维护/查看/编辑 | +3 |
| 5 | Interface Type | H5/小程序/API/Web/移动端/多端 | +3 |
| 6 | Defer Performance | 性能/缓存/优化/大数据量/分页 | +2 |
| 7 | Simple/Complex | 基础/增强/高级/核心/进阶 | +2 |

取最高权重 1-2 种组合使用。在 story-list.md 中给出选择理由。

### 3. 生成 Story 卡片

每条 Story 含：
- 标准格式："作为…我想要…以便…"
- Given-When-Then AC（2-5 条）
- 双向依赖标注
- 拆分模式标记
- **粒度控制**：1-3 天可完成，纵向切片（端到端可交付）

### 4. INVEST 内建自评

生成时逐维度检查，不合格当场修正：

| 维度 | 评分 | 不通过动作 |
|:--:|:--:|------|
| I 独立性 | ✅⚠️❌ | 拆分或标注依赖 |
| N 可协商性 | ✅⚠️❌ | 移除实现细节，保留目标 |
| V 有价值性 | ✅⚠️❌ | 合并横向切片为纵向 |
| E 可估算性 | ✅⚠️❌ | 补充上下文澄清 |
| S 适当大小 | ✅⚠️❌ | 拆分过大或合并过小 |
| T 可测试性 | ✅⚠️❌ | 补充 Given-When-Then AC |

全部 ✅ → 通过。存在 ⚠️ → 自动修正后产出。存在 ❌ → 当场修正。

### 5. Mermaid 依赖图 + Story Map

## Story ID 规则

在拆分前先为 Story 生成 ID，**必须继承 Feature ID 前缀**：

| 项 | 规则 |
|----|------|
| 格式 | `<Feature-ID>-US-<2 位数字>`，如 `FT-001-US-01` |
| 前缀 | 继承自 discover 分配的 Feature ID（如 `FT-001`），**禁止另建 `FT-xxx` / `US-xx` 等新前缀** |
| 序号 | 从 `01` 递增，两位数字补零 |
| 落盘 | 卡片保存到 `stories/<feature-id>/<Feature-ID>-US-XX.md` |
| 传递 | Story ID 作为 specify 的输入沿用 |

## Output

```
.aixcoding/workspace/stories/<feature-id>/
├── feature-prep.md            # 三要素分析（从 discover+design 合成）
├── story-list.md              # Story 清单 + Mermaid 依赖图 + 拆分策略说明
├── <Feature-ID>-US-XX.md      # Story 卡片（用户故事 + AC + INVEST 自评）
└── evaluation-report.md       # INVEST 六维度矩阵 + 统计摘要 + 优化建议
```

## Guardrails

- 不展示菜单，AI 自主选择策略并说明理由
- 纵向切片：禁止前端/后端/数据库横向拆分
- INVEST 不合格不产出（当场修正）
- AC 必须可测试（Given-When-Then）

## 使用

`/aixcoding-split <feature-id>`

> 产出的 Story ID 形如 `FT-001-US-01`，前缀固定继承 Feature ID，供 specify 追溯引用。
