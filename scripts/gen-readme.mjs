#!/usr/bin/env node
/**
 * 生成各包的中英双语 README
 * 用法: npm run gen:readme
 *
 * 各包 README 内容高度同构，集中生成避免 9 份手工维护产生漂移。
 * 根目录 README.md / README.en.md 是手写的，不由本脚本管理。
 */
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 各包定义：中英文名称/描述、环境变量表、工具语义、额外说明
const MYSQL_TOOLS = {
  zh: [
    ["read_query", "SELECT/SHOW/DESC/DESCRIBE/EXPLAIN/WITH", "执行只读查询"],
    ["write_query", "INSERT/UPDATE/REPLACE", "执行写入语句"],
    ["delete_query", "DELETE/TRUNCATE", "执行删除语句（危险操作）"],
    ["ddl_query", "CREATE/DROP/ALTER TABLE/DATABASE/INDEX/VIEW", "执行 DDL 语句（危险操作）"],
  ],
  en: [
    ["read_query", "SELECT/SHOW/DESC/DESCRIBE/EXPLAIN/WITH", "Read-only queries"],
    ["write_query", "INSERT/UPDATE/REPLACE", "Write data"],
    ["delete_query", "DELETE/TRUNCATE", "Delete data (dangerous)"],
    ["ddl_query", "CREATE/DROP/ALTER TABLE/DATABASE/INDEX/VIEW", "Schema changes (dangerous)"],
  ],
};

function mysqlFamilyEnv(prefix, port) {
  return {
    zh: [
      [`${prefix}_URL`, `连接字符串，如 \`mysql://user:pass@host:${port}/db\``],
      [`${prefix}_HOST`, "主机地址，默认 `localhost`"],
      [`${prefix}_PORT`, `端口，默认 \`${port}\``],
      [`${prefix}_USER`, "用户名，默认 `root`"],
      [`${prefix}_PASSWORD`, "密码"],
      [`${prefix}_DATABASE`, "数据库名，默认 `test`"],
    ],
    en: [
      [`${prefix}_URL`, `Connection string, e.g. \`mysql://user:pass@host:${port}/db\``],
      [`${prefix}_HOST`, "Host, default `localhost`"],
      [`${prefix}_PORT`, `Port, default \`${port}\``],
      [`${prefix}_USER`, "Username, default `root`"],
      [`${prefix}_PASSWORD`, "Password"],
      [`${prefix}_DATABASE`, "Database name, default `test`"],
    ],
  };
}

