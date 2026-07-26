# easy-mcps

**简体中文** | [English](./README.en.md)

统一权限控制的数据库 MCP 服务器集合。9 种数据库，同一套权限模型、同一套安全防线。

## 支持的数据库

### MySQL 兼容
- [MySQL](./mysql-mcp/) - MySQL 数据库
- [TiDB](./tidb-mcp/) - 分布式 NewSQL 数据库
- [OceanBase](./oceanbase-mcp/) - 国产分布式数据库
- [MariaDB](./mariadb-mcp/) - MySQL 分支
- [StarRocks](./starrocks-mcp/) - MPP 数据库

### PostgreSQL 兼容
- [PostgreSQL](./postgresql-mcp/) - PostgreSQL 数据库

### 其他
- [ClickHouse](./clickhouse-mcp/) - OLAP 列式数据库（支持集群）
- [SQLite](./sqlite-mcp/) - 轻量级嵌入式数据库
- [Redis](./redis-mcp/) - 键值存储数据库

## 工具列表

| 工具 | SQL 类型 | 说明 |
|------|---------|------|
| `read_query` | SELECT/SHOW/DESC/EXPLAIN/WITH | 只读查询（含元数据查询与执行计划） |
| `write_query` | INSERT/UPDATE/REPLACE | 写入数据 |
| `delete_query` | DELETE/TRUNCATE | 删除数据（危险） |
| `ddl_query` | CREATE/DROP/ALTER TABLE/DATABASE/INDEX/VIEW | 表结构操作（危险） |

Redis 使用 `read` / `write` / `admin` 三工具，命令按类别校验（read 工具无法执行写/管理命令）。

ClickHouse 语义映射：`ALTER TABLE ... UPDATE` 归 write，`DELETE FROM` / `TRUNCATE` / `ALTER TABLE ... DELETE` 归 delete；支持 `CLICKHOUSE_HOSTS` 配置多节点自动故障转移，DDL 可携带 `ON CLUSTER`。

## 权限配置

使用 `MCP_PERMISSIONS` 环境变量配置权限，支持数组或逗号分隔格式：

```json
"MCP_PERMISSIONS": ["read", "write"]
"MCP_PERMISSIONS": "read,write"
```

| 权限值 | 说明 |
|--------|------|
| `read` | 读操作（默认开启） |
| `write` | 写操作 |
| `delete` | 删除操作 |
| `ddl` | 表结构操作 |
| `admin` | 管理操作（仅 Redis） |

不配置 `MCP_PERMISSIONS` 时，默认只有 `read` 权限。未开启的权限对应的工具不会出现在工具列表里。

## 安全机制

**语句级校验**
- 所有 SQL 工具强制单条语句，拒绝 `SELECT 1; DROP TABLE x` 这类多语句绕过
- 只读通道拒绝 data-modifying CTE、`EXPLAIN ANALYZE` 写语句、`INTO OUTFILE`、`SELECT INTO` 等借道写入
- SQL 剥离器按方言处理注释与转义（`#` 仅 MySQL 系是注释、反斜杠仅 MySQL 系转义引号），
  避免因方言差异产生单语句检测绕过

**数据库层第二道防线**（校验被绕过时仍然拦得住）

| 数据库 | 机制 |
|--------|------|
| MySQL 系 | 只读语句在 `SET TRANSACTION READ ONLY` 事务中执行 |
| PostgreSQL | 读写分池，读池连接强制 `default_transaction_read_only=on` |
| ClickHouse | 只读查询带 `readonly=2` 设置 |
| SQLite | 读走独立的 readonly 连接 |

**资源保护**
- 查询结果默认最多 1000 行（`MCP_MAX_ROWS`）且不超过 1MB（`MCP_MAX_BYTES`），超出截断并提示
- 单条查询默认 30 秒超时（`MCP_QUERY_TIMEOUT`），Redis 命令同样生效

### 最小权限建议（最终兜底）

SQL 校验和会话只读都是应用层防线，最可靠的兜底是给 MCP 使用**最小权限的数据库账号**：

- 只读场景：创建仅有 `SELECT`（及元数据查看）权限的账号，即使校验被绕过也无法写入
- 读写场景：只授予目标库的 DML 权限，不给 DDL / 管理权限（`SUPER`、`FILE`、`GRANT` 等）
- Redis 6+ 可用 ACL 限制命令与 key 前缀，如 `ACL SETUSER mcp on +@read ~app:*`
- 不要用 root / 管理员账号连接 MCP

## 安装使用

### npx 直接运行（推荐）

