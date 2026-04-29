/**
 * MySQL MCP Server - 统一权限控制
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import mysql, { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { z } from "zod";

// ============ 权限配置 ============
interface PermissionConfig {
  canRead: boolean;
  canWrite: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canCreateTable: boolean;
  canDropTable: boolean;
  canAlterTable: boolean;
}

const defaultPermissions: PermissionConfig = {
  canRead: true,
  canWrite: true,
  canUpdate: true,
  canDelete: false,
  canCreateTable: false,
  canDropTable: false,
  canAlterTable: false,
};

let permissions: PermissionConfig = { ...defaultPermissions };

// ============ 数据库连接 ============
let pool: mysql.Pool | null = null;

function getPool(): mysql.Pool {
  if (!pool) {
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
  return pool;
}

// ============ MCP Server ============
const server = new Server(
  { name: "easy-mcps/mysql", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ============ SQL 验证 ============
function validateSQL(sql: string, type: 'read' | 'write' | 'update' | 'delete' | 'ddl'): boolean {
  const trimmed = sql.trim().toUpperCase();

  switch (type) {
    case 'read':
      return /^\s*SELECT/i.test(sql);
    case 'write':
      return /^\s*INSERT/i.test(sql);
    case 'update':
      return /^\s*UPDATE/i.test(sql);
    case 'delete':
      return /^\s*DELETE/i.test(sql);
    case 'ddl':
      return /^\s*(CREATE|DROP|ALTER)\s+(TABLE|DATABASE)/i.test(sql);
    default:
      return false;
  }
}

// ============ 工具定义 ============
const toolDefs = [
  {
    name: "read_query",
    description: "执行 SELECT 查询（只读）",
    inputSchema: {
      type: "object" as const,
      properties: {
        sql: { type: "string" as const, description: "SELECT SQL 语句" }
      },
      required: ["sql"] as string[]
    },
    check: () => permissions.canRead,
    sqlType: "read" as const,
  },
  {
    name: "write_query",
    description: "执行 INSERT 语句",
    inputSchema: {
      type: "object" as const,
      properties: {
        sql: { type: "string" as const, description: "INSERT SQL 语句" }
      },
      required: ["sql"] as string[]
    },
    check: () => permissions.canWrite,
    sqlType: "write" as const,
  },
  {
    name: "update_query",
    description: "执行 UPDATE 语句",
    inputSchema: {
      type: "object" as const,
      properties: {
        sql: { type: "string" as const, description: "UPDATE SQL 语句" }
      },
      required: ["sql"] as string[]
    },
    check: () => permissions.canUpdate,
    sqlType: "update" as const,
  },
  {
    name: "delete_query",
    description: "执行 DELETE 语句（危险操作）",
    inputSchema: {
      type: "object" as const,
      properties: {
        sql: { type: "string" as const, description: "DELETE SQL 语句" }
      },
      required: ["sql"] as string[]
    },
    check: () => permissions.canDelete,
    sqlType: "delete" as const,
  },
  {
    name: "create_table",
    description: "创建新表（DDL 操作）",
    inputSchema: {
      type: "object" as const,
      properties: {
        sql: { type: "string" as const, description: "CREATE TABLE SQL 语句" }
      },
      required: ["sql"] as string[]
    },
    check: () => permissions.canCreateTable,
    sqlType: "ddl" as const,
  },
  {
    name: "drop_table",
    description: "删除表（危险操作）",
    inputSchema: {
      type: "object" as const,
      properties: {
        sql: { type: "string" as const, description: "DROP TABLE SQL 语句" }
      },
      required: ["sql"] as string[]
    },
    check: () => permissions.canDropTable,
    sqlType: "ddl" as const,
  },
  {
    name: "alter_table",
    description: "修改表结构（DDL 操作）",
    inputSchema: {
      type: "object" as const,
      properties: {
        sql: { type: "string" as const, description: "ALTER TABLE SQL 语句" }
      },
      required: ["sql"] as string[]
    },
    check: () => permissions.canAlterTable,
    sqlType: "ddl" as const,
  },
  {
    name: "list_tables",
    description: "列出所有表",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
    check: () => true,
    sqlType: null,
  },
  {
    name: "desc_table",
    description: "查看表结构",
    inputSchema: {
      type: "object" as const,
      properties: {
        table_name: { type: "string" as const, description: "表名" }
      },
      required: ["table_name"] as string[]
    },
    check: () => true,
    sqlType: null,
  },
];

// ============ 请求处理器 ============

// ListTools - 动态返回工具列表
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const availableTools = toolDefs
    .filter(tool => tool.check())
    .map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));

  return { tools: availableTools };
});

// CallTool - 执行工具
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const tool = toolDefs.find(t => t.name === name);
  if (!tool) {
    return { content: [{ type: "text", text: `未知工具: ${name}` }], isError: true };
  }

  if (!tool.check()) {
    return {
      content: [{ type: "text", text: `工具 ${name} 已禁用` }],
      isError: true
    };
  }

  try {
    const db = getPool();

    // 处理无 SQL 的工具
    if (name === "list_tables") {
      const [rows] = await db.query<RowDataPacket[]>("SHOW TABLES");
      return {
        content: [{ type: "text", text: JSON.stringify(rows, null, 2) }]
      };
    }

    if (name === "desc_table") {
      const tableName = args?.table_name as string;
      if (!tableName) {
        return { content: [{ type: "text", text: "缺少 table_name 参数" }], isError: true };
      }
      const [rows] = await db.query<RowDataPacket[]>(`DESC \`${tableName}\``);
      return {
        content: [{ type: "text", text: JSON.stringify(rows, null, 2) }]
      };
    }

    // SQL 验证和执行
    const sql = args?.sql as string;
    if (!sql) {
      return { content: [{ type: "text", text: "缺少 sql 参数" }], isError: true };
    }

    // SQL 类型验证
    if (tool.sqlType && !validateSQL(sql, tool.sqlType)) {
      const typeMessages: Record<string, string> = {
        read: "read_query 只能执行 SELECT 语句",
        write: "write_query 只能执行 INSERT 语句",
        update: "update_query 只能执行 UPDATE 语句",
        delete: "delete_query 只能执行 DELETE 语句",
        ddl: "DDL 工具只能执行 CREATE/DROP/ALTER TABLE 语句",
      };
      return { content: [{ type: "text", text: typeMessages[tool.sqlType] }], isError: true };
    }

    // 执行查询
    const [result] = await db.query<ResultSetHeader | RowDataPacket[]>(sql);

    // 判断是查询还是修改
    if (Array.isArray(result)) {
      // 查询结果
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    } else {
      // 修改结果
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            affectedRows: result.affectedRows,
            insertId: result.insertId,
            warningCount: result.warningCount,
          }, null, 2)
        }]
      };
    }
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true
    };
  }
});

// ============ HTTP API - 权限控制（可选） ============
// 如果需要 HTTP 方式控制权限，可以启用以下代码
/*
import http from "http";

const httpServer = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === "/permissions" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(permissions));
    return;
  }

  if (req.url === "/permissions" && req.method === "PUT") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const newPerms = JSON.parse(body);
        permissions = { ...permissions, ...newPerms };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", permissions }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

const HTTP_PORT = parseInt(process.env.MCP_HTTP_PORT || "3100");
httpServer.listen(HTTP_PORT, () => {
  console.error(`权限控制 API 已启动: http://localhost:${HTTP_PORT}/permissions`);
});
*/

// ============ 启动 ============
async function main() {
  console.error("MySQL MCP Server 已启动");
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
