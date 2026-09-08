# Context Loader Skill

渐进式上下文加载技能，封装 **L1 → L2 → Source** 三层渐进式加载方法论，为 AI 代理在大规模代码库中提供高效的上下文导航能力。

## 功能

- **三层架构**：L1 顶层索引（<2KB）+ L2 领域索引（<8KB）+ Source 源码精准读取
- **Token 预算优化**：单次加载控制在 <50KB，将 90%+ Token 留给推理与生成
- **代码库适配**：适用于 200万行+ 的企业级代码库
- **Action 集成**：提供标准化的 Context Injection 模板供所有 action 引用

## 核心价值

| 维度 | 传统全量加载 | 渐进式加载 |
|------|------------|-----------|
| 首屏加载 | 30s-5min | <1s (L1 仅 ~2KB) |
| 单次上下文 | 50KB-500KB+ | 2KB-10KB（按需） |
| Token 利用率 | 60-70% | 90%+ |
| AI 决策准确率 | 受噪声稀释 | 高度聚焦 |

## 文件结构

```
~/.aixcoding/skills/context-loader/
├── manifest.json      # 技能元数据
├── SKILL.md           # 核心指令（AI 读取此文件了解方法论）
└── README.md          # 本文件 — 用户说明文档
```

## 适用场景

| 场景 | 加载策略 | 典型 Token 消耗 |
|------|---------|---------------|
| 理解项目全貌 | 仅 L1 | ~1.5 KB |
| 规划新功能 | L1 + 相关 L2 × 2-3 | ~15 KB |
| 修改单模块 | L1 + 单个 L2 + 少量源码 | ~25 KB |
| 跨域修改 | L1 + 多个 L2 + 接口定义 | ~35 KB |
| 架构重构 | L1 + 全部 L2 + 依赖图 | ~50 KB（上限） |

## License

Proprietary. See project root [LICENSE](LICENSE) for terms.
