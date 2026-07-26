# TiDB MCP Server

TiDB 数据库的 MCP 服务器实现，支持统一的权限控制。

## 功能特性

- ✅ 4 个工具：read_query, write_query, delete_query, ddl_query
- ✅ 统一权限控制：通过 MCP_PERMISSIONS 配置
- ✅ SQL 类型验证：每个工具只能执行对应类型的 SQL
- ✅ TiDB Cloud 支持：支持 SSL 连接

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
| read_query | SELECT/SHOW/DESC/DESCRIBE/EXPLAIN/WITH | 执行只读查询 |
| write_query | INSERT/UPDATE/REPLACE | 执行写入语句 |
| delete_query | DELETE/TRUNCATE | 执行删除语句（危险操作） |
| ddl_query | CREATE/DROP/ALTER TABLE/DATABASE/INDEX/VIEW | 执行 DDL 语句（危险操作） |

## 环境变量

```bash
# URL 格式（推荐）
TIDB_URL=mysql://user:password@host:port/database

# 或使用独立环境变量
TIDB_HOST=localhost
TIDB_PORT=4000
TIDB_USER=root
TIDB_PASSWORD=password
TIDB_DATABASE=test
TIDB_SSL=false  # TiDB Cloud Serverless 需要 true

# 也支持 MYSQL_* 环境变量（方便同时连接 MySQL 和 TiDB）
MYSQL_HOST=localhost
MYSQL_PORT=4000
MYSQL_USER=root
MYSQL_PASSWORD=password
MYSQL_DATABASE=test

MCP_PERMISSIONS='["read","write"]'  # 可选，默认只有 read
```

**环境变量优先级**：TIDB_* > MYSQL_* > 默认值

## 使用方式

### npx 直接运行

```bash
npx -y @easy-mcps/tidb-mcp-server
```

### Claude Desktop / Cursor

```json
{
  "mcpServers": {
    "tidb": {
      "command": "npx",
      "args": ["-y", "@easy-mcps/tidb-mcp-server"],
      "env": {
        "TIDB_HOST": "localhost",
        "TIDB_PORT": "4000",
        "TIDB_USER": "root",
        "TIDB_PASSWORD": "password",
        "TIDB_DATABASE": "test",
        "MCP_PERMISSIONS": "read,write"
      }
    }
  }
}
```

### 本地安装

```bash
npm install -g @easy-mcps/tidb-mcp-server
tidb-mcp-server
```

## 开发

```bash
npm install
npm run dev
```

## License

MIT