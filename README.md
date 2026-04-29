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
| `read_query` | SELECT | 只读查询 |
| `write_query` | INSERT/UPDATE | 写入数据 |
| `delete_query` | DELETE | 删除数据（危险） |
| `ddl_query` | CREATE/DROP/ALTER | 表结构操作（危险） |

Redis 使用 `read` / `write` / `admin` 三工具。

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

## 发布到 npm

```bash
cd mysql-mcp
npm run publish
```

需要先登录 npm：`npm login`

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