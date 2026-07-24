// ============================================================
// Nodamin - Types
// ============================================================

export type DatabaseType = "mysql" | "mariadb" | "sqlite";

export interface DbConnection {
  id: string;
  name: string;
  type: DatabaseType;
  // MySQL/MariaDB fields
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  // SQLite fields
  filePath?: string;
  temporaryFile?: boolean;
  // Safety settings
  readOnly?: boolean;
  queryTimeoutMs?: number;
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

export interface QueryExecutionOptions {
  queryId?: string;
  timeoutMs?: number;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  key: string;
  defaultValue: unknown;
  extra: string;
}

export interface ColumnDefinition {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
}

export interface IndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
  primary: boolean;
}

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onUpdate: string;
  onDelete: string;
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
