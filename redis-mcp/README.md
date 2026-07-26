# Redis MCP Server

**简体中文** | [English](./README.en.md)

Redis 键值数据库的 MCP 服务器，统一权限控制，命令按类别校验。

## 安装使用

```bash
npx -y @easy-mcps/redis-mcp-server
```

```json
{
  "mcpServers": {
    "redis": {
      "command": "npx",
      "args": [
        "-y",
        "@easy-mcps/redis-mcp-server"
      ]
    }
  }
}
```

## 工具

| 工具 | 说明 |
|------|------|
| `read` | 执行读命令（GET/HGET/SMEMBERS/SCAN 等） |
| `write` | 执行写命令（SET/HSET/DEL/SADD 等） |
| `admin` | 执行管理命令（FLUSHDB/CONFIG/EVAL 等，危险操作） |

命令按类别校验：`read` 工具无法执行写或管理命令，即使命令在总白名单中。不在白名单中的命令一律拒绝。

⚠️ `KEYS` 会遍历全库并阻塞 Redis，生产环境请改用 `SCAN`。

## 权限配置

通过环境变量 `MCP_PERMISSIONS` 配置，支持数组或逗号分隔格式：

```bash
MCP_PERMISSIONS='["read","write"]'
MCP_PERMISSIONS='read,write'
```

| 权限值 | 默认 | 说明 |
|------|------|------|
| `read` | ✅ 开启 | 读命令（GET/HGET/SCAN 等） |
| `write` | ❌ 关闭 | 写命令（SET/HSET/DEL 等） |
| `admin` | ❌ 关闭 | 管理命令（FLUSHDB/CONFIG/EVAL 等，危险） |

不配置时默认只有 `read`。未开启的权限对应的工具不会出现在工具列表里。

## 环境变量

| 变量 | 说明 |
|------|------|
| `REDIS_URL` | 连接字符串，支持 `redis://` 和 `rediss://` |
| `REDIS_HOST` | 主机地址，默认 `localhost` |
| `REDIS_PORT` | 端口，默认 `6379` |
| `REDIS_PASSWORD` | 密码 |
| `REDIS_DATABASE` | 数据库编号，默认 `0` |
| `REDIS_TLS` / `REDIS_SSL` | 设置为 `true` 启用 TLS 加密 |

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
    "redis": {
      "command": "npx",
      "args": ["-y", "@easy-mcps/redis-mcp-server"],
      "env": {
        "REDIS_HOST": "localhost",
        "REDIS_PORT": "6379",
        "REDIS_PASSWORD": "your-password",
        "REDIS_DATABASE": "0",
        "MCP_PERMISSIONS": ["read"]
      }
    }
  }
}
```

## 安全机制

- 命令按类别校验，`read` 工具无法越权执行写/管理命令
- 命令白名单之外的命令一律拒绝
- 支持引号参数解析，`SET k "hello world"` 不会被拆错
- 单条命令默认 30 秒超时

最可靠的兜底是 Redis 6+ 的 ACL，如 `ACL SETUSER mcp on +@read ~app:*`，详见[仓库说明](https://github.com/Code-suphub/easy-mcp#最小权限建议最终兜底)。

## 完整文档

更多数据库与用法见 [easy-mcps 仓库](https://github.com/Code-suphub/easy-mcp)。

## License

MIT
