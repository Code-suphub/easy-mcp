#!/usr/bin/env node
/**
 * 多库连接管理：single（env 单库）与 multi（配置文件多库）两种模式。
 * multi 模式下支持两类连接：
 *   - type=mysql: host/port/user/password/database 直连（mysql2 连接池 + READ ONLY 事务）
 *   - type=dms: 内网 DMS HTTP + Cookie（cloud.bilibili.co/rds/v1/dms/query_data）
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { getQueryTimeout } from "./shared.js";

// ============ 配置类型 ============

export interface MysqlConnConfig {
  type: "mysql";
  aliases?: string[];
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface DmsConnConfig {
  type: "dms";
  aliases?: string[];
  api_url: string;
  cookie_env?: string;
  cookie_file?: string;
  db_name: string;
  backend_cluster_name: string;
  instance_id: number;
}

export type ConnConfig = MysqlConnConfig | DmsConnConfig;

export interface MultiConfig {
  mode: "multi";
  connections: Record<string, ConnConfig>;
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

// ============ MySQL 直连连接器 ============

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
    const timeout = getQueryTimeout();
    const conn = await db.getConnection();
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

// ============ DMS HTTP+Cookie 连接器 ============

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
      throw new Error(`未配置 DMS Cookie：设置环境变量 ${this.cfg.cookie_env ?? "(未指定)"} 或写入 ${this.cfg.cookie_file ?? "(未指定)"}`);
    }
    return cookie;
  }

  async read(sql: string): Promise<unknown[]> {
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
          "Cookie": this.loadCookie(),
        },
        body: payload,
        signal: controller.signal,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`DMS HTTP ${resp.status}: ${text.slice(0, 500)}`);
      }
      const data = await resp.json() as any;
      if (data.code !== 0) {
        throw new Error(`DMS API 错误: ${data.message ?? "未知"}`);
      }
      const list = data.data?.data_list ?? [];
      return list.map((d: any) => d.item);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ============ 组装 ============

export type Connector = MysqlConnector | DmsConnector;

export function buildConnectors(cfg: MultiConfig): Map<string, Connector> {
  const map = new Map<string, Connector>();
  for (const [name, conn] of Object.entries(cfg.connections)) {
    let c: Connector | null = null;
    if (conn.type === "mysql") {
      c = new MysqlConnector(conn);
    } else if (conn.type === "dms") {
      c = new DmsConnector(conn);
    } else {
      console.error(`跳过未知连接类型: ${(conn as any).type} (${name})`);
      continue;
    }
    map.set(name, c);
    for (const alias of conn.aliases ?? []) {
      map.set(alias, c);
    }
  }
  return map;
}

export async function closeConnectors(map: Map<string, Connector>): Promise<void> {
  for (const conn of map.values()) {
    if (conn instanceof MysqlConnector) {
      try {
        await conn.close();
      } catch {
        // 关闭失败不阻塞退出
      }
    }
  }
}