```json
{
  "mcpServers": {
    "mysql": {
      "command": "npx",
      "args": ["-y", "@easy-mcps/mysql-mcp-server"]
    }
  }
}
```

### npm 全局安装

```bash
npm install -g @easy-mcps/mysql-mcp-server
```

### 本地路径

```json
{
  "mcpServers": {
    "mysql": {
      "command": "node",
      "args": ["/path/to/mysql-mcp/dist/index.js"]
    }
  }
}
```

## 环境变量参考

### 通用（所有包生效）

| 变量 | 必填 | 说明 |
|------|------|------|
| `MCP_PERMISSIONS` | 可选 | 权限控制，如 `read,write` 或 `["read","write"]` |
| `MCP_MAX_ROWS` | 可选 | 查询结果最大返回行数，默认 `1000` |
| `MCP_MAX_BYTES` | 可选 | 返回文本最大字节数，默认 `1048576`（1MB） |
| `MCP_QUERY_TIMEOUT` | 可选 | 单条查询/命令超时（毫秒），默认 `30000` |

### MySQL 系（MySQL / TiDB / OceanBase / MariaDB / StarRocks）

以 MySQL 为例，其余包把前缀换成 `TIDB_` / `OCEANBASE_` / `MARIADB_` / `STARROCKS_` 即可
（这些包同时兼容 `MYSQL_` 前缀作为回退）。

| 变量 | 必填 | 说明 |
|------|------|------|
| `MYSQL_URL` | 可选 | 连接字符串，如 `mysql://user:pass@host:3306/db` |
| `MYSQL_HOST` | 可选 | 主机地址，默认 `localhost` |
| `MYSQL_PORT` | 可选 | 端口，默认 `3306`（TiDB `4000`、OceanBase `2881`、StarRocks `9030`） |
| `MYSQL_USER` | 可选 | 用户名，默认 `root` |
| `MYSQL_PASSWORD` | 可选 | 密码 |
| `MYSQL_DATABASE` | 可选 | 数据库名，默认 `test` |
| `TIDB_SSL` | 可选 | 仅 TiDB：设为 `true` 启用 SSL（适配 TiDB Cloud） |

### PostgreSQL

| 变量 | 必填 | 说明 |
|------|------|------|
| `POSTGRESQL_URL` | 可选 | 连接字符串，如 `postgresql://user:pass@host:5432/db` |
| `DATABASE_URL` | 可选 | 连接字符串（`POSTGRESQL_URL` 的别名） |
| `PGHOST` | 可选 | 主机地址，默认 `localhost` |
| `PGPORT` | 可选 | 端口，默认 `5432` |
| `PGUSER` | 可选 | 用户名，默认 `postgres` |
| `PGPASSWORD` | 可选 | 密码 |
| `PGDATABASE` | 可选 | 数据库名，默认 `postgres` |
| `POSTGRESQL_SSL` / `PGSSLMODE` | 可选 | SSL 模式：`true` / `require` / `verify` / `false` / `disable` |

### ClickHouse

| 变量 | 必填 | 说明 |
|------|------|------|
| `CLICKHOUSE_HOSTS` | 可选 | 集群多节点，逗号分隔如 `ch1:8123,ch2:8123`，连接失败自动切换 |
| `CLICKHOUSE_URL` | 可选 | 单节点连接字符串 |
| `CLICKHOUSE_HOST` | 可选 | 主机地址，默认 `localhost` |
| `CLICKHOUSE_PORT` | 可选 | 端口，默认 `8123`（HTTPS 时 `8443`） |
| `CLICKHOUSE_USER` | 可选 | 用户名，默认 `default` |
| `CLICKHOUSE_PASSWORD` | 可选 | 密码 |
| `CLICKHOUSE_DATABASE` | 可选 | 数据库名，默认 `default` |
| `CLICKHOUSE_SECURE` | 可选 | 设为 `true` 使用 HTTPS |

### SQLite

| 变量 | 必填 | 说明 |
|------|------|------|
| `SQLITE_PATH` | 可选 | 数据库文件路径，默认当前目录 `data.db` |
| `SQLITE_URL` | 可选 | `sqlite:///path/to/database.db` 格式 |

### Redis

| 变量 | 必填 | 说明 |
|------|------|------|
| `REDIS_URL` | 可选 | 连接字符串，支持 `redis://` 和 `rediss://` |
| `REDIS_HOST` | 可选 | 主机地址，默认 `localhost` |
| `REDIS_PORT` | 可选 | 端口，默认 `6379` |
| `REDIS_PASSWORD` | 可选 | 密码 |
| `REDIS_DATABASE` | 可选 | 数据库编号，默认 `0` |
| `REDIS_TLS` / `REDIS_SSL` | 可选 | 设置为 `true` 启用 TLS 加密 |

