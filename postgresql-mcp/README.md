# PostgreSQL MCP Server

PostgreSQL 数据库的 MCP 服务器实现，支持统一的权限控制。

## 功能特性

- ✅ 4 个工具：read_query, write_query, delete_query, ddl_query
- ✅ 统一权限控制：通过 MCP_PERMISSIONS 配置
- ✅ SQL 类型验证：每个工具只能执行对应类型的 SQL
- ✅ 事务保护：只读操作使用 READ ONLY 事务

## 权限配置

通过环境变量 `MCP_PERMISSIONS` 配置权限，支持两种格式：

```bash
# JSON 数组格式
MCP_PERMISSIONS='["read","write"]'

# 逗号分隔格式
MCP_PERMISSIONS='read,write'
```

| 权限 | 默认值 | 说明 |
|------|--------|------|
| read | ✅ 开启 | SELECT 查询 |
| write | ❌ 关闭 | INSERT/UPDATE 操作 |
| delete | ❌ 关闭 | DELETE 操作（危险） |
| ddl | ❌ 关闭 | CREATE/DROP/ALTER TABLE（危险） |

## 工具说明

| 工具 | SQL 类型 | 说明 |
|------|----------|------|
| read_query | SELECT/SHOW/EXPLAIN/WITH | 执行只读查询 |
| write_query | INSERT/UPDATE | 执行写入语句 |
| delete_query | DELETE/TRUNCATE | 执行删除语句（危险操作） |
| ddl_query | CREATE/DROP/ALTER TABLE/DATABASE/INDEX/VIEW | 执行 DDL 语句（危险操作） |

## 环境变量

```bash
# URL 格式（推荐）
POSTGRESQL_URL=postgresql://user:password@host:port/database

# 或使用独立环境变量
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=password
PGDATABASE=postgres
MCP_PERMISSIONS='["read","write"]'  # 可选，默认只有 read

# SSL 配置（Neon 等云数据库）
POSTGRESQL_URL=postgresql://user:pass@host/db?sslmode=require
POSTGRESQL_SSL=true
```

### SSL 配置（适配 Neon 等云数据库）

通过 `POSTGRESQL_SSL` 或 `PGSSLMODE` 环境变量控制 SSL：

| 取值 | 行为 |
|------|------|
| `true` / `require` / `prefer` | 启用 SSL，不验证证书 |
| `verify` / `verify-full` / `verify-ca` | 启用 SSL，验证证书 |
| `false` / `disable` | 禁用 SSL |

**配置示例：**

```json
{
  "mcpServers": {
    "postgresql": {
      "command": "npx",
      "args": ["-y", "@easy-mcps/postgresql-mcp-server"],
      "env": {
        "POSTGRESQL_URL": "postgresql://user:pass@host/db?sslmode=require",
        "POSTGRESQL_SSL": "true",
        "MCP_PERMISSIONS": "read"
      }
    }
  }
}
```

## 使用方式

### npx 直接运行

```bash
npx -y @easy-mcps/postgresql-mcp-server
```

**带 SSL 运行（Neon 等云数据库）：**

```bash
POSTGRESQL_URL=postgresql://user:pass@host/db?sslmode=require POSTGRESQL_SSL=true npx -y @easy-mcps/postgresql-mcp-server
```

### Claude Desktop / Cursor

**基础配置：**

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
        "PGDATABASE": "postgres",
        "MCP_PERMISSIONS": "read,write"
      }
    }
  }
}
```

**SSL 配置（Neon 等云数据库）：**

方式1：URL + SSL

```json
{
  "mcpServers": {
    "postgresql": {
      "command": "npx",
      "args": ["-y", "@easy-mcps/postgresql-mcp-server"],
      "env": {
        "POSTGRESQL_URL": "postgresql://user:pass@host/db?sslmode=require",
        "POSTGRESQL_SSL": "true",
        "MCP_PERMISSIONS": "read"
      }
    }
  }
}
```

方式2：独立变量 + SSL

```json
{
  "mcpServers": {
    "postgresql": {
      "command": "npx",
      "args": ["-y", "@easy-mcps/postgresql-mcp-server"],
      "env": {
        "PGHOST": "host",
        "PGPORT": "5432",
        "PGUSER": "user",
        "PGPASSWORD": "password",
        "PGDATABASE": "db",
        "POSTGRESQL_SSL": "true",
        "MCP_PERMISSIONS": "read"
      }
    }
  }
}
```

### 本地安装

```bash
npm install -g @easy-mcps/postgresql-mcp-server
postgresql-mcp-server
```

## 开发

```bash
npm install
npm run dev
```

## License

MIT