const PACKAGES = [
  {
    dir: "mysql-mcp", pkg: "@easy-mcps/mysql-mcp-server", key: "mysql",
    title: { zh: "MySQL MCP Server", en: "MySQL MCP Server" },
    intro: { zh: "MySQL 数据库的 MCP 服务器，统一权限控制。", en: "MCP server for MySQL with unified permission control." },
    tools: MYSQL_TOOLS, env: mysqlFamilyEnv("MYSQL", 3306),
    readonlyNote: { zh: "只读语句在 `SET TRANSACTION READ ONLY` 事务中执行", en: "Read statements run inside a `SET TRANSACTION READ ONLY` transaction" },
  },
  {
    dir: "mariadb-mcp", pkg: "@easy-mcps/mariadb-mcp-server", key: "mariadb",
    title: { zh: "MariaDB MCP Server", en: "MariaDB MCP Server" },
    intro: { zh: "MariaDB 数据库的 MCP 服务器，统一权限控制。MariaDB 兼容 MySQL 协议。", en: "MCP server for MariaDB with unified permission control. MariaDB speaks the MySQL protocol." },
    tools: MYSQL_TOOLS, env: mysqlFamilyEnv("MARIADB", 3306),
    envNote: { zh: "同时兼容 `MYSQL_` 前缀作为回退。", en: "The `MYSQL_` prefix also works as a fallback." },
    readonlyNote: { zh: "只读语句在 `SET TRANSACTION READ ONLY` 事务中执行", en: "Read statements run inside a `SET TRANSACTION READ ONLY` transaction" },
  },
  {
    dir: "tidb-mcp", pkg: "@easy-mcps/tidb-mcp-server", key: "tidb",
    title: { zh: "TiDB MCP Server", en: "TiDB MCP Server" },
    intro: { zh: "TiDB 分布式数据库的 MCP 服务器，统一权限控制。TiDB 兼容 MySQL 协议。", en: "MCP server for the TiDB distributed database with unified permission control. TiDB speaks the MySQL protocol." },
    tools: MYSQL_TOOLS,
    env: (() => {
      const e = mysqlFamilyEnv("TIDB", 4000);
      e.zh.push(["TIDB_SSL", "设为 `true` 启用 SSL（适配 TiDB Cloud）"]);
      e.en.push(["TIDB_SSL", "Set to `true` to enable SSL (for TiDB Cloud)"]);
      return e;
    })(),
    envNote: { zh: "同时兼容 `MYSQL_` 前缀作为回退。", en: "The `MYSQL_` prefix also works as a fallback." },
    readonlyNote: { zh: "只读语句在 `SET TRANSACTION READ ONLY` 事务中执行", en: "Read statements run inside a `SET TRANSACTION READ ONLY` transaction" },
  },
  {
    dir: "oceanbase-mcp", pkg: "@easy-mcps/oceanbase-mcp-server", key: "oceanbase",
    title: { zh: "OceanBase MCP Server", en: "OceanBase MCP Server" },
    intro: { zh: "OceanBase 分布式数据库的 MCP 服务器，统一权限控制。OceanBase 兼容 MySQL 协议。", en: "MCP server for the OceanBase distributed database with unified permission control. OceanBase speaks the MySQL protocol." },
    tools: MYSQL_TOOLS, env: mysqlFamilyEnv("OCEANBASE", 2881),
    envNote: { zh: "同时兼容 `MYSQL_` 前缀作为回退。", en: "The `MYSQL_` prefix also works as a fallback." },
    readonlyNote: { zh: "只读语句在 `SET TRANSACTION READ ONLY` 事务中执行", en: "Read statements run inside a `SET TRANSACTION READ ONLY` transaction" },
  },
  {
    dir: "starrocks-mcp", pkg: "@easy-mcps/starrocks-mcp-server", key: "starrocks",
    title: { zh: "StarRocks MCP Server", en: "StarRocks MCP Server" },
    intro: { zh: "StarRocks MPP 数据库的 MCP 服务器，统一权限控制。StarRocks 兼容 MySQL 协议。", en: "MCP server for the StarRocks MPP database with unified permission control. StarRocks speaks the MySQL protocol." },
    tools: MYSQL_TOOLS, env: mysqlFamilyEnv("STARROCKS", 9030),
    envNote: { zh: "同时兼容 `MYSQL_` 前缀作为回退。", en: "The `MYSQL_` prefix also works as a fallback." },
    readonlyNote: { zh: "只读语句尝试在 `SET TRANSACTION READ ONLY` 事务中执行；StarRocks 不支持该语句时自动降级为仅正则校验", en: "Read statements attempt a `SET TRANSACTION READ ONLY` transaction; when StarRocks does not support it, the server falls back to validation only" },
  },
  {
    dir: "postgresql-mcp", pkg: "@easy-mcps/postgresql-mcp-server", key: "postgresql",
    title: { zh: "PostgreSQL MCP Server", en: "PostgreSQL MCP Server" },
    intro: { zh: "PostgreSQL 数据库的 MCP 服务器，统一权限控制。", en: "MCP server for PostgreSQL with unified permission control." },
    tools: {
      zh: [
        ["read_query", "SELECT/SHOW/EXPLAIN/WITH", "执行只读查询"],
        ["write_query", "INSERT/UPDATE", "执行写入语句"],
        ["delete_query", "DELETE/TRUNCATE", "执行删除语句（危险操作）"],
        ["ddl_query", "CREATE/DROP/ALTER TABLE/DATABASE/INDEX/VIEW", "执行 DDL 语句（危险操作）"],
      ],
      en: [
        ["read_query", "SELECT/SHOW/EXPLAIN/WITH", "Read-only queries"],
        ["write_query", "INSERT/UPDATE", "Write data"],
        ["delete_query", "DELETE/TRUNCATE", "Delete data (dangerous)"],
        ["ddl_query", "CREATE/DROP/ALTER TABLE/DATABASE/INDEX/VIEW", "Schema changes (dangerous)"],
      ],
    },
    env: {
      zh: [
        ["POSTGRESQL_URL", "连接字符串，如 `postgresql://user:pass@host:5432/db`"],
        ["DATABASE_URL", "连接字符串（`POSTGRESQL_URL` 的别名）"],
        ["PGHOST", "主机地址，默认 `localhost`"],
        ["PGPORT", "端口，默认 `5432`"],
        ["PGUSER", "用户名，默认 `postgres`"],
        ["PGPASSWORD", "密码"],
        ["PGDATABASE", "数据库名，默认 `postgres`"],
        ["POSTGRESQL_SSL` / `PGSSLMODE", "SSL 模式：`true` / `require` / `verify` / `false` / `disable`"],
      ],
      en: [
        ["POSTGRESQL_URL", "Connection string, e.g. `postgresql://user:pass@host:5432/db`"],
        ["DATABASE_URL", "Alias for `POSTGRESQL_URL`"],
        ["PGHOST", "Host, default `localhost`"],
        ["PGPORT", "Port, default `5432`"],
        ["PGUSER", "Username, default `postgres`"],
        ["PGPASSWORD", "Password"],
        ["PGDATABASE", "Database name, default `postgres`"],
        ["POSTGRESQL_SSL` / `PGSSLMODE", "SSL mode: `true` / `require` / `verify` / `false` / `disable`"],
      ],
    },
    readonlyNote: { zh: "读写分池，读池连接强制 `default_transaction_read_only=on`", en: "Separate read/write pools; the read pool sets `default_transaction_read_only=on`" },
    extra: {
      zh: `### SSL 配置

适配 Neon、Supabase 等云数据库：

\`\`\`json
"env": {
  "POSTGRESQL_URL": "postgresql://user:pass@host/db?sslmode=require",
  "POSTGRESQL_SSL": "true"
}
\`\`\`

\`POSTGRESQL_SSL\` / \`PGSSLMODE\` 取值：
- \`true\` / \`require\` / \`prefer\` — 启用 SSL，不验证证书
- \`verify\` / \`verify-full\` / \`verify-ca\` — 启用 SSL 并验证证书
- \`false\` / \`disable\` — 禁用 SSL`,
      en: `### SSL

For Neon, Supabase, and other cloud providers:

\`\`\`json
"env": {
  "POSTGRESQL_URL": "postgresql://user:pass@host/db?sslmode=require",
  "POSTGRESQL_SSL": "true"
}
\`\`\`

Accepted values for \`POSTGRESQL_SSL\` / \`PGSSLMODE\`:
- \`true\` / \`require\` / \`prefer\` — enable SSL without certificate verification
- \`verify\` / \`verify-full\` / \`verify-ca\` — enable SSL with certificate verification
- \`false\` / \`disable\` — disable SSL`,
    },
  },
  {
    dir: "clickhouse-mcp", pkg: "@easy-mcps/clickhouse-mcp-server", key: "clickhouse",
    title: { zh: "ClickHouse MCP Server", en: "ClickHouse MCP Server" },
    intro: { zh: "ClickHouse OLAP 数据库的 MCP 服务器，统一权限控制，支持集群多节点故障转移。", en: "MCP server for the ClickHouse OLAP database with unified permission control and multi-node cluster failover." },
    tools: {
      zh: [
        ["read_query", "SELECT/SHOW/DESC/EXISTS/EXPLAIN/WITH", "执行只读查询"],
        ["write_query", "INSERT / ALTER TABLE ... UPDATE", "写入数据（UPDATE mutation 归此工具）"],
        ["delete_query", "DELETE FROM / TRUNCATE / ALTER TABLE ... DELETE", "删除数据（危险操作）"],
        ["ddl_query", "CREATE/DROP/ALTER TABLE/DATABASE/VIEW", "表结构操作，支持 ON CLUSTER（危险操作）"],
      ],
      en: [
        ["read_query", "SELECT/SHOW/DESC/EXISTS/EXPLAIN/WITH", "Read-only queries"],
        ["write_query", "INSERT / ALTER TABLE ... UPDATE", "Write data (UPDATE mutations belong here)"],
        ["delete_query", "DELETE FROM / TRUNCATE / ALTER TABLE ... DELETE", "Delete data (dangerous)"],
        ["ddl_query", "CREATE/DROP/ALTER TABLE/DATABASE/VIEW", "Schema changes, supports ON CLUSTER (dangerous)"],
      ],
    },
    env: {
      zh: [
        ["CLICKHOUSE_HOSTS", "集群多节点，逗号分隔如 `ch1:8123,ch2:8123`，连接失败自动切换"],
        ["CLICKHOUSE_URL", "单节点连接字符串"],
        ["CLICKHOUSE_HOST", "主机地址，默认 `localhost`"],
        ["CLICKHOUSE_PORT", "端口，默认 `8123`（HTTPS 时 `8443`）"],
        ["CLICKHOUSE_USER", "用户名，默认 `default`"],
        ["CLICKHOUSE_PASSWORD", "密码"],
        ["CLICKHOUSE_DATABASE", "数据库名，默认 `default`"],
        ["CLICKHOUSE_SECURE", "设为 `true` 使用 HTTPS"],
      ],
      en: [
        ["CLICKHOUSE_HOSTS", "Cluster nodes, comma-separated (`ch1:8123,ch2:8123`), with automatic failover"],
        ["CLICKHOUSE_URL", "Single-node connection string"],
        ["CLICKHOUSE_HOST", "Host, default `localhost`"],
        ["CLICKHOUSE_PORT", "Port, default `8123` (`8443` over HTTPS)"],
        ["CLICKHOUSE_USER", "Username, default `default`"],
        ["CLICKHOUSE_PASSWORD", "Password"],
        ["CLICKHOUSE_DATABASE", "Database name, default `default`"],
        ["CLICKHOUSE_SECURE", "Set to `true` to use HTTPS"],
      ],
    },
    readonlyNote: { zh: "只读查询带 `readonly=2` 设置，服务端拒绝一切写入", en: "Read queries carry the `readonly=2` setting so the server rejects any write" },
    extra: {
      zh: `### 集群配置

\`CLICKHOUSE_HOSTS\` 支持配置多个节点，连接类错误（节点宕机、网络超时）时自动切换到下一个节点：

\`\`\`json
"env": {
  "CLICKHOUSE_HOSTS": "ch1:8123,ch2:8123,ch3:8123"
}
\`\`\`

只读查询会自动重试其他节点；写语句失败时只切换节点不重试，避免服务端已接收后重复写入。
DDL 语句可正常携带 \`ON CLUSTER\` 子句。`,
      en: `### Cluster setup

\`CLICKHOUSE_HOSTS\` accepts multiple nodes and switches to the next one on connection errors
(node down, network timeout):

\`\`\`json
"env": {
  "CLICKHOUSE_HOSTS": "ch1:8123,ch2:8123,ch3:8123"
}
\`\`\`

Read-only queries retry on other nodes automatically. Write statements switch nodes without
retrying, so a statement the server already received is never written twice. DDL statements may
carry an \`ON CLUSTER\` clause.`,
    },
  },
  {
    dir: "sqlite-mcp", pkg: "@easy-mcps/sqlite-mcp-server", key: "sqlite",
    title: { zh: "SQLite MCP Server", en: "SQLite MCP Server" },
    intro: { zh: "SQLite 嵌入式数据库的 MCP 服务器，统一权限控制。", en: "MCP server for the SQLite embedded database with unified permission control." },
    tools: {
      zh: [
        ["read_query", "SELECT/WITH/EXPLAIN/PRAGMA", "执行只读查询"],
        ["write_query", "INSERT/UPDATE/REPLACE", "执行写入语句"],
        ["delete_query", "DELETE", "执行删除语句（危险操作）"],
        ["ddl_query", "CREATE/DROP/ALTER TABLE/INDEX/VIEW", "执行 DDL 语句（危险操作）"],
      ],
      en: [
        ["read_query", "SELECT/WITH/EXPLAIN/PRAGMA", "Read-only queries"],
        ["write_query", "INSERT/UPDATE/REPLACE", "Write data"],
        ["delete_query", "DELETE", "Delete data (dangerous)"],
        ["ddl_query", "CREATE/DROP/ALTER TABLE/INDEX/VIEW", "Schema changes (dangerous)"],
      ],
    },
    env: {
      zh: [
        ["SQLITE_PATH", "数据库文件路径，默认当前目录 `data.db`"],
        ["SQLITE_URL", "`sqlite:///path/to/database.db` 格式"],
      ],
      en: [
        ["SQLITE_PATH", "Database file path, default `data.db` in the working directory"],
        ["SQLITE_URL", "`sqlite:///path/to/database.db` form"],
      ],
    },
    readonlyNote: { zh: "读操作走独立的 readonly 连接，SQLite 层面直接拒绝写入", en: "Reads use a dedicated readonly connection, so SQLite itself rejects writes" },
  },
];

