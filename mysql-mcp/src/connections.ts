#!/usr/bin/env node
/**
 * 多库连接管理：single（env 单库）与 multi（配置文件多库）两种模式。
 *
 * multi 模式以「app 名 + 环境」定位逻辑库，内部 channels 支持两类通道：
 *   - type=mysql: host/port/user/password/database 直连（mysql2 连接池 + READ ONLY 事务）
 *   - type=dms: 内网 DMS HTTP + Cookie（cloud.bilibili.co/rds/v1/dms/query_data）
 *
 * 一个 app+env 的 channels 数组按配置顺序调用，仅「连接失败」时抛
 * ChannelUnavailableError 供上层走下一通道兜底；SQL/业务错误原样抛出。
 */

import fs from "node:fs";
import mysql from "mysql2/promise";
import { getQueryTimeout } from "./shared.js";
import { loadDmsCookie } from "./cookie-auth.js";

// 连接失败标记：上层据此决定是否尝试下一 channel
export class ChannelUnavailableError extends Error {}

export interface ReadResult {
  rows: unknown[];
  // 服务端只返回了首页：结果可能不完整，必须显式告知调用方
  truncated?: boolean;
}

// ============ 配置类型 ============

export interface MysqlConnConfig {
  type: "mysql";
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  // 可选 TLS：true 使用默认校验，也可传 mysql2 的 ssl 选项对象
  ssl?: boolean | Record<string, unknown>;
}

export interface DmsConnConfig {
  type: "dms";
  api_url: string;
  cookie_env?: string;
  cookie_file?: string;
  db_name: string;
  backend_cluster_name: string;
  instance_id: number;
}

export type ConnConfig = MysqlConnConfig | DmsConnConfig;

export interface AppConfig {
  aliases?: string[];
  envs: Record<string, { channels: ConnConfig[] }>;
}

export interface MultiConfig {
  mode: "multi";
  connections: Record<string, AppConfig>;
}

// ============ 配置加载 ============

export function isMultiMode(): boolean {
  return process.env.MCP_MODE === "multi";
}

export function loadMultiConfig(configPath: string): MultiConfig {
  const raw = fs.readFileSync(configPath, "utf8");
  warnIfLoosePermissions(configPath);
  const parsed = JSON.parse(raw);
  if (parsed.mode !== "multi" || !parsed.connections) {
    throw new Error(
      "MCP_DB_CONFIG 不是 multi 配置：需包含 mode=multi 与 connections 字段"
    );
  }
  return parsed as MultiConfig;
}

// 配置内含明文凭据：权限放宽时提示，但不阻塞查询（Windows 等无 POSIX 权限位）
function warnIfLoosePermissions(file: string): void {
  if (typeof process.getuid !== "function") return;
  try {
    if (fs.statSync(file).mode & 0o077) {
      console.error(`警告: 数据库配置文件对组/其他用户可读，建议执行 chmod 600 ${file}`);
    }
  } catch {
    // 权限检查失败不影响查询
  }
}

// ============ MySQL 直连通道 ============

export class MysqlConnector {
  private pool: mysql.Pool | null = null;
  // 引擎是否支持 SET TRANSACTION READ ONLY（首次失败后置 false 不再重试）
  private readOnlyTxnSupported = true;

  constructor(private cfg: MysqlConnConfig) {}

  getPool(): mysql.Pool {
    if (!this.pool) {
      this.pool = mysql.createPool({
        host: this.cfg.host,
        port: this.cfg.port,
        user: this.cfg.user,
        password: this.cfg.password,
        database: this.cfg.database,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        ...(this.cfg.ssl ? { ssl: this.cfg.ssl === true ? {} : this.cfg.ssl } : {}),
      });
    }
    return this.pool;
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  async read(sql: string): Promise<ReadResult> {
    const db = this.getPool();
    let conn: mysql.PoolConnection;
    try {
      conn = await db.getConnection();
    } catch (e) {
      // 连接层失败（连不上/超时/认证失败）→ 通道不可用，走兜底
      throw new ChannelUnavailableError(
        `mysql 连接失败 (${this.cfg.host}:${this.cfg.port}): ${(e as Error).message}`
      );
    }
    const timeout = getQueryTimeout();
    try {
      if (this.readOnlyTxnSupported) {
        try {
          await conn.query("SET TRANSACTION READ ONLY");
        } catch {
          // 部分引擎（如 StarRocks）不支持，降级为仅白名单校验
          this.readOnlyTxnSupported = false;
          console.error(
            `警告: ${this.cfg.host}/${this.cfg.database} 不支持 SET TRANSACTION READ ONLY，` +
            `只读事务防线已降级，仅剩 SQL 校验`
          );
        }
      }
      const [rows] = await conn.query({ sql, timeout });
      return { rows: rows as unknown[] };
    } finally {
      conn.release();
    }
  }
}

// ============ DMS HTTP+Cookie 通道 ============

// DMS 只请求第一页：返回行数达到该值时无法判断是否还有更多
export const DMS_PAGE_SIZE = 100;

export class DmsConnector {
  constructor(private cfg: DmsConnConfig) {}

