/**
 * 数据库 MCP 服务器统一权限配置
 */

export interface PermissionConfig {
  // 数据读写
  canRead: boolean;
  canWrite: boolean;     // INSERT
  canUpdate: boolean;    // UPDATE
  canDelete: boolean;    // DELETE

  // 表结构
  canCreateTable: boolean;
  canDropTable: boolean;
  canAlterTable: boolean;

  // 库级别
  canCreateDatabase: boolean;
  canDropDatabase: boolean;
}

export const defaultPermissions: PermissionConfig = {
  canRead: true,
  canWrite: true,
  canUpdate: true,
  canDelete: false,        // ⚠️ 危险操作，默认关闭

  canCreateTable: false,   // ⚠️ DDL，默认关闭
  canDropTable: false,     // ⚠️ 危险，默认关闭
  canAlterTable: false,    // ⚠️ DDL，默认关闭

  canCreateDatabase: false,
  canDropDatabase: false,
};

export interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  check: () => boolean;
}

/**
 * SQL 语句类型验证
 */
export function validateSQLType(sql: string, type: 'read' | 'write' | 'update' | 'delete' | 'ddl'): boolean {
  const trimmed = sql.trim().toUpperCase();

  switch (type) {
    case 'read':
      return /^\s*SELECT/i.test(sql);
    case 'write':
      return /^\s*INSERT/i.test(sql);
    case 'update':
      return /^\s*UPDATE/i.test(sql);
    case 'delete':
      return /^\s*DELETE/i.test(sql);
    case 'ddl':
      return /^\s*(CREATE|DROP|ALTER)\s+(TABLE|DATABASE)/i.test(sql);
    default:
      return false;
  }
}
