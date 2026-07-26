# PostgreSQL MCP Server

[简体中文](./README.md) | **English**

MCP server for PostgreSQL with unified permission control.

## Installation

```bash
npx -y @easy-mcps/postgresql-mcp-server
```

```json
{
  "mcpServers": {
    "postgresql": {
      "command": "npx",
      "args": [
        "-y",
        "@easy-mcps/postgresql-mcp-server"
      ]
    }
  }
}
```

## Tools

| Tool | Command types | Description |
|------|------|------|
| `read_query` | SELECT/SHOW/EXPLAIN/WITH | Read-only queries |
| `write_query` | INSERT/UPDATE | Write data |
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
| `POSTGRESQL_URL` | Connection string, e.g. `postgresql://user:pass@host:5432/db` |
| `DATABASE_URL` | Alias for `POSTGRESQL_URL` |
| `PGHOST` | Host, default `localhost` |
| `PGPORT` | Port, default `5432` |
| `PGUSER` | Username, default `postgres` |
| `PGPASSWORD` | Password |
| `PGDATABASE` | Database name, default `postgres` |
| `POSTGRESQL_SSL` / `PGSSLMODE` | SSL mode: `true` / `require` / `verify` / `false` / `disable` |

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
    "postgresql": {
      "command": "npx",
      "args": ["-y", "@easy-mcps/postgresql-mcp-server"],
      "env": {
        "DATABASE_URL": "POSTGRESQL_URL",
        "PGHOST": "localhost",
        "PGPORT": "5432",
        "PGUSER": "postgres",
        "MCP_PERMISSIONS": ["read"]
      }
    }
  }
}
```

### SSL

For Neon, Supabase, and other cloud providers:

```json
"env": {
  "POSTGRESQL_URL": "postgresql://user:pass@host/db?sslmode=require",
  "POSTGRESQL_SSL": "true"
}
```

Accepted values for `POSTGRESQL_SSL` / `PGSSLMODE`:
- `true` / `require` / `prefer` — enable SSL without certificate verification
- `verify` / `verify-full` / `verify-ca` — enable SSL with certificate verification
- `false` / `disable` — disable SSL

## Security

- Single-statement enforcement rejects bypasses such as `SELECT 1; DROP TABLE x`
- The read-only path rejects data-modifying CTEs and `EXPLAIN ANALYZE` on write statements
- Database-level second line of defense: Separate read/write pools; the read pool sets `default_transaction_read_only=on`
- Results are capped at 1000 rows and 1MB; queries time out after 30 seconds by default

The most reliable backstop is a **least-privilege database account** — use a read-only account for
read-only work. See the [repository docs](https://github.com/Code-suphub/easy-mcp/blob/master/README.en.md#least-privilege-accounts-the-real-backstop).

## Full documentation

For other databases and advanced usage, see the [easy-mcps repository](https://github.com/Code-suphub/easy-mcp/blob/master/README.en.md).

## License

MIT
