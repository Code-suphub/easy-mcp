# Redis MCP Server

Redis 数据库的 MCP 服务器实现，采用三工具模式：read、write、admin。

## 功能特性

- ✅ 3 个工具：read (读), write (写), admin (管理)
- ✅ 统一权限控制：通过 MCP_PERMISSIONS 配置
- ✅ 命令白名单验证：确保 LLM 生成的命令安全
- ✅ 使用 ioredis 驱动

## 权限配置

通过环境变量 `MCP_PERMISSIONS` 配置权限，支持两种格式：

```bash
# JSON 数组格式
MCP_PERMISSIONS='["read","write"]'

# 逗号分隔格式
MCP_PERMISSIONS='read,write'
```

| 权限 | 默认值 | 说明 |
|------|--------|------|
| read | ✅ 开启 | GET, HGET, SCAN 等读命令 |
| write | ❌ 关闭 | SET, HSET, DEL 等写命令 |
| admin | ❌ 关闭 | FLUSHDB, CONFIG 等管理命令（危险） |

## 工具说明

| 工具 | 命令类型 | 说明 |
|------|----------|------|
| read | GET, HGET, SMEMBERS, SCAN 等 | 执行 Redis 读命令 |
| write | SET, HSET, DEL, SADD 等 | 执行 Redis 写命令 |
| admin | FLUSHDB, CONFIG 等 | 执行 Redis 管理命令（危险操作，默认禁用） |

## 环境变量

```bash
# 方式1：分别配置
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=password
REDIS_DATABASE=0  # 可选，默认 0

# 方式2：直接配置 URL（优先使用）
REDIS_URL=redis://:password@host:port/database

MCP_PERMISSIONS='["read","write"]'  # 可选，默认只有 read
```

**URL 格式示例：**
```
redis://:myredissecret@10.150.64.129:6479/0
redis://localhost:6379                    # 无密码
redis://localhost:6379/1                 # 选择数据库 1
```

## 支持的命令

### 读命令 (read)

GET, HGET, HGETALL, HMGET, SMEMBERS, SRANDMEMBER, LRANGE, ZRANGE, ZREVRANGE, ZSCORE, ZCARD, TYPE, TTL, PTTL, EXISTS, DBSIZE, INFO, SCAN, KEYS, CLIENT, PING, ECHO, MULTI, EXPIRE, HKEYS, HVALS, HLEN, HEXISTS, LLEN, SCARD 等

### 写命令 (write)

SET, SETEX, SETNX, MSET, MSETNX, HSET, HMSET, HSETNX, HDEL, HINCRBY, HINCRBYFLOAT, DEL, UNLINK, SADD, SREM, SPOP, SMOVE, LPUSH, RPUSH, LPOP, RPOP, LTRIM, LREM, LSET, LINSERT, ZADD, ZREM, ZINCRBY, ZREMRANGEBYRANK, ZREMRANGEBYSCORE, INCR, INCRBY, INCRBYFLOAT, DECR, DECRBY, APPEND, SETRANGE, GETSET, PUBLISH, EXPIRE, EXPIREAT, MOVE, RENAME, RENAMENX 等

### 管理命令 (admin)

FLUSHDB, FLUSHALL, CONFIG, SHUTDOWN, SLAVEOF, REPLICAOF, BGREWRITEAOF, BGSAVE, SAVE, CLIENT, DEBUG 等（危险操作，默认禁用）

## 使用方式

### npx 直接运行

```bash
npx -y @easy-mcps/redis-mcp-server
```

### Claude Desktop / Cursor

```json
{
  "mcpServers": {
    "redis": {
      "command": "npx",
      "args": ["-y", "@easy-mcps/redis-mcp-server"],
      "env": {
        "REDIS_HOST": "localhost",
        "REDIS_PORT": "6379",
        "REDIS_PASSWORD": "",
        "MCP_PERMISSIONS": "read,write"
      }
    }
  }
}
```

### 本地安装

```bash
npm install -g @easy-mcps/redis-mcp-server
redis-mcp-server
```

## 开发

```bash
npm install
npm run dev
```

## License

MIT
