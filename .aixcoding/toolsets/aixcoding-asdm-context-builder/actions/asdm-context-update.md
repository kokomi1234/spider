# 上下文更新指令（asdm-context-update）

## 目的

本指令引导 AI 模型在发生变更时更新现有工作区上下文文件。

## 语言检测

在更新任何上下文文件之前，必须检测并使用当前环境的响应语言：

1. **检测响应语言**：分析环境设置以确定主要语言：
   - 检查系统/用户语言设置或环境配置
   - 识别项目文档和注释中使用的主要语言
   - 根据工作区上下文确定语言偏好

2. **应用语言一致性**：确保所有更新的上下文文件使用检测到的语言：
   - 所有 Markdown 文件、注释和文档使用相同语言
   - 在所有更新的上下文文件中保持语言一致性
   - 遵循检测语言的写作规范和格式要求

3. **支持的语言**：
   - 中文（zh）
   - 英文（en）
   - 根据环境检测需要的其他语言

**重要说明**：语言检测是任何上下文更新之前的**第一步**。在整个过程中所有输出必须一致使用检测到的语言。

## 步骤 0 — 前置检查（目标文件存在性与状态评估）

**在执行任何更新操作之前，必须先确认目标文件的当前状态**。

### 0.1 确定目标范围

根据用户请求确定本次更新的目标文件列表：
- 若用户指定了具体文件名 → 仅针对该文件
- 若用户未指定但描述了变更类型（如"架构变了"）→ 映射到对应的 L2 文件
- 若用户请求全量更新 → 覆盖所有已有上下文文件

### 0.2 扫描并验证目标文件存在性

对每个目标文件，检查其在 `.aixcoding/contexts/` 目录中是否实际存在：

| 检查项 | 操作 |
|--------|------|
| `index.md` | 使用 `read_file` 读取，确认文件可正常解析 |
| `layer-2/*.md` | 先 `list_dir` 确认 `layer-2/` 目录存在，再逐一 `read_file` |

**若目标文件不存在**：
- 对于用户明确指定的缺失文件 → **警告用户**该文件尚未生成，建议先运行 `/asdm-context-init` 或单独生成该 L2 文件
- 对于全量更新时发现的缺失 L2 文件 → 记录到报告中的「待生成」清单，不自动创建（init 的职责）

### 0.3 快速一致性预检（启发式）

对已存在的目标文件，执行快速的一致性预检，判断是否**确实需要更新**：

1. **index.md 预检**：
   - 对比文件中的目录树 vs 当前 `list_dir` 结果
   - 检查技术栈版本号 vs package.json / pom.xml 实际值
   - 检查服务端口表 vs 实际配置文件

2. **L2 文件预检**：
   - 抽样检查文件中引用的关键路径是否存在（使用 `search_file` 或 `list_dir`）
   - 检查 API 端点列表 vs controller 代码中的 `@RequestMapping`
   - 检查数据模型字段 vs entity 类定义

3. **输出预检结论**：

| 结论 | 含义 | 后续动作 |
|------|------|----------|
| ✅ 无需更新 | 文件内容与实际项目一致 | 跳过该文件，告知用户 |
| ⚠️ 建议更新 | 发现不一致之处 | 列出差异点，等待用户确认后执行更新步骤 |

### 0.4 输出前置检查摘要并向用户确认

```markdown
## 更新前置检查

**目标文件**：{用户指定的文件 / 全量}
**扫描时间**：{时间戳}

### 文件存在性

| 目标文件 | 存在 | 一致性预检 | 建议 |
|----------|------|------------|------|
| index.md | ✅ / ❌ | ✅ 一致 / ⚠️ 需更新 | 跳过 / 待更新 / 不存在需先 init |
| layer-2/architecture.md | ... | ... | ... |

### 差异概要（仅 ⚠️ 文件）
- `index.md` 第 N 行：目录树缺少新增的 `xxx/` 目录
- ...
```

**若所有文件均显示 ✅ 一致** → 直接告知用户无需更新，结束流程。  
**若存在 ⚠️ 文件** → 等待用户确认后再进入正式更新步骤。

## 触发更新时机

当以下情况发生时需要更新上下文：
- 新增或删除了文件/目录
- 技术栈变更（新框架、库、工具）
- 数据模型被修改
- API 端点被新增/修改/删除
- 部署配置变更
- 架构演进
- 编码标准被更新

## 执行步骤

### 1. 检查现有上下文

审查 `.aixcoding/contexts/` 目录中的现有上下文文件，了解当前状态。

### 2. 基于 Manifest 的增量变更分析

**核心原则**：优先读取 `manifest.json` 获取上次验证锚点，通过 `git diff` 精准定位代码库变更范围，避免全量扫描浪费 Token。

#### 2.1 读取 Manifest 锚点

```bash
# 检查 manifest 是否存在
test -f .aixcoding/contexts/manifest.json && echo "EXISTS" || echo "MISSING"
```

