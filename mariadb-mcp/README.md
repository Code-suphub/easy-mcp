# MariaDB MCP Server

MariaDB 数据库的 MCP 服务器实现，支持统一的权限控制。

## 功能特性

- ✅ 4 个工具：read_query, write_query, delete_query, ddl_query
- ✅ 统一权限控制：通过 MCP_PERMISSIONS 配置
- ✅ SQL 类型验证：每个工具只能执行对应类型的 SQL
- ✅ MySQL 兼容：使用 mysql2 驱动

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
MARIADB_URL=mysql://user:password@host:port/database

# 或使用独立环境变量
MARIADB_HOST=localhost
MARIADB_PORT=3306
MARIADB_USER=root
MARIADB_PASSWORD=password
MARIADB_DATABASE=test

# 也支持 MYSQL_* 环境变量（方便同时连接 MySQL 和 MariaDB）
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=password
MYSQL_DATABASE=test

MCP_PERMISSIONS='["read","write"]'  # 可选，默认只有 read
```

**环境变量优先级**：MARIADB_* > MYSQL_* > 默认值

## 使用方式

### npx 直接运行

```bash
npx -y @easy-mcps/mariadb-mcp-server
```

### Claude Desktop / Cursor

```json
{
  "mcpServers": {
    "mariadb": {
      "command": "npx",
      "args": ["-y", "@easy-mcps/mariadb-mcp-server"],
      "env": {
        "MARIADB_HOST": "localhost",
        "MARIADB_PORT": "3306",
        "MARIADB_USER": "root",
        "MARIADB_PASSWORD": "password",
        "MARIADB_DATABASE": "test",
        "MCP_PERMISSIONS": "read,write"
      }
    }
  }
}
```

### 本地安装

```bash
npm install -g @easy-mcps/mariadb-mcp-server
mariadb-mcp-server
```

## 开发

```bash
npm install
npm run dev
```

## License

MIT