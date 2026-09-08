> **⚠️ 模板文件声明**
>
> - **本文件性质**：`.asdm/toolsets/asdm-context-builder/specs/layer-2/standard-coding-style.md` 是**规范模板（Spec Template）**，非最终上下文内容。
> - **生成规则**：执行 `/asdm-context-init` 时，AI 应扫描项目中已有的代码文件（Java/TypeScript/Vue），提取实际使用的编码风格、格式配置（如 EditorConfig、Prettier、Checkstyle 等），生成符合团队实际习惯的编码规范，写入 `.asdm/contexts/layer-2/standard-coding-style.md`。
> - **更新规则**：编码规范变更或引入新工具配置时，通过 `/asdm-context-update` 更新已生成的上下文文件。
> - **验证规则**：使用 `/asdm-context-validate` 检查现有代码是否符合上下文中的编码规范。
>
> ---

# 编码规范与风格指南（L2 层）

## 概述

本文档定义了本工作区的编码标准和风格指南。一致的编码风格可以提高代码的可读性、可维护性和协作效率。

## 通用原则

### 1. 可读性优先
- 代码应该易于阅读和理解
- 使用有意义的变量、函数和类名称
- 编写自解释的代码，清晰表达意图

### 2. 一致性
- 在整个代码库中遵循相同的模式
- 使用语言和框架已建立的约定
- 在团队成员间保持风格统一

### 3. 可维护性
- 编写易于修改和扩展的代码
- 保持函数和类的单一职责
- 避免不必要的复杂性

## 各语言编码指南

### TypeScript / JavaScript

#### 命名约定
```typescript
// 变量和函数 — camelCase
const userName = 'John';
function calculateTotal() { }

// 类和接口 — PascalCase
class UserService { }
interface UserData { }

// 常量 — UPPER_SNAKE_CASE
const MAX_RETRY_COUNT = 3;
const API_BASE_URL = 'https://api.example.com';

// 私有成员 — 下划线前缀（可选）
private _internalMethod() { }
```

#### 代码格式
```typescript
// 使用 2 空格缩进
function example() {
  if (condition) {
    // ...
  }
}

// 保持分号一致性
const name = 'John';

// 最大行长：80-100 字符
// 过长行需折行以提高可读性

// 字符串使用单引号（除非需要插值）
const message = 'Hello';
const template = `Hello ${name}`;
```

#### 类型注解
```typescript
// 始终指定返回类型
function add(a: number, b: number): number {
  return a + b;
}

// 使用显式类型替代 'any'
// 不推荐
function process(data: any) { }

// 推荐
function process(data: UserData) { }

// 对象形状使用 interface
interface User {
  id: number;
  name: string;
  email: string;
}
```

### Java

#### 命名约定
```java
// 类和接口 — PascalCase
public class UserService { }
public interface UserRepository { }

// 方法和变量 — camelCase
public void calculateTotal() { }
private String userName;

// 常量 — UPPER_SNAKE_CASE
public static final int MAX_RETRY_COUNT = 3;
private static final String API_BASE_URL = "https://api.example.com";
```

#### 代码格式
```java
// 使用 4 空格缩进
public class Example {
    public void method() {
        if (condition) {
            // ...
        }
    }
}

// 左大括号在同一行
public void example() {
    // ...
}

// 每行一个语句
// 不推荐
int a = 1; int b = 2;

// 推荐
int a = 1;
int b = 2;
```

#### 注解和修饰符
```java
// 标准修饰符顺序
public static final String CONSTANT = "value";

// 使用 @Override 注解
@Override
public String toString() {
    return "User";
}
```

### Vue 组件

