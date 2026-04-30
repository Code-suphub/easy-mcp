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

// ============ 权限配置 ============
// MCP_PERMISSIONS: 数组格式 ["read","write"] 或逗号分隔 "read,write"
// 不配置则默认只有 read
function getPermissions() {
  const value = process.env.MCP_PERMISSIONS;
  let perms: string[] = [];

  if (!value) {
    perms = [];
  } else if (value.startsWith('[')) {
    try {
      perms = JSON.parse(value);
    } catch {
      perms = [];
    }
  } else {
    perms = value.split(',').map(p => p.trim().toLowerCase());
  }

  const hasRead = perms.includes('read') || perms.length === 0;
  const hasWrite = perms.includes('write');
  const hasDelete = perms.includes('delete');
  const hasDDL = perms.includes('ddl');

  return { canRead: hasRead, canWrite: hasWrite, canDelete: hasDelete, canDDL: hasDDL };
}

// ============ 数据库连接 ============
let pool: mysql.Pool | null = null;

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
  { name: "easy-mcps/starrocks", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ============ SQL 验证 ============
function validateSQL(sql: string, type: 'read' | 'write' | 'delete' | 'ddl'): boolean {
  switch (type) {
    case 'read': return /^\s*SELECT/i.test(sql);
    case 'write': return /^\s*(INSERT|UPDATE)/i.test(sql);
    case 'delete': return /^\s*DELETE/i.test(sql);
    case 'ddl': return /^\s*(CREATE|DROP|ALTER)\s+(TABLE|DATABASE)/i.test(sql);
    default: return false;
  }
}

// ============ 工具定义 ============
const toolDefs = [
  {
    name: "read_query",
    description: "执行 SELECT 查询（只读，含 SHOW TABLES, DESC 等元数据查询）",
    inputSchema: { type: "object", properties: { sql: { type: "string", description: "SELECT SQL 语句" } }, required: ["sql"] },
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
    description: "执行 DELETE 语句（危险操作）",
    inputSchema: { type: "object", properties: { sql: { type: "string", description: "DELETE SQL 语句" } }, required: ["sql"] },
    check: () => getPermissions().canDelete, sqlType: "delete" as const,
  },
  {
    name: "ddl_query",
    description: "执行 CREATE/DROP/ALTER TABLE 语句（危险操作）",
    inputSchema: { type: "object", properties: { sql: { type: "string", description: "CREATE/DROP/ALTER TABLE SQL 语句" } }, required: ["sql"] },
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
  if (tool.sqlType && !validateSQL(sql, tool.sqlType)) {
    const messages: Record<string, string> = {
      read: "read_query 只能执行 SELECT 语句",
      write: "write_query 只能执行 INSERT/UPDATE 语句",
      delete: "delete_query 只能执行 DELETE 语句",
      ddl: "ddl_query 只能执行 CREATE/DROP/ALTER TABLE 语句",
    };
    return { content: [{ type: "text", text: messages[tool.sqlType] }], isError: true };
  }

  try {
    const db = getPool();
    const [result] = await db.query<ResultSetHeader | RowDataPacket[]>(sql);
    if (Array.isArray(result)) return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    return { content: [{ type: "text", text: JSON.stringify({ affectedRows: result.affectedRows, insertId: result.insertId }, null, 2) }] };
  } catch (error: any) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

async function main() {
  console.error("StarRocks MCP Server 已启动");
  await server.connect(new StdioServerTransport());
}
main().catch(console.error);