# easy-mcps

[简体中文](./README.md) | **English**

A collection of database MCP servers with unified permission control. Nine databases, one permission model, one set of safety guarantees.

## Supported Databases

### MySQL-compatible
- [MySQL](./mysql-mcp/)
- [TiDB](./tidb-mcp/) - distributed NewSQL database
- [OceanBase](./oceanbase-mcp/) - distributed database
- [MariaDB](./mariadb-mcp/) - MySQL fork
- [StarRocks](./starrocks-mcp/) - MPP database

### PostgreSQL-compatible
- [PostgreSQL](./postgresql-mcp/)

### Others
- [ClickHouse](./clickhouse-mcp/) - OLAP columnar database (cluster support)
- [SQLite](./sqlite-mcp/) - embedded database
- [Redis](./redis-mcp/) - key-value store

## Tools

| Tool | SQL types | Description |
|------|-----------|-------------|
| `read_query` | SELECT/SHOW/DESC/EXPLAIN/WITH | Read-only queries, including metadata and query plans |
| `write_query` | INSERT/UPDATE/REPLACE | Write data |
| `delete_query` | DELETE/TRUNCATE | Delete data (dangerous) |
| `ddl_query` | CREATE/DROP/ALTER TABLE/DATABASE/INDEX/VIEW | Schema changes (dangerous) |

Redis exposes three tools instead — `read` / `write` / `admin`. Commands are validated against
their category, so the `read` tool cannot execute write or admin commands.

ClickHouse mapping: `ALTER TABLE ... UPDATE` counts as write; `DELETE FROM`, `TRUNCATE`, and
`ALTER TABLE ... DELETE` count as delete. Multi-node failover is available via `CLICKHOUSE_HOSTS`,
and DDL statements may carry an `ON CLUSTER` clause.

## Permissions

Set permissions through the `MCP_PERMISSIONS` environment variable, as an array or a comma-separated string:

```json
"MCP_PERMISSIONS": ["read", "write"]
"MCP_PERMISSIONS": "read,write"
```

| Value | Description |
|-------|-------------|
| `read` | Read operations (enabled by default) |
| `write` | Write operations |
| `delete` | Delete operations |
| `ddl` | Schema changes |
| `admin` | Admin operations (Redis only) |

When `MCP_PERMISSIONS` is unset, only `read` is granted. Tools for permissions that are not
granted never appear in the tool list.

## Security

**Statement-level validation**
- Every SQL tool requires a single statement, rejecting bypasses such as `SELECT 1; DROP TABLE x`
- The read-only path rejects data-modifying CTEs, `EXPLAIN ANALYZE` on write statements,
  `INTO OUTFILE`, and `SELECT INTO`
- The SQL literal stripper is dialect-aware: `#` is a comment only in MySQL-family dialects, and
  backslash escapes quotes only in MySQL-family dialects. Getting this wrong lets dialect
  differences slip past single-statement detection.

**Database-level second line of defense** (holds even if validation is bypassed)

| Database | Mechanism |
|----------|-----------|
| MySQL family | Read statements run inside a `SET TRANSACTION READ ONLY` transaction |
| PostgreSQL | Separate read/write pools; the read pool sets `default_transaction_read_only=on` |
| ClickHouse | Read queries carry the `readonly=2` setting |
| SQLite | Reads use a dedicated readonly connection |

**Resource limits**
- Results are capped at 1000 rows (`MCP_MAX_ROWS`) and 1MB (`MCP_MAX_BYTES`); anything beyond is
  truncated with a note
- Queries time out after 30 seconds by default (`MCP_QUERY_TIMEOUT`), which also applies to Redis commands

### Least-privilege accounts (the real backstop)

SQL validation and read-only sessions are application-level defenses. The most reliable backstop is
connecting with a **least-privilege database account**:

- Read-only use: create an account with only `SELECT` (plus metadata) privileges, so writes are
  impossible even if validation is bypassed
