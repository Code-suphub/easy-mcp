#!/usr/bin/env node
/**
 * StarRocks MCP Server - 统一权限控制
 * StarRocks 兼容 MySQL 协议，使用 mysql2 连接
 * 4 工具模式：read_query, write_query, delete_query, ddl_query
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import mysql, { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { getPermissions, validateSQL, formatRows, getQueryTimeout, getPackageVersion } from "./shared.js";

// ============ 数据库连接 ============
let pool: mysql.Pool | null = null;
// 引擎是否支持 SET TRANSACTION READ ONLY（首次失败后置 false 不再重试）
let readOnlyTxnSupported = true;

function getPool(): mysql.Pool {
  if (!pool) {
    const url = process.env.STARROCKS_URL;

    if (url) {
      const parsed = new URL(url);
      pool = mysql.createPool({
        host: parsed.hostname,
        port: parseInt(parsed.port) || 9030,
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
        database: parsed.pathname.slice(1) || "test",
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
      });
    } else {
      const host = process.env.STARROCKS_HOST || process.env.MYSQL_HOST || "localhost";
      const port = parseInt(process.env.STARROCKS_PORT || process.env.MYSQL_PORT || "9030");
      const user = process.env.STARROCKS_USER || process.env.MYSQL_USER || "root";
      const password = process.env.STARROCKS_PASSWORD || process.env.MYSQL_PASSWORD || "";
      const database = process.env.STARROCKS_DATABASE || process.env.MYSQL_DATABASE || "test";

      pool = mysql.createPool({
        host, port, user, password, database,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
      });
    }
  }
  return pool;
}

// ============ MCP Server ============
const server = new Server(
  { name: "easy-mcps/starrocks", version: getPackageVersion(import.meta.url) },
  { capabilities: { tools: {} } }
);

// ============ 工具定义 ============
const toolDefs = [
  {
    name: "read_query",
    description: "执行只读查询（SELECT/SHOW/DESC/DESCRIBE/EXPLAIN/WITH）",
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
  const validation = validateSQL(sql, tool.sqlType, "mysql");
  if (!validation.ok) {
    return { content: [{ type: "text", text: validation.reason! }], isError: true };
  }

  try {
    const db = getPool();
    const timeout = getQueryTimeout();
    let result: ResultSetHeader | RowDataPacket[];
    if (tool.sqlType === "read") {
      // 只读语句在 READ ONLY 事务中执行，作为正则校验之外的第二道防线
      const conn = await db.getConnection();
      try {
        if (readOnlyTxnSupported) {
          try {
            await conn.query("SET TRANSACTION READ ONLY");
          } catch {
            // 部分 MySQL 协议引擎（如 StarRocks）不支持，
            // 记住后不再重试，降级为仅正则校验
            readOnlyTxnSupported = false;
            console.error("当前引擎不支持 SET TRANSACTION READ ONLY，只读事务防线已降级");
          }
        }
        [result] = await conn.query<ResultSetHeader | RowDataPacket[]>({ sql, timeout });
      } finally {
        conn.release();
      }
    } else {
      [result] = await db.query<ResultSetHeader | RowDataPacket[]>({ sql, timeout });
    }
    if (Array.isArray(result)) return { content: [{ type: "text", text: formatRows(result) }] };
    return { content: [{ type: "text", text: JSON.stringify({ affectedRows: result.affectedRows, insertId: result.insertId }, null, 2) }] };
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
      if (pool) await pool.end();
    } catch {
      // 关闭失败不阻塞退出
    }
    process.exit(0);
  });
}

async function main() {
  console.error("StarRocks MCP Server 已启动");
  await server.connect(new StdioServerTransport());
}
main().catch(console.error);