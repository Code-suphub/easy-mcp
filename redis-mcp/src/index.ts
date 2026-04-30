#!/usr/bin/env node
/**
 * Redis MCP Server - 统一权限控制
 * 三工具模式：read (读), write (写), admin (管理)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import IORedisModule from "ioredis";
const IORedis = (IORedisModule as any).default || IORedisModule;

// ============ 命令白名单 ============
const READ_COMMANDS = new Set([
  'GET', 'HGET', 'HGETALL', 'HMGET', 'SMEMBERS', 'SRANDMEMBER',
  'LRANGE', 'ZRANGE', 'ZREVRANGE', 'ZSCORE', 'ZCARD',
  'TYPE', 'TTL', 'PTTL', 'EXISTS', 'DBSIZE', 'INFO',
  'SCAN', 'KEYS', 'CLIENT', 'PING', 'ECHO', 'MULTI', 'EXPIRE',
  'HKEYS', 'HVALS', 'HLEN', 'HEXISTS', 'LLEN', 'SCARD'
]);

const WRITE_COMMANDS = new Set([
  'SET', 'SETEX', 'SETNX', 'MSET', 'MSETNX',
  'HSET', 'HMSET', 'HSETNX', 'HDEL', 'HINCRBY', 'HINCRBYFLOAT',
  'DEL', 'UNLINK',
  'SADD', 'SREM', 'SPOP', 'SMOVE',
  'LPUSH', 'RPUSH', 'LPOP', 'RPOP', 'LTRIM', 'LREM', 'LSET', 'LINSERT',
  'ZADD', 'ZREM', 'ZINCRBY', 'ZREMRANGEBYRANK', 'ZREMRANGEBYSCORE',
  'INCR', 'INCRBY', 'INCRBYFLOAT', 'DECR', 'DECRBY',
  'APPEND', 'SETRANGE', 'GETSET',
  'PUBLISH', 'EXPIRE', 'EXPIREAT', 'MOVE', 'RENAME', 'RENAMENX'
]);

// 危险命令，需要 admin 权限
const ADMIN_COMMANDS = new Set([
  'FLUSHDB', 'FLUSHALL', 'CONFIG', 'SHUTDOWN', 'SLAVEOF', 'REPLICAOF',
  'BGREWRITEAOF', 'BGSAVE', 'SAVE', 'CLIENT', 'DEBUG'
]);

const ALL_ALLOWED_COMMANDS = new Set([...READ_COMMANDS, ...WRITE_COMMANDS, ...ADMIN_COMMANDS]);

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
  const hasAdmin = perms.includes('admin');

  return { canRead: hasRead, canWrite: hasWrite, canAdmin: hasAdmin };
}

function getCommandCategory(cmd: string): 'read' | 'write' | 'admin' | 'unknown' {
  const upper = cmd.toUpperCase();
  if (READ_COMMANDS.has(upper)) return 'read';
  if (WRITE_COMMANDS.has(upper)) return 'write';
  if (ADMIN_COMMANDS.has(upper)) return 'admin';
  if (upper === 'EXEC' || upper === 'EVAL' || upper === 'EVALSHA') return 'admin'; // 脚本默认归类为 admin
  return 'unknown';
}

// ============ 数据库连接 ============
let redis: any = null;

function getRedis(): any {
  if (!redis) {
    const url = process.env.REDIS_URL;

    if (url) {
      // 解析 URL 格式：redis://:password@host:port/database
      const parsed = new URL(url);
      const host = parsed.hostname;
      const port = parseInt(parsed.port) || 6379;
      const password = parsed.password || undefined;
      const database = parsed.pathname ? parseInt(parsed.pathname.slice(1)) : 0;

      redis = new IORedis({
        host,
        port,
        password,
        db: database,
        lazyConnect: true,
        maxRetriesPerRequest: 3,
      });
    } else {
      const host = process.env.REDIS_HOST || "localhost";
      const port = parseInt(process.env.REDIS_PORT || "6379");
      const password = process.env.REDIS_PASSWORD || undefined;
      const database = parseInt(process.env.REDIS_DATABASE || "0");

      redis = new IORedis({
        host,
        port,
        password,
        db: database,
        lazyConnect: true,
        maxRetriesPerRequest: 3,
      });
    }

    redis.on('error', (err: Error) => {
      console.error('Redis 连接错误:', err.message);
    });
  }
  return redis;
}

// ============ MCP Server ============
const server = new Server(
  { name: "easy-mcps/redis", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ============ 工具定义 ============
const toolDefs = [
  {
    name: "read",
    description: "执行 Redis 读命令（GET, HGET, SMEMBERS, SCAN 等）",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Redis 读命令，如 GET mykey, HGET user:1 name" }
      },
      required: ["command"]
    },
    category: "read" as const,
  },
  {
    name: "write",
    description: "执行 Redis 写命令（SET, HSET, DEL, SADD 等）",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Redis 写命令，如 SET mykey value, HSET user:1 name Alice" }
      },
      required: ["command"]
    },
    category: "write" as const,
  },
  {
    name: "admin",
    description: "执行 Redis 管理命令（FLUSHDB, CONFIG 等，危险操作，默认禁用）",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Redis 管理命令，如 FLUSHDB, CONFIG GET *" }
      },
      required: ["command"]
    },
    category: "admin" as const,
  },
];

// ============ 命令验证 ============
function validateCommand(command: string): { valid: boolean; error?: string } {
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0].toUpperCase();

  if (!cmd) {
    return { valid: false, error: "命令不能为空" };
  }

  // 检查命令是否在白名单中
  if (!ALL_ALLOWED_COMMANDS.has(cmd)) {
    return { valid: false, error: `命令 ${cmd} 不在允许列表中` };
  }

  return { valid: true };
}

// ============ 执行命令 ============
async function executeCommand(command: string): Promise<string> {
  const validation = validateCommand(command);
  if (!validation.valid) {
    return JSON.stringify({ error: validation.error });
  }

  const parts = command.trim().split(/\s+/);
  const cmd = parts[0].toUpperCase();
  const args = parts.slice(1);

  try {
    const client = getRedis();
    const result = await client.call(cmd, ...args);

    // 处理不同类型的结果
    if (result === null) {
      return JSON.stringify({ result: null, type: "null" });
    }
    if (typeof result === 'number') {
      return JSON.stringify({ result, type: "integer" });
    }
    if (typeof result === 'string') {
      return JSON.stringify({ result, type: "string" });
    }
    if (Array.isArray(result)) {
      return JSON.stringify({ result, type: "array", length: result.length });
    }
    if (typeof result === 'object') {
      // Buffer 或其他类型
      return JSON.stringify({ result: result.toString(), type: "buffer" });
    }

    return JSON.stringify({ result, type: typeof result });
  } catch (error: any) {
    return JSON.stringify({ error: error.message });
  }
}

// ============ 请求处理器 ============
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const perms = getPermissions();
  const tools = toolDefs
    .filter(tool => {
      if (tool.category === 'read') return perms.canRead;
      if (tool.category === 'write') return perms.canWrite;
      if (tool.category === 'admin') return perms.canAdmin;
      return false;
    })
    .map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = toolDefs.find(t => t.name === name);

  if (!tool) {
    return { content: [{ type: "text", text: `未知工具: ${name}` }], isError: true };
  }

  const perms = getPermissions();
  if (tool.category === 'read' && !perms.canRead) {
    return { content: [{ type: "text", text: `工具 ${name} 已禁用` }], isError: true };
  }
  if (tool.category === 'write' && !perms.canWrite) {
    return { content: [{ type: "text", text: `工具 ${name} 已禁用` }], isError: true };
  }
  if (tool.category === 'admin' && !perms.canAdmin) {
    return { content: [{ type: "text", text: `工具 ${name} 已禁用` }], isError: true };
  }

  const command = args?.command as string;
  if (!command) {
    return { content: [{ type: "text", text: "缺少 command 参数" }], isError: true };
  }

  // 执行命令
  const result = await executeCommand(command);

  return { content: [{ type: "text", text: result }] };
});

async function main() {
  console.error("Redis MCP Server 已启动");
  console.error(`权限配置: canRead=${getPermissions().canRead}, canWrite=${getPermissions().canWrite}, canAdmin=${getPermissions().canAdmin}`);
  await server.connect(new StdioServerTransport());
}

main().catch(console.error);