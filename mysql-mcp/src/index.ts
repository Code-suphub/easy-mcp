#!/usr/bin/env node
/**
 * MySQL MCP Server - 统一权限控制
 * 4 工具模式：read_query, write_query, delete_query, ddl_query
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import mysql, { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { getPermissions, validateSQL, formatRows } from "./shared.js";

// ============ 数据库连接 ============
let pool: mysql.Pool | null = null;

function getPool(): mysql.Pool {
  if (!pool) {
    const url = process.env.MYSQL_URL;

    if (url) {
      // 解析 URL 格式：mysql://user:password@host:port/database
      const parsed = new URL(url);
      pool = mysql.createPool({
        host: parsed.hostname,
        port: parseInt(parsed.port) || 3306,
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
        database: parsed.pathname.slice(1) || "test",
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
      });
    } else {
      const host = process.env.MYSQL_HOST || "localhost";
      const port = parseInt(process.env.MYSQL_PORT || "3306");
      const user = process.env.MYSQL_USER || "root";
      const password = process.env.MYSQL_PASSWORD || "";
      const database = process.env.MYSQL_DATABASE || "test";

      pool = mysql.createPool({
        host,
        port,
        user,
        password,
        database,
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
  { name: "easy-mcps/mysql", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ============ 工具定义 ============
const toolDefs = [
  {
    name: "read_query",
    description: "执行只读查询（SELECT/SHOW/DESC/DESCRIBE/EXPLAIN/WITH）",
    inputSchema: {
      type: "object" as const,
      properties: {
        sql: { type: "string" as const, description: "只读 SQL 语句" }
      },
      required: ["sql"] as string[]
    },
    check: () => getPermissions().canRead,
    sqlType: "read" as const,
  },
  {
    name: "write_query",
    description: "执行 INSERT/UPDATE/REPLACE 语句",
    inputSchema: {
      type: "object" as const,
      properties: {
        sql: { type: "string" as const, description: "INSERT/UPDATE/REPLACE SQL 语句" }
      },
      required: ["sql"] as string[]
    },
    check: () => getPermissions().canWrite,
    sqlType: "write" as const,
  },
  {
    name: "delete_query",
    description: "执行 DELETE/TRUNCATE 语句（危险操作）",
    inputSchema: {
      type: "object" as const,
      properties: {
        sql: { type: "string" as const, description: "DELETE 或 TRUNCATE SQL 语句" }
      },
      required: ["sql"] as string[]
    },
    check: () => getPermissions().canDelete,
    sqlType: "delete" as const,
  },
  {
    name: "ddl_query",
    description: "执行 CREATE/DROP/ALTER TABLE/DATABASE/INDEX/VIEW 等 DDL 语句（危险操作）",
    inputSchema: {
      type: "object" as const,
      properties: {
        sql: { type: "string" as const, description: "DDL SQL 语句" }
      },
      required: ["sql"] as string[]
    },
    check: () => getPermissions().canDDL,
    sqlType: "ddl" as const,
  },
];

// ============ 请求处理器 ============
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefs.filter(t => t.check()).map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }))
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
    const [result] = await db.query<ResultSetHeader | RowDataPacket[]>(sql);
    if (Array.isArray(result)) {
      return { content: [{ type: "text", text: formatRows(result) }] };
    }
    return { content: [{ type: "text", text: JSON.stringify({ affectedRows: result.affectedRows, insertId: result.insertId }, null, 2) }] };
  } catch (error: any) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

async function main() {
  console.error("MySQL MCP Server 已启动");
  await server.connect(new StdioServerTransport());
}
main().catch(console.error);