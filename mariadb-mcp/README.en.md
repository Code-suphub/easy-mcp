# MariaDB MCP Server

[简体中文](./README.md) | **English**

MCP server for MariaDB with unified permission control. MariaDB speaks the MySQL protocol.

## Installation

```bash
npx -y @easy-mcps/mariadb-mcp-server
```

```json
{
  "mcpServers": {
    "mariadb": {
      "command": "npx",
      "args": [
        "-y",
        "@easy-mcps/mariadb-mcp-server"
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
| `MARIADB_URL` | Connection string, e.g. `mysql://user:pass@host:3306/db` |
| `MARIADB_HOST` | Host, default `localhost` |
| `MARIADB_PORT` | Port, default `3306` |
| `MARIADB_USER` | Username, default `root` |
| `MARIADB_PASSWORD` | Password |
| `MARIADB_DATABASE` | Database name, default `test` |

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
    "mariadb": {
      "command": "npx",
      "args": ["-y", "@easy-mcps/mariadb-mcp-server"],
      "env": {
        "MARIADB_HOST": "localhost",
        "MARIADB_PORT": "3306",
        "MARIADB_USER": "root",
        "MARIADB_PASSWORD": "your-password",
        "MCP_PERMISSIONS": ["read"]
      }
    }
  }
}
```

## Security

- Single-statement enforcement rejects bypasses such as `SELECT 1; DROP TABLE x`
- The read-only path rejects data-modifying CTEs and `EXPLAIN ANALYZE` on write statements
- Database-level second line of defense: Read statements run inside a `SET TRANSACTION READ ONLY` transaction
- Results are capped at 1000 rows and 1MB; queries time out after 30 seconds by default

The most reliable backstop is a **least-privilege database account** — use a read-only account for
read-only work. See the [repository docs](https://github.com/Code-suphub/easy-mcp/blob/master/README.en.md#least-privilege-accounts-the-real-backstop).

## Full documentation

For other databases and advanced usage, see the [easy-mcps repository](https://github.com/Code-suphub/easy-mcp/blob/master/README.en.md).

## License

MIT
