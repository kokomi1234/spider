> **⚠️ 模板文件声明**
>
> - **本文件性质**：`.asdm/toolsets/asdm-context-builder/specs/layer-2/standard-project-structure.md` 是**规范模板（Spec Template）**，非最终上下文内容。
> - **生成规则**：执行 `/asdm-context-init` 时，AI 应扫描 `server/`、`web/` 等目录的实际结构，确认服务列表、目录命名、分层约定后，生成完整内容并写入 `.asdm/contexts/layer-2/standard-project-structure.md`。新增服务时须同步更新「当前已注册服务」表格。
> - **更新规则**：新增 `{domain}/` 子目录或调整项目结构后，通过 `/asdm-context-update` 同步更新已生成的上下文文件。
> - **验证规则**：使用 `/asdm-context-validate` 对比上下文与实际目录结构是否一致。
>
> ---

# 标准项目结构（L2 层）

## 概述

本文档定义了本工作区的标准项目结构。它提供了组织文件和目录的指导原则，以保持一致性并促进协作。

## 项目结构模板

### 整体结构
```
project-root/
├── .asdm/                          # ASDM 配置和工具集
│   ├── contexts/                   # AI 上下文文件
│   │   ├── index.md                # L1 层入口文件
│   │   └── layer-2/               # L2 层详细上下文
│   └── toolsets/                   # 已安装的工具集
├── server/                         # ★ 后端服务根目录（多服务 Monorepo）
│   │                               #   — 第 1 级：服务容器，不直接包含源码
│   │                               #   — 第 2 级：各独立后端服务项目
│   ├── qa-service-{domain}/        # ★ 第 2 级 — 独立服务项目（见下方详细说明）
│   │   ├── pom.xml                 # Maven 构建配置
│   │   ├── mvnw / mvnw.cmd         # Maven Wrapper
│   │   ├── src/
│   │   │   ├── main/java/com/leansofx/qaservice{Domain}/
│   │   │   │   ├── *Application.java      # Spring Boot 启动类
│   │   │   │   ├── controller/            # REST 控制器层
│   │   │   │   ├── service/               # 业务逻辑层
│   │   │   │   ├── repository/            # 数据访问层
│   │   │   │   ├── model/ 或 entity/      # 实体类/数据模型
│   │   │   │   ├── dto/                   # 数据传输对象
│   │   │   │   ├── config/                # 配置类
│   │   │   │   └── util/ 或 common/       # 工具类
│   │   │   ├── main/resources/
│   │   │   │   ├── application.yml / application.properties
│   │   │   │   └── static/                # 静态资源（如需）
│   │   │   └── test/java/                 # 测试代码
│   │   ├── docs/                  # 服务专属文档（可选）
│   │   ├── README.md              # 服务说明文档（可选）
│   │   ├── start.sh / stop.sh     # 运维脚本（可选）
│   │   └── target/                # Maven 编译输出（不入库）
│   └── ...                        # 更多服务项目按需添加
├── web/                            # 前端应用
│   ├── src/                        # 源码
│   │   ├── api/                    # API 调用封装
│   │   ├── assets/                 # 静态资源
│   │   ├── components/             # 可复用组件
│   │   ├── views/ 或 pages/        # 页面组件
│   │   ├── router/                 # 路由配置
│   │   ├── stores/                 # 状态管理
│   │   ├── utils/                  # 工具函数
│   │   ├── App.vue                 # 根组件
│   │   └── main.ts/js              # 入口文件
│   ├── public/                     # 公共资源
│   ├── package.json
│   └── vite.config.ts              # Vite 配置
├── deploy/                         # 部署与发布配置
│   ├── Dockerfile                  # 容器镜像构建
│   ├── docker-compose.yml          # 本地编排
│   ├── config/                     # 多环境配置
│   │   ├── development/            # 开发环境
│   │   ├── staging/                # 预发布环境
│   │   └── production/             # 生产环境
│   └── ...                         # 其他部署相关配置（K8s、Nginx 等）
├── docs/                           # 用户操作手册（面向最终用户）
└── README.md                       # 项目说明
```

### 后端服务标准结构详解（server/）

`server/` 采用 **两级多服务 Monorepo** 结构。第 1 级是服务容器目录，第 2 级是各独立的后端服务项目。

#### 命名规范

| 层级 | 格式 | 示例 | 说明 |
|------|------|------|------|
| 服务目录 | `qa-service-{domain}` | `qa-service-user`、`qa-service-question`、`qa-service-statistic` | domain 为业务领域的小写英文 |
| Java 包路径 | `com.leansofx.qaservice{Domain}` | `com.leansofx.qaserviceuser` | Domain 首字母大写，与目录对应 |
| 启动类 | `{Domain}Application.java` | `QaServiceUserApplication.java` | PascalCase |

