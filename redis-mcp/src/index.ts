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
// 注意：一个命令只能属于一个类别，类别决定所需权限
const READ_COMMANDS = new Set([
  'GET', 'MGET', 'GETRANGE', 'STRLEN',
  'HGET', 'HGETALL', 'HMGET', 'HKEYS', 'HVALS', 'HLEN', 'HEXISTS', 'HRANDFIELD',
  'SMEMBERS', 'SRANDMEMBER', 'SCARD', 'SISMEMBER', 'SMISMEMBER',
  'SINTER', 'SUNION', 'SDIFF',
  'LRANGE', 'LLEN', 'LINDEX', 'LPOS',
  'ZRANGE', 'ZREVRANGE', 'ZRANGEBYSCORE', 'ZREVRANGEBYSCORE', 'ZSCORE', 'ZMSCORE',
  'ZCARD', 'ZCOUNT', 'ZRANK', 'ZREVRANK', 'ZRANDMEMBER',
  'TYPE', 'TTL', 'PTTL', 'EXISTS', 'RANDOMKEY', 'OBJECT', 'MEMORY',
  'DBSIZE', 'INFO', 'SCAN', 'SSCAN', 'HSCAN', 'ZSCAN', 'KEYS',
  'PING', 'ECHO', 'TIME', 'LASTSAVE'
]);

const WRITE_COMMANDS = new Set([
  'SET', 'SETEX', 'PSETEX', 'SETNX', 'MSET', 'MSETNX', 'GETSET', 'GETDEL', 'GETEX',
  'HSET', 'HMSET', 'HSETNX', 'HDEL', 'HINCRBY', 'HINCRBYFLOAT',
  'DEL', 'UNLINK',
  'SADD', 'SREM', 'SPOP', 'SMOVE',
  'LPUSH', 'RPUSH', 'LPUSHX', 'RPUSHX', 'LPOP', 'RPOP', 'LTRIM', 'LREM', 'LSET', 'LINSERT', 'RPOPLPUSH', 'LMOVE',
  'ZADD', 'ZREM', 'ZINCRBY', 'ZREMRANGEBYRANK', 'ZREMRANGEBYSCORE', 'ZPOPMIN', 'ZPOPMAX',
  'INCR', 'INCRBY', 'INCRBYFLOAT', 'DECR', 'DECRBY',
  'APPEND', 'SETRANGE',
  'PUBLISH', 'EXPIRE', 'PEXPIRE', 'EXPIREAT', 'PEXPIREAT', 'PERSIST',
  'MOVE', 'RENAME', 'RENAMENX', 'COPY'
]);

// 危险命令，需要 admin 权限（EVAL/EVALSHA 脚本可执行任意命令，归 admin）
const ADMIN_COMMANDS = new Set([
  'FLUSHDB', 'FLUSHALL', 'CONFIG', 'SHUTDOWN', 'SLAVEOF', 'REPLICAOF',
  'BGREWRITEAOF', 'BGSAVE', 'SAVE', 'CLIENT', 'DEBUG', 'RESET',
  'EVAL', 'EVALSHA', 'SCRIPT', 'FUNCTION', 'FCALL', 'SWAPDB'
]);

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
  return 'unknown';
}

/**
 * 解析命令行：支持单/双引号包裹的含空格参数
 * 如 SET greeting "hello world" -> ["SET", "greeting", "hello world"]
 */
function parseCommandLine(command: string): string[] {
  const parts: string[] = [];
  const re = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command)) !== null) {
    if (m[1] !== undefined) parts.push(m[1].replace(/\\(.)/g, "$1"));
    else if (m[2] !== undefined) parts.push(m[2].replace(/\\(.)/g, "$1"));
    else parts.push(m[3]);
  }
  return parts;
}

// ============ TLS 配置 ============
// 支持 REDIS_TLS 或 REDIS_SSL 环境变量
// 设置为 true 时启用 TLS（适配 Upstash 等云 Redis）
function getTLSConfig(): object | undefined {
  const tls = process.env.REDIS_TLS || process.env.REDIS_SSL;
  if (tls && tls.toLowerCase() === 'true') {
    return {};
  }
  return undefined;
}

// ============ 数据库连接 ============
let redis: any = null;

// MCP_QUERY_TIMEOUT: 单条命令超时（毫秒），默认 30000
function getCommandTimeout(): number {
  const v = parseInt(process.env.MCP_QUERY_TIMEOUT || "30000");
  return Number.isFinite(v) && v > 0 ? v : 30000;
}

function getRedis(): any {
  if (!redis) {
    const url = process.env.REDIS_URL;
    const tls = getTLSConfig();

    if (url) {
      // ioredis 原生支持 redis:// 和 rediss:// URL，自动识别 TLS
      redis = new IORedis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        commandTimeout: getCommandTimeout(),
        tls,
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
        commandTimeout: getCommandTimeout(),
        tls,
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

// ============ 执行命令 ============
// category: 调用来源工具的类别，命令的实际类别必须与其一致，
// 防止用 read 工具执行 FLUSHALL 之类的越权命令
async function executeCommand(command: string, category: 'read' | 'write' | 'admin'): Promise<{ text: string; isError: boolean }> {
  const parts = parseCommandLine(command.trim());
  const cmd = (parts[0] || '').toUpperCase();

  if (!cmd) {
    return { text: JSON.stringify({ error: "命令不能为空" }), isError: true };
  }

  const cmdCategory = getCommandCategory(cmd);
  if (cmdCategory === 'unknown') {
    return { text: JSON.stringify({ error: `命令 ${cmd} 不在允许列表中` }), isError: true };
  }
  if (cmdCategory !== category) {
    return { text: JSON.stringify({ error: `命令 ${cmd} 属于 ${cmdCategory} 类别，请使用 ${cmdCategory} 工具（且需要对应权限）` }), isError: true };
  }

  const args = parts.slice(1);

  try {
    const client = getRedis();
    const result = await client.call(cmd, ...args);

    // 处理不同类型的结果
    if (result === null) {
      return { text: JSON.stringify({ result: null, type: "null" }), isError: false };
    }
    if (typeof result === 'number') {
      return { text: JSON.stringify({ result, type: "integer" }), isError: false };
    }
    if (typeof result === 'string') {
      return { text: JSON.stringify({ result, type: "string" }), isError: false };
    }
    if (Array.isArray(result)) {
      return { text: JSON.stringify({ result, type: "array", length: result.length }), isError: false };
    }
    if (typeof result === 'object') {
      // Buffer 或其他类型
      return { text: JSON.stringify({ result: result.toString(), type: "buffer" }), isError: false };
    }

    return { text: JSON.stringify({ result, type: typeof result }), isError: false };
  } catch (error: any) {
    return { text: JSON.stringify({ error: error.message }), isError: true };
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

  // 执行命令（按工具类别校验命令归属）
  const result = await executeCommand(command, tool.category);

  return { content: [{ type: "text", text: result.text }], isError: result.isError };
});

async function main() {
  console.error("Redis MCP Server 已启动");
  console.error(`权限配置: canRead=${getPermissions().canRead}, canWrite=${getPermissions().canWrite}, canAdmin=${getPermissions().canAdmin}`);
  await server.connect(new StdioServerTransport());
}

main().catch(console.error);