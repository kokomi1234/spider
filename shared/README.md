# 团队共享数据（本机落盘，不入库）

这个目录放**需要跨机器看同一份**的运行时数据，由代理
（`publish/proxy.js` 的 `/local/*` 端点）读写，前端不直接碰文件。

## 当前数据

| 文件 | 用途 | 对应端点 |
| --- | --- | --- |
| `saved-queries.db` | 首页「常用查询」的团队库（SQLite） | `GET/POST /local/saved-queries` |
| `saved-queries.json` | **降级产物**：SQLite 用不上的时候才落到这里（见下面「什么时候会降级」） | 同上 |
| `saved-queries.example.json` | 空模板（入库，用来占位目录结构） | — |

`saved-queries.db*` 与 `.json` 都**不入库**（含真实查询条件 / 人名 / 部门，见根 `.gitignore`），
首次写入时代理会自动创建。

## 为什么常用查询要落成 SQLite

一句话：**JSON 文件回答不了「同一份查询条件被多少人保存过」**。

JSON 里一条记录只有一个 `owner`。同一份条件（比如「调用方=E00406 的全部服务」）被 10 个人
各存一份，文件里就是 10 条互不相识的记录 —— 既合并不起来，也说不清它到底被多少人用过。
现在拆成两张表：

| 表 | 存什么 |
| --- | --- |
| `saved_queries` | 查询本体（页面、名字、条件 fields、指纹、hits） |
| `saved_query_savers` | **谁**保存过它（工号/姓名/部门/时间），按 `query_id + user_key` 唯一 |
| `saved_query_tombstones` | 墓碑：删掉的记录留 30 天，防止同事的旧副本把它「复活」 |

于是两种视图一次拿到：

- **一个人的常用查询** → `savers` 表里这个人关联的所有查询；
- **部门高频查询** → 同一份条件，按部门过滤后 `COUNT(DISTINCT 人)`，**人多者排前**。

依赖只有 Node 内置的 `node:sqlite`（Node ≥ 22.5），**不装任何 npm 包**，
内网 / 离线环境照样跑（跟 vendoring playwright-core 一个思路）。

### 什么时候会降级到 JSON（两条触发，不只「Node 版本不够」那一条）

1. **这台 Node 没有可用的 `node:sqlite`**（< 22.5，或内置模块被裁掉）；
2. **SQLite 打不开** —— 目录不可写、库文件权限不够、**库被另一个进程以独占方式打开**
   （`proxy.js` 的 `getQueriesStore()` 把 `open()` 的异常整块 catch 掉，只往控制台打一行
   「SQLite 打开失败，回落 JSON 文件: <原因>」，页面上一切看起来正常）。

降级后功能不残废，但**部门排行退回前端本机算**：JSON 分支的响应只发 `mode:'all'`，
而前端 `deptTopFromServer` 明确要求 `mode === 'dept'` 才用服务端结果
（2026-09-19 改严：旧写法 `data.mode && data.mode !== 'dept'` 在 `mode` **缺失**时放行，
那一刻会把**全部门的记录**当成本部门排行渲染到首页卡片上 —— 名不副实且没人报错）。

⚠️ 两条路径写的是**不同的文件**（`.db` 与 `.json`），所以「SQLite 突然打不开」实际等于
换了一个后端：库里的记录不会自动出现在 JSON 那边。遇到角标显示「仅本机 / 同步失败」或
排行口径变了，先去代理控制台看有没有那行回落原因，别当成数据丢了。
两个位置各有一个环境变量：SQLite 用 `PROXY_QUERIES_DB`，**JSON 兜底用 `PROXY_QUERIES_FILE`**
（默认 `shared/saved-queries.json`；旧路径 `publish/config/saved-queries.json` 只在它还不存在时被复制过来）。

## 怎么才算「同一个团队库」

**同一个库文件路径就是同一个库。** 三种用法：

1. **只在本机用**：什么都不用配，默认就是这里的 `shared/saved-queries.db`。
2. **同一个 git 工作区多人用**：路径统一了，但文件不入库、各自各自机器的磁盘 ——
   **这只解决「路径统一」，不解决同步**。
3. **跨机器真正共享**（推荐做法见下）：
   - ✅ **推荐：只跑一份代理，大家都连它。** 在团队里能访问的机器上起 `node proxy.js`，
     同事用 `<那台机器>:3000` 打开页面 —— 只有那一个进程读写这个库，锁是可靠的，
     也不用管文件放哪。这跟「项目跑在一台中间机器上」的部署方式本来就是一致的。
   - ⚠️ **不要把库文件直接放到网络盘（NFS/SMB/同步盘）让多台机器各自写。**
     SQLite 官方明确警告：网络文件系统上的文件锁实现常常不可靠，
     多进程同时写**可能损坏数据库**。真要这么放，至少保证同一时刻只有一台机器写，
     并且接受「偶尔要重建库」的风险。用 `PROXY_QUERIES_DB` 指过去就能生效，但不推荐：

     ```env
     # 仅在你清楚风险时才这样配（反斜杠要写两个）
     PROXY_QUERIES_DB=\\\\nas\\share\\saved-queries.db
     # JSON 兜底的位置：只在「那台 Node 用不上 SQLite」时才被读到（见上一节）。
     # 要真共享就两条一起指过去 —— 只配 DB 的话，一旦降级会落到一个空库上。
     PROXY_QUERIES_FILE=\\\\nas\\share\\saved-queries.json
     ```

   库损坏的代价很小（只是常用查询的历史丢掉），但别把它当成「天然支持多写」。