const REDIS = {
  dir: "redis-mcp", pkg: "@easy-mcps/redis-mcp-server", key: "redis",
  title: { zh: "Redis MCP Server", en: "Redis MCP Server" },
  intro: { zh: "Redis 键值数据库的 MCP 服务器，统一权限控制，命令按类别校验。", en: "MCP server for Redis with unified permission control and per-category command validation." },
  env: {
    zh: [
      ["REDIS_URL", "连接字符串，支持 `redis://` 和 `rediss://`"],
      ["REDIS_HOST", "主机地址，默认 `localhost`"],
      ["REDIS_PORT", "端口，默认 `6379`"],
      ["REDIS_PASSWORD", "密码"],
      ["REDIS_DATABASE", "数据库编号，默认 `0`"],
      ["REDIS_TLS` / `REDIS_SSL", "设置为 `true` 启用 TLS 加密"],
    ],
    en: [
      ["REDIS_URL", "Connection string, supports `redis://` and `rediss://`"],
      ["REDIS_HOST", "Host, default `localhost`"],
      ["REDIS_PORT", "Port, default `6379`"],
      ["REDIS_PASSWORD", "Password"],
      ["REDIS_DATABASE", "Database index, default `0`"],
      ["REDIS_TLS` / `REDIS_SSL", "Set to `true` to enable TLS"],
    ],
  },
};

