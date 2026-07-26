# SQLite MCP Server

[简体中文](./README.md) | **English**

MCP server for the SQLite embedded database with unified permission control.

## Installation

```bash
npx -y @easy-mcps/sqlite-mcp-server
```

```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": [
        "-y",
        "@easy-mcps/sqlite-mcp-server"
      ]
    }
  }
}
```

## Tools

| Tool | Command types | Description |
|------|------|------|
| `read_query` | SELECT/WITH/EXPLAIN/PRAGMA | Read-only queries |
| `write_query` | INSERT/UPDATE/REPLACE | Write data |
| `delete_query` | DELETE | Delete data (dangerous) |
| `ddl_query` | CREATE/DROP/ALTER TABLE/INDEX/VIEW | Schema changes (dangerous) |

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
| `SQLITE_PATH` | Database file path, default `data.db` in the working directory |
| `SQLITE_URL` | `sqlite:///path/to/database.db` form |

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
    "sqlite": {
      "command": "npx",
      "args": ["-y", "@easy-mcps/sqlite-mcp-server"],
      "env": {
        "SQLITE_URL": "",
        "MCP_PERMISSIONS": ["read"]
      }
    }
  }
}
```

## Security

- Single-statement enforcement rejects bypasses such as `SELECT 1; DROP TABLE x`
- The read-only path rejects data-modifying CTEs and `EXPLAIN ANALYZE` on write statements
- Database-level second line of defense: Reads use a dedicated readonly connection, so SQLite itself rejects writes
- Results are capped at 1000 rows and 1MB; queries time out after 30 seconds by default

The most reliable backstop is a **least-privilege database account** — use a read-only account for
read-only work. See the [repository docs](https://github.com/Code-suphub/easy-mcp/blob/master/README.en.md#least-privilege-accounts-the-real-backstop).

## Full documentation

For other databases and advanced usage, see the [easy-mcps repository](https://github.com/Code-suphub/easy-mcp/blob/master/README.en.md).

## License

MIT
