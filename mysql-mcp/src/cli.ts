#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { buildApps, closeApps, loadMultiConfig } from "./connections.js";
import { readQuery } from "./read-query.js";
import { formatRows } from "./shared.js";

const help = `mysql-query --config <连接配置.json> --database <项目或别名> --env <环境> --sql <SQL>
  --list             列出项目、别名、环境及通道类型，不访问数据库
  --sql-file <文件>  从文件读取 SQL；用 - 从标准输入读取
  --output <文件>    保存结果，默认输出到标准输出
  --help             显示帮助
配置也可通过 MCP_DB_CONFIG 指定。仅支持只读查询，复用 MCP 的连接、认证、校验及结果限制。
`;

async function main() {
  const { values } = parseArgs({ options: {
    config: { type: "string" }, database: { type: "string" }, env: { type: "string" },
    sql: { type: "string" }, "sql-file": { type: "string" }, output: { type: "string" },
    list: { type: "boolean" }, help: { type: "boolean", short: "h" },
  }});
  if (values.help) { process.stdout.write(help); return; }
  const configPath = values.config || process.env.MCP_DB_CONFIG;
  if (!configPath) throw new Error("必须指定 --config 或 MCP_DB_CONFIG");
  const config = loadMultiConfig(configPath);
  if (values.list) {
    process.stdout.write(JSON.stringify(Object.entries(config.connections).map(([database, cfg]) => ({
      database, aliases: cfg.aliases || [],
      envs: Object.fromEntries(Object.entries(cfg.envs).map(([env, cfg]) => [env, cfg.channels.map(c => c.type)])),
    })), null, 2) + "\n");
    return;
  }
  if (!values.database || !values.env) throw new Error("查询必须指定 --database 和 --env");
  if ((values.sql !== undefined) === (values["sql-file"] !== undefined)) throw new Error("必须且只能指定 --sql 或 --sql-file");
  let sql = values.sql;
  if (values["sql-file"] === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    sql = Buffer.concat(chunks).toString("utf8");
  } else if (values["sql-file"]) {
    sql = await readFile(values["sql-file"], "utf8");
  }
  if (!sql?.trim()) throw new Error("SQL 不能为空");
  const apps = buildApps(config);
  try {
    const result = formatRows(await readQuery(apps, values.database, values.env, sql));
    if (values.output) await writeFile(values.output, result + "\n", "utf8");
    else process.stdout.write(result + "\n");
  } finally {
    await closeApps(apps);
  }
}

main().catch(error => {
  console.error(`mysql-query: ${error.message}`);
  process.exitCode = 1;
});
