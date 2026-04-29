# Redis MCP Server

Redis 数据库的 MCP 服务器实现，采用三工具模式：read、write、admin。

## 功能特性

- ✅ 三工具模式：read (读), write (写), admin (管理)
- ✅ 动态权限控制：通过环境变量配置
- ✅ 命令白名单验证：确保 LLM 生成的命令安全
- ✅ 使用 ioredis 驱动

## 权限配置

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| MCP_CAN_READ | true | 读命令 (GET, HGET, SCAN 等) |
| MCP_CAN_WRITE | true | 写命令 (SET, HSET, DEL 等) |
| MCP_CAN_ADMIN | false | 管理命令 (FLUSHDB, CONFIG 等) |

## 环境变量

```bash
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=password
```

## 使用方式

### 只读模式（推荐）

```json
{
  "mcpServers": {
    "redis": {
      "command": "node",
      "args": ["/path/to/redis-mcp/dist/index.js"],
      "env": {
        "REDIS_HOST": "localhost",
        "REDIS_PORT": "6379",
        "MCP_CAN_READ": "true",
        "MCP_CAN_WRITE": "false",
        "MCP_CAN_ADMIN": "false"
      }
    }
  }
}
```

### 读写模式

```json
{
  "mcpServers": {
    "redis": {
      "command": "node",
      "args": ["/path/to/redis-mcp/dist/index.js"],
      "env": {
        "REDIS_HOST": "localhost",
        "REDIS_PORT": "6379",
        "MCP_CAN_READ": "true",
        "MCP_CAN_WRITE": "true",
        "MCP_CAN_ADMIN": "false"
      }
    }
  }
}
```

### 完整权限（慎用）

```json
{
  "mcpServers": {
    "redis": {
      "command": "node",
      "args": ["/path/to/redis-mcp/dist/index.js"],
      "env": {
        "REDIS_HOST": "localhost",
        "REDIS_PORT": "6379",
        "MCP_CAN_READ": "true",
        "MCP_CAN_WRITE": "true",
        "MCP_CAN_ADMIN": "true"
      }
    }
  }
}
```

## 支持的命令

### 读命令 (read)

GET, HGET, HGETALL, HMGET, SMEMBERS, SRANDMEMBER, LRANGE, ZRANGE, ZREVRANGE, TYPE, TTL, EXISTS, SCAN, INFO, DBSIZE 等

### 写命令 (write)

SET, HSET, HDEL, DEL, SADD, SREM, LPUSH, RPUSH, LPOP, RPOP, ZADD, ZREM, INCR, DECR, PUBLISH 等

### 管理命令 (admin)

FLUSHDB, FLUSHALL, CONFIG, CLIENT 等（默认禁用）

## 开发

```bash
cd redis-mcp
npm install
npm run dev
```

## License

MIT