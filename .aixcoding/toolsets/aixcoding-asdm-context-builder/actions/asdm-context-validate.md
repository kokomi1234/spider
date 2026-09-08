# 上下文验证指令（asdm-context-validate）

## 目的

本指令引导 AI 模型检查现有上下文文件的准确性，识别过时或不一致的内容，并生成诊断报告。

## 语言检测

在验证任何上下文文件之前，必须检测并使用当前环境的响应语言：

1. **检测响应语言**：分析环境设置以确定主要语言
2. **应用语言一致性**：确保验证报告使用检测到的语言
3. **支持的语言**：中文（zh）、英文（en）及其他

## 步骤 0 — 前置检查（目标文件存在性扫描）

**在执行任何验证操作之前，必须先确认目标文件是否实际存在**。避免对不存在的文件执行无意义的验证或生成误导性的错误报告。

### 0.1 扫描 `.aixcoding/contexts/` 目录

使用 `list_dir` 扫描以下位置，获取实际的文件清单：
- `.asdm/contexts/` — 根目录（应包含 `index.md`）
- `.asdm/contexts/layer-2/` — L2 目录（可能包含部分或全部 L2 文件）

记录每个找到的文件名及其状态。

### 0.2 对比目标清单与实际文件

根据用户指定的验证范围，建立目标文件清单，然后逐一核对是否存在：

| 目标文件 | 预期位置 | 实际存在 | 状态 |
|----------|----------|----------|------|
| `index.md` | `.asdm/contexts/` | ✅ / ❌ | 可验证 / 缺失 |
| `standard-project-structure.md` | `layer-2/` | ✅ / ❌ | 可验证 / 缺失 |
| `standard-coding-style.md` | `layer-2/` | ✅ / ❌ | 可验证 / 缺失 |
| `data-models.md` | `layer-2/` | ✅ / ❌ | 可验证 / 缺失 |
| `deployment.md` | `layer-2/` | ✅ / ❌ | 可验证 / 缺失 |
| `api.md` | `layer-2/` | ✅ / ❌ | 可验证 / 缺失 |
| `architecture.md` | `layer-2/` | ✅ / ❌ | 可验证 / 缺失 |

### 0.3 处理缺失文件

对于目标清单中不存在的文件：

1. **区分缺失类型**：
    - **从未生成**：该 L2 文件在 `index.md` 的导航表中标记为「待生成」 → 归类为"待创建"，不属于验证问题
    - **已被删除**：该文件曾被生成但现已不存在 → 归类为"异常缺失"，应在报告中标记为错误

2. **将结果纳入报告**：

```markdown
## 目标文件存在性检查

| 文件 | 状态 | 备注 |
|------|------|------|
| index.md | ✅ 存在 | — |
| architecture.md | ✅ 存在 | — |
| standard-project-structure.md | 🔴 缺失（待生成） | index.md 标记为「待生成」，建议运行 `/asdm-context-init` |
| api.md | 🔴 缺失（待生成） | 同上 |
| ... | ... | ... |

> 注：标记为「待生成」的缺失文件不计入健康度评分扣分项。
> 若发现「异常缺失」（曾被生成但被删除），计为错误项。
```

### 0.4 输出扫描摘要并调整验证范围

向用户展示前置检查结果：
- 若有缺失文件 → 明确告知哪些文件将跳过验证及原因
- 仅对**实际存在的文件**继续后续验证步骤（步骤 1+）
- 动态调整后续验证范围，移除不存在的文件

## 执行步骤

### 1. 加载验证范围

确定要验证的范围：
- **全量验证**：验证 `.aixcoding/contexts/` 下的所有上下文文件
- **指定文件验证**：仅验证用户指定的文件
- **增量验证**：基于最近的 git 变更范围，验证可能受影响的上下文文件

### 2. 读取现有上下文文件