  async read(sql: string): Promise<ReadResult> {
    let cookie: string;
    try {
      cookie = await loadDmsCookie(this.cfg);
    } catch (e) {
      throw new ChannelUnavailableError((e as Error).message);
    }

    const payload = JSON.stringify({
      explain: false,
      force_execute: false,
      db_type: "mysql",
      db_name: this.cfg.db_name,
      backend_cluster_name: this.cfg.backend_cluster_name,
      sql,
      page_num: 1,
      page_size: DMS_PAGE_SIZE,
      instance_id: this.cfg.instance_id,
      limit: 500,
    });
    const timeout = getQueryTimeout();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      let resp: Response;
      try {
        resp = await fetch(this.cfg.api_url, {
          method: "POST",
          // 手动携带的 Cookie 不应跟随重定向；DMS 接口本身也不该跳转
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            "Cookie": cookie,
          },
          body: payload,
          signal: controller.signal,
        });
      } catch (error) {
        throw new ChannelUnavailableError(`DMS 请求失败: ${(error as Error).message}`);
      }
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        const detail = `DMS HTTP ${resp.status}: ${text.slice(0, 500)}`;
        // 仅网关/服务不可用时兜底；4xx 是查询或鉴权错误，换通道只会掩盖真实原因
        if (resp.status === 502 || resp.status === 503 || resp.status === 504) {
          throw new ChannelUnavailableError(detail);
        }
        throw new Error(detail);
      }
      const data = await resp.json() as any;
      if (data.code !== 0) {
        throw new Error(`DMS API 错误: ${data.message ?? "未知"}`);
      }
      const list = data.data?.data_list ?? [];
      return {
        rows: list.map((d: any) => d.item),
        truncated: list.length >= DMS_PAGE_SIZE,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ============ App 组装 ============

export type Channel = MysqlConnector | DmsConnector;

export interface App {
  name: string;
  envs: Record<string, Channel[]>;
}

function toChannel(conn: ConnConfig): Channel {
  if (conn.type === "mysql") return new MysqlConnector(conn);
  if (conn.type === "dms") return new DmsConnector(conn);
  throw new Error(`未知连接类型: ${(conn as any).type}`);
}

export function buildApps(cfg: MultiConfig): Map<string, App> {
  const map = new Map<string, App>();
  for (const [name, appCfg] of Object.entries(cfg.connections)) {
    const envs: Record<string, Channel[]> = {};
    for (const [env, envCfg] of Object.entries(appCfg.envs ?? {})) {
      envs[env] = (envCfg.channels ?? []).map(toChannel);
    }
    map.set(name, { name, envs });
  }
  // 所有真实库名先注册完再挂别名；别名冲突必须报错，否则会静默把查询路由到别的库
  for (const [name, appCfg] of Object.entries(cfg.connections)) {
    const app = map.get(name)!;
    for (const alias of appCfg.aliases ?? []) {
      if (alias === name) continue;
      const existing = map.get(alias);
      if (existing) {
        throw new Error(`database 别名冲突: "${alias}" 同时指向 "${existing.name}" 和 "${name}"`);
      }
      map.set(alias, app);
    }
  }
  return map;
}

export async function closeApps(map: Map<string, App>): Promise<void> {
  const seen = new Set<App>();
  for (const app of map.values()) {
    if (seen.has(app)) continue;
    seen.add(app);
    for (const channels of Object.values(app.envs)) {
      for (const ch of channels) {
        if (ch instanceof MysqlConnector) {
          try {
            await ch.close();
          } catch {
            // 关闭失败不阻塞退出
          }
        }
      }
    }
  }
}
