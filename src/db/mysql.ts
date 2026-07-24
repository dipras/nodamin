// ============================================================
// Nodamin - MySQL Database Driver
// ============================================================

import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import type { DatabaseDriver } from "./driver.js";
import type {
  DbConnection,
  QueryExecutionOptions,
  QueryResult,
  ColumnInfo,
  ColumnDefinition,
  ForeignKeyInfo,
  IndexInfo,
  TableInfo,
} from "../types.js";
import {
  assertSqlReadOnly,
  assertWritable,
  splitSqlStatements,
} from "./sql.js";

export function quoteMySQLIdentifier(identifier: string): string {
  return `\`${identifier.replace(/`/g, "``")}\``;
}

export class MySQLDriver implements DatabaseDriver {
  private pool: mysql.Pool | null = null;
  private currentConnection: DbConnection | null = null;
  private currentDatabase: string | null = null;
  private readonly activeQueries = new Map<string, {
    connection: mysql.PoolConnection;
    threadId: number;
    cancelled: boolean;
    timedOut: boolean;
  }>();

  connect(conn: DbConnection): void {
    if (this.pool) {
      this.pool.end().catch(() => { });
    }
    const poolOpts: mysql.PoolOptions = {
      host: conn.host ?? "localhost",
      port: conn.port ?? 3306,
      user: conn.user ?? "root",
      password: conn.password ?? "",
      waitForConnections: true,
      connectionLimit: 5,
    };
    const database = this.currentDatabase ?? conn.database;
    if (database) {
      poolOpts.database = database;
      this.currentDatabase = database;
    }
    this.pool = mysql.createPool(poolOpts);
    this.currentConnection = conn;
  }

  disconnect(): void {
    for (const active of this.activeQueries.values()) active.connection.destroy();
    this.activeQueries.clear();
    if (this.pool) {
      this.pool.end().catch(() => { });
      this.pool = null;
    }
    this.currentConnection = null;
    this.currentDatabase = null;
  }

  getConnection(): DbConnection | null {
    return this.currentConnection;
  }

  getCurrentDatabase(): string | null {
    return this.currentDatabase;
  }

  setCurrentDatabase(db: string | null): void {
    this.currentDatabase = db;
    if (this.currentConnection) {
      this.connect(this.currentConnection);
    }
  }

