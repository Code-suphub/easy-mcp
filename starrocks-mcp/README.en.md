# StarRocks MCP Server

[简体中文](./README.md) | **English**

MCP server for the StarRocks MPP database with unified permission control. StarRocks speaks the MySQL protocol.

## Installation

```bash
npx -y @easy-mcps/starrocks-mcp-server
```

```json
{
  "mcpServers": {
    "starrocks": {
      "command": "npx",
      "args": [
        "-y",
        "@easy-mcps/starrocks-mcp-server"
      ]
    }
  }
}
```

## Tools

| Tool | Command types | Description |
|------|------|------|
| `read_query` | SELECT/SHOW/DESC/DESCRIBE/EXPLAIN/WITH | Read-only queries |
| `write_query` | INSERT/UPDATE/REPLACE | Write data |
| `delete_query` | DELETE/TRUNCATE | Delete data (dangerous) |
| `ddl_query` | CREATE/DROP/ALTER TABLE/DATABASE/INDEX/VIEW | Schema changes (dangerous) |

## Permissions

Configure with the `MCP_PERMISSIONS` environment variable, as an array or a comma-separated string:

```bash
MCP_PERMISSIONS='["read","write"]'
MCP_PERMISSIONS='read,write'
```

| Value | Default | Description |
|------|------|------|
| `read` | ✅ on | Read-only queries |
| `write` | ❌ off | Write data |
| `delete` | ❌ off | Delete data (dangerous) |
| `ddl` | ❌ off | Schema changes (dangerous) |

When unset, only `read` is granted. Tools for permissions that are not granted never appear in the tool list.

## Environment Variables

| Variable | Description |
|------|------|
| `STARROCKS_URL` | Connection string, e.g. `mysql://user:pass@host:9030/db` |
| `STARROCKS_HOST` | Host, default `localhost` |
| `STARROCKS_PORT` | Port, default `9030` |
| `STARROCKS_USER` | Username, default `root` |
| `STARROCKS_PASSWORD` | Password |
| `STARROCKS_DATABASE` | Database name, default `test` |

The `MYSQL_` prefix also works as a fallback.

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
    "starrocks": {
      "command": "npx",
      "args": ["-y", "@easy-mcps/starrocks-mcp-server"],
      "env": {
        "STARROCKS_HOST": "localhost",
        "STARROCKS_PORT": "9030",
        "STARROCKS_USER": "root",
        "STARROCKS_PASSWORD": "your-password",
        "MCP_PERMISSIONS": ["read"]
      }
    }
  }
}
```

## Security

- Single-statement enforcement rejects bypasses such as `SELECT 1; DROP TABLE x`
- The read-only path rejects data-modifying CTEs and `EXPLAIN ANALYZE` on write statements
- Database-level second line of defense: Read statements attempt a `SET TRANSACTION READ ONLY` transaction; when StarRocks does not support it, the server falls back to validation only
- Results are capped at 1000 rows and 1MB; queries time out after 30 seconds by default

The most reliable backstop is a **least-privilege database account** — use a read-only account for
read-only work. See the [repository docs](https://github.com/Code-suphub/easy-mcp/blob/master/README.en.md#least-privilege-accounts-the-real-backstop).

## Full documentation

For other databases and advanced usage, see the [easy-mcps repository](https://github.com/Code-suphub/easy-mcp/blob/master/README.en.md).

## License

MIT
