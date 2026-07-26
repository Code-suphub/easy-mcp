/**
 * 数据库 MCP 服务器共享逻辑（权限解析 + SQL 校验 + 结果截断）
 *
 * ⚠️ 本文件是唯一维护源，各包内的 src/shared.ts 由 scripts/sync-shared.mjs 复制生成，
 *    不要直接修改各包内的副本。修改后执行: npm run sync
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

// ============ 包版本 ============
// 从 package.json 读取真实版本上报给 MCP 客户端，避免写死后与发布版本不一致
export function getPackageVersion(importMetaUrl: string): string {
  try {
    const dir = path.dirname(url.fileURLToPath(importMetaUrl));
    // dist/index.js -> ../package.json；src/index.ts（tsx 直跑）同样成立
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "..", "package.json"), "utf8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// ============ 权限解析 ============
// MCP_PERMISSIONS: 数组格式 ["read","write"] 或逗号分隔 "read,write"
// 不配置则默认只有 read；配置解析失败时打印警告并降级为只读
export interface Permissions {
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canDDL: boolean;
  canAdmin: boolean;
}

export function getPermissions(): Permissions {
  const value = process.env.MCP_PERMISSIONS;
  let perms: string[] = [];

  if (!value) {
    perms = [];
  } else if (value.trim().startsWith("[")) {
    try {
      perms = JSON.parse(value);
    } catch {
      console.error(`警告: MCP_PERMISSIONS 不是合法 JSON，已降级为只读: ${value}`);
      perms = [];
    }
  } else {
    perms = value.split(",").map((p) => p.trim().toLowerCase());
  }

  const known = ["read", "write", "delete", "ddl", "admin"];
  for (const p of perms) {
    if (!known.includes(p)) {
      console.error(`警告: MCP_PERMISSIONS 中的未知权限值 "${p}" 已忽略（可用: ${known.join("/")}）`);
    }
  }

  return {
    canRead: perms.includes("read") || perms.length === 0,
    canWrite: perms.includes("write"),
    canDelete: perms.includes("delete"),
    canDDL: perms.includes("ddl"),
    canAdmin: perms.includes("admin"),
  };
}

// ============ SQL 预处理 ============

/**
 * 去掉字符串字面量、被引用的标识符和注释，只留下裸 SQL 关键字，
 * 供关键字扫描与分号检测使用。
 *
 * ⚠️ 必须按方言处理，否则剥离规则与数据库实际解析不一致会产生绕过：
 * - `#` 在 MySQL 系是行注释，在 PostgreSQL/SQLite 是运算符。
 *   若对 PG 也当注释剥离，`SELECT 1 # 2; DROP TABLE x` 会被误判为单语句。
 * - 反斜杠在 MySQL 默认转义引号，在 PG（standard_conforming_strings=on）和
 *   SQLite 不转义。若对 PG 也当转义处理，`SELECT 'a\'; DROP TABLE x; --'`
 *   会被误判为单语句。
 * 不确定时一律选择"更保守"（不剥离），宁可误拒也不放行。
 */
