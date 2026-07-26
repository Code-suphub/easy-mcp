# easy-mcps

统一权限控制的数据库 MCP 服务器集合

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
- [ClickHouse](./clickhouse-mcp/) - OLAP 列式数据库
- [SQLite](./sqlite-mcp/) - 轻量级嵌入式数据库
- [Redis](./redis-mcp/) - 键值存储数据库

## 工具列表

| 工具 | SQL/命令类型 | 说明 |
|------|-------------|------|
| `read_query` | SELECT/SHOW/DESC/EXPLAIN/WITH | 只读查询（含元数据查询与执行计划） |
| `write_query` | INSERT/UPDATE/REPLACE | 写入数据 |
| `delete_query` | DELETE/TRUNCATE | 删除数据（危险） |
| `ddl_query` | CREATE/DROP/ALTER TABLE/DATABASE/INDEX/VIEW | 表结构操作（危险） |

Redis 使用 `read` / `write` / `admin` 三工具，命令按类别校验（read 工具无法执行写/管理命令）。

安全说明：
- 所有 SQL 工具强制单条语句，拒绝 `SELECT 1; DROP TABLE x` 这类多语句绕过
- 只读通道拒绝 data-modifying CTE、`EXPLAIN ANALYZE` 写语句、`INTO OUTFILE` 等借道写入
- 只读通道有数据库层第二道防线：MySQL 系在 `READ ONLY` 事务中执行，PostgreSQL 读池连接
  强制 `default_transaction_read_only=on`，ClickHouse 带 `readonly=2` 设置，SQLite 走只读连接
- 查询结果默认最多返回 1000 行（`MCP_MAX_ROWS` 可调），超出部分截断
- 单条查询默认 30 秒超时（`MCP_QUERY_TIMEOUT` 毫秒，可调），Redis 命令同样生效

### 最小权限建议（最终兜底）

SQL 校验和会话只读都是应用层防线，最可靠的兜底是给 MCP 使用**最小权限的数据库账号**：

- 只读场景：创建仅有 `SELECT`（及元数据查看）权限的账号，即使校验被绕过也无法写入
- 读写场景：只授予目标库的 DML 权限，不给 DDL / 管理权限（`SUPER`、`FILE`、`GRANT` 等）
- Redis 6+ 可用 ACL 限制命令与 key 前缀，如 `ACL SETUSER mcp on +@read ~app:*`
- 不要用 root / 管理员账号连接 MCP

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

不配置 `MCP_PERMISSIONS` 时，默认只有 `read` 权限。

## 安装使用

### npm 安装（推荐）

```bash
npm install -g @easy-mcps/mysql-mcp-server
```

### npx 直接运行

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

### Redis

| 变量 | 必填 | 说明 |
|------|------|------|
| `REDIS_URL` | 可选 | 连接字符串，支持 `redis://` 和 `rediss://` |
| `REDIS_HOST` | 可选 | 主机地址，默认 `localhost` |
| `REDIS_PORT` | 可选 | 端口，默认 `6379` |
| `REDIS_PASSWORD` | 可选 | 密码 |
| `REDIS_DATABASE` | 可选 | 数据库编号，默认 `0` |
| `REDIS_TLS` / `REDIS_SSL` | 可选 | 设置为 `true` 启用 TLS 加密 |

### 通用

| 变量 | 必填 | 说明 |
|------|------|------|
| `MCP_PERMISSIONS` | 可选 | 权限控制，如 `read,write` 或 `["read","write"]` |
| `MCP_MAX_ROWS` | 可选 | 查询结果最大返回行数，默认 `1000` |
| `MCP_QUERY_TIMEOUT` | 可选 | 单条查询/命令超时（毫秒），默认 `30000` |

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

### PostgreSQL

```json
{
  "mcpServers": {
    "postgresql": {
      "command": "npx",
      "args": ["-y", "@easy-mcps/postgresql-mcp-server"],
      "env": {
        "PGHOST": "localhost",
        "PGPORT": "5432",
        "PGUSER": "postgres",
        "PGPASSWORD": "password",
        "PGDATABASE": "test",
        "MCP_PERMISSIONS": ["read"]
      }
    }
  }
}
```

**SSL 配置**（适配 Neon 等云数据库）：

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

支持的环境变量：`POSTGRESQL_SSL` 或 `PGSSLMODE`，取值：
- `true` / `require` / `prefer` — 启用 SSL，不验证证书
- `verify` / `verify-full` / `verify-ca` — 启用 SSL 并验证证书
- `false` / `disable` — 禁用 SSL

### Redis

```json
{
  "mcpServers": {
    "redis": {
      "command": "npx",
      "args": ["-y", "@easy-mcps/redis-mcp-server"],
      "env": {
        "REDIS_HOST": "localhost",
        "REDIS_PORT": "6379",
        "REDIS_PASSWORD": "",
        "MCP_PERMISSIONS": ["read", "write"]
      }
    }
  }
}
```

**TLS 配置**（适配 Upstash 等云 Redis）：

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

支持的环境变量：`REDIS_TLS` 或 `REDIS_SSL`，设置为 `true` 时启用 TLS。使用 `REDIS_URL` 时可直接使用 `rediss://` 协议，ioredis 会自动识别。

## 发布到 npm

### 配置 npm Token（免登录）

在项目的 `.npmrc` 文件中配置 Granular Access Token：

```
//registry.npmjs.org/:_authToken=你的token
```

`.npmrc` 已加入 `.gitignore`，不会提交到仓库。

创建 token 的要求：
- 类型：**Granular Access Token**
- 权限：**Read and write** all packages + Read/write organization
- 务必勾选 **Bypass 2FA**

### 一键发布

```bash
# 发布指定包（自动 bump patch 版本 + 构建 + 发布）
npm run release:postgresql
npm run release:redis
```

或在子目录手动操作：

```bash
cd postgresql-mcp
npm version patch --no-git-tag-version
npm run release
```

## 开发

```bash
# 安装依赖
npm install

# 开发模式
cd mysql-mcp && npm run dev

# 构建
npm run build
```

## License

MIT