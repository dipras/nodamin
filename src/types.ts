// ============================================================
// Nodamin - Types
// ============================================================

export interface DbConnection {
  id: string;
  name: string;
  type: "mysql" | "sqlite";
  // MySQL fields
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  // SQLite fields
  filePath?: string;
}

export interface ServerConfig {
  port: number;
  host?: string;
}

export interface QueryResult {
  fields: ColumnInfo[];
  rows: Record<string, unknown>[];
  affectedRows?: number;
  message?: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  key: string;
  defaultValue: unknown;
  extra: string;
}

export interface TableInfo {
  name: string;
  engine: string;
  rows: number;
  size: string;
  collation: string;
}

export interface RouteContext {
  path: string;
  method: string;
  query: Record<string, string>;
  body: Record<string, unknown>;
  params: Record<string, string>;
  sessionId: string | null;
}
