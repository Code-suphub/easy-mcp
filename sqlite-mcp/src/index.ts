#!/usr/bin/env node
/**
 * SQLite MCP Server - 统一权限控制
 * 4 工具模式：read_query, write_query, delete_query, ddl_query
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import Database from "better-sqlite3";
import path from "path";
import { getPermissions, validateSQL, formatRows, getPackageVersion } from "./shared.js";

// ============ 数据库连接 ============
// 读写分连接：read 走 readonly 连接，SQLite 层面直接拒绝任何写入，
// 作为正则校验之外的第二道防线
const dbs: { read?: Database.Database; write?: Database.Database } = {};

function getDbPath(): string {
  const url = process.env.SQLITE_URL;
  if (url) {
    // URL 格式: sqlite:///path/to/database.db
    return new URL(url).pathname;
  }
  return process.env.SQLITE_PATH || path.join(process.cwd(), "data.db");
}

function getDb(kind: "read" | "write"): Database.Database {
  let db = dbs[kind];
  if (!db) {
    const dbPath = getDbPath();
    try {
      db = new Database(dbPath, { readonly: kind === "read", fileMustExist: kind === "read" });
    } catch (error: any) {
      if (kind === "read" && /unable to open|no such file/i.test(error.message)) {
        throw new Error(`数据库文件不存在: ${dbPath}（请检查 SQLITE_PATH / SQLITE_URL 配置）`);
      }
      throw error;
    }
    if (kind === "write") {
      db.pragma("journal_mode = WAL");
    }
    dbs[kind] = db;
  }
  return db;
}

// ============ MCP Server ============
const server = new Server(
  { name: "easy-mcps/sqlite", version: getPackageVersion(import.meta.url) },
  { capabilities: { tools: {} } }
);

// ============ 工具定义 ============
const toolDefs = [
  {
    name: "read_query",
    description: "执行只读查询（SELECT/WITH/EXPLAIN/PRAGMA）",
    inputSchema: { type: "object", properties: { sql: { type: "string", description: "只读 SQL 语句" } }, required: ["sql"] },
    check: () => getPermissions().canRead, sqlType: "read" as const,
  },
  {
    name: "write_query",
    description: "执行 INSERT/UPDATE/REPLACE 语句",
    inputSchema: { type: "object", properties: { sql: { type: "string", description: "INSERT/UPDATE/REPLACE SQL 语句" } }, required: ["sql"] },
    check: () => getPermissions().canWrite, sqlType: "write" as const,
  },
  {
    name: "delete_query",
    description: "执行 DELETE 语句（危险操作）",
    inputSchema: { type: "object", properties: { sql: { type: "string", description: "DELETE SQL 语句" } }, required: ["sql"] },
    check: () => getPermissions().canDelete, sqlType: "delete" as const,
  },
  {
    name: "ddl_query",
    description: "执行 CREATE/DROP/ALTER TABLE/INDEX/VIEW 等 DDL 语句（危险操作）",
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
  const validation = validateSQL(sql, tool.sqlType, "sqlite");
  if (!validation.ok) {
    return { content: [{ type: "text", text: validation.reason! }], isError: true };
  }

  try {
    const database = getDb(tool.sqlType === "read" ? "read" : "write");
    const stmt = database.prepare(sql);
    // stmt.reader 表示语句是否返回数据：INSERT/UPDATE/DELETE/DDL 必须用 run()，用 all() 会抛错
    if (stmt.reader) {
      return { content: [{ type: "text", text: formatRows(stmt.all()) }] };
    }
    const info = stmt.run();
    return { content: [{ type: "text", text: JSON.stringify({ changes: info.changes, lastInsertRowid: String(info.lastInsertRowid) }, null, 2) }] };
  } catch (error: any) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

// 收到退出信号时关闭连接，避免留下悬挂连接
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      dbs.read?.close(); dbs.write?.close();
    } catch {
      // 关闭失败不阻塞退出
    }
    process.exit(0);
  });
}

async function main() {
  console.error("SQLite MCP Server 已启动");
  await server.connect(new StdioServerTransport());
}
main().catch(console.error);