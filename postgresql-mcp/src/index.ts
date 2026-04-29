/**
 * PostgreSQL MCP Server - 统一权限控制
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import pg from "pg";

const { Pool } = pg;

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
      const result = await db.query(`
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename
      `);
      return {
        content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }]
      };
    }

    if (name === "desc_table") {
      const tableName = args?.table_name as string;
      if (!tableName) {
        return { content: [{ type: "text", text: "缺少 table_name 参数" }], isError: true };
      }
      // 使用双引号处理表名大小写
      const result = await db.query(`
        SELECT
          column_name,
          data_type,
          is_nullable,
          column_default
        FROM information_schema.columns
        WHERE table_name = $1 AND table_schema = 'public'
        ORDER BY ordinal_position
      `, [tableName]);
      return {
        content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }]
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

    // 事务保护（只读事务）
    const client = await db.connect();
    try {
      if (tool.sqlType === "read" || tool.sqlType === null) {
        await client.query("BEGIN READ ONLY");
      } else {
        await client.query("BEGIN");
      }

      const result = await client.query(sql);

      if (Array.isArray(result.rows)) {
        await client.query("COMMIT");
        return {
          content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }]
        };
      } else {
        await client.query("COMMIT");
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              rowCount: result.rowCount,
              oid: result.oid,
            }, null, 2)
          }]
        };
      }
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
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
  console.error("PostgreSQL MCP Server 已启动");
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