读取需要验证的所有上下文文件：
- L1 层：`index.md` — 入口文件
- L2 层：`standard-project-structure.md`、`standard-coding-style.md`、`data-models.md`、`deployment.md`、`api.md`、`architecture.md`

### 3. 对比实际工作区

对每个上下文文件，对比其内容与实际工作区代码的差异：

#### 验证 index.md（L1 层）
- [ ] 文件树是否与实际目录结构一致
- [ ] 技术栈信息（框架版本、依赖）是否正确
- [ ] 构建/测试命令是否可用且正确
- [ ] L2 层上下文文件引用链接是否有效
- [ ] 关键目录说明是否准确

#### 验证 standard-project-structure.md（L2 层）
- [ ] 描述的项目结构是否与实际一致
- [ ] 目录用途说明是否匹配当前代码组织
- [ ] 命名约定是否符合实际情况

#### 验证 standard-coding-style.md（L2 层）
- [ ] 编码规范描述是否反映团队当前的实践
- [ ] 配置文件路径是否存在且配置正确（如 .eslintrc、.editorconfig 等）
- [ ] 代码示例是否符合项目实际风格

#### 验证 data-models.md（L2 层）
- [ ] 实体/表定义是否与数据库 Schema 或实体类一致
- [ ] 关系描述（一对多、多对多等）是否准确
- [ ] Mermaid ER 图是否与实际数据模型匹配
- [ ] 字段名称、类型、约束是否正确

#### 验证 api.md（L2 层）
- [ ] API 端点列表是否完整（无遗漏的新端点）
- [ ] 请求/响应格式是否与控制器代码一致
- [ ] 示例数据是否仍然有效
- [ ] 已废弃/删除的端点是否仍被列出

#### 验证 deployment.md（L2 层）
- [ ] 部署配置（Dockerfile、K8s YAML 等）是否与仓库中的一致
- [ ] 环境变量列表是否准确
- [ ] CI/CD 流程描述是否反映当前配置

#### 验证 architecture.md（L2 层）
- [ ] 架构组件是否与实际服务/模块对应
- [ ] 组件间关系是否正确
- [ ] Mermaid 架构图是否反映当前设计

### 4. 生成诊断报告

将验证结果写入报告文件：

**输出路径**：`.aixcoding/workspace/asmd-context/validation-reports/validation-{日期}.md`

**报告模板**：

```markdown
# 上下文验证报告

**验证时间**：{YYYY-MM-DD HH:mm}
**验证范围**：{全量/指定文件/增量}
**验证人**：AI Agent（asdm-context-validate）

## 总览

| 指标 | 数值 |
|------|------|
| 已验证文件数 | {N} |
| 通过检查项 | {M} |
| 警告项（轻微不一致） | {K} |
| 错误项（严重不一致） | {J} |
| 健康度评分 | {X}% |

## 详细结果

### ✅ 通过的文件
- `filename.md` — 无问题发现

### ⚠️ 存在警告的文件

#### filename.md
| # | 类型 | 位置 | 说明 | 建议修复动作 |
|---|------|------|------|-------------|
| W01 | 过期内容 | 第 N 行 | 具体描述 | 建议运行 `/asdm-context-update filename.md` |

### ❌ 存在错误的文件

#### filename.md
| # | 类型 | 位置 | 说明 | 建议修复动作 |
|---|------|------|------|-------------|
| E01 | 缺失内容 | 第 N 行 | 具体描述 | 建议补充... |
| E02 | 不一致 | 第 N 行 | 具体描述 | 建议更正为... |

## 修复建议优先级

1. **[高]** {最紧急的问题}
2. **[中]** {建议尽快处理的问题}
3. **[低]** {可延后处理的改进}

## 下一步操作

- 运行 `/asdm-context-update [文件名]` 修复指定问题
- 或运行 `/asdm-context-update` 进行全量更新
```

### 5. 生成版本快照（Manifest）

