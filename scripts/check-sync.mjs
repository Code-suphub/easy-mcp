#!/usr/bin/env node
/**
 * 校验各包内的 src/shared.ts 副本与根 src/shared.ts 一致
 * 不一致说明有人直接改了包内副本（会被 npm run sync 覆盖），应改根文件
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, "src", "shared.ts"), "utf8");

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const targets = pkg.workspaces.filter((w) => w !== "redis-mcp");

let dirty = 0;
for (const ws of targets) {
  const copy = readFileSync(path.join(root, ws, "src", "shared.ts"), "utf8");
  if (copy !== source) {
    dirty++;
    console.error(`不一致: ${ws}/src/shared.ts 与根 src/shared.ts 不同，请勿直接修改副本，改根文件后执行 npm run sync`);
  }
}
if (dirty > 0) process.exit(1);
console.log(`${targets.length} 个副本与根 src/shared.ts 一致`);
