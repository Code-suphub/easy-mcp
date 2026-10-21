/** Reuse toolkit's Arc/Keychain logic without passing credentials to child processes. */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const pending = new Map<string, Promise<void>>();
const MAX_BYTES = 65536;

interface CookieConfig {
  api_url: string;
  cookie_env?: string;
  cookie_file?: string;
}

function validCookie(value: string): string {
  if (Buffer.byteLength(value) > MAX_BYTES || /[\r\n\0]/.test(value)) {
    throw new Error("DMS Cookie 格式无效；应为不超过 64 KiB 的单行 Header");
  }
  return value;
}

function cookiePath(value: string): string {
  if (value === "~") return os.homedir();
  return path.resolve(value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value);
}

function readCookie(file: string, isDefault: boolean): string {
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK |
      (isDefault ? fs.constants.O_NOFOLLOW : 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw new Error("无法读取 DMS Cookie 文件；请检查权限和路径（默认文件不能为符号链接）");
  }
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile() || info.size > MAX_BYTES ||
        (isDefault && typeof process.getuid === "function" && info.uid !== process.getuid())) {
      throw new Error("DMS Cookie 须为可读取的普通文件，默认文件须属于当前用户且大小不超过 64 KiB");
    }
    return validCookie(fs.readFileSync(fd, "utf8").trim());
  } finally {
    fs.closeSync(fd);
  }
}

function trustedEndpoint(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      !url.search && !url.hash &&
      ["cloud.bilibili.co", "uat-cloud.bilibili.co"].includes(url.hostname) &&
      url.pathname === "/rds/v1/dms/query_data";
  } catch {
    return false;
  }
}

async function ensureDefaultCookie(file: string): Promise<void> {
  let task = pending.get(file);
  if (!task) {
    task = (async () => {
      const override = process.env.MCP_TOOLKIT_BIN;
      if (override && !path.isAbsolute(override)) {
        throw new Error("MCP_TOOLKIT_BIN 必须是 toolkit 可执行文件的绝对路径");
      }
      const local = path.join(os.homedir(), ".local/bin/toolkit");
      const binary = override || (fs.existsSync(local) ? local : "toolkit");
      try {
        // stdout contains metadata only; never relay helper stdout/stderr or its errors.
        await execute(binary, ["auth", "ensure"], { timeout: 45000, maxBuffer: MAX_BYTES });
      } catch {
        throw new Error("DMS Cookie 自动补齐失败；请确认 toolkit 已安装且支持 auth ensure、Arc 已登录，并检查钥匙串授权。可设置 MCP_TOOLKIT_BIN 或运行 toolkit auth refresh");
      }
    })();
    pending.set(file, task);
  }
  try {
    await task;
  } finally {
    if (pending.get(file) === task) pending.delete(file);
  }
}

export async function loadDmsCookie(config: CookieConfig): Promise<string> {
  const environment = config.cookie_env ? process.env[config.cookie_env]?.trim() : "";
  if (environment) return validCookie(environment);
  if (!config.cookie_file) {
    throw new Error("DMS Cookie 缺失：请设置已配置的 Cookie 环境变量或配置 cookie_file");
  }
  const file = cookiePath(config.cookie_file);
  const isDefault = file === path.join(os.homedir(), ".bi-cookie");
  // 默认共享 SSO Cookie 只能发往已知内部 DMS 接口；
  // 其他地址必须显式配置独立 Cookie，避免配置被改动后把凭据外发
  if (isDefault && !trustedEndpoint(config.api_url)) {
    throw new Error("默认 DMS Cookie 仅允许发送到已知内部 DMS HTTPS 接口；其他地址请显式配置独立的 cookie_file 或 cookie_env");
  }
  let cookie = readCookie(file, isDefault);
  if (!cookie && isDefault) {
    await ensureDefaultCookie(file);
    cookie = readCookie(file, true);
  }
  if (!cookie) {
    throw new Error("DMS Cookie 缺失：请检查配置的环境变量或 Cookie 文件；自定义文件不会自动补齐");
  }
  return cookie;
}
