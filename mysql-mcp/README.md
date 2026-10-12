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

## 只读 CLI（与 multi 模式 MCP 共用连接逻辑）

构建后使用 `node dist/cli.js`，安装本包后可使用 `mysql-query`。

```sh
mysql-query --config /path/to/db_connections.json --list
mysql-query --config /path/to/db_connections.json --database my-app --env prod --sql 'SHOW TABLES'
mysql-query --config /path/to/db_connections.json --database my-app --env uat --sql-file query.sql --output rows.json
```

配置也可通过 `MCP_DB_CONFIG` 指定。查询要求显式指定 `--database`、`--env`，
并且只能指定 `--sql` 或 `--sql-file` 中的一个；`--sql-file -` 从标准输入读取。
CLI 只支持 multi 配置和只读查询，复用 `connections.ts`、`read-query.ts`、
SQL 校验及结果截断。`--list` 不连接数据库，不显示密码或 Cookie。
成功退出码为 0；失败为 1，错误写入标准错误。`--output` 会覆盖目标文件。

默认查询超时 30 秒，输出上限 1000 行、1 MiB，配置变量与 MCP 一致：
`MCP_QUERY_TIMEOUT`、`MCP_MAX_ROWS`、`MCP_MAX_BYTES`。这些输出限制不限制数据库扫描量。
DMS 仍只请求第一页（page_size=100、limit=500），不支持完整导出。
单行超过体积上限时输出可能被硬截断而不再是有效 JSON。
只读 SQL 校验不代替数据库账号及 DMS 服务端权限。

在仓库根目录执行 `npm run test:cli --workspace mysql-mcp` 可构建并运行本地测试，
测试不访问真实数据库或 DMS。
