#!/usr/bin/env node
/**
 * MySQL MCP Server - 统一权限控制
 *
 * 两种模式：
 *   single（默认）：env 读一组 MYSQL_*，暴露 read/write/delete/ddl 四个工具（行为不变）。
 *   multi（MCP_MODE=multi + MCP_DB_CONFIG=json）：按配置文件读多库，只暴露 read_query(database, env, sql)，
 *     以「app + env」定位逻辑库，内部多 channel（mysql 直连 / dms HTTP+cookie）按序兜底，
 *     仅连接失败时尝试下一通道，SQL/业务错误直接返回。
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import mysql, { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { getPermissions, validateSQL, formatRows, getQueryTimeout, getPackageVersion } from "./shared.js";
import {
  isMultiMode, loadMultiConfig, buildApps, closeApps, ChannelUnavailableError,
  MysqlConnector, DmsConnector, App,
} from "./connections.js";

// ============ 模式 ============
const MODE = isMultiMode() ? "multi" : "single";
const dbConfigPath = process.env.MCP_DB_CONFIG;
const multiConfig = MODE === "multi" ? loadMultiConfig(dbConfigPath ?? "") : null;
// app 名/别名 -> App
const apps = multiConfig ? buildApps(multiConfig) : null;

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
function multiAppNames(): string {
  if (!apps) return "(未加载)";
  return [...apps.keys()].join(", ");
}

function describeDatabases(): string {
  if (!multiConfig) return "(未加载)";
  return Object.entries(multiConfig.connections)
    .map(([name, cfg]) => {
      const envs = Object.keys(cfg.envs ?? {}).join("/");
      const aliases = cfg.aliases?.length ? `（别名 ${cfg.aliases.join(",")}）` : "";
      return `${name}${aliases}: env=${envs}`;
    })
    .join("；");
}

const multiToolDefs = [
  {
    name: "read_query",
    description:
      `只读查询（SELECT/SHOW/DESC/DESCRIBE/EXPLAIN/WITH）。database 为项目 app 名或别名，env 为环境（默认 prod），内部多通道自动兜底（优先直连，失败走 DMS）。\n` +
      `示例: read_query(database="brc", env="prod", sql="SELECT COUNT(*) FROM t")\n` +
      `可选 database: ${describeDatabases()}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        database: {
          type: "string" as const,
          description: `项目 app 名或别名，可选: ${describeDatabases()}`,
        },
        env: {
          type: "string" as const,
          description: "环境，默认 prod；各 app 可用环境见 database 说明（如 brc 支持 prod）",
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
    // ===== multi 模式：按 app + env 路由，多通道兜底 =====
    if (MODE === "multi") {
      const database = args?.database as string;
      if (!database) return { content: [{ type: "text", text: "multi 模式缺少 database 参数" }], isError: true };
      const env = (args?.env as string) || "prod";

      const app: App | undefined = apps?.get(database);
      if (!app) {
        return { content: [{ type: "text", text: `未知 database(app): ${database}，可选: ${multiAppNames()}` }], isError: true };
      }
      const channels = app.envs[env];
      if (!channels || channels.length === 0) {
        return { content: [{ type: "text", text: `app=${database} 无环境 ${env}，可选 env: ${Object.keys(app.envs).join(", ")}` }], isError: true };
      }

      const errors: string[] = [];
      for (const ch of channels) {
        try {
          const rows = await ch.read(sql);
          return { content: [{ type: "text", text: formatRows(rows) }] };
        } catch (e) {
          if (e instanceof ChannelUnavailableError) {
            errors.push(`${ch instanceof MysqlConnector ? "mysql" : "dms"}: ${e.message}`);
            continue; // 连接失败，试下一通道
          }
          throw e; // SQL/业务错误直接返回
        }
      }
      return { content: [{ type: "text", text: `app=${database} env=${env} 所有通道连接失败: ${errors.join(" | ")}` }], isError: true };
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
      if (apps) {
        await closeApps(apps);
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