  private async getPool(): Promise<mysql.Pool> {
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

  async testConnection(conn: DbConnection): Promise<boolean> {
    let testPool: mysql.Pool | null = null;
    try {
      testPool = mysql.createPool({
        host: conn.host ?? "localhost",
        port: conn.port ?? 3306,
        user: conn.user ?? "root",
        password: conn.password ?? "",
        ...(conn.database ? { database: conn.database } : {}),
        connectionLimit: 1,
      });
      await testPool.query("SELECT 1");
      return true;
    } catch {
      return false;
    } finally {
      await testPool?.end().catch(() => { });
    }
  }

  async listDatabases(): Promise<string[]> {
    const p = await this.getPool();
    const [rows] = await p.query("SHOW DATABASES");
    return (rows as Record<string, string>[]).map((r) => r["Database"]!);
  }

  async listTables(): Promise<TableInfo[]> {
    if (!this.currentDatabase) return [];
    const p = await this.getPool();
    const [rows] = await p.query(
      `SELECT 
        TABLE_NAME as name,
        ENGINE as engine,
        TABLE_ROWS as \`rows\`,
        ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024, 2) as size,
        TABLE_COLLATION as collation
      FROM information_schema.TABLES 
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME`,
      [this.currentDatabase]
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      name: r["name"] as string,
      engine: (r["engine"] as string) ?? "-",
      rows: Number(r["rows"] ?? 0),
      size: `${r["size"]} KB`,
      collation: (r["collation"] as string) ?? "-",
    }));
  }

  async getTableStructure(table: string): Promise<ColumnInfo[]> {
    const p = await this.getPool();
    const [rows] = await p.query(
      `SELECT 
        COLUMN_NAME as name,
        COLUMN_TYPE as type,
        IS_NULLABLE as nullable,
        COLUMN_KEY as \`key\`,
        COLUMN_DEFAULT as defaultValue,
        EXTRA as extra
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
      [this.currentDatabase, table]
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      name: r["name"] as string,
      type: r["type"] as string,
      nullable: r["nullable"] === "YES",
      key: (r["key"] as string) ?? "",
      defaultValue: r["defaultValue"],
      extra: (r["extra"] as string) ?? "",
    }));
  }

  async addColumn(table: string, column: ColumnDefinition): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    return this.executeSchemaQuery(
      `ALTER TABLE ${quoteMySQLIdentifier(table)} ADD COLUMN ${mysqlColumnDefinition(column)}`
    );
  }

  async modifyColumn(
    table: string,
    column: string,
    definition: ColumnDefinition
  ): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    return this.executeSchemaQuery(
      `ALTER TABLE ${quoteMySQLIdentifier(table)} MODIFY COLUMN ${mysqlColumnDefinition(definition)}`
    );
  }

  async renameColumn(table: string, column: string, newName: string): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    return this.executeSchemaQuery(
      `ALTER TABLE ${quoteMySQLIdentifier(table)} RENAME COLUMN ${quoteMySQLIdentifier(column)} TO ${quoteMySQLIdentifier(newName)}`
    );
  }

  async dropColumn(table: string, column: string): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    return this.executeSchemaQuery(
      `ALTER TABLE ${quoteMySQLIdentifier(table)} DROP COLUMN ${quoteMySQLIdentifier(column)}`
    );
  }

  async listIndexes(table: string): Promise<IndexInfo[]> {
    const p = await this.getPool();
    const [rows] = await p.query(
      `SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName,
              SEQ_IN_INDEX AS sequence
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [this.currentDatabase, table]
    );
    const indexes = new Map<string, IndexInfo>();
    for (const row of rows as Record<string, unknown>[]) {
      const name = String(row["name"]);
      const current = indexes.get(name) ?? {
        name,
        unique: Number(row["nonUnique"]) === 0,
        columns: [],
        primary: name === "PRIMARY",
      };
      current.columns.push(String(row["columnName"]));
      indexes.set(name, current);
    }
    return [...indexes.values()];
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
      `CREATE ${unique ? "UNIQUE " : ""}INDEX ${quoteMySQLIdentifier(name)} ON ${quoteMySQLIdentifier(table)} (${columns.map(quoteMySQLIdentifier).join(", ")})`
    );
  }

  async dropIndex(table: string, name: string): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    if (name === "PRIMARY") throw new Error("Primary keys cannot be dropped as regular indexes");
    return this.executeSchemaQuery(
      `DROP INDEX ${quoteMySQLIdentifier(name)} ON ${quoteMySQLIdentifier(table)}`
    );
  }

  async listForeignKeys(table: string): Promise<ForeignKeyInfo[]> {
    const p = await this.getPool();
    const [rows] = await p.query(
      `SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS columnName,
              k.REFERENCED_TABLE_NAME AS referencedTable,
              k.REFERENCED_COLUMN_NAME AS referencedColumn,
              r.UPDATE_RULE AS onUpdate, r.DELETE_RULE AS onDelete,
              k.ORDINAL_POSITION AS position
       FROM information_schema.KEY_COLUMN_USAGE k
       JOIN information_schema.REFERENTIAL_CONSTRAINTS r
         ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
        AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
        AND r.TABLE_NAME = k.TABLE_NAME
       WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ?
         AND k.REFERENCED_TABLE_NAME IS NOT NULL
       ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
      [this.currentDatabase, table]
    );
    const foreignKeys = new Map<string, ForeignKeyInfo>();
    for (const row of rows as Record<string, unknown>[]) {
      const name = String(row["name"]);
      const current = foreignKeys.get(name) ?? {
        name,
        columns: [],
        referencedTable: String(row["referencedTable"]),
        referencedColumns: [],
        onUpdate: String(row["onUpdate"]),
        onDelete: String(row["onDelete"]),
      };
      current.columns.push(String(row["columnName"]));
      current.referencedColumns.push(String(row["referencedColumn"]));
      foreignKeys.set(name, current);
    }
    return [...foreignKeys.values()];
  }

  async createForeignKey(table: string, foreignKey: ForeignKeyInfo): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    validateForeignKey(foreignKey);
    return this.executeSchemaQuery(
      `ALTER TABLE ${quoteMySQLIdentifier(table)} ADD CONSTRAINT ${quoteMySQLIdentifier(foreignKey.name)} FOREIGN KEY (${foreignKey.columns.map(quoteMySQLIdentifier).join(", ")}) REFERENCES ${quoteMySQLIdentifier(foreignKey.referencedTable)} (${foreignKey.referencedColumns.map(quoteMySQLIdentifier).join(", ")}) ON UPDATE ${foreignAction(foreignKey.onUpdate)} ON DELETE ${foreignAction(foreignKey.onDelete)}`
    );
  }

  async dropForeignKey(table: string, name: string): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    return this.executeSchemaQuery(
      `ALTER TABLE ${quoteMySQLIdentifier(table)} DROP FOREIGN KEY ${quoteMySQLIdentifier(name)}`
    );
  }

  async getTableData(
    table: string,
    page: number = 1,
    perPage: number = 50,
    sort?: string,
    order?: string,
    filters: Record<string, string> = {}
  ): Promise<{ rows: Record<string, unknown>[]; total: number; fields: string[] }> {
    const p = await this.getPool();
    const columns = await this.getTableStructure(table);
    const columnNames = new Set(columns.map((column) => column.name));
    const activeFilters = Object.entries(filters)
      .filter(([column, value]) => columnNames.has(column) && value.length > 0);
    const where = activeFilters.length
      ? ` WHERE ${activeFilters.map(([column]) => `CAST(${quoteMySQLIdentifier(column)} AS CHAR) LIKE ?`).join(" AND ")}`
      : "";
    const values = activeFilters.map(([, value]) => `%${value}%`);

    const [countResult] = await p.query(
      `SELECT COUNT(*) as total FROM ${quoteMySQLIdentifier(table)}${where}`,
      values
    );
    const total = Number((countResult as Record<string, unknown>[])[0]!["total"]);

    const offset = (page - 1) * perPage;
    let query = `SELECT * FROM ${quoteMySQLIdentifier(table)}${where}`;
    if (sort) {
      const dir = order === "desc" ? "DESC" : "ASC";
      query += ` ORDER BY ${quoteMySQLIdentifier(sort)} ${dir}`;
    }
    query += ` LIMIT ${perPage} OFFSET ${offset}`;

    const [rows] = await p.query(query, values);
    const dataRows = rows as Record<string, unknown>[];
    const fields = columns.map((column) => column.name);

    return { rows: dataRows, total, fields };
  }

  async getTableRows(table: string): Promise<Record<string, unknown>[]> {
    const p = await this.getPool();
    const [rows] = await p.query(`SELECT * FROM ${quoteMySQLIdentifier(table)}`);
    return rows as Record<string, unknown>[];
  }

  async getRow(
    table: string,
    where: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> {
    const keys = Object.keys(where);
    if (keys.length === 0) throw new Error("A row selector is required");
    const p = await this.getPool();
    const clauses = keys.map((key) => `${quoteMySQLIdentifier(key)} = ?`).join(" AND ");
    const [rows] = await p.query(
      `SELECT * FROM ${quoteMySQLIdentifier(table)} WHERE ${clauses} LIMIT 1`,
      Object.values(where)
    );
    return (rows as Record<string, unknown>[])[0] ?? null;
  }

  async executeQuery(sql: string, options?: QueryExecutionOptions): Promise<QueryResult> {
    const p = await this.getPool();
    const queryId = options?.queryId ?? randomUUID();
    if (this.activeQueries.has(queryId)) {
      return {
        fields: [],
        rows: [],
        message: "Error: A query with this ID is already running",
      };
    }
    const connection = await p.getConnection();
    const timeoutMs = normalizeTimeout(options?.timeoutMs ?? this.currentConnection?.queryTimeoutMs);
    const active = {
      connection,
      threadId: connection.threadId,
      cancelled: false,
      timedOut: false,
    };
    this.activeQueries.set(queryId, active);
    const timeout = timeoutMs
      ? setTimeout(() => {
        active.timedOut = true;
        void this.interruptActiveQuery(queryId);
      }, timeoutMs)
      : null;

    try {
      if (this.currentConnection?.readOnly) assertSqlReadOnly(sql);
      const [result, fields] = await connection.query(sql);

      if (Array.isArray(result)) {
        const rows = result as Record<string, unknown>[];
        const fieldNames = fields
          ? (fields as mysql.FieldPacket[]).map((f) => ({
            name: f.name,
            type: String(f.type ?? ""),
            nullable: true,
            key: "",
            defaultValue: null,
            extra: "",
          }))
          : [];
        return { fields: fieldNames, rows };
      } else {
        const r = result as mysql.ResultSetHeader;
        return {
          fields: [],
          rows: [],
          affectedRows: r.affectedRows,
          message: `Query OK, ${r.affectedRows} row(s) affected`,
        };
      }
    } catch (err: unknown) {
      const msg = active.cancelled
        ? "Query cancelled"
        : active.timedOut
          ? `Query timed out after ${timeoutMs} ms`
          : err instanceof Error ? err.message : String(err);
      return {
        fields: [],
        rows: [],
        message: `Error: ${msg}`,
      };
    } finally {
      if (timeout) clearTimeout(timeout);
      this.activeQueries.delete(queryId);
      connection.release();
    }
  }

  async cancelQuery(queryId: string): Promise<boolean> {
    const active = this.activeQueries.get(queryId);
    if (!active) return false;
    active.cancelled = true;
    await this.interruptActiveQuery(queryId);
    return true;
  }

  private async interruptActiveQuery(queryId: string): Promise<void> {
    const active = this.activeQueries.get(queryId);
    if (!active) return;
    try {
      const p = await this.getPool();
      await p.query(`KILL QUERY ${active.threadId}`);
    } catch {
      active.connection.destroy();
    }
  }

  async insertRow(
    table: string,
    data: Record<string, unknown>
  ): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    const p = await this.getPool();
    const keys = Object.keys(data);
    if (keys.length === 0) throw new Error("At least one value is required");
    const placeholders = keys.map(() => "?").join(", ");
    const values = keys.map((k) => data[k]);
    const columns = keys.map(quoteMySQLIdentifier).join(", ");
    const sql = `INSERT INTO ${quoteMySQLIdentifier(table)} (${columns}) VALUES (${placeholders})`;
    const [result] = await p.query(sql, values);
    const r = result as mysql.ResultSetHeader;
    return {
      fields: [],
      rows: [],
      affectedRows: r.affectedRows,
      message: `Inserted ${r.affectedRows} row(s)`,
    };
  }

  async updateRow(
    table: string,
    data: Record<string, unknown>,
    where: Record<string, unknown>
  ): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    const p = await this.getPool();
    if (Object.keys(data).length === 0) throw new Error("At least one value is required");
    if (Object.keys(where).length === 0) throw new Error("A row selector is required");
    const setClauses = Object.keys(data)
      .map((k) => `${quoteMySQLIdentifier(k)} = ?`)
      .join(", ");
    const whereClauses = Object.keys(where)
      .map((k) => `${quoteMySQLIdentifier(k)} = ?`)
      .join(" AND ");
    const values = [...Object.values(data), ...Object.values(where)];
    const sql = `UPDATE ${quoteMySQLIdentifier(table)} SET ${setClauses} WHERE ${whereClauses}`;
    const [result] = await p.query(sql, values);
    const r = result as mysql.ResultSetHeader;
    return {
      fields: [],
      rows: [],
      affectedRows: r.affectedRows,
      message: `Updated ${r.affectedRows} row(s)`,
    };
  }

  async deleteRow(
    table: string,
    where: Record<string, unknown>
  ): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    const p = await this.getPool();
    if (Object.keys(where).length === 0) throw new Error("A row selector is required");
    const whereClauses = Object.keys(where)
      .map((k) => `${quoteMySQLIdentifier(k)} = ?`)
      .join(" AND ");
    const values = Object.values(where);
    const sql = `DELETE FROM ${quoteMySQLIdentifier(table)} WHERE ${whereClauses}`;
    const [result] = await p.query(sql, values);
    const r = result as mysql.ResultSetHeader;
    return {
      fields: [],
      rows: [],
      affectedRows: r.affectedRows,
      message: `Deleted ${r.affectedRows} row(s)`,
    };
  }

  async dropTable(table: string): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    return this.executeQuery(`DROP TABLE ${quoteMySQLIdentifier(table)}`);
  }

  async truncateTable(table: string): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    return this.executeQuery(`TRUNCATE TABLE ${quoteMySQLIdentifier(table)}`);
  }

  async createDatabase(name: string): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    return this.executeQuery(`CREATE DATABASE ${quoteMySQLIdentifier(name)}`);
  }

  async dropDatabase(name: string): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    return this.executeQuery(`DROP DATABASE ${quoteMySQLIdentifier(name)}`);
  }

  async createTable(
    table: string,
    columns: { name: string; type: string; nullable: boolean; primary: boolean; autoIncrement: boolean; defaultValue?: string }[]
  ): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    const columnDefs = columns.map((col) => {
      let def = `${quoteMySQLIdentifier(col.name)} ${col.type}`;
      if (!col.nullable) def += " NOT NULL";
      if (col.autoIncrement) def += " AUTO_INCREMENT";
      if (col.defaultValue) def += ` DEFAULT ${col.defaultValue}`;
      return def;
    });

    const primaryKeys = columns.filter((c) => c.primary).map((c) => c.name);
    if (primaryKeys.length > 0) {
      columnDefs.push(`PRIMARY KEY (${primaryKeys.map(quoteMySQLIdentifier).join(", ")})`);
    }

    const sql = `CREATE TABLE ${quoteMySQLIdentifier(table)} (\n  ${columnDefs.join(",\n  ")}\n)`;
    console.log("Creating table with SQL:", sql);
    const result = await this.executeQuery(sql);
    console.log("Create table result:", result);
    return result;
  }

  async exportTable(table: string, structureOnly: boolean = false): Promise<string> {
    const p = await this.getPool();

    const quotedTable = quoteMySQLIdentifier(table);
    const [createRows] = await p.query(`SHOW CREATE TABLE ${quotedTable}`);
    const createTableSQL = (createRows as any[])[0]["Create Table"];

    let dump = `-- Table: ${table}\n`;
    dump += `-- Generated: ${new Date().toISOString()}\n`;
    dump += structureOnly ? `-- Export: Structure Only\n\n` : `-- Export: Structure and Data\n\n`;
    dump += `DROP TABLE IF EXISTS ${quotedTable};\n`;
    dump += createTableSQL + ";\n\n";

    if (!structureOnly) {
      const [rows] = await p.query(`SELECT * FROM ${quotedTable}`);
      const data = rows as Record<string, unknown>[];

      if (data.length > 0) {
        const columns = Object.keys(data[0]!);
        dump += `INSERT INTO ${quotedTable} (${columns.map(quoteMySQLIdentifier).join(", ")}) VALUES\n`;

        const values = data.map((row) => {
          const vals = columns.map((col) => {
            const val = row[col];
            if (val === null) return "NULL";
            if (typeof val === "number") return String(val);
            return `'${String(val).replace(/'/g, "\\'")}'`;
          });
          return `  (${vals.join(", ")})`;
        });

        dump += values.join(",\n") + ";\n";
      }
    }

    return dump;
  }

  async importSQL(sql: string): Promise<QueryResult> {
    assertWritable(this.currentConnection?.readOnly);
    const p = await this.getPool();
    const statements = splitSqlStatements(sql);

    let affectedRows = 0;
    for (const [index, statement] of statements.entries()) {
      try {
        const [result] = await p.query(statement);
        if ((result as mysql.ResultSetHeader).affectedRows) {
          affectedRows += (result as mysql.ResultSetHeader).affectedRows;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Import stopped at statement ${index + 1} of ${statements.length}: ${message}`);
      }
    }

    return {
      fields: [],
      rows: [],
      affectedRows,
      message: `Executed ${statements.length} statement(s), affected ${affectedRows} row(s)`,
    };
  }

  async exportDatabase(structureOnly: boolean = false): Promise<string> {
    if (!this.currentDatabase) throw new Error("No database selected");

    let dump = `-- Database: ${this.currentDatabase}\n`;
    dump += `-- Generated: ${new Date().toISOString()}\n`;
    dump += structureOnly ? `-- Export: Structure Only\n\n` : `-- Export: Structure and Data\n\n`;
    const quotedDatabase = quoteMySQLIdentifier(this.currentDatabase);
    dump += `CREATE DATABASE IF NOT EXISTS ${quotedDatabase};\n`;
    dump += `USE ${quotedDatabase};\n\n`;

    const tables = await this.listTables();

    for (const table of tables) {
      const tableDump = await this.exportTable(table.name, structureOnly);
      dump += tableDump + "\n\n";
    }

    return dump;
  }
}

function normalizeTimeout(value: number | undefined): number | undefined {
  if (!value || !Number.isFinite(value)) return undefined;
  return Math.min(300_000, Math.max(100, Math.round(value)));
}

function mysqlColumnDefinition(column: ColumnDefinition): string {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?(?:\s+UNSIGNED)?$/i.test(column.type.trim())) {
    throw new Error("Invalid column type");
  }
  let sql = `${quoteMySQLIdentifier(column.name)} ${column.type.trim()}`;
  sql += column.nullable ? " NULL" : " NOT NULL";
  if (column.defaultValue?.trim()) sql += ` DEFAULT ${validatedDefault(column.defaultValue)}`;
  return sql;
}

function validatedDefault(value: string): string {
  const normalized = value.trim();
  if (!/^(?:NULL|[-+]?\d+(?:\.\d+)?|'(?:''|[^'])*'|"(?:[^"]|"")*"|CURRENT_(?:TIME|DATE|TIMESTAMP)(?:\(\))?)$/i.test(normalized)) {
    throw new Error("Invalid default value");
  }
  return normalized;
}

function foreignAction(action: string): string {
  const normalized = action.trim().toUpperCase();
  if (!["NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"].includes(normalized)) {
    throw new Error("Invalid foreign-key action");
  }
  return normalized;
}

function validateForeignKey(foreignKey: ForeignKeyInfo): void {
  if (
    foreignKey.columns.length === 0
    || foreignKey.columns.length !== foreignKey.referencedColumns.length
  ) {
    throw new Error("Foreign-key columns must have matching referenced columns");
  }
}
