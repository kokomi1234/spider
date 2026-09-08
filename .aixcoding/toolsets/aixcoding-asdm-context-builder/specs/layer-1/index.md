> **⚠️ 模板声明**
>
> - 本文件是规范模板（Spec Template），非最终内容。
> - 执行 `/asdm-context-init` 时，AI 扫描项目后将 `[占位符]` 替换为真实信息，写入 `.asdm/contexts/index.md`。
> - 更新用 `/asdm-context-update`，验证用 `/asdm-context-validate`。

---

# [项目名称] — 工作区上下文索引

## 基本信息

- **名称**：[项目名称]
- **描述**：[一句话描述项目用途]
- **技术栈**：[语言] + [框架] + [构建工具]

## 目录结构

> 标注说明：`[边界]` = 独立业务/技术域，已生成或待生成对应 `CONTEXT.md`；`[分层-见约定]` = 技术分层目录（如 controller/service/entity 等模式化结构），不单独生成索引，归并至最近 `[边界]` 节点的"分层架构约定"一节。

```
{根目录}/
├── .asdm/
│   ├── contexts/                    # ★ 上下文文件
│   │   ├── index.md                # ★ 本文件（L1 入口）
│   │   └── layer-2/                # 主题型 L2（横切文档）
│   └── toolsets/
├── [server]/                        [边界]
│   ├── [module1]/                   [边界]
│   │   └── src/.../{controller,service,entity,...}  [分层-见约定]
│   └── [module2]/                   [边界]
├── [web]/                           [边界]
│   └── src/{api,components,...}     [边界或分层，视目录职责是否分叉而定]
└── ...                              # 其他目录
```

## 服务与端口

| 服务 | 端口 | 说明 |
|------|------|------|
| [前端] | [端口] | [说明] |
| [后端服务A] | [端口] | [说明] |
| [后端服务B] | [端口] | [说明] |

## 开发命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动全部服务 |
| `npm run dev:web` | 仅启动前端 |
| `npm run build` | 构建生产版本 |

## 主题型 L2 上下文导航（横切文档）

| 文件 | 说明 | 状态 |
|------|------|------|
| [standard-project-structure.md](./layer-2/standard-project-structure.md) | 项目结构详情 | 待生成 |
| [standard-coding-style.md](./layer-2/standard-coding-style.md) | 编码规范 | 待生成 |
| [data-models.md](./layer-2/data-models.md) | 数据模型 | 待生成 |
| [deployment.md](./layer-2/deployment.md) | 部署配置 | 待生成 |
| [api.md](./layer-2/api.md) | API 文档 | 待生成 |
| [architecture.md](./layer-2/architecture.md) | 架构设计 | 待生成 |

## 结构型上下文导航（业务边界节点）

> 仅列 `[边界]` 目录对应的 `CONTEXT.md`，分散存放于各自源码目录下，不集中在 `layer-2/`。
> "分层约定"列标注该节点的技术分层架构约定定义在何处，避免同构 module 之间重复生成。

| 节点路径 | 说明 | 分层约定 | 状态 |
|------|------|------|------|
| [server/CONTEXT.md](../../[server]/CONTEXT.md) | [后端总览] | 定义于此 | 待生成 |
| [server/module1/CONTEXT.md](../../[server]/[module1]/CONTEXT.md) | [模块1业务说明] | 遵循 server/CONTEXT.md | 待生成 |
| [server/module2/CONTEXT.md](../../[server]/[module2]/CONTEXT.md) | [模块2业务说明] | 遵循 server/CONTEXT.md | 待生成 |
| [web/CONTEXT.md](../../[web]/CONTEXT.md) | [前端总览] | 无（不含技术分层子目录） | 待生成 |

---

*由 ASDM 上下文构建工具集维护。*