| 状态 | 处理方式 |
|------|----------|
| **存在且可解析** | 提取 `commitSha` 作为 diff 基准点，进入 2.2 |
| **不存在 / 解析失败** | 回退为全量模式：对整个工作区执行 `git log --oneline -20` 获取近期变更概览，提示用户建议先运行 `/asdm-context-validate` 生成 manifest |

#### 2.2 执行增量 Diff

以 manifest 中的 `commitSha` 为基准，执行：

```bash
# 获取变更文件清单（相对于锚点 commit）
git diff {commitSha} HEAD --name-only

# 获取新增文件（锚点之后的新文件）
git diff {commitSha} HEAD --diff-filter=A --name-only

# 获取删除的文件
git diff {commitSha} HEAD --diff-filter=D --name-only
```

> **脏工作区处理**：若 `manifest.isDirty === true` 或当前 `git status --porcelain` 非空，额外执行：
> ```bash
> git diff HEAD --name-only          # 未暂存变更
> git diff --cached --name-only      # 已暂存未提交变更
> ```

#### 2.3 变更文件 → 上下文文件映射

将 git diff 输出的变更文件路径映射到需要更新的 L1/L2 上下文文件：

| 变更文件模式示例 | 影响的上下文文件 | 映射规则 |
|-----------------|-----------------|---------|
| `package.json`, `pom.xml`, `*.lock` | `index.md`, `standard-project-structure.md` | 技术栈版本、依赖变更 |
| `web/qa-web/src/router/*`, `web/qa-web/src/views/*` | `standard-project-structure.md`, `architecture.md` | 页面路由增删改 |
| `web/qa-web/src/store/index.ts` | `data-models.md`, `architecture.md` | 数据模型接口变更 |
| `web/qa-web/src/data/*.json` | `data-models.md` | 数据记录数/结构变化 |
| `server/*/controller/*` | `api.md` | API 端点变更 |
| `server/*/config/*` | `deployment.md`, `api.md` | 配置项（CORS、端口等） |
| `server/*/src/main/resources/application*` | `deployment.md`, `api.md` | 后端配置变更 |
| `Dockerfile`, `docker-compose*`, `k8s*` | `deployment.md` | 容器化配置变更 |
| `.eslintrc*`, `.editorconfig`, `tsconfig*` | `standard-coding-style.md` | 编码规范工具链变更 |
| 根目录结构变更（新目录/删除目录） | `index.md` | 文件树更新 |

输出映射结果：

```markdown
## 变更分析结果

**锚定 Commit**：`{shortSha}` → **当前 HEAD**：`{currentShortSha}`
**变更文件数**：{N}

| 变更文件 | 变更类型 | 受影响的上下文文件 |
|---------|---------|------------------|
| `web/qa-web/src/views/NewPage.vue` | 新增 | standard-project-structure.md, architecture.md |
| `server/qa-service-user/.../NewController.java` | 新增 | api.md, architecture.md |

**待更新上下文文件**：{列表}
```

#### 2.4 无 Git 变更时的处理

若 `git diff {commitSha} HEAD --name-only` 输出为空且工作区干净：

- **直接告知用户无需更新**，结束流程
- 不执行后续步骤，节省 Token

### 2.5 以 Spec 为参考基准

使用 `specs/` 目录中的规范模板作为参考点来更新上下文：
**重要说明**：翻译并适配所有规范模板内容为检测到的语言，确保文本、示例和解释的自然准确本地化。
- 将当前工作区状态与规范模板要求进行对比
- 根据实际工作区分析结果定制规范模板内容
- 确保更新的同时符合规范标准并反映真实情况

### 3. 按需更新特定上下文文件

基于用户请求逐一更新上下文文件以确保高质量输出：
**每个文件应单独更新，且必须使用检测到的语言**：

- 用户指定需要更新的上下文文件
- 使用检测到的语言单独更新请求的文件
- 与其他上下文文件保持一致
- 等待用户审查后再继续下一个更新

仅更新受变更影响的上下文文件：

#### 结构性变更时：
- 更新 `index.md` 中的新文件树和注释（使用检测到的语言）
- 如果项目组织结构发生了变化，更新 `standard-project-structure.md`（使用检测到的语言）

#### 技术变更时：
- 更新 `index.md` 的技术栈部分（使用检测到的语言）
- 如果编码标准发生变化，更新 `standard-coding-style.md`（使用检测到的语言）

#### 数据模型变更时：
- 使用新的/修改过的模型更新 `data-models.md`（使用检测到的语言）
- 更新图表和关系描述

#### API 变更时：
- 使用新的/修改过的端点更新 `api.md`（使用检测到的语言）
- 更新示例数据和文档（使用检测到的语言）

#### 部署变更时：
- 使用新配置更新 `deployment.md`（使用检测到的语言）
- 更新部署图表

#### 架构变更时：
- 使用新的架构决策更新 `architecture.md`（使用检测到的语言）
- 更新架构图表

### 4. 保持一致性

确保所有上下文文件之间保持一致：
- 文件之间的交叉引用应准确无误
- 所有文件中的术语应统一（使用检测到的语言）
- 图表应反映当前状态
- 所有更新文件的语言使用应保持统一