const T = {
  zh: {
    langLine: (other) => `**简体中文** | [English](./${other})`,
    tools: "工具", toolsHead: ["工具", "命令类型", "说明"],
    perms: "权限配置",
    permsIntro: "通过环境变量 `MCP_PERMISSIONS` 配置，支持数组或逗号分隔格式：",
    permsHead: ["权限值", "默认", "说明"],
    permsNote: "不配置时默认只有 `read`。未开启的权限对应的工具不会出现在工具列表里。",
    env: "环境变量", envHead: ["变量", "说明"],
    common: "通用变量",
    install: "安装使用",
    security: "安全机制",
    securityBody: (note) => `- 强制单条语句，拒绝 \`SELECT 1; DROP TABLE x\` 这类多语句绕过
- 只读通道拒绝 data-modifying CTE、\`EXPLAIN ANALYZE\` 写语句等借道写入
- 数据库层第二道防线：${note}
- 结果默认最多 1000 行且不超过 1MB，单条查询默认 30 秒超时

最可靠的兜底是使用**最小权限的数据库账号**——只读场景就配只读账号，详见[仓库说明](https://github.com/Code-suphub/easy-mcp#最小权限建议最终兜底)。`,
    example: "配置示例",
    license: "License",
    docs: "完整文档",
    docsBody: "更多数据库与用法见 [easy-mcps 仓库](https://github.com/Code-suphub/easy-mcp)。",
  },
  en: {
    langLine: (other) => `[简体中文](./${other}) | **English**`,
    tools: "Tools", toolsHead: ["Tool", "Command types", "Description"],
    perms: "Permissions",
    permsIntro: "Configure with the `MCP_PERMISSIONS` environment variable, as an array or a comma-separated string:",
    permsHead: ["Value", "Default", "Description"],
    permsNote: "When unset, only `read` is granted. Tools for permissions that are not granted never appear in the tool list.",
    env: "Environment Variables", envHead: ["Variable", "Description"],
    common: "Common variables",
    install: "Installation",
    security: "Security",
    securityBody: (note) => `- Single-statement enforcement rejects bypasses such as \`SELECT 1; DROP TABLE x\`
- The read-only path rejects data-modifying CTEs and \`EXPLAIN ANALYZE\` on write statements
- Database-level second line of defense: ${note}
- Results are capped at 1000 rows and 1MB; queries time out after 30 seconds by default

The most reliable backstop is a **least-privilege database account** — use a read-only account for
read-only work. See the [repository docs](https://github.com/Code-suphub/easy-mcp/blob/master/README.en.md#least-privilege-accounts-the-real-backstop).`,
    example: "Configuration Example",
    license: "License",
    docs: "Full documentation",
    docsBody: "For other databases and advanced usage, see the [easy-mcps repository](https://github.com/Code-suphub/easy-mcp/blob/master/README.en.md).",
  },
};

