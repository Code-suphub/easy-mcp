# MySQL MCP Server

**简体中文** | [English](./README.en.md)

MySQL 数据库的 MCP 服务器，统一权限控制。

## 安装使用

```bash
npx -y @easy-mcps/mysql-mcp-server
```

```json
{
  "mcpServers": {
    "mysql": {
      "command": "npx",
      "args": [
        "-y",
        "@easy-mcps/mysql-mcp-server"
      ]
    }
  }
}
```

## 工具

| 工具 | 命令类型 | 说明 |
|------|------|------|
| `read_query` | SELECT/SHOW/DESC/DESCRIBE/EXPLAIN/WITH | 执行只读查询 |
| `write_query` | INSERT/UPDATE/REPLACE | 执行写入语句 |
| `delete_query` | DELETE/TRUNCATE | 执行删除语句（危险操作） |
| `ddl_query` | CREATE/DROP/ALTER TABLE/DATABASE/INDEX/VIEW | 执行 DDL 语句（危险操作） |

## 权限配置

通过环境变量 `MCP_PERMISSIONS` 配置，支持数组或逗号分隔格式：

```bash
MCP_PERMISSIONS='["read","write"]'
MCP_PERMISSIONS='read,write'
```

| 权限值 | 默认 | 说明 |
|------|------|------|
| `read` | ✅ 开启 | 只读查询 |
| `write` | ❌ 关闭 | 写入数据 |
| `delete` | ❌ 关闭 | 删除数据（危险） |
| `ddl` | ❌ 关闭 | 表结构操作（危险） |

不配置时默认只有 `read`。未开启的权限对应的工具不会出现在工具列表里。

## 环境变量

| 变量 | 说明 |
|------|------|
| `MYSQL_URL` | 连接字符串，如 `mysql://user:pass@host:3306/db` |
| `MYSQL_HOST` | 主机地址，默认 `localhost` |
| `MYSQL_PORT` | 端口，默认 `3306` |
| `MYSQL_USER` | 用户名，默认 `root` |
| `MYSQL_PASSWORD` | 密码 |
| `MYSQL_DATABASE` | 数据库名，默认 `test` |

### 通用变量

| 变量 | 说明 |
|------|------|
| `MCP_PERMISSIONS` | 权限控制，如 `read,write` 或 `["read","write"]` |
| `MCP_MAX_ROWS` | 查询结果最大返回行数，默认 `1000` |
| `MCP_MAX_BYTES` | 返回文本最大字节数，默认 `1048576`（1MB） |
| `MCP_QUERY_TIMEOUT` | 单条查询/命令超时（毫秒），默认 `30000` |

## 配置示例

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
        "MYSQL_PASSWORD": "your-password",
        "MCP_PERMISSIONS": ["read"]
      }
    }
  }
}
```

## 安全机制

- 强制单条语句，拒绝 `SELECT 1; DROP TABLE x` 这类多语句绕过
- 只读通道拒绝 data-modifying CTE、`EXPLAIN ANALYZE` 写语句等借道写入
- 数据库层第二道防线：只读语句在 `SET TRANSACTION READ ONLY` 事务中执行
- 结果默认最多 1000 行且不超过 1MB，单条查询默认 30 秒超时

最可靠的兜底是使用**最小权限的数据库账号**——只读场景就配只读账号，详见[仓库说明](https://github.com/Code-suphub/easy-mcp#最小权限建议最终兜底)。

## 完整文档

更多数据库与用法见 [easy-mcps 仓库](https://github.com/Code-suphub/easy-mcp)。

## License

MIT
