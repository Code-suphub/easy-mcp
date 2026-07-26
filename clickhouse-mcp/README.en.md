# ClickHouse MCP Server

[简体中文](./README.md) | **English**

MCP server for the ClickHouse OLAP database with unified permission control and multi-node cluster failover.

## Installation

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

## Tools

| Tool | Command types | Description |
|------|------|------|
| `read_query` | SELECT/SHOW/DESC/EXISTS/EXPLAIN/WITH | Read-only queries |
| `write_query` | INSERT / ALTER TABLE ... UPDATE | Write data (UPDATE mutations belong here) |
| `delete_query` | DELETE FROM / TRUNCATE / ALTER TABLE ... DELETE | Delete data (dangerous) |
| `ddl_query` | CREATE/DROP/ALTER TABLE/DATABASE/VIEW | Schema changes, supports ON CLUSTER (dangerous) |

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
| `CLICKHOUSE_HOSTS` | Cluster nodes, comma-separated (`ch1:8123,ch2:8123`), with automatic failover |
| `CLICKHOUSE_URL` | Single-node connection string |
| `CLICKHOUSE_HOST` | Host, default `localhost` |
| `CLICKHOUSE_PORT` | Port, default `8123` (`8443` over HTTPS) |
| `CLICKHOUSE_USER` | Username, default `default` |
| `CLICKHOUSE_PASSWORD` | Password |
| `CLICKHOUSE_DATABASE` | Database name, default `default` |
| `CLICKHOUSE_SECURE` | Set to `true` to use HTTPS |

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

### Cluster setup

`CLICKHOUSE_HOSTS` accepts multiple nodes and switches to the next one on connection errors
(node down, network timeout):

```json
"env": {
  "CLICKHOUSE_HOSTS": "ch1:8123,ch2:8123,ch3:8123"
}
```

Read-only queries retry on other nodes automatically. Write statements switch nodes without
retrying, so a statement the server already received is never written twice. DDL statements may
carry an `ON CLUSTER` clause.

## Security

- Single-statement enforcement rejects bypasses such as `SELECT 1; DROP TABLE x`
- The read-only path rejects data-modifying CTEs and `EXPLAIN ANALYZE` on write statements
- Database-level second line of defense: Read queries carry the `readonly=2` setting so the server rejects any write
- Results are capped at 1000 rows and 1MB; queries time out after 30 seconds by default

The most reliable backstop is a **least-privilege database account** — use a read-only account for
read-only work. See the [repository docs](https://github.com/Code-suphub/easy-mcp/blob/master/README.en.md#least-privilege-accounts-the-real-backstop).

## Full documentation

For other databases and advanced usage, see the [easy-mcps repository](https://github.com/Code-suphub/easy-mcp/blob/master/README.en.md).

## License

MIT
