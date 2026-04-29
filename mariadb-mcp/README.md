# MariaDB MCP Server

MariaDB 数据库的 MCP 服务器实现，支持统一的权限控制。

## 功能特性

- ✅ 9 个工具：read_query, write_query, update_query, delete_query, create_table, drop_table, alter_table, list_tables, desc_table
- ✅ 动态权限控制：通过环境变量配置
- ✅ SQL 类型验证：每个工具只能执行对应类型的 SQL
- ✅ MySQL 兼容：使用 mysql2 驱动

## 权限配置

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
MARIADB_HOST=localhost
MARIADB_PORT=3306
MARIADB_USER=root
MARIADB_PASSWORD=password
MARIADB_DATABASE=test
```

## 使用方式

```json
{
  "mcpServers": {
    "mariadb": {
      "command": "node",
      "args": ["/path/to/mariadb-mcp/dist/index.js"],
      "env": {
        "MARIADB_HOST": "localhost",
        "MARIADB_PORT": "3306",
        "MARIADB_USER": "root",
        "MARIADB_PASSWORD": "password",
        "MARIADB_DATABASE": "test",
        "MCP_CAN_READ": "true",
        "MCP_CAN_WRITE": "true",
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
