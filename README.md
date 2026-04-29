# easy-mcps

统一权限控制的数据库 MCP 服务器集合

## 支持的数据库

### MySQL 兼容（使用 mysql2）
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

## 统一设计

### 权限控制

所有 MCP 服务器采用统一的权限控制模型，通过环境变量配置：

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| MCP_CAN_READ | true | SELECT 查询 |
| MCP_CAN_WRITE | true | INSERT 操作 |
| MCP_CAN_UPDATE | true | UPDATE 操作 |
| MCP_CAN_DELETE | **false** | DELETE 操作（危险） |
| MCP_CAN_CREATE_TABLE | **false** | CREATE TABLE |
| MCP_CAN_DROP_TABLE | **false** | DROP TABLE（危险） |
| MCP_CAN_ALTER_TABLE | **false** | ALTER TABLE |

### 工具列表

| 工具 | SQL 类型 | 说明 |
|------|----------|------|
| `read_query` | SELECT | 只读查询 |
| `write_query` | INSERT | 写入数据 |
| `update_query` | UPDATE | 更新数据 |
| `delete_query` | DELETE | 删除数据 |
| `create_table` | CREATE TABLE | 创建表 |
| `drop_table` | DROP TABLE | 删除表 |
| `alter_table` | ALTER TABLE | 修改表结构 |
| `list_tables` | - | 列出所有表 |
| `desc_table` | - | 查看表结构 |

## 使用示例

### 只读模式（推荐）

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
        "MYSQL_DATABASE": "test",
        "MCP_CAN_READ": "true",
        "MCP_CAN_WRITE": "false",
        "MCP_CAN_UPDATE": "false",
        "MCP_CAN_DELETE": "false"
      }
    }
  }
}
```

### 读写模式

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
        "MYSQL_DATABASE": "test",
        "MCP_CAN_READ": "true",
        "MCP_CAN_WRITE": "true",
        "MCP_CAN_UPDATE": "true",
        "