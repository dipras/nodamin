import pg from "pg";
import { randomUUID } from "node:crypto";
import type { DatabaseDriver } from "./driver.js";
import type {
  ColumnDefinition,
  ColumnInfo,
  DbConnection,
  ForeignKeyInfo,
  IndexInfo,
  QueryExecutionOptions,
  QueryResult,
  TableInfo,
} from "../types.js";
import { assertSqlReadOnly, assertWritable } from "./sql.js";

const { Pool } = pg;

export function quotePostgreSQLIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export class PostgreSQLDriver implements DatabaseDriver {
  private pool: pg.Pool | null = null;
  private currentConnection: DbConnection | null = null;
  private currentDatabase: string | null = null;
  private readonly activeQueries = new Map<string, {
    processId: number;
    cancelled: boolean;
    timedOut: boolean;
  }>();

  connect(conn: DbConnection): void {
    if (this.pool) void this.pool.end().catch(() => {});
    const database = conn.database || this.currentDatabase || "postgres";
    this.currentDatabase = database;
    this.currentConnection = { ...conn, database };
    this.pool = new Pool(poolConfig(this.currentConnection));
  }

  disconnect(): void {
    for (const queryId of this.activeQueries.keys()) void this.cancelQuery(queryId);
    this.activeQueries.clear();
    if (this.pool) void this.pool.end().catch(() => {});
    this.pool = null;
    this.currentConnection = null;
    this.currentDatabase = null;
  }

  getConnection(): DbConnection | null {
    return this.currentConnection;
  }

  getCurrentDatabase(): string | null {
    return this.currentDatabase;
  }

  setCurrentDatabase(database: string | null): void {
    const next = database || "postgres";
    if (next === this.currentDatabase) return;
    if (!this.currentConnection) throw new Error("Not connected to database");
    this.currentDatabase = next;
    this.connect({ ...this.currentConnection, database: next });
  }

  async testConnection(conn: DbConnection): Promise<boolean> {
    const testPool = new Pool({ ...poolConfig(conn), max: 1 });
    try {
      await testPool.query("SELECT 1");
      return true;
    } catch {
      return false;
    } finally {
      await testPool.end().catch(() => {});
    }
  }

  async listDatabases(): Promise<string[]> {
    const { rows } = await this.requirePool().query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname"
    );
    return rows.map(({ datname }) => datname);
  }

  async listTables(): Promise<TableInfo[]> {
    const { rows } = await this.requirePool().query<{
      name: string;
      rows: string | number;
      size: string;
    }>(`
      SELECT c.relname AS name, c.reltuples::bigint AS rows,
             pg_size_pretty(pg_total_relation_size(c.oid)) AS size
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname
    `);
    return rows.map((row) => ({
      name: row.name,
      engine: "PostgreSQL",
      rows: Number(row.rows),
      size: row.size,
      collation: "-",
    }));
  }

  async getTableStructure(table: string): Promise<ColumnInfo[]> {
    const { rows } = await this.requirePool().query<{
      name: string;
      type: string;
      nullable: string;
      default_value: unknown;
      identity: string;
      constraint_types: string[] | null;
    }>(`
      SELECT a.attname AS name,
             pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
             CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS nullable,
             pg_get_expr(d.adbin, d.adrelid) AS default_value,
             a.attidentity AS identity,
             array_remove(array_agg(DISTINCT con.contype), NULL) AS constraint_types
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      LEFT JOIN pg_constraint con ON con.conrelid = c.oid AND a.attnum = ANY(con.conkey)
      WHERE n.nspname = 'public' AND c.relname = $1
        AND a.attnum > 0 AND NOT a.attisdropped
      GROUP BY a.attnum, a.attname, a.atttypid, a.atttypmod, a.attnotnull,
               d.adbin, d.adrelid, a.attidentity
      ORDER BY a.attnum
    `, [table]);
    return rows.map((row) => ({
      name: row.name,
      type: row.type,
      nullable: row.nullable === "YES",
      key: row.constraint_types?.includes("p")
        ? "PRI"
        : row.constraint_types?.includes("u")
          ? "UNI"
          : row.constraint_types?.includes("f") ? "MUL" : "",
      defaultValue: row.default_value,
      extra: row.identity ? "auto_increment" : "",
    }));
  }

  async addColumn(table: string, column: ColumnDefinition): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    return this.executeSchemaQuery(
      `ALTER TABLE ${quotePostgreSQLIdentifier(table)} ADD COLUMN ${postgresColumnDefinition(column)}`
    );
  }

  async modifyColumn(
    table: string,
    column: string,
    definition: ColumnDefinition
  ): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    const tableName = quotePostgreSQLIdentifier(table);
    const columnName = quotePostgreSQLIdentifier(column);
    const type = validatedPostgresType(definition.type);
    const statements = [
      `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} TYPE ${type} USING ${columnName}::${type}`,
      `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} ${definition.nullable ? "DROP" : "SET"} NOT NULL`,
      definition.defaultValue?.trim()
        ? `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} SET DEFAULT ${validatedPostgresDefault(definition.defaultValue)}`
        : `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} DROP DEFAULT`,
    ];
    await this.executeTransaction(statements);
    return schemaResult(`Modified column ${column}`);
  }

  async renameColumn(table: string, column: string, newName: string): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    return this.executeSchemaQuery(
      `ALTER TABLE ${quotePostgreSQLIdentifier(table)} RENAME COLUMN ${quotePostgreSQLIdentifier(column)} TO ${quotePostgreSQLIdentifier(newName)}`
    );
  }

  async dropColumn(table: string, column: string): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    return this.executeSchemaQuery(
      `ALTER TABLE ${quotePostgreSQLIdentifier(table)} DROP COLUMN ${quotePostgreSQLIdentifier(column)}`
    );
  }

  async listIndexes(table: string): Promise<IndexInfo[]> {
    const { rows } = await this.requirePool().query<{
      name: string;
      unique: boolean;
      primary: boolean;
      columns: string[];
    }>(`
      SELECT idx.relname AS name, i.indisunique AS unique, i.indisprimary AS primary,
             array_agg(att.attname ORDER BY keys.ordinality) AS columns
      FROM pg_index i
      JOIN pg_class tbl ON tbl.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = tbl.relnamespace
      JOIN pg_class idx ON idx.oid = i.indexrelid
      JOIN LATERAL unnest(i.indkey) WITH ORDINALITY keys(attnum, ordinality) ON true
      LEFT JOIN pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = keys.attnum
      WHERE n.nspname = 'public' AND tbl.relname = $1 AND keys.attnum > 0
      GROUP BY idx.relname, i.indisunique, i.indisprimary
      ORDER BY idx.relname
    `, [table]);
    return rows;
  }

  async createIndex(
    table: string,
    name: string,
    columns: string[],
    unique: boolean
  ): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    if (columns.length === 0) throw new Error("Choose at least one index column");
    return this.executeSchemaQuery(
      `CREATE ${unique ? "UNIQUE " : ""}INDEX ${quotePostgreSQLIdentifier(name)} ON ${quotePostgreSQLIdentifier(table)} (${columns.map(quotePostgreSQLIdentifier).join(", ")})`
    );
  }

  async dropIndex(_table: string, name: string): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    return this.executeSchemaQuery(`DROP INDEX ${quotePostgreSQLIdentifier(name)}`);
  }

  async listForeignKeys(table: string): Promise<ForeignKeyInfo[]> {
    const { rows } = await this.requirePool().query<{
      name: string;
      columns: string[];
      referenced_table: string;
      referenced_columns: string[];
      on_update: string;
      on_delete: string;
    }>(`
      SELECT con.conname AS name,
             array_agg(src.attname ORDER BY src_key.ordinality) AS columns,
             target.relname AS referenced_table,
             array_agg(dst.attname ORDER BY src_key.ordinality) AS referenced_columns,
             CASE con.confupdtype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
               WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' ELSE 'SET DEFAULT' END AS on_update,
             CASE con.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
               WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' ELSE 'SET DEFAULT' END AS on_delete
      FROM pg_constraint con
      JOIN pg_class source ON source.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = source.relnamespace
      JOIN pg_class target ON target.oid = con.confrelid
      JOIN LATERAL unnest(con.conkey) WITH ORDINALITY src_key(attnum, ordinality) ON true
      JOIN LATERAL unnest(con.confkey) WITH ORDINALITY dst_key(attnum, ordinality)
        ON dst_key.ordinality = src_key.ordinality
      JOIN pg_attribute src ON src.attrelid = source.oid AND src.attnum = src_key.attnum
      JOIN pg_attribute dst ON dst.attrelid = target.oid AND dst.attnum = dst_key.attnum
      WHERE con.contype = 'f' AND n.nspname = 'public' AND source.relname = $1
      GROUP BY con.conname, target.relname, con.confupdtype, con.confdeltype
      ORDER BY con.conname
    `, [table]);
    return rows.map((row) => ({
      name: row.name,
      columns: row.columns,
      referencedTable: row.referenced_table,
      referencedColumns: row.referenced_columns,
      onUpdate: row.on_update,
      onDelete: row.on_delete,
    }));
  }

  async createForeignKey(table: string, foreignKey: ForeignKeyInfo): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    validateForeignKey(foreignKey);
    return this.executeSchemaQuery(
      `ALTER TABLE ${quotePostgreSQLIdentifier(table)} ADD CONSTRAINT ${quotePostgreSQLIdentifier(foreignKey.name)} FOREIGN KEY (${foreignKey.columns.map(quotePostgreSQLIdentifier).join(", ")}) REFERENCES ${quotePostgreSQLIdentifier(foreignKey.referencedTable)} (${foreignKey.referencedColumns.map(quotePostgreSQLIdentifier).join(", ")}) ON UPDATE ${postgresForeignAction(foreignKey.onUpdate)} ON DELETE ${postgresForeignAction(foreignKey.onDelete)}`
    );
  }

  async dropForeignKey(table: string, name: string): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    return this.executeSchemaQuery(
      `ALTER TABLE ${quotePostgreSQLIdentifier(table)} DROP CONSTRAINT ${quotePostgreSQLIdentifier(name)}`
    );
  }

  async getTableData(
    table: string,
    page = 1,
    perPage = 50,
    sort?: string,
    order?: string,
    filters: Record<string, string> = {}
  ): Promise<{ rows: Record<string, unknown>[]; total: number; fields: string[] }> {
    const columns = await this.getTableStructure(table);
    const names = new Set(columns.map(({ name }) => name));
    const activeFilters = Object.entries(filters).filter(([name, value]) => names.has(name) && value);
    const values: unknown[] = activeFilters.map(([, value]) => `%${value}%`);
    const where = activeFilters.length
      ? ` WHERE ${activeFilters.map(([name], index) => `${quotePostgreSQLIdentifier(name)}::text ILIKE $${index + 1}`).join(" AND ")}`
      : "";
    const count = await this.requirePool().query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM ${quotePostgreSQLIdentifier(table)}${where}`,
      values
    );
    let sql = `SELECT * FROM ${quotePostgreSQLIdentifier(table)}${where}`;
    if (sort && names.has(sort)) {
      sql += ` ORDER BY ${quotePostgreSQLIdentifier(sort)} ${order === "desc" ? "DESC" : "ASC"}`;
    }
    values.push(perPage, Math.max(0, (page - 1) * perPage));
    sql += ` LIMIT $${values.length - 1} OFFSET $${values.length}`;
    const result = await this.requirePool().query(sql, values);
    return {
      rows: result.rows,
      total: Number(count.rows[0]?.total ?? 0),
      fields: columns.map(({ name }) => name),
    };
  }

  async getTableRows(table: string): Promise<Record<string, unknown>[]> {
    return (await this.requirePool().query(
      `SELECT * FROM ${quotePostgreSQLIdentifier(table)}`
    )).rows;
  }

  async getRow(
    table: string,
    where: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> {
    const entries = Object.entries(where);
    if (entries.length === 0) throw new Error("A row selector is required");
    const clauses = entries.map(([name], index) =>
      `${quotePostgreSQLIdentifier(name)} IS NOT DISTINCT FROM $${index + 1}`);
    const result = await this.requirePool().query(
      `SELECT * FROM ${quotePostgreSQLIdentifier(table)} WHERE ${clauses.join(" AND ")} LIMIT 1`,
      entries.map(([, value]) => value)
    );
    return result.rows[0] ?? null;
  }

  async executeQuery(sql: string, options?: QueryExecutionOptions): Promise<QueryResult> {
    const pool = this.requirePool();
    const client = await pool.connect();
    const queryId = options?.queryId ?? randomUUID();
    const process = await client.query<{ process_id: number }>(
      "SELECT pg_backend_pid() AS process_id"
    );
    const active = {
      processId: process.rows[0]!.process_id,
      cancelled: false,
      timedOut: false,
    };
    this.activeQueries.set(queryId, active);
    const timeoutMs = normalizeTimeout(options?.timeoutMs ?? this.currentConnection?.queryTimeoutMs);
    const timeout = timeoutMs
      ? setTimeout(() => {
          active.timedOut = true;
          void this.cancelQuery(queryId);
        }, timeoutMs)
      : null;
    try {
      if (this.currentConnection?.readOnly) assertSqlReadOnly(sql);
      const raw = await client.query(sql) as unknown;
      const results = Array.isArray(raw) ? raw as pg.QueryResult[] : [raw as pg.QueryResult];
      const result = results.at(-1)!;
      return {
        fields: result.fields.map((field) => ({
          name: field.name,
          type: String(field.dataTypeID),
          nullable: true,
          key: "",
          defaultValue: null,
          extra: "",
        })),
        rows: result.rows,
        ...(result.rowCount === null ? {} : { affectedRows: result.rowCount }),
        ...(!result.fields.length ? {
          message: `Query OK, ${result.rowCount ?? 0} row(s) affected`,
        } : {}),
      };
    } catch (error: unknown) {
      const message = active.timedOut
        ? `Query timed out after ${timeoutMs} ms`
        : active.cancelled ? "Query cancelled" : errorMessage(error);
      return { fields: [], rows: [], message: `Error: ${message}` };
    } finally {
      if (timeout) clearTimeout(timeout);
      this.activeQueries.delete(queryId);
      client.release();
    }
  }

  async cancelQuery(queryId: string): Promise<boolean> {
    const active = this.activeQueries.get(queryId);
    if (!active) return false;
    active.cancelled = !active.timedOut;
    const result = await this.requirePool().query<{ cancelled: boolean }>(
      "SELECT pg_cancel_backend($1) AS cancelled",
      [active.processId]
    );
    return result.rows[0]?.cancelled === true;
  }

  async insertRow(table: string, data: Record<string, unknown>): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    const entries = Object.entries(data);
    if (!entries.length) throw new Error("At least one value is required");
    const result = await this.requirePool().query(
      `INSERT INTO ${quotePostgreSQLIdentifier(table)} (${entries.map(([name]) => quotePostgreSQLIdentifier(name)).join(", ")}) VALUES (${entries.map((_, index) => `$${index + 1}`).join(", ")})`,
      entries.map(([, value]) => value)
    );
    return mutationResult("Inserted", result.rowCount);
  }

  async updateRow(
    table: string,
    data: Record<string, unknown>,
    where: Record<string, unknown>
  ): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    const values = Object.entries(data);
    const selectors = Object.entries(where);
    if (!values.length || !selectors.length) throw new Error("Values and a row selector are required");
    const parameters = [...values.map(([, value]) => value), ...selectors.map(([, value]) => value)];
    const set = values.map(([name], index) => `${quotePostgreSQLIdentifier(name)} = $${index + 1}`);
    const clauses = selectors.map(([name], index) =>
      `${quotePostgreSQLIdentifier(name)} IS NOT DISTINCT FROM $${values.length + index + 1}`);
    const result = await this.requirePool().query(
      `UPDATE ${quotePostgreSQLIdentifier(table)} SET ${set.join(", ")} WHERE ${clauses.join(" AND ")}`,
      parameters
    );
    return mutationResult("Updated", result.rowCount);
  }

  async deleteRow(table: string, where: Record<string, unknown>): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    const entries = Object.entries(where);
    if (!entries.length) throw new Error("A row selector is required");
    const clauses = entries.map(([name], index) =>
      `${quotePostgreSQLIdentifier(name)} IS NOT DISTINCT FROM $${index + 1}`);
    const result = await this.requirePool().query(
      `DELETE FROM ${quotePostgreSQLIdentifier(table)} WHERE ${clauses.join(" AND ")}`,
      entries.map(([, value]) => value)
    );
    return mutationResult("Deleted", result.rowCount);
  }

  async dropTable(table: string): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    return this.executeSchemaQuery(`DROP TABLE ${quotePostgreSQLIdentifier(table)}`);
  }

  async truncateTable(table: string): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    return this.executeSchemaQuery(`TRUNCATE TABLE ${quotePostgreSQLIdentifier(table)}`);
  }

  async createDatabase(name: string): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    return this.executeSchemaQuery(`CREATE DATABASE ${quotePostgreSQLIdentifier(name)}`);
  }

  async dropDatabase(name: string): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    if (this.currentDatabase === name) this.setCurrentDatabase("postgres");
    return this.executeSchemaQuery(`DROP DATABASE ${quotePostgreSQLIdentifier(name)}`);
  }

  async createTable(
    table: string,
    columns: {
      name: string;
      type: string;
      nullable: boolean;
      primary: boolean;
      autoIncrement: boolean;
      defaultValue?: string;
    }[]
  ): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    const definitions = columns.map((column) => {
      const type = validatedPostgresType(column.type);
      let definition = `${quotePostgreSQLIdentifier(column.name)} ${type}`;
      if (column.autoIncrement) definition += " GENERATED BY DEFAULT AS IDENTITY";
      if (!column.nullable) definition += " NOT NULL";
      if (column.defaultValue?.trim()) {
        definition += ` DEFAULT ${validatedPostgresDefault(column.defaultValue)}`;
      }
      return definition;
    });
    const primary = columns.filter(({ primary }) => primary);
    if (primary.length) {
      definitions.push(`PRIMARY KEY (${primary.map(({ name }) => quotePostgreSQLIdentifier(name)).join(", ")})`);
    }
    return this.executeSchemaQuery(
      `CREATE TABLE ${quotePostgreSQLIdentifier(table)} (${definitions.join(", ")})`
    );
  }

  async exportTable(table: string, structureOnly = false): Promise<string> {
    const columns = await this.getTableStructure(table);
    const indexes = await this.listIndexes(table);
    const foreignKeys = await this.listForeignKeys(table);
    const primary = columns.filter(({ key }) => key === "PRI");
    const definitions = columns.map((column) => {
      let definition = `${quotePostgreSQLIdentifier(column.name)} ${column.type}`;
      if (column.extra.includes("auto_increment")) definition += " GENERATED BY DEFAULT AS IDENTITY";
      if (!column.nullable) definition += " NOT NULL";
      if (column.defaultValue !== null && !column.extra.includes("auto_increment")) {
        definition += ` DEFAULT ${String(column.defaultValue)}`;
      }
      return definition;
    });
    if (primary.length) {
      definitions.push(`PRIMARY KEY (${primary.map(({ name }) => quotePostgreSQLIdentifier(name)).join(", ")})`);
    }
    for (const foreignKey of foreignKeys) {
      definitions.push(
        `CONSTRAINT ${quotePostgreSQLIdentifier(foreignKey.name)} FOREIGN KEY (${foreignKey.columns.map(quotePostgreSQLIdentifier).join(", ")}) REFERENCES ${quotePostgreSQLIdentifier(foreignKey.referencedTable)} (${foreignKey.referencedColumns.map(quotePostgreSQLIdentifier).join(", ")}) ON UPDATE ${foreignKey.onUpdate} ON DELETE ${foreignKey.onDelete}`
      );
    }
    let dump = `-- Table: ${table}\nDROP TABLE IF EXISTS ${quotePostgreSQLIdentifier(table)} CASCADE;\n`;
    dump += `CREATE TABLE ${quotePostgreSQLIdentifier(table)} (${definitions.join(", ")});\n`;
    for (const index of indexes.filter(({ primary }) => !primary)) {
      dump += `CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${quotePostgreSQLIdentifier(index.name)} ON ${quotePostgreSQLIdentifier(table)} (${index.columns.map(quotePostgreSQLIdentifier).join(", ")});\n`;
    }
    if (!structureOnly) {
      const rows = await this.getTableRows(table);
      for (const row of rows) {
        const entries = Object.entries(row);
        dump += `INSERT INTO ${quotePostgreSQLIdentifier(table)} (${entries.map(([name]) => quotePostgreSQLIdentifier(name)).join(", ")}) VALUES (${entries.map(([, value]) => postgresLiteral(value)).join(", ")});\n`;
      }
    }
    return dump;
  }

  async importSQL(sql: string): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    const client = await this.requirePool().connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("COMMIT");
      return schemaResult("PostgreSQL script imported");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async exportDatabase(structureOnly = false): Promise<string> {
    let dump = `-- PostgreSQL database: ${this.currentDatabase}\n\n`;
    for (const table of await this.listTables()) {
      dump += `${await this.exportTable(table.name, structureOnly)}\n`;
    }
    return dump;
  }

  private requirePool(): pg.Pool {
    if (!this.pool) throw new Error("Not connected to database");
    return this.pool;
  }

  private async executeSchemaQuery(sql: string): Promise<QueryResult> {
    const result = await this.executeQuery(sql);
    if (result.message?.startsWith("Error:")) {
      throw new Error(result.message.slice("Error:".length).trim());
    }
    return result;
  }

  private async executeTransaction(statements: string[]): Promise<void> {
    const client = await this.requirePool().connect();
    try {
      await client.query("BEGIN");
      for (const statement of statements) await client.query(statement);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

function poolConfig(connection: DbConnection): pg.PoolConfig {
  return {
    host: connection.host ?? "localhost",
    port: connection.port ?? 5432,
    user: connection.user ?? "postgres",
    password: connection.password ?? "",
    database: connection.database ?? "postgres",
    max: 5,
    application_name: "nodamin",
    ...(connection.ssl ? { ssl: true } : {}),
    ...(connection.readOnly ? { options: "-c default_transaction_read_only=on" } : {}),
  };
}

function postgresColumnDefinition(column: ColumnDefinition): string {
  let definition = `${quotePostgreSQLIdentifier(column.name)} ${validatedPostgresType(column.type)}`;
  definition += column.nullable ? " NULL" : " NOT NULL";
  if (column.defaultValue?.trim()) {
    definition += ` DEFAULT ${validatedPostgresDefault(column.defaultValue)}`;
  }
  return definition;
}

function validatedPostgresType(type: string): string {
  const normalized = type.trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_ ]*(?:\(\s*\d+(?:\s*,\s*\d+)?\s*\))?(?:\[\])?$/.test(normalized)) {
    throw new Error("Invalid PostgreSQL column type");
  }
  return normalized;
}

function validatedPostgresDefault(value: string): string {
  const normalized = value.trim();
  if (!/^(?:NULL|TRUE|FALSE|[-+]?\d+(?:\.\d+)?|'(?:''|[^'])*'|CURRENT_(?:TIME|DATE|TIMESTAMP)|now\(\)|gen_random_uuid\(\)|nextval\('[a-zA-Z0-9_."-]+'::regclass\))$/i.test(normalized)) {
    throw new Error("Invalid PostgreSQL default value");
  }
  return normalized;
}

function postgresForeignAction(action: string): string {
  const normalized = action.trim().toUpperCase();
  if (!["NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"].includes(normalized)) {
    throw new Error("Invalid foreign-key action");
  }
  return normalized;
}

function validateForeignKey(foreignKey: ForeignKeyInfo): void {
  if (!foreignKey.columns.length || foreignKey.columns.length !== foreignKey.referencedColumns.length) {
    throw new Error("Foreign-key columns must have matching referenced columns");
  }
}

function postgresLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (Buffer.isBuffer(value)) return `'\\x${value.toString("hex")}'::bytea`;
  const normalized = value instanceof Date ? value.toISOString() : typeof value === "object"
    ? JSON.stringify(value) : String(value);
  return `'${normalized.replace(/'/g, "''")}'`;
}

function mutationResult(action: string, rowCount: number | null): QueryResult {
  const affectedRows = rowCount ?? 0;
  return { fields: [], rows: [], affectedRows, message: `${action} ${affectedRows} row(s)` };
}

function schemaResult(message: string): QueryResult {
  return { fields: [], rows: [], message };
}

function normalizeTimeout(value: number | undefined): number | undefined {
  if (!value || !Number.isFinite(value)) return undefined;
  return Math.min(300_000, Math.max(100, Math.round(value)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
