# MySQL MCP Server

MySQL 数据库的 MCP 服务器实现，支持统一的权限控制。

## 功能特性

- ✅ 9 个工具：read_query, write_query, update_query, delete_query, create_table, drop_table, alter_table, list_tables, desc_table
- ✅ 动态权限控制：可开启/关闭任意工具
- ✅ SQL 类型验证：每个工具只能执行对应类型的 SQL
- ✅ 连接池：支持高并发

## 权限配置

| 权限 | 默认值 | 说明 |
|------|--------|------|
| canRead | ✅ 开启 | SELECT 查询 |
| canWrite | ✅ 开启 | INSERT 操作 |
| canUpdate | ✅ 开启 | UPDATE 操作 |
| canDelete | ❌ 关闭 | DELETE 操作（危险） |
| canCreateTable | ❌ 关闭 | CREATE TABLE |
| canDropTable | ❌ 关闭 | DROP TABLE（危险） |
| canAlterTable | ❌ 关闭 | ALTER TABLE |

## 环境变量

```bash
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=password
MYSQL_DATABASE=test
```

## 使用方式

### Claude Desktop

```json
{
  "mcpServers": {
    "mysql": {
      "command": "node",
      "args": ["/path/to/mysql-mcp/dist/index.js"],
      "env": {
        "MYSQL_HOST": "localhost",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "root",
        "MYSQL_PASSWORD": "password",
        "MYSQL_DATABASE": "test"
      }
    }
  }
}
```

### Cursor

```json
{
  "mcpServers": {
    "mysql": {
      "command": "node",
      "args": ["/path/to/mysql-mcp/dist/index.js"],
      "env": {
        "MYSQL_HOST": "localhost",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "root",
        "MYSQL_PASSWORD": "password",
        "MYSQL_DATABASE": "test"
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
