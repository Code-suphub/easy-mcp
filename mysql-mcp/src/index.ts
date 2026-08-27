#!/usr/bin/env node
/**
 * MySQL MCP Server - 统一权限控制
 *
 * 两种模式：
 *   single（默认）：env 读一组 MYSQL_*，暴露 read/write/delete/ddl 四个工具（行为不变）。
 *   multi（MCP_MODE=multi + MCP_DB_CONFIG=json）：按配置文件读多库，只暴露 read_query(database, sql)，
 *     支持 mysql 直连与 dms(HTTP+cookie) 两类连接。
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import mysql, { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { getPermissions, validateSQL, formatRows, getQueryTimeout, getPackageVersion } from "./shared.js";
import { isMultiMode, loadMultiConfig, buildConnectors, closeConnectors, MysqlConnector, DmsConnector } from "./connections.js";

// ============ 模式 ============
const MODE = isMultiMode() ? "multi" : "single";
const dbConfigPath = process.env.MCP_DB_CONFIG;
const multiConfig = MODE === "multi" ? loadMultiConfig(dbConfigPath ?? "") : null;
// database 名 -> 连接器
const connectors = multiConfig ? buildConnectors(multiConfig) : null;

// ============ 数据库连接（single 模式） ============
let pool: mysql.Pool | null = null;
// 引擎是否支持 SET TRANSACTION READ ONLY（首次失败后置 false 不再重试）
let readOnlyTxnSupported = true;

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
  { name: "easy-mcps/mysql", version: getPackageVersion(import.meta.url) },
  { capabilities: { tools: {} } }
);

// ============ 工具定义 ============
// single 模式工具（向后兼容）
const singleToolDefs = [
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

// multi 模式工具（只暴露只读 read_query，天然防误写多生产库）
const multiToolDefs = [
  {
    name: "read_query",
    description:
      "执行只读查询（SELECT/SHOW/DESC/DESCRIBE/EXPLAIN/WITH），按 database 选择连接。支持 mysql 直连与 dms(HTTP+cookie) 两类。",
    inputSchema: {
      type: "object" as const,
      properties: {
        database: {
          type: "string" as const,
          description: `数据库连接名，可选: ${connectors ? [...connectors.keys()].join(", ") : "(未加载)"}`,
        },
        sql: { type: "string" as const, description: "只读 SQL 语句" }
      },
      required: ["database", "sql"] as string[]
    },
    check: () => true,
    sqlType: "read" as const,
  },
];

const toolDefs = MODE === "multi" ? multiToolDefs : singleToolDefs;

// ============ 请求处理器 ============
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefs.filter(t => t.check ? t.check() : true).map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }))
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = toolDefs.find(t => t.name === name);
  if (!tool) return { content: [{ type: "text", text: `未知工具: ${name}` }], isError: true };
  if (tool.check && !tool.check()) return { content: [{ type: "text", text: `工具 ${name} 已禁用` }], isError: true };

  const sql = args?.sql as string;
  if (!sql) return { content: [{ type: "text", text: "缺少 sql 参数" }], isError: true };
  const validation = validateSQL(sql, tool.sqlType, "mysql");
  if (!validation.ok) {
    return { content: [{ type: "text", text: validation.reason! }], isError: true };
  }

  try {
    // ===== multi 模式：按 database 路由 =====
    if (MODE === "multi") {
      const database = args?.database as string;
      if (!database) return { content: [{ type: "text", text: "multi 模式缺少 database 参数" }], isError: true };
      const conn = connectors?.get(database);
      if (!conn) {
        return { content: [{ type: "text", text: `未知 database: ${database}，可选: ${[...(connectors?.keys() ?? [])].join(", ")}` }], isError: true };
      }
      let rows: unknown[];
      if (conn instanceof MysqlConnector) {
        rows = await conn.read(sql);
      } else if (conn instanceof DmsConnector) {
        rows = await conn.read(sql);
      } else {
        return { content: [{ type: "text", text: `连接类型未知: ${(conn as any).constructor?.name}` }], isError: true };
      }
      return { content: [{ type: "text", text: formatRows(rows) }] };
    }

    // ===== single 模式（向后兼容） =====
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
    if (Array.isArray(result)) {
      return { content: [{ type: "text", text: formatRows(result) }] };
    }
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
      if (connectors) {
        await closeConnectors(connectors);
      } else if (pool) {
        await pool.end();
      }
    } catch {
      // 关闭失败不阻塞退出
    }
    process.exit(0);
  });
}

async function main() {
  console.error(`MySQL MCP Server 已启动（mode=${MODE}）`);
  await server.connect(new StdioServerTransport());
}
main().catch(console.error);
