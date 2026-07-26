# Redis MCP Server

[简体中文](./README.md) | **English**

MCP server for Redis with unified permission control and per-category command validation.

## Installation

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

## Tools

| Tool | Description |
|------|------|
| `read` | Read commands (GET/HGET/SMEMBERS/SCAN…) |
| `write` | Write commands (SET/HSET/DEL/SADD…) |
| `admin` | Admin commands (FLUSHDB/CONFIG/EVAL…, dangerous) |

Commands are validated against their category: the `read` tool cannot execute write or admin
commands even though they are on the overall allowlist. Commands outside the allowlist are rejected.

⚠️ `KEYS` scans the entire keyspace and blocks Redis — use `SCAN` in production.

## Permissions

Configure with the `MCP_PERMISSIONS` environment variable, as an array or a comma-separated string:

```bash
MCP_PERMISSIONS='["read","write"]'
MCP_PERMISSIONS='read,write'
```

| Value | Default | Description |
|------|------|------|
| `read` | ✅ on | Read commands (GET/HGET/SCAN…) |
| `write` | ❌ off | Write commands (SET/HSET/DEL…) |
| `admin` | ❌ off | Admin commands (FLUSHDB/CONFIG/EVAL…, dangerous) |

When unset, only `read` is granted. Tools for permissions that are not granted never appear in the tool list.

## Environment Variables

| Variable | Description |
|------|------|
| `REDIS_URL` | Connection string, supports `redis://` and `rediss://` |
| `REDIS_HOST` | Host, default `localhost` |
| `REDIS_PORT` | Port, default `6379` |
| `REDIS_PASSWORD` | Password |
| `REDIS_DATABASE` | Database index, default `0` |
| `REDIS_TLS` / `REDIS_SSL` | Set to `true` to enable TLS |

### Common variables

| Variable | Description |
|------|------|
| `MCP_PERMISSIONS` | Permissions, e.g. `read,write` or `["read","write"]` |
| `MCP_MAX_ROWS` | Maximum rows returned, default `1000` |
| `MCP_MAX_BYTES` | Maximum response size in bytes, default `1048576` (1MB) |
| `MCP_QUERY_TIMEOUT` | Per-query/command timeout in milliseconds, default `30000` |

## Configuration Example

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

## Security

- Commands are validated against their category, so the `read` tool cannot escalate to writes or admin
- Commands outside the allowlist are rejected
- Quoted arguments are parsed correctly, so `SET k "hello world"` is not split incorrectly
- Commands time out after 30 seconds by default

The most reliable backstop is a Redis 6+ ACL such as `ACL SETUSER mcp on +@read ~app:*`. See the
[repository docs](https://github.com/Code-suphub/easy-mcp/blob/master/README.en.md#least-privilege-accounts-the-real-backstop).

## Full documentation

For other databases and advanced usage, see the [easy-mcps repository](https://github.com/Code-suphub/easy-mcp/blob/master/README.en.md).

## License

MIT