**在展示摘要之前，必须生成或更新版本快照文件**。该文件记录本次验证时代码库的 Git 状态，作为后续 `asdm-context-update` 执行增量更新的基准锚点。

> **格式规范**：详见 [`manifest-spec.md`](../specs/manifest-spec.md)（含字段定义、用途说明）。

#### 5.1 获取当前 Git 提交信息

通过 `git` 命令获取工作区当前状态：

```bash
git rev-parse HEAD                          # 完整 commit SHA
git rev-parse --short HEAD                  # 短 hash（前 8 位）
git branch --show-current                   # 当前分支名
git status --porcelain                      # 工作区脏状态标记
```

> **前置条件**：若当前目录不是 Git 仓库（无 `.git` 目录），跳过本步骤并在报告中注明「非 Git 仓库，未生成 Manifest」。

#### 5.2 构建 Manifest 对象

按 `manifest-spec.md` 定义的 JSON 结构组装数据，覆盖写入 `.aixcoding/contexts/manifest.json`。

#### 5.3 在验证报告中引用 Manifest

在诊断报告的头部区域添加 Manifest 引用块：

```markdown
## 版本快照

| 项目 | 值 |
|------|-----|
| 锚定 Commit | `023005f1` |
| 分支 | `feat/leixu/0516-build-harness-toolset` |
| Manifest | [.aixcoding/contexts/manifest.json](../contexts/manifest.json) |

> 此 Commit 作为后续 `asdm-context-update` 执行增量 diff 的基准点。
```

### 6. 展示摘要

向用户展示验证结果的简洁摘要，包括：
- 整体健康度评分
- 最关键的问题列表
- 建议执行的下一步操作
- **锚定的 Git Commit SHA（来自 Manifest）**

## 使用方法

1. 选择验证范围（全量/指定/增量）
2. 自动对比上下文文件与实际代码
3. 生成版本快照 `manifest.json`（锚定当前 Git Commit）
4. 生成结构化的诊断报告
5. 基于报告决定是否需要执行更新

## 输出摘要

执行完成后将产生：

| 输出项 | 路径                                                                        | 说明 |
|--------|---------------------------------------------------------------------------|------|
| 验证报告 | `.aixcoding/workspace/asdm-context/validation-reports/validation-{日期}.md` | 含健康度评分、问题清单、修复建议 |
| 版本快照（Manifest） | `.aixcodign/contexts/manifest.json`                                       | 含 Git Commit SHA、分支，作为 `asdm-context-update` 的 diff 基准锚点 |

### Manifest 用途说明

> 详见 [`manifest-spec.md`](../specs/manifest-spec.md)「用途」章节。

## 输出质量保证（Markdown Lint）

验证报告自身也是 Markdown 文件，必须确保其语法正确性和渲染质量：

### 1. 加载 Skill 规范

首先读取 `.aixcoding/skills/markdownlint/SKILL.md`，获取完整的验证工作流、规则说明和修复指南。后续所有验证步骤均遵循该 Skill 定义。

### 2. 验证报告文件

生成 `validation-{日期}.md` 报告后，对报告本身执行语法检查，方式参照 SKILL.md「核心工作流」章节。

### 3. 同时验证被检文件

在生成报告的过程中，也应对本次验证范围内的上下文文件执行 markdownlint 检查（双重保障）。将发现的**语法层面问题**（与内容准确性问题区分）单独记录到报告中：

```markdown
## Markdown 语法质量

| 文件 | 状态 | 问题数 | 说明 |
|------|------|--------|------|
| index.md | ✅ / ⚠️ | N | 通过 / 存在格式问题 |
| ... | | | |
```

### 4. 处理流程

1. 先运行 markdownlint 获取语法层面的诊断结果（命令参照 SKILL.md）
2. 再进行语义层面的上下文准确性对比
3. 两类问题分开记录，不混淆
4. 如发现可自动修复的语法问题，按 SKILL.md 修复指南处理并记录