- Read-write use: grant DML on the target database only — no DDL or admin privileges
  (`SUPER`, `FILE`, `GRANT`, etc.)
- Redis 6+: restrict commands and key prefixes with ACLs, e.g. `ACL SETUSER mcp on +@read ~app:*`
- Never connect as root or an administrator

## Installation

### Run with npx (recommended)

```json
{
  "mcpServers": {
    "mysql": {
      "command": "npx",
      "args": ["-y", "@easy-mcps/mysql-mcp-server"]
    }
  }
}
```

### Install globally

```bash
npm install -g @easy-mcps/mysql-mcp-server
```

### Local path

```json
{
  "mcpServers": {
    "mysql": {
      "command": "node",
      "args": ["/path/to/mysql-mcp/dist/index.js"]
    }
  }
}
```

## Environment Variables

### Common (all packages)

| Variable | Required | Description |
|----------|----------|-------------|
| `MCP_PERMISSIONS` | Optional | Permissions, e.g. `read,write` or `["read","write"]` |
| `MCP_MAX_ROWS` | Optional | Maximum rows returned, default `1000` |
| `MCP_MAX_BYTES` | Optional | Maximum response size in bytes, default `1048576` (1MB) |
| `MCP_QUERY_TIMEOUT` | Optional | Per-query/command timeout in milliseconds, default `30000` |

### MySQL family (MySQL / TiDB / OceanBase / MariaDB / StarRocks)

MySQL is shown below; other packages use the `TIDB_`, `OCEANBASE_`, `MARIADB_`, or `STARROCKS_`
prefix instead and fall back to the `MYSQL_` prefix.

| Variable | Required | Description |
|----------|----------|-------------|
| `MYSQL_URL` | Optional | Connection string, e.g. `mysql://user:pass@host:3306/db` |
| `MYSQL_HOST` | Optional | Host, default `localhost` |
| `MYSQL_PORT` | Optional | Port, default `3306` (TiDB `4000`, OceanBase `2881`, StarRocks `9030`) |
| `MYSQL_USER` | Optional | Username, default `root` |
| `MYSQL_PASSWORD` | Optional | Password |
| `MYSQL_DATABASE` | Optional | Database name, default `test` |
| `TIDB_SSL` | Optional | TiDB only: set to `true` to enable SSL (for TiDB Cloud) |

### PostgreSQL

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTGRESQL_URL` | Optional | Connection string, e.g. `postgresql://user:pass@host:5432/db` |
| `DATABASE_URL` | Optional | Alias for `POSTGRESQL_URL` |
| `PGHOST` | Optional | Host, default `localhost` |
| `PGPORT` | Optional | Port, default `5432` |
| `PGUSER` | Optional | Username, default `postgres` |
| `PGPASSWORD` | Optional | Password |
| `PGDATABASE` | Optional | Database name, default `postgres` |
| `POSTGRESQL_SSL` / `PGSSLMODE` | Optional | SSL mode: `true` / `require` / `verify` / `false` / `disable` |

### ClickHouse

| Variable | Required | Description |
|----------|----------|-------------|
| `CLICKHOUSE_HOSTS` | Optional | Cluster nodes, comma-separated (`ch1:8123,ch2:8123`), with automatic failover |
| `CLICKHOUSE_URL` | Optional | Single-node connection string |
| `CLICKHOUSE_HOST` | Optional | Host, default `localhost` |
| `CLICKHOUSE_PORT` | Optional | Port, default `8123` (`8443` over HTTPS) |
| `CLICKHOUSE_USER` | Optional | Username, default `default` |
| `CLICKHOUSE_PASSWORD` | Optional | Password |
| `CLICKHOUSE_DATABASE` | Optional | Database name, default `default` |
| `CLICKHOUSE_SECURE` | Optional | Set to `true` to use HTTPS |

### SQLite