## 配置示例

### MySQL

```json
{
  "mcpServers": {
    "mysql": {
      "command": "npx",
      "args": ["-y", "@easy-mcps/mysql-mcp-server"],
      "env": {
        "MYSQL_HOST": "localhost",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "root",
        "MYSQL_PASSWORD": "password",
        "MYSQL_DATABASE": "test",
        "MCP_PERMISSIONS": ["read", "write"]
      }
    }
  }
}
```

### PostgreSQL（含 SSL，适配 Neon 等云数据库）

```json
{
  "mcpServers": {
    "postgresql": {
      "command": "npx",
      "args": ["-y", "@easy-mcps/postgresql-mcp-server"],
      "env": {
        "POSTGRESQL_URL": "postgresql://user:pass@host/db?sslmode=require",
        "POSTGRESQL_SSL": "true",
        "MCP_PERMISSIONS": ["read"]
      }
    }
  }
}
```

`POSTGRESQL_SSL` / `PGSSLMODE` 取值：
- `true` / `require` / `prefer` — 启用 SSL，不验证证书
- `verify` / `verify-full` / `verify-ca` — 启用 SSL 并验证证书
- `false` / `disable` — 禁用 SSL

### ClickHouse 集群

```json
{
  "mcpServers": {
    "clickhouse": {
      "command": "npx",
      "args": ["-y", "@easy-mcps/clickhouse-mcp-server"],
      "env": {
        "CLICKHOUSE_HOSTS": "ch1:8123,ch2:8123,ch3:8123",
        "CLICKHOUSE_USER": "default",
        "CLICKHOUSE_PASSWORD": "password",
        "CLICKHOUSE_DATABASE": "default",
        "MCP_PERMISSIONS": ["read"]
      }
    }
  }
}
```

### Redis（含 TLS，适配 Upstash 等云 Redis）

```json
{
  "mcpServers": {
    "redis": {
      "command": "npx",
      "args": ["-y", "@easy-mcps/redis-mcp-server"],
      "env": {
        "REDIS_URL": "rediss://default:pass@host:6379",
        "REDIS_TLS": "true",
        "MCP_PERMISSIONS": ["read", "write"]
      }
    }
  }
}
```

使用 `REDIS_URL` 时可直接用 `rediss://` 协议，ioredis 会自动识别 TLS。

## 开发

```bash
npm install          # 安装依赖
npm run build        # 同步共享模块 + 构建全部包
npm test             # 构建 + 共享模块一致性检查 + SQL 校验用例
cd mysql-mcp && npm run dev   # 单包开发模式
```

**共享模块**：权限解析、SQL 校验、结果截断等公共逻辑维护在根目录 `src/shared.ts`，
由 `npm run sync` 复制到各包。**不要直接修改各包内的 `src/shared.ts` 副本**，
改动会被下次同步覆盖；`npm test` 会检查副本一致性。

## 发布到 npm

推荐使用 **Trusted Publishing**（GitHub Actions OIDC 免 token 发布）。

> npm 正在限制「绕过 2FA」的 Granular Access Token：账号管理操作自 2026 年 8 月起禁用，
> 直接发布能力约 2027 年 1 月取消（[官方公告](https://github.blog/changelog/2026-07-08-npm-install-time-security-and-gat-bypass2fa-deprecation/)）。
> 因此不建议再依赖长期 token 发布。

### 一次性配置

在 npmjs.com 上为**每个包**配置 Trusted Publisher（Package → Settings → Trusted Publisher）：

| 字段 | 值 |
|------|-----|
| Organization or user | `Code-suphub` |
| Repository | `easy-mcp` |
| Workflow filename | `publish.yml` |
| Allowed actions | `npm publish` |

### 发布

在 GitHub 仓库的 **Actions → Publish → Run workflow** 中触发：

- `packages`：`all` 发布全部，或填 `redis,postgresql` 只发指定包
- `bump`：`patch` / `minor` / `major`

工作流会跑测试、递增版本号、构建、发布，并把版本号提交回仓库，同时自动生成
provenance（npm 页面会标注"已验证来自该仓库构建"）。

### 本地发布（备用）

本地脚本仍然可用，但因 2FA 策略需要附带动态验证码，且验证码 30 秒失效，只能逐个发布：

```bash
npm run release:mysql -- --otp=你的6位验证码
```

## License

MIT
