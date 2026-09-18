/**
 * 已订阅服务管理模块
 * 
 * 功能：
 * 1. 管理已订阅的服务编码列表
 * 2. 支持手动添加/删除
 * 3. 支持批量导入/导出
 * 4. 本地存储持久化
 */

const SUBSCRIBE_STORAGE_KEY = 'subscribed_services';

class SubscribeManager {
  constructor() {
    this.services = this._load();
    // 结果表每一行都要问一次「是否已订阅」，用数组 includes 是 O(n)：
    // 200 行 × 数百订阅 ≈ 数万次比较/渲染。索引成 Set 后查询降到 O(1)。
    // services 仍保留数组，因为导出需要维持用户的添加顺序。
    this._index = new Set(this.services);
  }

  /**
   * 从 localStorage 加载。
   * 存量数据不可信（旧版本、手工改过、别的页面写坏过）：非数组或含非字符串元素时
   * 一律过滤成空/合法列表 —— 否则 `new Set(非可迭代对象)` 会在构造函数里抛错，
   * 整个订阅管理模块建不出来，「已订阅」判定全线失效。
   */
  _load() {
    try {
      const data = localStorage.getItem(SUBSCRIBE_STORAGE_KEY);
      if (!data) return [];
      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((s) => typeof s === 'string' && s !== '');
    } catch (e) {
      console.warn('加载已订阅列表失败:', e);
      return [];
    }
  }

  /** 保存到 localStorage */
  _save() {
    try {
      localStorage.setItem(SUBSCRIBE_STORAGE_KEY, JSON.stringify(this.services));
    } catch (e) {
      console.warn('保存已订阅列表失败:', e);
    }
  }

  /** 获取所有已订阅服务 */
  getAll() {
    return [...this.services];
  }

  /** 检查是否已订阅 */
  isSubscribed(serverCoding) {
    return this._index.has(serverCoding);
  }

  /** 添加单个服务 */
  add(serverCoding) {
    if (!serverCoding || this.isSubscribed(serverCoding)) return false;
    this.services.push(serverCoding);
    this._index.add(serverCoding);
    this._save();
    return true;
  }

  /** 删除单个服务 */
  remove(serverCoding) {
    const idx = this.services.indexOf(serverCoding);
    if (idx === -1) return false;
    this.services.splice(idx, 1);
    this._index.delete(serverCoding);
    this._save();
    return true;
  }

  /** 批量导入 */
  import(codings) {
    if (!Array.isArray(codings)) return 0;
    let added = 0;
    codings.forEach(code => {
      if (code && !this.isSubscribed(code)) {
        this.services.push(code);
        this._index.add(code);
        added++;
      }
    });
    this._save();
    return added;
  }

  /** 批量导出 */
  export() {
    return this.services.join('\n');
  }

  /** 清空所有 */
  clear() {
    this.services = [];
    this._index.clear();
    this._save();
  }

  /** 统计数量 */
  count() {
    return this.services.length;
  }
}

// 全局单例
window.SubscribeManager = new SubscribeManager();