const PERM_ROWS = {
  zh: [["read", "✅ 开启", "只读查询"], ["write", "❌ 关闭", "写入数据"], ["delete", "❌ 关闭", "删除数据（危险）"], ["ddl", "❌ 关闭", "表结构操作（危险）"]],
  en: [["read", "✅ on", "Read-only queries"], ["write", "❌ off", "Write data"], ["delete", "❌ off", "Delete data (dangerous)"], ["ddl", "❌ off", "Schema changes (dangerous)"]],
};

const REDIS_PERM_ROWS = {
  zh: [["read", "✅ 开启", "读命令（GET/HGET/SCAN 等）"], ["write", "❌ 关闭", "写命令（SET/HSET/DEL 等）"], ["admin", "❌ 关闭", "管理命令（FLUSHDB/CONFIG/EVAL 等，危险）"]],
  en: [["read", "✅ on", "Read commands (GET/HGET/SCAN…)"], ["write", "❌ off", "Write commands (SET/HSET/DEL…)"], ["admin", "❌ off", "Admin commands (FLUSHDB/CONFIG/EVAL…, dangerous)"]],
};

const COMMON_ENV = {
  zh: [
    ["MCP_PERMISSIONS", "权限控制，如 `read,write` 或 `[\"read\",\"write\"]`"],
    ["MCP_MAX_ROWS", "查询结果最大返回行数，默认 `1000`"],
    ["MCP_MAX_BYTES", "返回文本最大字节数，默认 `1048576`（1MB）"],
    ["MCP_QUERY_TIMEOUT", "单条查询/命令超时（毫秒），默认 `30000`"],
  ],
  en: [
    ["MCP_PERMISSIONS", "Permissions, e.g. `read,write` or `[\"read\",\"write\"]`"],
    ["MCP_MAX_ROWS", "Maximum rows returned, default `1000`"],
    ["MCP_MAX_BYTES", "Maximum response size in bytes, default `1048576` (1MB)"],
    ["MCP_QUERY_TIMEOUT", "Per-query/command timeout in milliseconds, default `30000`"],
  ],
};