#### 当前已注册服务

| 服务目录 | 业务领域 | 包路径 | 状态 |
|----------|---------|--------|------|
| `qa-service-question/` | 问答服务 | `com.leansofx.qaservicequestion` | ✅ 已实现 |
| `qa-service-statistic/` | 统计服务 | `com.leansofx.qaservicestatistic` | 🔲 预留（占位） |
| `qa-service-user/` | 用户服务 | `com.leansofx.qaserviceuser` | ✅ 已实现 |

> **新建服务时**，在 `server/` 下创建新的 `qa-service-{domain}/` 目录，遵循上述命名和内部结构规范。

## 目录用途与约定

### 后端服务目录（server/）

`server/` 是**多服务 Monorepo 根目录**，采用两级目录结构承载后端服务：

**第 1 级 — `server/`（服务容器）**
- 不直接包含源码文件
- 仅作为各独立服务的父级容器
- 新建服务时在此层级创建子目录

**第 2 级 — `qa-service-{domain}/`（独立服务项目）**
- 每个目录是一个完整的 Spring Boot + Maven 独立项目
- 拥有独立的 `pom.xml`、`mvnw`、源码和测试
- 内部遵循标准分层架构：
  - **`controller/`**：处理 HTTP 请求和响应，负责参数校验和调用 Service 层
  - **`service/`**：核心业务逻辑实现，事务管理在此层处理
  - **`repository/`**：数据持久化操作，继承 Spring Data JPA 接口
  - **`model/` 或 `entity/`**：JPA 实体类，映射数据库表
  - **`dto/`：数据传输对象，用于 Controller 与外部交互的数据格式
  - **`config/`**：Spring Boot 配置类（如 Security、CORS、Swagger 等）
  - **`util/` 或 `common/`**：工具类

### 前端代码目录（web/）
- **`components/`**：可复用的 UI 组件
- **`views/` 或 `pages/`**：页面级组件，对应路由页面
- **`api/`**：封装后端 API 调用（axios/fetch 封装）
- **`stores/`**：Pinia/Vuex 状态管理模块
- **`router/`**：路由定义和导航守卫
- **`utils/`**：通用工具函数

### 部署配置（deploy/）
- **多环境配置**：`deploy/config/` 下按环境分离（development / staging / production）
- **容器化部署**：Dockerfile + docker-compose.yml 位于 `deploy/` 根目录
- **配置外置**：敏感配置不提交到版本控制
- **密钥管理**：绝不将密钥提交到版本控制

## 命名约定

### 后端服务（server/ 下的独立项目）
- 服务目录：**`qa-service-{domain}`**，domain 为业务领域小写英文，如 `qa-service-user`、`qa-service-order`
- Java 包路径：**`com.leansofx.qaservice{Domain}`**，Domain 首字母大写
- Spring Boot 启动类：**`{Domain}Application.java`**

### 文件和目录
- 目录名使用 **kebab-case**：`user-management`、`order-service`
- Java 文件使用 **PascalCase**：`UserController.java`
- TypeScript/Vue 组件使用 **PascalCase**：`UserService.ts`、`UserForm.vue`
- 工具函数文件使用 **kebab-case**：`date-utils.ts`

### 测试文件
- 测试文件后缀：`Test.java`（Java）、`.spec.ts` 或 `.test.ts`（TypeScript）
- 测试文件放在与源码平行的目录中
- 使用描述性测试名称：`UserService.createUser.spec.ts`

## 最佳实践

### 1. 服务边界清晰（server/）
- 每个服务对应一个明确的业务领域，遵循领域驱动设计（DDD）原则
- 新增业务域时在 `server/` 下新建 `qa-service-{domain}/` 目录
- 服务间通信通过 API 调用，避免直接跨包引用

### 2. 模块化
- 保持模块的内聚性和低耦合
- 最小化模块间的依赖
- 使用清晰的接口定义层间边界

### 3. 可扩展性
- `server/` 两级结构支持按需添加新服务而不影响已有项目
- 避免过深的嵌套（最多 3-4 层）
- 大型项目使用功能域文件夹组织

### 4. 可维护性
- 类似项目间保持一致的结构（统一 `qa-service-*` 命名和分层）
- 清晰的关注点分离
- 新开发者易于导航

---

*本模板应根据工作区的具体技术栈和项目需求进行定制化。*
