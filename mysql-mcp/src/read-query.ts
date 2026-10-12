/** MCP 和 CLI 共用的多库只读查询入口。 */
import { App, ChannelUnavailableError, MysqlConnector } from "./connections.js";
import { validateSQL } from "./shared.js";

export async function readQuery(apps: Map<string, App>, database: string, env: string, sql: string): Promise<unknown[]> {
  const validation = validateSQL(sql, "read", "mysql");
  if (!validation.ok) throw new Error(validation.reason);
  const app = apps.get(database);
  if (!app) throw new Error(`未知 database(app): ${database}，可选: ${[...apps.keys()].join(", ")}`);
  const channels = app.envs[env];
  if (!channels?.length) throw new Error(`app=${database} 无环境 ${env}，可选: ${Object.keys(app.envs).join(", ")}`);
  const errors: string[] = [];
  for (const channel of channels) {
    try {
      return await channel.read(sql);
    } catch (error) {
      if (!(error instanceof ChannelUnavailableError)) throw error;
      errors.push(`${channel instanceof MysqlConnector ? "mysql" : "dms"}: ${error.message}`);
    }
  }
  throw new Error(`app=${database} env=${env} 所有通道连接失败: ${errors.join(" | ")}`);
}
