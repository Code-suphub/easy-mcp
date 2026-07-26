#!/usr/bin/env node
/**
 * 共享 SQL 校验逻辑回归测试
 * 依赖构建产物，运行前先 npm run build（npm test 已包含）
 */
import { validateSQL } from "../mysql-mcp/dist/shared.js";

const cases = [
  // [sql, type, dialect, expected ok]
  // ---- read 正常放行 ----
  ["SELECT * FROM users", "read", "mysql", true],
  ["SHOW TABLES", "read", "mysql", true],
  ["SHOW CREATE TABLE users", "read", "mysql", true],
  ["DESC users", "read", "mysql", true],
  ["DESCRIBE users", "read", "mysql", true],
  ["EXPLAIN SELECT * FROM users WHERE id = 1", "read", "mysql", true],
  ["WITH t AS (SELECT 1) SELECT * FROM t", "read", "mysql", true],
  ["  select * from `update_log` where note = 'DROP TABLE x'", "read", "mysql", true],
  ["SELECT 1;", "read", "mysql", true],
  ["SELECT 1; -- comment", "read", "mysql", true],
  // ---- read 绕过尝试，必须拒绝 ----
  ["SELECT 1; DROP TABLE users", "read", "postgresql", false],
  ["SELECT 1; DELETE FROM t", "read", "mysql", false],
  ["WITH x AS (DELETE FROM users RETURNING *) SELECT * FROM x", "read", "postgresql", false],
  ["EXPLAIN ANALYZE INSERT INTO t VALUES (1)", "read", "postgresql", false],
  ["SELECT * FROM users INTO OUTFILE '/tmp/x'", "read", "mysql", false],
  ["SELECT * INTO newtable FROM users", "read", "postgresql", false],
  ["DELETE FROM users", "read", "mysql", false],
  // 方言差异绕过：# 在 PG 是运算符不是注释，不能当注释剥离
  ["SELECT 1 # 2; DROP TABLE x", "read", "postgresql", false],
  ["SELECT 1 # 2", "read", "postgresql", true],
  ["SELECT 1 # 注释掉的内容", "read", "mysql", true],
  // 方言差异绕过：PG standard_conforming_strings=on 时反斜杠不转义引号
  ["SELECT 'a\\'; DROP TABLE x; --'", "read", "postgresql", false],
  ["SELECT 'a\\'; DROP TABLE x; --'", "read", "mysql", true],
  // FOR UPDATE / FOR SHARE 是合法只读加锁查询，不应被 \bUPDATE\b 误拒
  ["WITH t AS (SELECT id FROM users FOR UPDATE) SELECT * FROM t", "read", "postgresql", true],
  ["WITH t AS (SELECT id FROM users FOR NO KEY UPDATE) SELECT * FROM t", "read", "postgresql", true],
  ["WITH t AS (SELECT id FROM users FOR SHARE) SELECT * FROM t", "read", "postgresql", true],
  // ---- write ----
  ["INSERT INTO t VALUES (1)", "write", "mysql", true],
  ["REPLACE INTO t VALUES (1)", "write", "mysql", true],
  ["UPDATE t SET a = 1", "write", "mysql", true],
  ["DELETE FROM t", "write", "mysql", false],
  ["INSERT INTO t VALUES (1); DROP TABLE t", "write", "mysql", false],
  // ---- delete ----
  ["DELETE FROM t WHERE id = 1", "delete", "mysql", true],
  ["TRUNCATE TABLE t", "delete", "mysql", true],
  // ---- ddl ----
  ["CREATE TABLE t (id INT)", "ddl", "mysql", true],
  ["CREATE INDEX idx ON t (id)", "ddl", "mysql", true],
  ["CREATE UNIQUE INDEX idx ON t (id)", "ddl", "mysql", true],
  ["CREATE OR REPLACE VIEW v AS SELECT 1", "ddl", "mysql", true],
  ["DROP INDEX idx ON t", "ddl", "mysql", true],
  ["ALTER TABLE t ADD COLUMN b INT", "ddl", "mysql", true],
  ["RENAME TABLE a TO b", "ddl", "mysql", true],
  // ---- clickhouse 语义 ----
  ["ALTER TABLE t UPDATE a = 1 WHERE id = 1", "write", "clickhouse", true],
  ["ALTER TABLE t DELETE WHERE id = 1", "delete", "clickhouse", true],
  ["DELETE FROM t WHERE id = 1", "delete", "clickhouse", true],
  ["TRUNCATE TABLE t", "delete", "clickhouse", true],
  ["ALTER TABLE t DELETE WHERE id = 1", "ddl", "clickhouse", false],
  ["ALTER TABLE t UPDATE a = 1 WHERE id = 1", "ddl", "clickhouse", false],
  ["ALTER TABLE t ADD COLUMN b Int32", "ddl", "clickhouse", true],
  ["CREATE TABLE t ON CLUSTER main (id Int32) ENGINE = MergeTree ORDER BY id", "ddl", "clickhouse", true],
  ["EXISTS TABLE t", "read", "clickhouse", true],
  ["SHOW TABLES", "read", "clickhouse", true],
  // ---- sqlite ----
  ["PRAGMA table_info(users)", "read", "sqlite", true],
  ["SELECT * FROM users", "read", "sqlite", true],
  ["SHOW TABLES", "read", "sqlite", false],
];

let fail = 0;
for (const [sql, type, dialect, expected] of cases) {
  const r = validateSQL(sql, type, dialect);
  if (r.ok !== expected) {
    fail++;
    console.log(`FAIL [${dialect}/${type}] expected ${expected} got ${r.ok}: ${sql}${r.reason ? ` (${r.reason})` : ""}`);
  }
}
if (fail > 0) {
  console.error(`${fail}/${cases.length} 个用例失败`);
  process.exit(1);
}
console.log(`全部 ${cases.length} 个用例通过`);