## 端点一览

```
GET  /local/saved-queries                       → { items, deleted, file, storage, people }
GET  /local/saved-queries?dept=<部门键>&limit=N   → 部门高频：按「几个人保存过」排序
GET  /local/saved-queries?user=<工号或姓名>&limit=N → 这一个人员的常用查询（三个键同比：`user_key`/`user_id`/`user_name`）
POST /local/saved-queries                        → { items, deletedIds }，合并后返回全集
```

部门键的口径和前端一致：`teamId → teamName → orgId → orgName` 取第一个非空
（`SavedQuery.deptKeyOf`）。用 `teamId` 优先是因为 `orgName` 是一级单位（几百人），
按它分组等于没有维度。

## 合并与删除规则（多人同时写不会互相覆盖）

POST 是幂等 upsert，不是「直接覆盖」：

- 查询本体：同 `id` 更新，`hits/saves/时间` 取 **max**，所以反复提交刷不出热度；
- 保存者：同「查询 + 人」更新，`saved_at` 取 max —— **一个人存十遍也只算一个人**；
- 同一份条件（指纹相同）在排行里聚成一行，跨 persons 汇总人数；
- 删除走**墓碑**（保留 30 天），否则同事的本地副本一推送就把删掉的记录「复活」。

## 并发与部署形态（2026-09-19 实测过，结论按部署分两种）

**推荐部署：只跑一份代理，大家连它。** 这种形态下并发是安全的：
2/8/20/60/100 并发、19 轮共 470 次 POST，**全部 200、记录不丢、`savers` 恒对**。
原因是写库的 `upsert` 是同步事务、没有「读-改-写」窗口，
而「几个人保存过」是 SQL 现算的 `COUNT(DISTINCT user_key)`，不是旧 JSON 时代那种「后写者覆盖」
—— 所以这一层**不需要再加文件锁**。

**危险的形态是多份代理开同一个库文件**（例如每人自己起代理、都把 `PROXY_QUERIES_DB`
指到同一个网络盘路径）。实测 12 轮里 11 轮至少一方报 `database is locked`，
「每人只推一次」时库里只剩 33/52 条 —— **真丢记录**。
已补 `PRAGMA busy_timeout = 2000`（把撞上变成排队）缓解，但**根治要单写者**：
一份代理、多人连它，而不是一个文件多人写。
（SQLite 官方也警告网络文件系统上的锁实现常不可靠，见其 FAQ。）

## 备份与恢复（⚠️ 别直接 cp 那个 .db）

`saved-queries.db` 是 **WAL 模式**，最近的写入都还在 `saved-queries.db-wal` 里，
主库文件本身可能只有几 KB。2026-09-21 实测：主库 4 KB、`-wal` 1.79 MB，
**只拷 `.db` 一个文件打开会报 `no such table: saved_queries`** —— 连表都没有，数据全丢。
代理进程被强杀后 WAL 也不会自动合并回主库。

**正确做法：用现成的备份脚本**（走 SQLite `VACUUM INTO`，产出**自包含的单文件**）：

```bash
cd publish
node tools/backup-queries-db.js                  # 备份到 shared/backups，默认保留 14 份
node tools/backup-queries-db.js --keep 30         # 保留 30 份
node tools/backup-queries-db.js --out /data/bk    # 换目录
```

**恢复**：
1. 停掉代理；
2. 用选中的 `saved-queries-YYYYMMDD-HHMMSS.db` 覆盖 `shared/saved-queries.db`；
3. **删掉同目录的 `-wal` / `-shm`** —— 那是旧库的残页，留着会被当成新库的一部分。

真要手工拷贝，必须连带 `-wal` 和 `-shm` 三个文件一起搬，且拷贝期间没有写入。

## 默认只绑本机，共享要显式打开

`proxy.js` 默认 `listen(PORT, '127.0.0.1')`：这台机器以外访问不到。
要让同事连同一份代理，在根目录 `.env` 里设 `PROXY_HOST=0.0.0.0`。

⚠️ **注意：`/local/*`、`/cache/*`、`/admin/*` 目前完全不鉴权，且 CORS 是 `*`**
—— 同网段任何人都能读光、改写、删空这份团队库，也能一键清空录制缓存。
这是 2026-09-20 用户拍板的选择（内网自用、一台部署），**不是漏配**。
（更早版本有过 `PROXY_ADMIN_TOKEN` 开关，**已在 2026-09-20 整体删除**，别再照旧文档去设它；
现在要收窄只能设 `PROXY_HOST=127.0.0.1` 只绑本机。）

> 历史：2026-09-19 之前用的是 `publish/config/saved-queries.json`。
> 首次落成库时会自动把那里的旧记录迁进来，旧文件保留不动，确认不用后可自行删除。
