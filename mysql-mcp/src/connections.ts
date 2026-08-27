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
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { getQueryTimeout } from "./shared.js";

// 连接失败标记：上层据此决定是否尝试下一 channel
export class ChannelUnavailableError extends Error {}

// ============ 配置类型 ============

export interface MysqlConnConfig {
  type: "mysql";
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
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
  const parsed = JSON.parse(raw);
  if (parsed.mode !== "multi" || !parsed.connections) {
    throw new Error(
      "MCP_DB_CONFIG 不是 multi 配置：需包含 mode=multi 与 connections 字段"
    );
  }
  return parsed as MultiConfig;
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

  async read(sql: string): Promise<unknown[]> {
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
          console.error("当前引擎不支持 SET TRANSACTION READ ONLY，只读事务防线已降级");
        }
      }
      const [rows] = await conn.query({ sql, timeout });
      return rows as unknown[];
    } finally {
      conn.release();
    }
  }
}

// ============ DMS HTTP+Cookie 通道 ============

export class DmsConnector {
  constructor(private cfg: DmsConnConfig) {}

  private loadCookie(): string {
    let cookie = "";
    if (this.cfg.cookie_env && process.env[this.cfg.cookie_env]) {
      cookie = process.env[this.cfg.cookie_env]!;
    }
    if (!cookie && this.cfg.cookie_file) {
      const p = this.cfg.cookie_file.startsWith("~")
        ? path.join(os.homedir(), this.cfg.cookie_file.slice(1))
        : this.cfg.cookie_file;
      if (fs.existsSync(p)) {
        cookie = fs.readFileSync(p, "utf8").trim();
      }
    }
    if (!cookie) {
      throw new ChannelUnavailableError(
        `DMS Cookie 缺失：设置环境变量 ${this.cfg.cookie_env ?? "(未指定)"} 或写入 ${this.cfg.cookie_file ?? "(未指定)"}`
      );
    }
    return cookie;
  }

  async read(sql: string): Promise<unknown[]> {
    let cookie: string;
    try {
      cookie = this.loadCookie();
    } catch (e) {
      throw e; // 已是 ChannelUnavailableError
    }

    const payload = JSON.stringify({
      explain: false,
      force_execute: false,
      db_type: "mysql",
      db_name: this.cfg.db_name,
      backend_cluster_name: this.cfg.backend_cluster_name,
      sql,
      page_num: 1,
      page_size: 100,
      instance_id: this.cfg.instance_id,
      limit: 500,
    });
    const timeout = getQueryTimeout();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const resp = await fetch(this.cfg.api_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": cookie,
        },
        body: payload,
        signal: controller.signal,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new ChannelUnavailableError(`DMS HTTP ${resp.status}: ${text.slice(0, 500)}`);
      }
      const data = await resp.json() as any;
      if (data.code !== 0) {
        throw new Error(`DMS API 错误: ${data.message ?? "未知"}`);
      }
      const list = data.data?.data_list ?? [];
      return list.map((d: any) => d.item);
    } catch (e) {
      if (e instanceof ChannelUnavailableError) throw e;
      // fetch 网络层失败（连不上/超时）→ 通道不可用；其余业务错误原样抛
      throw new ChannelUnavailableError(`DMS 请求失败: ${(e as Error).message}`);
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
    const app: App = { name, envs };
    map.set(name, app);
    for (const alias of appCfg.aliases ?? []) {
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
