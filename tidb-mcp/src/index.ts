/**
 * TiDB MCP Server - 统一权限控制
 * TiDB 兼容 MySQL 协议，使用 mysql2 连接
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import mysql, { RowDataPacket, ResultSetHeader } from "mysql2/promise";

// ============ 权限配置（通过环境变量） ============
interface PermissionConfig {
  canRead: boolean;
  canWrite: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canCreateTable: boolean;
  canDropTable: boolean;
  canAlterTable: boolean;
}

// 从环境变量读取权限配置，支持 MCP 配置文件中通过 env 设置
const defaultPermissions: PermissionConfig = {
  canRead: true,
  canWrite: true,
  canUpdate: true,
  canDelete: false,        // ⚠️ 危险操作，默认关闭
  canCreateTable: false,   // ⚠️ DDL，默认关闭
  canDropTable: false,     // ⚠️ 危险，默认关闭
  canAlterTable: false,     // ⚠️ DDL，默认关闭
};

function getPermissions(): PermissionConfig {
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
    const host = process.env.TIDB_HOST || process.env.MYSQL_HOST || "localhost";
    const port = parseInt(process.env.TIDB_PORT || process.env.MYSQL_PORT || "4000");
    const user = process.env.TIDB_USER || process.env.MYSQL_USER || "root";
    const password = process.env.TIDB_PASSWORD || process.env.MYSQL_PASSWORD || "";
    const database = process.env.TIDB_DATABASE || process.env.MYSQL_DATABASE || "test";

    // TiDB Cloud Serverless 需要 SSL
    const ssl = process.env.TIDB_SSL === 'true' ? {
      rejectUnauthorized: false
    } : undefined;

    pool = mysql.createPool({
      host,
      port,
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      ssl,
    });
  }
  return pool;
}

// ============ MCP Server ============
const server = new Server(
  { name: "easy-mcps/tidb", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ============ SQL 验证 ============
function validateSQL(sql: string, type: 'read' | 'write' | 'update' | 'delete' | 'ddl'): boolean {
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
    check: () => getPermissions().canRead,
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
    check: () => getPermissions().canWrite,
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
    check: () => getPermissions().canUpdate,
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
    check: () => getPermissions().canDelete,
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
    check: () => getPermissions().canCreateTable,
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
    check: () => getPermissions().canDropTable,
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
    check: () => getPermissions().canAlterTable,
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

    if (name === "list_tables") {
      const [rows] = await db.query<RowDataPacket[]>("SHOW TABLES");
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }

    if (name === "desc_table") {
      const tableName = args?.table_name as string;
      if (!tableName) {
        return { content: [{ type: "text", text: "缺少 table_name 参数" }], isError: true };
      }
      const [rows] = await db.query<RowDataPacket[]>(`DESC \`${tableName}\``);
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }

    const sql = args?.sql as string;
    if (!sql) {
      return { content: [{ type: "text", text: "缺少 sql 参数" }], isError: true };
    }

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

    const [result] = await db.query<ResultSetHeader | RowDataPacket[]>(sql);

    if (Array.isArray(result)) {
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } else {
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

// ============ 启动 ============
async function main() {
  console.error("TiDB MCP Server 已启动");
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
