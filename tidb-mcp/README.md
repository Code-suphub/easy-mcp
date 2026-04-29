# TiDB MCP Server

TiDB 数据库的 MCP 服务器实现，支持统一的权限控制。

## 功能特性

- ✅ 9 个工具：read_query, write_query, update_query, delete_query, create_table, drop_table, alter_table, list_tables, desc_table
- ✅ 动态权限控制：通过环境变量配置
- ✅ SQL 类型验证：每个工具只能执行对应类型的 SQL
- ✅ TiDB Cloud 支持：支持 SSL 连接

## 权限配置

在 MCP 配置文件中通过 `env` 设置：

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| MCP_CAN_READ | true | SELECT 查询 |
| MCP_CAN_WRITE | true | INSERT 操作 |
| MCP_CAN_UPDATE | true | UPDATE 操作 |
| MCP_CAN_DELETE | false | DELETE 操作 |
| MCP_CAN_CREATE_TABLE | false | CREATE TABLE |
| MCP_CAN_DROP_TABLE | false | DROP TABLE |
| MCP_CAN_ALTER_TABLE | false | ALTER TABLE |

## 环境变量

```bash
# TiDB 连接
TIDB_HOST=localhost
TIDB_PORT=4000
TIDB_USER=root
TIDB_PASSWORD=password
TIDB_DATABASE=test
TIDB_SSL=false  # TiDB Cloud Serverless 需要 true

# 或兼容 MySQL 环境变量
MYSQL_HOST=localhost
MYSQL_PORT=4000
MYSQL_USER=root
MYSQL_PASSWORD=password
MYSQL_DATABASE=test
```

## 使用方式

### Claude Desktop - 只读模式

```json
{
  "mcpServers": {
    "tidb": {
      "command": "node",
      "args": ["/path/to/tidb-mcp/dist/index.js"],
      "env": {
        "TIDB_HOST": "gateway.xxxx TiDB Cloud",
        "TIDB_PORT": "443",
        "TIDB_USER": "xxx",
        "TIDB_PASSWORD": "xxx",
        "TIDB_DATABASE": "test",
        "TIDB_SSL": "true",
        "MCP_CAN_READ": "true",
        "MCP_CAN_WRITE": "false",
        "MCP_CAN_DELETE": "false"
      }
    }
  }
}
```

### Claude Desktop - 读写模式

```json
{
  "mcpServers": {
    "tidb": {
      "command": "node",
      "args": ["/path/to/tidb-mcp/dist/index.js"],
      "env": {
        "TIDB_HOST": "localhost",
        "TIDB_PORT": "4000",
        "TIDB_USER": "root",
        "TIDB_PASSWORD": "password",
        "TIDB_DATABASE": "test",
        "MCP_CAN_READ": "true",
        "MCP_CAN_WRITE": "true",
        "MCP_CAN_UPDATE": "true",
        "MCP_CAN_DELETE": "false"
      }
    }
  }
}
```

## 开发

```bash
npm install
npm run dev
```

## License

MIT