function table(head, rows) {
  return [
    `| ${head.join(" | ")} |`,
    `|${head.map(() => "------").join("|")}|`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}

function envTable(lang, rows) {
  return table(T[lang].envHead, rows.map(([k, v]) => [`\`${k}\``, v]));
}

// 从环境变量说明里提取默认值作为示例值，提取不到则用占位符
function exampleValue(desc, key) {
  const m = desc.match(/`([^`]+)`\s*$/);
  if (m && !/^(true|false)$/.test(m[1]) && !m[1].includes("/")) return m[1];
  if (/PASSWORD/.test(key)) return "your-password";
  if (/URL/.test(key)) return "";
  return "";
}

function render(spec, lang, isRedis = false) {
  const t = T[lang];
  const otherFile = lang === "zh" ? "README.en.md" : "README.md";
  const exampleEnv = spec.env[lang]
    .slice(1, 5)
    .map(([k, desc]) => {
      const key = k.split("` / `")[0];
      return `        "${key}": "${exampleValue(desc, key)}"`;
    })
    .join(",\n");

  const parts = [
    `# ${spec.title[lang]}`,
    ``,
    t.langLine(otherFile),
    ``,
    spec.intro[lang],
    ``,
    `## ${t.install}`,
    ``,
    "```bash",
    `npx -y ${spec.pkg}`,
    "```",
    ``,
    "```json",
    JSON.stringify({ mcpServers: { [spec.key]: { command: "npx", args: ["-y", spec.pkg] } } }, null, 2),
    "```",
    ``,
    `## ${t.tools}`,
    ``,
  ];

  if (isRedis) {
    parts.push(
      lang === "zh"
        ? table(["工具", "说明"], [
            ["`read`", "执行读命令（GET/HGET/SMEMBERS/SCAN 等）"],
            ["`write`", "执行写命令（SET/HSET/DEL/SADD 等）"],
            ["`admin`", "执行管理命令（FLUSHDB/CONFIG/EVAL 等，危险操作）"],
          ])
        : table(["Tool", "Description"], [
            ["`read`", "Read commands (GET/HGET/SMEMBERS/SCAN…)"],
            ["`write`", "Write commands (SET/HSET/DEL/SADD…)"],
            ["`admin`", "Admin commands (FLUSHDB/CONFIG/EVAL…, dangerous)"],
          ]),
      ``,
      lang === "zh"
        ? "命令按类别校验：`read` 工具无法执行写或管理命令，即使命令在总白名单中。不在白名单中的命令一律拒绝。\n\n⚠️ `KEYS` 会遍历全库并阻塞 Redis，生产环境请改用 `SCAN`。"
        : "Commands are validated against their category: the `read` tool cannot execute write or admin\ncommands even though they are on the overall allowlist. Commands outside the allowlist are rejected.\n\n⚠️ `KEYS` scans the entire keyspace and blocks Redis — use `SCAN` in production.",
    );
  } else {
    parts.push(table(t.toolsHead, spec.tools[lang].map(([n, ty, d]) => [`\`${n}\``, ty, d])));
  }

  parts.push(
    ``,
    `## ${t.perms}`,
    ``,
    t.permsIntro,
    ``,
    "```bash",
    `MCP_PERMISSIONS='["read","write"]'`,
    `MCP_PERMISSIONS='read,write'`,
    "```",
    ``,
    table(t.permsHead, (isRedis ? REDIS_PERM_ROWS : PERM_ROWS)[lang].map(([p, d, desc]) => [`\`${p}\``, d, desc])),
    ``,
    t.permsNote,
    ``,
    `## ${t.env}`,
    ``,
    envTable(lang, spec.env[lang]),
    ``,
  );

  if (spec.envNote) parts.push(spec.envNote[lang], ``);

  parts.push(
    `### ${t.common}`,
    ``,
    envTable(lang, COMMON_ENV[lang]),
    ``,
    `## ${t.example}`,
    ``,
    "```json",
    `{
  "mcpServers": {
    "${spec.key}": {
      "command": "npx",
      "args": ["-y", "${spec.pkg}"],
      "env": {
${exampleEnv},
        "MCP_PERMISSIONS": ["read"]
      }
    }
  }
}`,
    "```",
    ``,
  );

  if (spec.extra) parts.push(spec.extra[lang], ``);

  parts.push(
    `## ${t.security}`,
    ``,
    isRedis
      ? (lang === "zh"
          ? `- 命令按类别校验，\`read\` 工具无法越权执行写/管理命令
- 命令白名单之外的命令一律拒绝
- 支持引号参数解析，\`SET k "hello world"\` 不会被拆错
- 单条命令默认 30 秒超时

最可靠的兜底是 Redis 6+ 的 ACL，如 \`ACL SETUSER mcp on +@read ~app:*\`，详见[仓库说明](https://github.com/Code-suphub/easy-mcp#最小权限建议最终兜底)。`
          : `- Commands are validated against their category, so the \`read\` tool cannot escalate to writes or admin
- Commands outside the allowlist are rejected
- Quoted arguments are parsed correctly, so \`SET k "hello world"\` is not split incorrectly
- Commands time out after 30 seconds by default

The most reliable backstop is a Redis 6+ ACL such as \`ACL SETUSER mcp on +@read ~app:*\`. See the
[repository docs](https://github.com/Code-suphub/easy-mcp/blob/master/README.en.md#least-privilege-accounts-the-real-backstop).`)
      : t.securityBody(spec.readonlyNote[lang]),
    ``,
    `## ${t.docs}`,
    ``,
    t.docsBody,
    ``,
    `## ${t.license}`,
    ``,
    `MIT`,
    ``,
  );

  return parts.join("\n");
}

const all = [...PACKAGES, REDIS];
for (const spec of all) {
  const isRedis = spec.dir === "redis-mcp";
  writeFileSync(path.join(root, spec.dir, "README.md"), render(spec, "zh", isRedis));
  writeFileSync(path.join(root, spec.dir, "README.en.md"), render(spec, "en", isRedis));
  console.log(`generated: ${spec.dir}/README.md + README.en.md`);
}