| Variable | Required | Description |
|----------|----------|-------------|
| `SQLITE_PATH` | Optional | Database file path, default `data.db` in the working directory |
| `SQLITE_URL` | Optional | `sqlite:///path/to/database.db` form |

### Redis

| Variable | Required | Description |
|----------|----------|-------------|
| `REDIS_URL` | Optional | Connection string, supports `redis://` and `rediss://` |
| `REDIS_HOST` | Optional | Host, default `localhost` |
| `REDIS_PORT` | Optional | Port, default `6379` |
| `REDIS_PASSWORD` | Optional | Password |
| `REDIS_DATABASE` | Optional | Database index, default `0` |
| `REDIS_TLS` / `REDIS_SSL` | Optional | Set to `true` to enable TLS |

## Configuration Examples

### MySQL

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
        "MYSQL_PASSWORD": "password",
        "MYSQL_DATABASE": "test",
        "MCP_PERMISSIONS": ["read", "write"]
      }
    }
  }
}
```

### PostgreSQL with SSL (Neon and other cloud providers)

```json
{
  "mcpServers": {
    "postgresql": {
      "command": "npx",
      "args": ["-y", "@easy-mcps/postgresql-mcp-server"],
      "env": {
        "POSTGRESQL_URL": "postgresql://user:pass@host/db?sslmode=require",
        "POSTGRESQL_SSL": "true",
        "MCP_PERMISSIONS": ["read"]
      }
    }
  }
}
```

Accepted values for `POSTGRESQL_SSL` / `PGSSLMODE`:
- `true` / `require` / `prefer` — enable SSL without certificate verification
- `verify` / `verify-full` / `verify-ca` — enable SSL with certificate verification
- `false` / `disable` — disable SSL

### ClickHouse cluster

```json
{
  "mcpServers": {
    "clickhouse": {
      "command": "npx",
      "args": ["-y", "@easy-mcps/clickhouse-mcp-server"],
      "env": {
        "CLICKHOUSE_HOSTS": "ch1:8123,ch2:8123,ch3:8123",
        "CLICKHOUSE_USER": "default",
        "CLICKHOUSE_PASSWORD": "password",
        "CLICKHOUSE_DATABASE": "default",
        "MCP_PERMISSIONS": ["read"]
      }
    }
  }
}
```

### Redis with TLS (Upstash and other cloud providers)

```json
{
  "mcpServers": {
    "redis": {
      "command": "npx",
      "args": ["-y", "@easy-mcps/redis-mcp-server"],
      "env": {
        "REDIS_URL": "rediss://default:pass@host:6379",
        "REDIS_TLS": "true",
        "MCP_PERMISSIONS": ["read", "write"]
      }
    }
  }
}
```

With `REDIS_URL` you can use the `rediss://` scheme directly — ioredis detects TLS automatically.

## Development

```bash
npm install          # install dependencies
npm run build        # sync shared module + build all packages
npm test             # build + shared-module consistency check + SQL validation cases
cd mysql-mcp && npm run dev   # develop a single package
```

**Shared module**: permission parsing, SQL validation, and result truncation live in `src/shared.ts`
at the repository root and are copied into each package by `npm run sync`. **Do not edit the
per-package `src/shared.ts` copies** — those edits are overwritten on the next sync, and `npm test`
verifies that the copies match.

## Publishing

### npm token setup

Add a Granular Access Token to `~/.npmrc`:

```
//registry.npmjs.org/:_authToken=YOUR_TOKEN
```

Token requirements:
- Type: **Granular Access Token**
- Permissions: **Read and write** on all packages + read/write on the organization
- Enable **Bypass two-factor authentication (2FA)** — without it, publishing fails with a 403

### Publish

```bash
npm run release:all        # run tests, then publish all nine packages
npm run release:mysql      # or publish one package
```

Each release script syncs the shared module, bumps the patch version, builds, and publishes.

## License

MIT