### 5. 刷新 Manifest 锚点

**每次更新完成后，必须刷新 `manifest.json` 中的锚点信息。**

> **格式规范**：详见 [`manifest-spec.md`](../specs/manifest-spec.md)（含字段定义、写入时机）。

#### 5.1 获取当前 Git 状态

```bash
git rev-parse HEAD                          # 新的完整 commit SHA
git rev-parse --short HEAD                  # 短 hash
git branch --show-current                   # 当前分支名
git status --porcelain                      # 脏状态检测
```

#### 5.2 更新 Manifest 文件

按 `manifest-spec.md` 定义的 JSON 结构覆盖写入 `.asdm/contexts/manifest.json`（锚点前移至当前 HEAD）。

#### 5.3 写入并验证

覆盖写入 `.asdm/contexts/manifest.json` 后：
- 验证 JSON 格式有效性（确保无截断或语法错误）
- 在向用户的最终摘要中包含 Manifest 引用

```markdown
## 版本快照已更新

| 项目 | 值 |
|------|-----|
| 上次锚点 Commit | `{oldShortSha}` |
| **新锚定 Commit** | **`{newShortSha}`** |
| 本次更新文件数 | {N} |
| Manifest | [.asdm/contexts/manifest.json](../../contexts/manifest.json) |

> 下次 `/asdm-context-update` 或 `/asdm-context-validate` 将以新锚点为基准。
```

## 使用方法

1. 首先检测并应用环境的响应语言
2. **读取 `manifest.json`，获取上次验证锚点 Commit SHA**
3. 执行 `git diff {commitSha} HEAD --name-only` 获取变更范围
4. 将变更文件映射到受影响的上下文文件
5. 基于用户请求按需逐个更新上下文文件（关注增量更新而非全量重生成）
6. **刷新 `manifest.json` 锚点至当前 HEAD**
7. 在整个更新过程中始终使用检测到的语言

这种分阶段方式确保：
- 高效的 Token 使用
- 每次更新更高的输出质量
- 用户对更新顺序的控制能力
- 可根据反馈进行调整
- 所有上下文文件的语言一致性

## 输出质量保证（Markdown Lint）

每次更新上下文文件后，必须对该文件执行 Markdown 语法质量检查：

### 1. 加载 Skill 规范

首先读取 `.asdm/skills/markdownlint/SKILL.md`，获取完整的验证工作流、规则说明、配置方法和修复指南。后续所有验证步骤均遵循该 Skill 定义。

### 2. 逐文件验证

每个上下文文件更新完成后立即执行验证（不等待全部更新完毕），验证方式参照 SKILL.md「核心工作流」章节。

### 3. 处理验证结果

- **Exit code 0**：✅ 通过，继续处理下一个文件或向用户报告完成
- **Exit code 1**：⚠️ 发现问题：
   - 可自动修复 → 参照 SKILL.md 执行修复流程后重新确认
   - 需人工判断 → 记录问题，在最终变更摘要中一并报告用户

### 4. 全量复查

所有文件更新完毕后，对 `.aixcoding/contexts/` 目录执行一次全量复查确保一致性。

### 5. Mermaid 图表专项

如更新的文件包含 Mermaid 代码块，参照 SKILL.md「Mermaid 图表专项检查」章节执行额外检查。

## 输出摘要

执行完成后将产生或更新：

| 输出项 | 路径 | 说明 |
|--------|------|------|
| 更新的上下文文件 | `.aixcoding/contexts/**/*.md` | 根据变更范围实际修改的 L1/L2 文件 |
| 版本快照（Manifest） | `.aixcoding/contexts/manifest.json` | 锚点前移至当前 HEAD |

## Manifest 驱动的增量更新工作流

以下为 `asdm-context-validate` 与 `asdm-context-update` 通过 `manifest.json` 协作的完整闭环：

```text
                    ┌─────────────────────────┐
                    │  asdm-context-validate   │
                    │                         │
                    │  1. 验证全部上下文文件    │
                    │  2. git rev-parse HEAD    │──→ 获取 commitSha A
                    │  3. 写入 manifest.json    │   (锚定 commit = A)
                    │     {commitSha: A, ...}  │
                    └────────┬────────────────┘
                             │
                    开发者提交新代码...
                             ▼
                    ┌─────────────────────────┐
                    │  asdm-context-update     │
                    │                         │
                    │  1. 读取 manifest.json   │──→ 提取 commitSha A
                    │  2. git diff A HEAD      │──→ 获取变更文件列表
                    │  3. 映射 → 受影响上下文    │
                    │  4. 增量更新目标文件       │
                    │  5. git rev-parse HEAD    │──→ 获取 commitSha B
                    │  6. 刷新 manifest.json    │   (锚定前移 → B)
                    │     {commitSha: B, ...}  │
                    └─────────────────────────┘
```

**关键约束**：
- 若 `manifest.json` 不存在，update 回退为全量模式，并建议先执行 validate
- 每次更新**必须**刷新 manifest 锚点，否则下次增量 diff 基准过期
- manifest 中 `isDirty=true` 时需额外检查未提交的变更