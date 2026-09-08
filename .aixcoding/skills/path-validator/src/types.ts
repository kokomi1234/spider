/**
 * 路径验证结果
 */
export interface ValidationResult {
  /** 文件的绝对路径 */
  filePath: string;
  /** 文件是否存在 */
  exists: boolean;
  /** 文件名（含扩展名） */
  filename: string;
  /** 相对于项目根目录的路径 */
  relativePath: string;
  /** Markdown 相对链接（仅 exists=true 时） */
  relativeLink?: string;
  /** Markdown 表格行（仅 exists=true 时） */
  markdownRow?: string;
}

/**
 * 批量配置文件格式
 */
export interface BatchConfig {
  /** 待验证的文件路径列表 */
  files: string[];
  [key: string]: unknown;
}

/**
 * CLI 参数
 */
export interface CliArgs {
  validate?: string;
  validateAndLink?: string;
  batch?: string;
  fileList?: string;
  basePath?: string;
  verbose?: boolean;
  help?: boolean;
}
