/**
 * PostgreSQL MCP Server - 统一权限控制
 * 4 工具模式：read_query, write_query, delete_query, ddl_query
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import pg from "pg";

const { Pool } = pg;

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
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL ||
      `postgresql://${process.env.PGUSER || "postgres"}:${process.env.PGPASSWORD || ""}@${process.env.PGHOST || "localhost"}:${process.env.PGPORT || "5432"}/${process.env.PGDATABASE || "postgres"}`;

    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }
  return pool;
}

// ============ MCP Server ============
const server = new Server(
  { name: "easy-mcps/postgresql", version: "1.0.0" },
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
    const result = await db.query(sql);
    if (Array.isArray(result.rows)) {
      return { content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }] };
    }
    return { content: [{ type: "text", text: JSON.stringify({ rowCount: result.rowCount }, null, 2) }] };
  } catch (error: any) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

async function main() {
  console.error("PostgreSQL MCP Server 已启动");
  await server.connect(new StdioServerTransport());
}
main().catch(console.error);