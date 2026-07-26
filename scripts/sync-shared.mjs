#!/usr/bin/env node
/**
 * 将根目录 src/shared.ts 同步到各包的 src/shared.ts
 * 用法: npm run sync
 */
import { copyFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "src", "shared.ts");

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
// Redis 非 SQL 语义，不使用共享 SQL 校验
const targets = pkg.workspaces.filter((w) => w !== "redis-mcp");

for (const ws of targets) {
  const dest = path.join(root, ws, "src", "shared.ts");
  copyFileSync(source, dest);
  console.log(`synced -> ${ws}/src/shared.ts`);
}
