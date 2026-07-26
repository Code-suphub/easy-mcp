# ClickHouse MCP Server

**简体中文** | [English](./README.en.md)

ClickHouse OLAP 数据库的 MCP 服务器，统一权限控制，支持集群多节点故障转移。

## 安装使用

```bash
npx -y @easy-mcps/clickhouse-mcp-server
```

```json
{
  "mcpServers": {
    "clickhouse": {
      "command": "npx",
      "args": [
        "-y",
        "@easy-mcps/clickhouse-mcp-server"
      ]
    }
  }
}
```

## 工具

| 工具 | 命令类型 | 说明 |
|------|------|------|
| `read_query` | SELECT/SHOW/DESC/EXISTS/EXPLAIN/WITH | 执行只读查询 |
| `write_query` | INSERT / ALTER TABLE ... UPDATE | 写入数据（UPDATE mutation 归此工具） |
| `delete_query` | DELETE FROM / TRUNCATE / ALTER TABLE ... DELETE | 删除数据（危险操作） |
| `ddl_query` | CREATE/DROP/ALTER TABLE/DATABASE/VIEW | 表结构操作，支持 ON CLUSTER（危险操作） |

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
| `CLICKHOUSE_HOSTS` | 集群多节点，逗号分隔如 `ch1:8123,ch2:8123`，连接失败自动切换 |
| `CLICKHOUSE_URL` | 单节点连接字符串 |
| `CLICKHOUSE_HOST` | 主机地址，默认 `localhost` |
| `CLICKHOUSE_PORT` | 端口，默认 `8123`（HTTPS 时 `8443`） |
| `CLICKHOUSE_USER` | 用户名，默认 `default` |
| `CLICKHOUSE_PASSWORD` | 密码 |
| `CLICKHOUSE_DATABASE` | 数据库名，默认 `default` |
| `CLICKHOUSE_SECURE` | 设为 `true` 使用 HTTPS |

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
    "clickhouse": {
      "command": "npx",
      "args": ["-y", "@easy-mcps/clickhouse-mcp-server"],
      "env": {
        "CLICKHOUSE_URL": "",
        "CLICKHOUSE_HOST": "localhost",
        "CLICKHOUSE_PORT": "",
        "CLICKHOUSE_USER": "default",
        "MCP_PERMISSIONS": ["read"]
      }
    }
  }
}
```

### 集群配置

`CLICKHOUSE_HOSTS` 支持配置多个节点，连接类错误（节点宕机、网络超时）时自动切换到下一个节点：

```json
"env": {
  "CLICKHOUSE_HOSTS": "ch1:8123,ch2:8123,ch3:8123"
}
```

只读查询会自动重试其他节点；写语句失败时只切换节点不重试，避免服务端已接收后重复写入。
DDL 语句可正常携带 `ON CLUSTER` 子句。

## 安全机制

- 强制单条语句，拒绝 `SELECT 1; DROP TABLE x` 这类多语句绕过
- 只读通道拒绝 data-modifying CTE、`EXPLAIN ANALYZE` 写语句等借道写入
- 数据库层第二道防线：只读查询带 `readonly=2` 设置，服务端拒绝一切写入
- 结果默认最多 1000 行且不超过 1MB，单条查询默认 30 秒超时

最可靠的兜底是使用**最小权限的数据库账号**——只读场景就配只读账号，详见[仓库说明](https://github.com/Code-suphub/easy-mcp#最小权限建议最终兜底)。

## 完整文档

更多数据库与用法见 [easy-mcps 仓库](https://github.com/Code-suphub/easy-mcp)。

## License

MIT
