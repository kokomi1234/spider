---
name: path-validator
description: 'File path validation utility for verifying source code paths before generating Markdown links in review/progress reports. Use this skill whenever generating code file references in .md documents. Triggers for: (1) Validating code paths before adding to reports, (2) Generating verified Markdown links for code files, (3) Batch validating file lists'
license: Proprietary. See LICENSE.txt for complete terms
---

# Path Validator Skill — 代码路径验证

## Overview

本技能封装 `path-validator` TypeScript 工具，为 AI 代理在生成报告时提供标准化的文件路径验证能力。当 AI 需要在 Markdown 文档中引用项目代码文件时，应使用此技能验证路径正确性后再生成链接。

## Prerequisites（前置条件）

### 检查 Node.js 环境

```bash
which node && node --version
```

### 安装依赖

```bash
cd ~/.aixcoding/skills/path-validator
npm install
```

## 核心工作流

### 工作流 A：验证单个路径

```bash
cd ~/.aixcoding/skills/path-validator
npx tsx src/main.ts --validate <绝对或相对路径>
```

### 工作流 B：验证并生成 Markdown 链接

```bash
cd ~/.aixcoding/skills/path-validator
npx tsx src/main.ts --validate-and-link <绝对或相对路径>
```

输出示例：`| UserController.java | [查看代码](../../server/...) |`

### 工作流 C：批量验证

```bash
cd ~/.aixcoding/skills/path-validator
npx tsx src/main.ts --batch files.json
```

## 配置

基础路径自动检测为项目根目录。`config.json` 中的 `path_patterns` 可按需扩展。

## 常用命令速查

| 操作 | 命令 |
|------|------|
| **验证单个文件** | `npx tsx src/main.ts --validate <path>` |
| **验证并生成链接** | `npx tsx src/main.ts --validate-and-link <path>` |
| **批量验证** | `npx tsx src/main.ts --batch files.json` |
| **从文件列表验证** | `npx tsx src/main.ts --file-list paths.txt` |

## 与 Action 集成

在任何需要生成代码文件引用的 action 中调用：

```text
## 路径验证

在列出代码文件路径之前，使用 path-validator 技能验证路径：

1. 将待验证的路径写入临时 JSON 文件
2. 执行 `npx tsx ~/.aixcoding/skills/path-validator/src/main.ts --batch <json>`
3. 仅对验证通过（exists=true）的文件生成 Markdown 链接
4. 对不存在的文件标注为"文件不存在"
```
