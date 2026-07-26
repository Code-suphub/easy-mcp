#!/usr/bin/env node
/**
 * ClickHouse MCP Server - 统一权限控制
 * 4 工具模式：read_query, write_query, delete_query, ddl_query
 *
 * ClickHouse 语义映射：
 * - write:  INSERT，以及 ALTER TABLE ... UPDATE（mutation）
 * - delete: DELETE FROM（轻量级删除，23.x+）、TRUNCATE、ALTER TABLE ... DELETE（mutation）
 * - ddl:    CREATE/DROP/ALTER TABLE/DATABASE/VIEW 等（不含 ALTER TABLE ... UPDATE/DELETE）
 *
 * 集群支持：
 * - CLICKHOUSE_HOSTS 可配置多个节点（逗号分隔，如 "ch1:8123,ch2:8123"），
 *   连接失败时自动切换下一个节点重试
 * - DDL 可正常携带 ON CLUSTER 子句
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createClient, ClickHouseClient } from "@clickhouse/client";
import { getPermissions, validateSQL, formatRows, getQueryTimeout } from "./shared.js";

// ============ 连接配置（支持多节点） ============

interface Endpoint {
  url: string; // http(s)://host:port
}

function getEndpoints(): Endpoint[] {
  const secure = process.env.CLICKHOUSE_SECURE === "true";
  const defaultPort = secure ? "8443" : "8123";
  const scheme = secure ? "https" : "http";

  // 1. CLICKHOUSE_HOSTS: 多节点，逗号分隔，host 或 host:port
  const hosts = process.env.CLICKHOUSE_HOSTS;
  if (hosts) {
    return hosts.split(",").map((h) => {
      const t = h.trim();
      if (/^https?:\/\//.test(t)) return { url: t };
      return { url: `${scheme}://${t.includes(":") ? t : `${t}:${defaultPort}`}` };
    });
  }

  // 2. CLICKHOUSE_URL: 单节点 URL
  const url = process.env.CLICKHOUSE_URL;
  if (url) {
    const parsed = new URL(url);
    const s = parsed.protocol === "https:";
    return [{ url: `${s ? "https" : "http"}://${parsed.hostname}:${parsed.port || (s ? 8443 : 8123)}` }];
  }

  // 3. 单机环境变量
  const host = process.env.CLICKHOUSE_HOST || "localhost";
  const port = process.env.CLICKHOUSE_PORT || defaultPort;
  return [{ url: `${scheme}://${host}:${port}` }];
}

function getCredentials() {
  const url = process.env.CLICKHOUSE_URL;
  if (url && !process.env.CLICKHOUSE_HOSTS) {
    const parsed = new URL(url);
    return {
      database: parsed.pathname.slice(1) || process.env.CLICKHOUSE_DATABASE || "default",
      username: decodeURIComponent(parsed.username) || "default",
      password: decodeURIComponent(parsed.password) || "",
    };
  }
  return {
    database: process.env.CLICKHOUSE_DATABASE || "default",
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD || "",
  };
}

const endpoints = getEndpoints();
let currentEndpoint = 0;
const clients = new Map<number, ClickHouseClient>();

function getClient(): ClickHouseClient {
  let c = clients.get(currentEndpoint);
  if (!c) {
    const creds = getCredentials();
    c = createClient({
      host: endpoints[currentEndpoint].url,
      database: creds.database,
      username: creds.username,
      password: creds.password,
      request_timeout: getQueryTimeout(),
    });
    clients.set(currentEndpoint, c);
  }
  return c;
}

function isConnectionError(error: any): boolean {
  const msg = String(error?.message || "");
  const code = error?.code || error?.cause?.code || "";
  return (
    ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"].includes(code) ||
    /socket hang up|fetch failed|Connect|Timeout/i.test(msg)
  );
}

/**
 * 在当前节点执行；连接类错误时依次切换到其余节点重试。
 * 仅只读查询自动重试——写语句的"连接错误"可能发生在服务端已接收之后，
 * 自动重试有重复写入风险，因此写失败时只切换节点（下次请求生效）不重试。
 */
async function withFailover<T>(fn: (client: ClickHouseClient) => Promise<T>, retry: boolean): Promise<T> {
  let lastError: any;
  const attempts = retry ? endpoints.length : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn(getClient());
    } catch (error: any) {
      lastError = error;
      if (!isConnectionError(error) || endpoints.length === 1) throw error;
      const failed = endpoints[currentEndpoint].url;
      currentEndpoint = (currentEndpoint + 1) % endpoints.length;
      console.error(`节点 ${failed} 连接失败，切换到 ${endpoints[currentEndpoint].url}: ${error.message}`);
    }
  }
  throw lastError;
}

// ============ MCP Server ============
const server = new Server(
  { name: "easy-mcps/clickhouse", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ============ 工具定义 ============
const toolDefs = [
  {
    name: "read_query",
    description: "执行只读查询（SELECT/SHOW/DESC/DESCRIBE/EXISTS/EXPLAIN/WITH）",
    inputSchema: { type: "object", properties: { sql: { type: "string", description: "只读 SQL 语句" } }, required: ["sql"] },
    check: () => getPermissions().canRead, sqlType: "read" as const,
  },
  {
    name: "write_query",
    description: "执行 INSERT 或 ALTER TABLE ... UPDATE 语句",
    inputSchema: { type: "object", properties: { sql: { type: "string", description: "INSERT 或 ALTER TABLE ... UPDATE SQL 语句" } }, required: ["sql"] },
    check: () => getPermissions().canWrite, sqlType: "write" as const,
  },
  {
    name: "delete_query",
    description: "执行 DELETE FROM / TRUNCATE / ALTER TABLE ... DELETE 语句（危险操作）",
    inputSchema: { type: "object", properties: { sql: { type: "string", description: "DELETE FROM、TRUNCATE 或 ALTER TABLE ... DELETE SQL 语句" } }, required: ["sql"] },
    check: () => getPermissions().canDelete, sqlType: "delete" as const,
  },
  {
    name: "ddl_query",
    description: "执行 CREATE/DROP/ALTER TABLE/DATABASE/VIEW 等 DDL 语句（支持 ON CLUSTER，危险操作）",
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
  const validation = validateSQL(sql, tool.sqlType, "clickhouse");
  if (!validation.ok) {
    return { content: [{ type: "text", text: validation.reason! }], isError: true };
  }

  try {
    if (tool.sqlType === "read") {
      // 只读查询走 query()；readonly=2 让服务端拒绝一切数据写入，
      // 作为正则校验之外的第二道防线（用 2 不用 1 是因为客户端需要传格式设置）
      const rows = await withFailover(async (ch) => {
        const result = await ch.query({
          query: sql,
          format: "JSONEachRow",
          clickhouse_settings: { readonly: "2", max_execution_time: Math.ceil(getQueryTimeout() / 1000) },
        });
        return await result.json();
      }, true);
      return { content: [{ type: "text", text: formatRows(rows as unknown[]) }] };
    }
    // INSERT/mutation/DDL 走 command()（query() 会附加 FORMAT 子句导致报错）
    const summary = await withFailover(async (ch) => {
      const result = await ch.command({ query: sql });
      return result.summary;
    }, false);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ success: true, written_rows: summary?.written_rows, elapsed_ns: summary?.elapsed_ns }, null, 2)
      }]
    };
  } catch (error: any) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

async function main() {
  console.error(`ClickHouse MCP Server 已启动（节点: ${endpoints.map(e => e.url).join(", ")}）`);
  await server.connect(new StdioServerTransport());
}
main().catch(console.error);