#### 单文件组件结构
```vue
<template>
  <!-- 模板部分 -->
</template>

<script setup lang="ts">
// 1. 导入
import { ref, computed } from 'vue'
import type { User } from '@/types'

// 2. Props 和 Emits
const props = defineProps<{ userId: number }>()
const emit = defineEmits<{
  (e: 'update', value: string): void
}>()

// 3. 响应式状态
const loading = ref(false)
const data = ref<User | null>(null)

// 4. 计算属性
const displayName = computed(() => data.value?.name ?? '')

// 5. 方法
async function fetchData() { }

// 6. 生命周期
onMounted(() => {
  fetchData()
})
</script>

<style scoped>
/* 样式部分 */
</style>
```

## 常见模式

### 错误处理
```typescript
// 使用 try-catch 处理预期错误
try {
  const result = await apiCall();
} catch (error) {
  // 处理特定错误类型
  if (error instanceof NetworkError) {
    // 重试逻辑
  } else if (error instanceof ValidationError) {
    // 显示用户消息
  }
}

// 不要吞掉异常
// 不推荐
try {
  riskyOperation();
} catch (e) {
  // 空的 catch 块
}

// 推荐
try {
  riskyOperation();
} catch (e) {
  logger.error('操作失败', e);
  throw new OperationFailedError('操作失败', e);
}
```

### 日志记录
```typescript
// 使用适当的日志级别
logger.debug('详细的调试信息');
logger.info('一般信息');
logger.warn('警告消息');
logger.error('错误发生');

// 在日志中包含上下文
logger.info('用户登录', { userId: user.id, timestamp: new Date() });

// 不记录敏感信息
// 不推荐
logger.info('用户认证成功', { password: user.password });

// 推荐
logger.info('用户认证成功', { userId: user.id });
```

### 注释和文档

#### 何时添加注释
- 解释"为什么"而非"是什么"（代码应自解释）
- 记录复杂算法或业务逻辑
- 标记临时方案或变通方法
- 记录公共 API 和接口定义

#### 注释风格
```typescript
/**
 * 计算含税总价。
 * 
 * @param items - 含价格和数量的商品数组
 * @param taxRate - 税率，小数形式（如 0.08 表示 8%）
 * @returns 含税后的总价
 */
function calculateTotalWithTax(items: Item[], taxRate: number): number {
  // 计算小计
  const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  
  // 应用税率
  return subtotal * (1 + taxRate);
}
```

## 测试标准

### 测试结构
```typescript
describe('UserService', () => {
  let userService: UserService;
  let mockRepository: jest.Mocked<UserRepository>;

  beforeEach(() => {
    mockRepository = {
      findById: jest.fn(),
      save: jest.fn(),
    };
    userService = new UserService(mockRepository);
  });

  describe('createUser', () => {
    it('应使用有效数据创建用户', async () => {
      // 准备
      const userData = { name: 'John', email: 'john@example.com' };
      mockRepository.save.mockResolvedValue({ id: 1, ...userData });

      // 执行
      const result = await userService.createUser(userData);

      // 断言
      expect(result.id).toBe(1);
      expect(mockRepository.save).toHaveBeenCalledWith(userData);
    });
  });
});
```

### 测试命名
- 使用描述性的测试名称
- 遵循格式：`should [期望行为] when [条件]`
- 示例：`should return user when valid ID is provided`

## 代码审查要点

### 审查清单
1. **功能性**：代码是否按预期工作？
2. **可读性**：代码是否易于理解？
3. **测试覆盖**：是否有充分的测试？
4. **性能**：是否存在性能问题？
5. **安全性**：是否存在安全漏洞？
6. **可维护性**：代码是否易于维护？

### 审查建议
- 建设性和具体化的反馈
- 提供替代方案，而不仅是批评
- 关注代码本身，而非个人
- 使用"我们"的表达方式："我们应当考虑..."

## 工具配置

### EditorConfig
```ini
# .editorconfig
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.java]
indent_size = 4

[*.{ts,vue}]
indent_size = 2
```

---

*这些编码标准应根据具体的项目需求和团队偏好进行调整。定期审查和更新本文档是被鼓励的做法。*
