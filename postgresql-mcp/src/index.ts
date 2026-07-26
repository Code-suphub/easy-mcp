#!/usr/bin/env node
/**
 * PostgreSQL MCP Server - 统一权限控制
 * 4 工具模式：read_query, write_query, delete_query, ddl_query
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import pg, { Pool } from "pg";
import { getPermissions, validateSQL, formatRows, getQueryTimeout } from "./shared.js";

// ============ SSL 配置 ============
// 支持 POSTGRESQL_SSL 或 PGSSLMODE 环境变量
// true/require -> 启用 SSL（不验证证书，适配 Neon 等云数据库）
// verify/verify-full/verify-ca -> 启用 SSL 并验证证书
// false/disable -> 禁用 SSL
function getSSLConfig(): boolean | { rejectUnauthorized: boolean } | undefined {
  const ssl = process.env.POSTGRESQL_SSL;
  const sslmode = process.env.PGSSLMODE;
  const mode = ssl || sslmode;

  if (!mode) return undefined;

  const lower = mode.toLowerCase();
  if (lower === 'true' || lower === 'require' || lower === 'prefer') {
    return { rejectUnauthorized: false };
  }
  if (lower === 'verify' || lower === 'verify-full' || lower === 'verify-ca') {
    return { rejectUnauthorized: true };
  }
  if (lower === 'false' || lower === 'disable') {
    return false;
  }
  return undefined;
}

// ============ 数据库连接 ============
// 读写分池：读池连接强制 default_transaction_read_only=on，
// 作为正则校验之外的第二道防线（写语句在读池连接上会被数据库直接拒绝）
const pools: { read?: Pool; write?: Pool } = {};

function getConnectionString(): string {
  return process.env.POSTGRESQL_URL || process.env.DATABASE_URL ||
    `postgresql://${process.env.PGUSER || "postgres"}:${process.env.PGPASSWORD || ""}@${process.env.PGHOST || "localhost"}:${process.env.PGPORT || "5432"}/${process.env.PGDATABASE || "postgres"}`;
}

function getPool(kind: "read" | "write"): Pool {
  let pool = pools[kind];
  if (!pool) {
    pool = new Pool({
      connectionString: getConnectionString(),
      ssl: getSSLConfig(),
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      statement_timeout: getQueryTimeout(),
      options: kind === "read" ? "-c default_transaction_read_only=on" : undefined,
    });
    pools[kind] = pool;
  }
  return pool;
}

// ============ MCP Server ============
const server = new Server(
  { name: "easy-mcps/postgresql", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ============ 工具定义 ============
const toolDefs = [
  {
    name: "read_query",
    description: "执行只读查询（SELECT/SHOW/EXPLAIN/WITH）",
    inputSchema: { type: "object", properties: { sql: { type: "string", description: "只读 SQL 语句" } }, required: ["sql"] },
    check: () => getPermissions().canRead, sqlType: "read" as const,
  },
  {
    name: "write_query",
    description: "执行 INSERT/UPDATE 语句",
    inputSchema: { type: "object", properties: { sql: { type: "string", description: "INSERT 或 UPDATE SQL 语句" } }, required: ["sql"] },
    check: () => getPermissions().canWrite, sqlType: "write" as const,
  },
  {
    name: "delete_query",
    description: "执行 DELETE/TRUNCATE 语句（危险操作）",
    inputSchema: { type: "object", properties: { sql: { type: "string", description: "DELETE 或 TRUNCATE SQL 语句" } }, required: ["sql"] },
    check: () => getPermissions().canDelete, sqlType: "delete" as const,
  },
  {
    name: "ddl_query",
    description: "执行 CREATE/DROP/ALTER TABLE/DATABASE/INDEX/VIEW 等 DDL 语句（危险操作）",
    inputSchema: { type: "object", properties: { sql: { type: "string", description: "DDL SQL 语句" } }, required: ["sql"] },
    check: () => getPermissions().canDDL, sqlType: "ddl" as const,
  },
];

// ============ 请求处理器 ============
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefs.filter(t => t.check()).map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = toolDefs.find(t => t.name === name);
  if (!tool) return { content: [{ type: "text", text: `未知工具: ${name}` }], isError: true };
  if (!tool.check()) return { content: [{ type: "text", text: `工具 ${name} 已禁用` }], isError: true };

  const sql = args?.sql as string;
  if (!sql) return { content: [{ type: "text", text: "缺少 sql 参数" }], isError: true };
  const validation = validateSQL(sql, tool.sqlType, "postgresql");
  if (!validation.ok) {
    return { content: [{ type: "text", text: validation.reason! }], isError: true };
  }

  try {
    const db = getPool(tool.sqlType === "read" ? "read" : "write");
    const result = await db.query(sql);
    // 只读查询返回行数据；写/DDL 返回执行结果（INSERT/UPDATE 的 rows 通常为空数组，直接返回会丢失 rowCount）
    if (tool.sqlType === "read" || (result.rows && result.rows.length > 0)) {
      return { content: [{ type: "text", text: formatRows(result.rows) }] };
    }
    return { content: [{ type: "text", text: JSON.stringify({ command: result.command, rowCount: result.rowCount }, null, 2) }] };
  } catch (error: any) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

async function main() {
  console.error("PostgreSQL MCP Server 已启动");
  await server.connect(new StdioServerTransport());
}
main().catch(console.error);