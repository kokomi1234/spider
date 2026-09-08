#!/usr/bin/env node
/**
 * 路径验证工具 - 验证项目中的文件路径正确性
 *
 * Usage:
 *   tsx src/main.ts --validate <path>
 *   tsx src/main.ts --validate-and-link <path>
 *   tsx src/main.ts --batch files.json
 *   tsx src/main.ts --file-list paths.txt
 */

import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { relative, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ValidationResult, BatchConfig, CliArgs } from './types.js';

// ============================================================================
// PathValidator
// ============================================================================

class PathValidator {
  private readonly basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath ?? process.env.ASDM_ROOT ?? resolve('.');
  }

  /** 验证单个文件路径 */
  validateFile(filePath: string): ValidationResult {
    const fullPath = this.resolvePath(filePath);
    const exists = existsSync(fullPath);

    const result: ValidationResult = {
      filePath: fullPath,
      exists,
      filename: basename(fullPath),
      relativePath: this.getRelativePath(fullPath),
    };

    if (exists) {
      result.relativeLink = this.generateRelativeLink(fullPath);
      result.markdownRow = this.generateMarkdownRow(fullPath);
    }

    return result;
  }

  /** 批量验证文件路径 */
  validateFiles(filePaths: string[]): ValidationResult[] {
    return filePaths.map((p) => this.validateFile(p));
  }

  // ---- 私有方法 ----

  private resolvePath(filePath: string): string {
    if (filePath.startsWith(this.basePath)) {
      return filePath;
    }
    return join(this.basePath, filePath);
  }

  private getRelativePath(fullPath: string): string {
    const rel = relative(this.basePath, fullPath);
    // relative() 返回空字符串表示路径相同
    if (rel === '') return basename(fullPath);
    // 如果路径无法相对化（跨驱动器等），返回原路径
    if (rel.startsWith('..')) return fullPath;
    return rel;
  }

  private generateRelativeLink(fullPath: string): string {
    const relPath = this.getRelativePath(fullPath);
    return `../../${relPath}`;
  }

  private generateMarkdownRow(fullPath: string): string {
    const filename = basename(fullPath);
    const link = this.generateRelativeLink(fullPath);
    return `| \`${filename}\` | [查看代码](${link}) |`;
  }
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(raw: string[]): CliArgs {
  const args: CliArgs = {};

  for (let i = 2; i < raw.length; i++) {
    const arg = raw[i];
    switch (arg) {
      case '--validate': {
        args.validate = raw[++i];
        break;
      }
      case '--validate-and-link': {
        args.validateAndLink = raw[++i];
        break;
      }
      case '--batch': {
        args.batch = raw[++i];
        break;
      }
      case '--file-list': {
        args.fileList = raw[++i];
        break;
      }
      case '--base-path': {
        args.basePath = raw[++i];
        break;
      }
      case '--verbose': {
        args.verbose = true;
        break;
      }
      case '--help':
      case '-h': {
        args.help = true;
        break;
      }
      default: {
        // ignore unknown flags
        break;
      }
    }
  }

  return args;
}

function printHelp(): void {
  console.log('路径验证工具');
  console.log('');
  console.log('Usage:');
  console.log('  tsx src/main.ts --validate <file-path>');
  console.log('  tsx src/main.ts --validate-and-link <file-path>');
  console.log('  tsx src/main.ts --batch <config.json>');
  console.log('  tsx src/main.ts --file-list <paths.txt>');
  console.log('');
  console.log('Options:');
  console.log('  --validate <path>           验证单个文件路径，输出 JSON');
  console.log('  --validate-and-link <path>  验证文件路径并生成 Markdown 链接');
  console.log('  --batch <json-file>         从 JSON 配置文件批量验证');
  console.log('  --file-list <txt-file>      从换行分隔的文本文件批量验证');
  console.log('  --base-path <path>          指定项目根目录（默认 $ASDM_ROOT 或当前目录）');
  console.log('  --verbose                   详细输出');
  console.log('  --help, -h                  显示帮助');
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help || Object.keys(args).length === 0) {
    printHelp();
    process.exit(0);
  }

  const validator = new PathValidator(args.basePath);

  // --validate: 输出 JSON
  if (args.validate) {
    const result = validator.validateFile(args.validate);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // --validate-and-link: 输出 Markdown 行
  if (args.validateAndLink) {
    const result = validator.validateFile(args.validateAndLink);
    if (result.exists) {
      console.log(result.markdownRow);
    } else {
      console.log(`文件不存在: ${result.filePath}`);
      process.exitCode = 1;
    }
    return;
  }

  // --batch: 从 JSON 配置文件批量验证
  if (args.batch) {
    const raw = readFileSync(args.batch, 'utf-8');
    const config: BatchConfig = JSON.parse(raw);
    const files = config.files ?? [];

    if (files.length === 0) {
      console.error('错误: 配置文件中没有 files 字段或为空数组');
      process.exit(1);
    }

    const results = validator.validateFiles(files);
    for (const result of results) {
      if (result.exists) {
        console.log(result.markdownRow);
      } else {
        console.log(`# 文件不存在: ${result.filename}`);
      }
    }
    return;
  }

  // --file-list: 从文本文件批量验证（每行一个路径）
  if (args.fileList) {
    const raw = readFileSync(args.fileList, 'utf-8');
    const files = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const results = validator.validateFiles(files);
    for (const result of results) {
      console.log(JSON.stringify(result));
    }
    return;
  }

  // 没有有效命令
  printHelp();
}

main();