export function stripSQLLiterals(sql: string, dialect: SQLDialect): string {
  // MySQL 系（含 ClickHouse，其 MySQL 兼容语法同样接受 # 注释与反斜杠转义）
  const hashIsComment = dialect === "mysql" || dialect === "clickhouse";
  const backslashEscapes = dialect === "mysql" || dialect === "clickhouse";

  let out = "";
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];
    const next = i + 1 < n ? sql[i + 1] : "";

    // 单引号 / 双引号字符串、反引号标识符
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      i++;
      while (i < n) {
        if (backslashEscapes && sql[i] === "\\" && quote !== "`") { i += 2; continue; }
        if (sql[i] === quote) {
          // '' 转义（所有方言通用）
          if (i + 1 < n && sql[i + 1] === quote) { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      out += " ";
      continue;
    }
    // 方括号标识符（SQLite/兼容语法）
    if (dialect === "sqlite" && ch === "[") {
      while (i < n && sql[i] !== "]") i++;
      i++;
      out += " ";
      continue;
    }
    // 行注释 --（通用）与 #（仅 MySQL 系）
    if ((ch === "-" && next === "-") || (hashIsComment && ch === "#")) {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    // 块注释 /* ... */
    if (ch === "/" && next === "*") {
      i += 2;
      while (i + 1 < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      out += " ";
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** 是否单条语句（去掉字面量/注释后，非末尾位置不允许出现分号） */
export function isSingleStatement(sql: string, dialect: SQLDialect): boolean {
  const stripped = stripSQLLiterals(sql, dialect).trim();
  const semi = stripped.indexOf(";");
  return semi === -1 || semi === stripped.length - 1;
}

/**
 * 扫描是否包含写/DDL 关键字（作用于 stripSQLLiterals 之后的文本）。
 * 不含 SET/USE/DO/CALL：它们无法出现在 CTE 内部构成写入，
 * 放进来只会误伤 SETTINGS、列名等合法只读查询。
 */
const WRITE_KEYWORD_RE =
  /\b(INSERT|UPDATE|DELETE|MERGE|REPLACE|TRUNCATE|DROP|CREATE|ALTER|GRANT|REVOKE|VACUUM|ATTACH|DETACH|COPY|LOAD|RENAME)\b/i;

// SELECT ... FOR UPDATE / FOR SHARE / FOR NO KEY UPDATE 是合法只读加锁查询，
// 扫描前先移除，避免被 \bUPDATE\b 误判
const LOCKING_CLAUSE_RE = /\bFOR\s+(NO\s+KEY\s+)?(UPDATE|SHARE|KEY\s+SHARE)\b/gi;

export function containsWriteKeyword(sql: string, dialect: SQLDialect): boolean {
  const stripped = stripSQLLiterals(sql, dialect).replace(LOCKING_CLAUSE_RE, " ");
  return WRITE_KEYWORD_RE.test(stripped);
}

// ============ SQL 类型校验 ============

export type SQLDialect = "mysql" | "postgresql" | "clickhouse" | "sqlite";
export type SQLType = "read" | "write" | "delete" | "ddl";

export interface ValidateResult {
  ok: boolean;
  reason?: string;
}

// 各方言允许的只读语句起始关键字
const READ_STARTERS: Record<SQLDialect, RegExp> = {
  mysql: /^\s*(SELECT|SHOW|DESC|DESCRIBE|EXPLAIN|WITH|TABLE)\b/i,
  postgresql: /^\s*(SELECT|SHOW|EXPLAIN|WITH|TABLE)\b/i,
  clickhouse: /^\s*(SELECT|SHOW|DESC|DESCRIBE|EXISTS|EXPLAIN|WITH)\b/i,
  sqlite: /^\s*(SELECT|EXPLAIN|WITH|PRAGMA)\b/i,
};

// write 语句（clickhouse 的 UPDATE 是 ALTER TABLE ... UPDATE）
const WRITE_STARTERS: Record<SQLDialect, RegExp> = {
  mysql: /^\s*(INSERT|UPDATE|REPLACE)\b/i,
  postgresql: /^\s*(INSERT|UPDATE)\b/i,
  clickhouse: /^\s*(INSERT\b|ALTER\s+TABLE\s+[^;]*?\bUPDATE\b)/i,
  sqlite: /^\s*(INSERT|UPDATE|REPLACE)\b/i,
};

// delete 语句（clickhouse 支持轻量级 DELETE FROM 与 ALTER TABLE ... DELETE）
const DELETE_STARTERS: Record<SQLDialect, RegExp> = {
  mysql: /^\s*(DELETE|TRUNCATE)\b/i,
  postgresql: /^\s*(DELETE|TRUNCATE)\b/i,
  clickhouse: /^\s*(DELETE\s+FROM\b|TRUNCATE\b|ALTER\s+TABLE\s+[^;]*?\bDELETE\b)/i,
  sqlite: /^\s*DELETE\b/i,
};

// DDL：CREATE/DROP/ALTER + 常见对象类型（含 INDEX/VIEW/物化视图），以及 RENAME TABLE
const DDL_RE =
  /^\s*((CREATE|DROP|ALTER)\s+(OR\s+REPLACE\s+)?(TEMPORARY\s+|TEMP\s+)?(UNIQUE\s+)?(MATERIALIZED\s+)?(TABLE|DATABASE|SCHEMA|INDEX|VIEW)\b|RENAME\s+TABLE\b)/i;

/**
 * 校验 SQL 是否属于指定类型。
 * - 所有类型都强制单条语句（堵住 "SELECT 1; DROP TABLE x" 这类绕过）
 * - read 中 WITH/EXPLAIN 开头的语句额外做写关键字扫描
 *   （防止 PostgreSQL 的 data-modifying CTE、EXPLAIN ANALYZE INSERT 等借道只读通道）
 * - read 禁止 INTO OUTFILE / INTO DUMPFILE / SELECT INTO
 */
export function validateSQL(sql: string, type: SQLType, dialect: SQLDialect): ValidateResult {
  if (!isSingleStatement(sql, dialect)) {
    return { ok: false, reason: "一次只能执行一条 SQL 语句" };
  }

  switch (type) {
    case "read": {
      if (!READ_STARTERS[dialect].test(sql)) {
        return { ok: false, reason: "read_query 只能执行 SELECT/SHOW/DESC/EXPLAIN/WITH 等只读语句" };
      }
      const stripped = stripSQLLiterals(sql, dialect);
      // WITH / EXPLAIN 可能内嵌写语句（如 data-modifying CTE、EXPLAIN ANALYZE UPDATE）
      if (/^\s*(WITH|EXPLAIN)\b/i.test(sql) && containsWriteKeyword(sql, dialect)) {
        return { ok: false, reason: "只读查询中不允许包含写操作（如 data-modifying CTE、EXPLAIN 写语句）" };
      }
      if (/\bINTO\s+(OUTFILE|DUMPFILE)\b/i.test(stripped)) {
        return { ok: false, reason: "只读查询不允许写文件（INTO OUTFILE/DUMPFILE）" };
      }
      if (dialect === "postgresql" && /\bSELECT\b[\s\S]*?\bINTO\b/i.test(stripped) && !/\bEXPLAIN\b/i.test(stripped)) {
        return { ok: false, reason: "只读查询不允许 SELECT INTO 建表" };
      }
      return { ok: true };
    }
    case "write":
      return WRITE_STARTERS[dialect].test(sql)
        ? { ok: true }
        : { ok: false, reason: "write_query 只能执行 INSERT/UPDATE 类语句" };
    case "delete":
      return DELETE_STARTERS[dialect].test(sql)
        ? { ok: true }
        : { ok: false, reason: "delete_query 只能执行 DELETE/TRUNCATE 类语句" };
    case "ddl": {
      if (!DDL_RE.test(sql)) {
        return { ok: false, reason: "ddl_query 只能执行 CREATE/DROP/ALTER TABLE/DATABASE/INDEX/VIEW 等 DDL 语句" };
      }
      // ClickHouse: ALTER TABLE ... DELETE/UPDATE 是数据变更，不允许借 ddl 权限执行
      if (dialect === "clickhouse" && /^\s*ALTER\s+TABLE\s+[^;]*?\b(DELETE|UPDATE)\b/i.test(stripSQLLiterals(sql, dialect))) {
        return { ok: false, reason: "ALTER TABLE ... DELETE/UPDATE 属于数据变更，请使用 delete_query/write_query" };
      }
      return { ok: true };
    }
  }
}

// ============ 查询超时 ============
// MCP_QUERY_TIMEOUT: 单条查询超时（毫秒），默认 30000

export function getQueryTimeout(): number {
  const v = parseInt(process.env.MCP_QUERY_TIMEOUT || "30000");
  return Number.isFinite(v) && v > 0 ? v : 30000;
}

// ============ 结果截断 ============
// MCP_MAX_ROWS: 查询结果最大返回行数，默认 1000，防止大表灌爆上下文

export function getMaxRows(): number {
  const v = parseInt(process.env.MCP_MAX_ROWS || "1000");
  return Number.isFinite(v) && v > 0 ? v : 1000;
}

// MCP_MAX_BYTES: 返回文本最大字节数，默认 1MB。
// 行数限制挡不住宽表（1000 行 × 大字段仍可能几十 MB），需要额外的体积兜底
export function getMaxBytes(): number {
  const v = parseInt(process.env.MCP_MAX_BYTES || "1048576");
  return Number.isFinite(v) && v > 0 ? v : 1048576;
}

export function formatRows(rows: unknown[]): string {
  const maxRows = getMaxRows();
  const truncatedByRows = rows.length > maxRows;
  const payload = truncatedByRows
    ? { rows: rows.slice(0, maxRows), truncated: true, totalRows: rows.length, note: `结果超过 ${maxRows} 行已截断，请加 LIMIT` }
    : rows;

  let text = JSON.stringify(payload, null, 2);

  // 体积兜底：逐步减半行数直到满足字节上限，仍超则硬截断字符串
  const maxBytes = getMaxBytes();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    let n = truncatedByRows ? maxRows : rows.length;
    while (n > 1) {
      n = Math.floor(n / 2);
      text = JSON.stringify(
        { rows: rows.slice(0, n), truncated: true, totalRows: rows.length, note: `结果体积超过 ${maxBytes} 字节，已截断至 ${n} 行，请加 LIMIT 或只查所需列` },
        null,
        2
      );
      if (Buffer.byteLength(text, "utf8") <= maxBytes) break;
    }
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      // 单行就超限（超大字段），按字节硬截断
      text = Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8") +
        `\n... [单行数据超过 ${maxBytes} 字节上限，已截断]`;
    }
  }
  return text;
}
