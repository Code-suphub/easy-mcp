/**
 * StarRocks MCP Server - 统一权限控制
 * StarRocks 兼容 MySQL 协议，使用 mysql2 连接
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import mysql, { RowDataPacket, ResultSetHeader } from "mysql2/promise";

// ============ 权限配置（通过环境变量） ============
function getPermissions() {
  return {
    canRead: process.env.MCP_CAN_READ !== 'false',
    canWrite: process.env.MCP_CAN_WRITE !== 'false',
    canUpdate: process.env.MCP_CAN_UPDATE !== 'false',
    canDelete: process.env.MCP_CAN_DELETE === 'true',
    canCreateTable: process.env.MCP_CAN_CREATE_TABLE === 'true',
    canDropTable: process.env.MCP_CAN_DROP_TABLE === 'true',
    canAlterTable: process.env.MCP_CAN_ALTER_TABLE === 'true',
  };
}

// ============ 数据库连接 ============
let pool: mysql.Pool | null = null;

function getPool(): mysql.Pool {
  if (!pool) {
    const host = process.env.STARROCKS_HOST || process.env.MYSQL_HOST || "localhost";
    const port = parseInt(process.env.STARROCKS_PORT || process.env.MYSQL_PORT || "9030");
    const user = process.env.STARROCKS_USER || process.env.MYSQL_USER || "root";
    const password = process.env.STARROCKS_PASSWORD || process.env.MYSQL_PASSWORD || "";
    const database = process.env.STARROCKS_DATABASE || process.env.MYSQL_DATABASE || "test";

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
  return pool;
}

// ============ MCP Server ============
const server = new Server(
  { name: "easy-mcps/starrocks", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ============ SQL 验证 ============
function validateSQL(sql: string, type: 'read' | 'write' | 'update' | 'delete' | 'ddl'): boolean {
  switch (type) {
    case 'read': return /^\s*SELECT/i.test(sql);
    case 'write': return /^\s*INSERT/i.test(sql);
    case 'update': return /^\s*UPDATE/i.test(sql);
    case 'delete': return /^\s*DELETE/i.test(sql);
    case 'ddl': return /^\s*(CREATE|DROP|ALTER)\s+(TABLE|DATABASE)/i.test(sql);
    default: return false;
  }
}

// ============ 工具定义 ============
const toolDefs = [
  { name: "read_query", description: "执行 SELECT 查询（只读）",
    inputSchema: { type: "object", properties: { sql: { type: "string", description: "SELECT SQL 语句" } }, required: ["sql"] },
    check: () => getPermissions().canRead, sqlType: "read" as const },
  { name: "write_query", description: "执行 INSERT 语句",
    inputSchema: { type: "object", properties: { sql: { type: "string", description: "INSERT SQL 语句" } }, required: ["sql"] },
    check: () => getPermissions().canWrite, sqlType: "write" as const },
  { name: "update_query", description: "执行 UPDATE 语句",
    inputSchema: { type: "object", properties: { sql: { type: "string", description: "UPDATE SQL 语句" } }, required: ["sql"] },
    check: () => getPermissions().canUpdate, sqlType: "update" as const },
  { name: "delete_query", description: "执行 DELETE 语句（危险操作）",
    inputSchema: { type: "object", properties: { sql: { type: "string", description: "DELETE SQL 语句" } }, required: ["sql"] },
    check: () => getPermissions().canDelete, sqlType: "delete" as const },
  { name: "create_table", description: "创建新表（DDL 操作）",
    inputSchema: { type: "object", properties: { sql: { type: "string", description: "CREATE TABLE SQL 语句" } }, required: ["sql"] },
    check: () => getPermissions().canCreateTable, sqlType: "ddl" as const },
  { name: "drop_table", description: "删除表（危险操作）",
    inputSchema: { type: "object", properties: { sql: { type: "string", description: "DROP TABLE SQL 语句" } }, required: ["sql"] },
    check: () => getPermissions().canDropTable, sqlType: "ddl" as const },
  { name: "alter_table", description: "修改表结构（DDL 操作）",
    inputSchema: { type: "object", properties: { sql: { type: "string", description: "ALTER TABLE SQL 语句" } }, required: ["sql"] },
    check: () => getPermissions().canAlterTable, sqlType: "ddl" as const },
  { name: "list_tables", description: "列出所有表",
    inputSchema: { type: "object", properties: {} },
    check: () => true, sqlType: null },
  { name: "desc_table", description: "查看表结构",
    inputSchema: { type: "object", properties: { table_name: { type: "string", description: "表名" } }, required: ["table_name"] },
    check: () => true, sqlType: null },
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

  try {
    const db = getPool();
    if (name === "list_tables") {
      const [rows] = await db.query<RowDataPacket[]>("SHOW TABLES");
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }
    if (name === "desc_table") {
      const tableName = args?.table_name as string;
      if (!tableName) return { content: [{ type: "text", text: "缺少 table_name 参数" }], isError: true };
      const [rows] = await db.query<RowDataPacket[]>(`DESC \`${tableName}\``);
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }
    const sql = args?.sql as string;
    if (!sql) return { content: [{ type: "text", text: "缺少 sql 参数" }], isError: true };
    if (tool.sqlType && !validateSQL(sql, tool.sqlType)) {
      return { content: [{ type: "text", text: `${name} 只能执行对应的 SQL 类型` }], isError: true };
    }
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
