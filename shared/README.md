# 团队共享数据（本机落盘，不入库）

这个目录放**需要跨机器看同一份**的运行时数据，由代理
（`publish/proxy.js` 的 `/local/*` 端点）读写，前端不直接碰文件。

## 当前数据

| 文件 | 用途 | 对应端点 |
| --- | --- | --- |
| `saved-queries.db` | 首页「常用查询」的团队库（SQLite） | `GET/POST /local/saved-queries` |
| `saved-queries.json` | **降级产物**：Node < 22.5 时才用它 | 同上 |
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
Node 版本不够时代理自动回落 JSON 文件，功能不残废，只是部门排行退回前端本机算。

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
     ```

   库损坏的代价很小（只是常用查询的历史丢掉），但别把它当成「天然支持多写」。

## 端点一览

```
GET  /local/saved-queries                       → { items, deleted, file, storage, people }
GET  /local/saved-queries?dept=<部门键>&limit=N   → 部门高频：按「几个人保存过」排序
GET  /local/saved-queries?user=<工号>&limit=N     → 这一个人员的常用查询
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

## 并发

只有 SQLite 的 WAL 模式与 upsert，**没有跨进程文件锁**：多人同一瞬间写，
可能出现后写者覆盖某些 max 值的极小概率偏差（记录不会丢）。真高频并发再说。

> 历史：2026-09-19 之前用的是 `publish/config/saved-queries.json`。
> 首次落成库时会自动把那里的旧记录迁进来，旧文件保留不动，确认不用后可自行删除。
