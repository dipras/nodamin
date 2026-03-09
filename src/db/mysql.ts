// ============================================================
// Nodamin - MySQL Database Driver
// ============================================================

import mysql from "mysql2/promise";
import type { DatabaseDriver } from "./driver.js";
import type { DbConnection, QueryResult, ColumnInfo, TableInfo } from "../types.js";

export class MySQLDriver implements DatabaseDriver {
  private pool: mysql.Pool | null = null;
  private currentConnection: DbConnection | null = null;
  private currentDatabase: string | null = null;

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
    if (this.currentDatabase) {
      poolOpts.database = this.currentDatabase;
    }
    this.pool = mysql.createPool(poolOpts);
    this.currentConnection = conn;
  }

  disconnect(): void {
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

  async testConnection(conn: DbConnection): Promise<boolean> {
    try {
      const testPool = mysql.createPool({
        host: conn.host ?? "localhost",
        port: conn.port ?? 3306,
        user: conn.user ?? "root",
        password: conn.password ?? "",
        connectionLimit: 1,
      });
      await testPool.query("SELECT 1");
      await testPool.end();
      return true;
    } catch {
      return false;
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

  async getTableData(
    table: string,
    page: number = 1,
    perPage: number = 50,
    sort?: string,
    order?: string
  ): Promise<{ rows: Record<string, unknown>[]; total: number; fields: string[] }> {
    const p = await this.getPool();

    const [countResult] = await p.query(
      `SELECT COUNT(*) as total FROM \`${table}\``
    );
    const total = Number((countResult as Record<string, unknown>[])[0]!["total"]);

    const offset = (page - 1) * perPage;
    let query = `SELECT * FROM \`${table}\``;
    if (sort) {
      const dir = order === "desc" ? "DESC" : "ASC";
      query += ` ORDER BY \`${sort}\` ${dir}`;
    }
    query += ` LIMIT ${perPage} OFFSET ${offset}`;

    const [rows] = await p.query(query);
    const dataRows = rows as Record<string, unknown>[];
    const fields = dataRows.length > 0 ? Object.keys(dataRows[0]!) : [];

    return { rows: dataRows, total, fields };
  }

  async executeQuery(sql: string): Promise<QueryResult> {
    const p = await this.getPool();
    try {
      const [result, fields] = await p.query(sql);

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
      const msg = err instanceof Error ? err.message : String(err);
      return {
        fields: [],
        rows: [],
        message: `Error: ${msg}`,
      };
    }
  }

  async insertRow(
    table: string,
    data: Record<string, unknown>
  ): Promise<QueryResult> {
    const p = await this.getPool();
    const keys = Object.keys(data);
    const placeholders = keys.map(() => "?").join(", ");
    const values = keys.map((k) => data[k]);
    const sql = `INSERT INTO \`${table}\` (\`${keys.join("`, `")}\`) VALUES (${placeholders})`;
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
    const p = await this.getPool();
    const setClauses = Object.keys(data)
      .map((k) => `\`${k}\` = ?`)
      .join(", ");
    const whereClauses = Object.keys(where)
      .map((k) => `\`${k}\` = ?`)
      .join(" AND ");
    const values = [...Object.values(data), ...Object.values(where)];
    const sql = `UPDATE \`${table}\` SET ${setClauses} WHERE ${whereClauses}`;
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
    const p = await this.getPool();
    const whereClauses = Object.keys(where)
      .map((k) => `\`${k}\` = ?`)
      .join(" AND ");
    const values = Object.values(where);
    const sql = `DELETE FROM \`${table}\` WHERE ${whereClauses}`;
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
    return this.executeQuery(`DROP TABLE \`${table}\``);
  }

  async truncateTable(table: string): Promise<QueryResult> {
    return this.executeQuery(`TRUNCATE TABLE \`${table}\``);
  }

  async createDatabase(name: string): Promise<QueryResult> {
    return this.executeQuery(`CREATE DATABASE \`${name}\``);
  }

  async dropDatabase(name: string): Promise<QueryResult> {
    return this.executeQuery(`DROP DATABASE \`${name}\``);
  }

  async createTable(
    table: string,
    columns: { name: string; type: string; nullable: boolean; primary: boolean; autoIncrement: boolean; defaultValue?: string }[]
  ): Promise<QueryResult> {
    const columnDefs = columns.map((col) => {
      let def = `\`${col.name}\` ${col.type}`;
      if (!col.nullable) def += " NOT NULL";
      if (col.autoIncrement) def += " AUTO_INCREMENT";
      if (col.defaultValue) def += ` DEFAULT ${col.defaultValue}`;
      return def;
    });

    const primaryKeys = columns.filter((c) => c.primary).map((c) => c.name);
    if (primaryKeys.length > 0) {
      columnDefs.push(`PRIMARY KEY (\`${primaryKeys.join("`, `")}\`)`);
    }

    const sql = `CREATE TABLE \`${table}\` (\n  ${columnDefs.join(",\n  ")}\n)`;
    console.log("Creating table with SQL:", sql);
    const result = await this.executeQuery(sql);
    console.log("Create table result:", result);
    return result;
  }

  async exportTable(table: string, structureOnly: boolean = false): Promise<string> {
    const p = await this.getPool();

    const [createRows] = await p.query(`SHOW CREATE TABLE \`${table}\``);
    const createTableSQL = (createRows as any[])[0]["Create Table"];

    let dump = `-- Table: ${table}\n`;
    dump += `-- Generated: ${new Date().toISOString()}\n`;
    dump += structureOnly ? `-- Export: Structure Only\n\n` : `-- Export: Structure and Data\n\n`;
    dump += `DROP TABLE IF EXISTS \`${table}\`;\n`;
    dump += createTableSQL + ";\n\n";

    if (!structureOnly) {
      const [rows] = await p.query(`SELECT * FROM \`${table}\``);
      const data = rows as Record<string, unknown>[];

      if (data.length > 0) {
        const columns = Object.keys(data[0]!);
        dump += `INSERT INTO \`${table}\` (\`${columns.join("`, `")}\`) VALUES\n`;

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
    const p = await this.getPool();
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("--"));

    let affectedRows = 0;
    for (const stmt of statements) {
      const [result] = await p.query(stmt);
      if ((result as mysql.ResultSetHeader).affectedRows) {
        affectedRows += (result as mysql.ResultSetHeader).affectedRows;
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
    dump += `CREATE DATABASE IF NOT EXISTS \`${this.currentDatabase}\`;\n`;
    dump += `USE \`${this.currentDatabase}\`;\n\n`;

    const tables = await this.listTables();

    for (const table of tables) {
      const tableDump = await this.exportTable(table.name, structureOnly);
      dump += tableDump + "\n\n";
    }

    return dump;
  }
}
