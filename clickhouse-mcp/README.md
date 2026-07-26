# ClickHouse MCP Server

ClickHouse 数据库的 MCP 服务器实现，支持统一的权限控制。

## 功能特性

- ✅ 4 个工具：read_query, write_query, delete_query, ddl_query
- ✅ 统一权限控制：通过 MCP_PERMISSIONS 配置
- ✅ SQL 类型验证：每个工具只能执行对应类型的 SQL
- ✅ ClickHouse 特性：UPDATE/DELETE 使用 ALTER TABLE ... UPDATE/DELETE 语法

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
| read_query | SELECT/SHOW/DESC/EXISTS/EXPLAIN/WITH | 执行只读查询 |
| write_query | INSERT / ALTER TABLE ... UPDATE | 写入数据（UPDATE mutation 归此工具） |
| delete_query | DELETE FROM / TRUNCATE / ALTER TABLE ... DELETE | 删除数据（危险操作） |
| ddl_query | CREATE/DROP/ALTER TABLE/DATABASE/VIEW | 表结构操作，支持 ON CLUSTER（危险操作；不含 UPDATE/DELETE mutation） |

## 环境变量

```bash
# URL 格式（推荐）
CLICKHOUSE_URL=http://user:password@host:port/database
CLICKHOUSE_URL=https://user:password@host:port/database  # 使用 HTTPS

# 集群多节点（逗号分隔，连接失败自动切换下一个节点）
CLICKHOUSE_HOSTS=ch1:8123,ch2:8123,ch3:8123

# 或使用独立环境变量
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=8123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=password
CLICKHOUSE_DATABASE=default
CLICKHOUSE_SECURE=false  # true 使用 HTTPS
MCP_PERMISSIONS='["read","write"]'  # 可选，默认只有 read
```

## 使用方式

### npx 直接运行

```bash
npx -y @easy-mcps/clickhouse-mcp-server
```

### Claude Desktop / Cursor

```json
{
  "mcpServers": {
    "clickhouse": {
      "command": "npx",
      "args": ["-y", "@easy-mcps/clickhouse-mcp-server"],
      "env": {
        "CLICKHOUSE_HOST": "localhost",
        "CLICKHOUSE_PORT": "8123",
        "CLICKHOUSE_USER": "default",
        "CLICKHOUSE_PASSWORD": "password",
        "CLICKHOUSE_DATABASE": "default",
        "CLICKHOUSE_SECURE": "false",
        "MCP_PERMISSIONS": "read,write"
      }
    }
  }
}
```

### 本地安装

```bash
npm install -g @easy-mcps/clickhouse-mcp-server
clickhouse-mcp-server
```

## 开发

```bash
npm install
npm run dev
```

## License

MIT