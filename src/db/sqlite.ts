// ============================================================
// Nodamin - SQLite Database Driver
// ============================================================

import Database from "better-sqlite3";
import path from "node:path";
import type { DatabaseDriver } from "./driver.js";
import type { DbConnection, QueryResult, ColumnInfo, TableInfo } from "../types.js";

export class SQLiteDriver implements DatabaseDriver {
    private db: Database.Database | null = null;
    private currentConnection: DbConnection | null = null;
    private dbName: string | null = null;

    connect(conn: DbConnection): void {
        if (this.db) {
            try { this.db.close(); } catch { }
        }
        const filePath = conn.filePath ?? ":memory:";
        this.db = new Database(filePath);
        this.db.pragma("journal_mode = WAL");
        this.currentConnection = conn;
        this.dbName = path.basename(filePath, path.extname(filePath));
    }

    disconnect(): void {
        if (this.db) {
            try { this.db.close(); } catch { }
            this.db = null;
        }
        this.currentConnection = null;
        this.dbName = null;
    }

    getConnection(): DbConnection | null {
        return this.currentConnection;
    }

    getCurrentDatabase(): string | null {
        return this.dbName;
    }

    setCurrentDatabase(_db: string | null): void {
        // SQLite is single-file = single database, no-op
    }

    private getDb(): Database.Database {
        if (!this.db) throw new Error("Not connected to database");
        return this.db;
    }

    async testConnection(conn: DbConnection): Promise<boolean> {
        try {
            const filePath = conn.filePath ?? ":memory:";
            const testDb = new Database(filePath);
            testDb.pragma("journal_mode = WAL");
            testDb.close();
            return true;
        } catch (err) {
            console.error("[SQLite testConnection Error]:", err);
            return false;
        }
    }

    async listDatabases(): Promise<string[]> {
        // SQLite = 1 file = 1 database
        if (this.dbName) {
            return [this.dbName];
        }
        return [];
    }

    async listTables(): Promise<TableInfo[]> {
        const db = this.getDb();
        const rows = db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
        ).all() as { name: string }[];

        return rows.map((r) => {
            // Get row count
            let rowCount = 0;
            try {
                const countResult = db.prepare(`SELECT COUNT(*) as cnt FROM "${r.name}"`).get() as { cnt: number };
                rowCount = countResult.cnt;
            } catch { }

            return {
                name: r.name,
                engine: "SQLite",
                rows: rowCount,
                size: "-",
                collation: "-",
            };
        });
    }

    async getTableStructure(table: string): Promise<ColumnInfo[]> {
        const db = this.getDb();
        const rows = db.prepare(`PRAGMA table_info("${table}")`).all() as {
            cid: number;
            name: string;
            type: string;
            notnull: number;
            dflt_value: string | null;
            pk: number;
        }[];

        return rows.map((r) => ({
            name: r.name,
            type: r.type || "TEXT",
            nullable: r.notnull === 0,
            key: r.pk > 0 ? "PRI" : "",
            defaultValue: r.dflt_value,
            extra: this.isAutoIncrement(table, r.name, r.pk) ? "auto_increment" : "",
        }));
    }

    private isAutoIncrement(table: string, _column: string, pk: number): boolean {
        if (pk === 0) return false;
        const db = this.getDb();
        try {
            const sql = db.prepare(
                `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`
            ).get(table) as { sql: string } | undefined;
            if (sql?.sql) {
                return /AUTOINCREMENT/i.test(sql.sql) ||
                    (/INTEGER\s+PRIMARY\s+KEY/i.test(sql.sql) && pk === 1);
            }
        } catch { }
        return false;
    }

    async getTableData(
        table: string,
        page: number = 1,
        perPage: number = 50,
        sort?: string,
        order?: string
    ): Promise<{ rows: Record<string, unknown>[]; total: number; fields: string[] }> {
        const db = this.getDb();

        const countResult = db.prepare(`SELECT COUNT(*) as total FROM "${table}"`).get() as { total: number };
        const total = countResult.total;

        const offset = (page - 1) * perPage;
        let query = `SELECT * FROM "${table}"`;
        if (sort) {
            const dir = order === "desc" ? "DESC" : "ASC";
            query += ` ORDER BY "${sort}" ${dir}`;
        }
        query += ` LIMIT ${perPage} OFFSET ${offset}`;

        const rows = db.prepare(query).all() as Record<string, unknown>[];
        const fields = rows.length > 0 ? Object.keys(rows[0]!) : [];

        return { rows, total, fields };
    }

    async executeQuery(sql: string): Promise<QueryResult> {
        const db = this.getDb();
        try {
            const trimmed = sql.trim();
            const isSelect = /^\s*(SELECT|PRAGMA|EXPLAIN)/i.test(trimmed);

            if (isSelect) {
                const rows = db.prepare(trimmed).all() as Record<string, unknown>[];
                const fields = rows.length > 0
                    ? Object.keys(rows[0]!).map((name) => ({
                        name,
                        type: "",
                        nullable: true,
                        key: "",
                        defaultValue: null,
                        extra: "",
                    }))
                    : [];
                return { fields, rows };
            } else {
                const result = db.prepare(trimmed).run();
                return {
                    fields: [],
                    rows: [],
                    affectedRows: result.changes,
                    message: `Query OK, ${result.changes} row(s) affected`,
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
        const db = this.getDb();
        const keys = Object.keys(data);
        const placeholders = keys.map(() => "?").join(", ");
        const values = keys.map((k) => data[k]);
        const sql = `INSERT INTO "${table}" ("${keys.join('", "')}") VALUES (${placeholders})`;
        const result = db.prepare(sql).run(...values);
        return {
            fields: [],
            rows: [],
            affectedRows: result.changes,
            message: `Inserted ${result.changes} row(s)`,
        };
    }

    async updateRow(
        table: string,
        data: Record<string, unknown>,
        where: Record<string, unknown>
    ): Promise<QueryResult> {
        const db = this.getDb();
        const setClauses = Object.keys(data)
            .map((k) => `"${k}" = ?`)
            .join(", ");
        const whereClauses = Object.keys(where)
            .map((k) => `"${k}" = ?`)
            .join(" AND ");
        const values = [...Object.values(data), ...Object.values(where)];
        const sql = `UPDATE "${table}" SET ${setClauses} WHERE ${whereClauses}`;
        const result = db.prepare(sql).run(...values);
        return {
            fields: [],
            rows: [],
            affectedRows: result.changes,
            message: `Updated ${result.changes} row(s)`,
        };
    }

    async deleteRow(
        table: string,
        where: Record<string, unknown>
    ): Promise<QueryResult> {
        const db = this.getDb();
        const whereClauses = Object.keys(where)
            .map((k) => `"${k}" = ?`)
            .join(" AND ");
        const values = Object.values(where);
        const sql = `DELETE FROM "${table}" WHERE ${whereClauses}`;
        const result = db.prepare(sql).run(...values);
        return {
            fields: [],
            rows: [],
            affectedRows: result.changes,
            message: `Deleted ${result.changes} row(s)`,
        };
    }

    async dropTable(table: string): Promise<QueryResult> {
        return this.executeQuery(`DROP TABLE "${table}"`);
    }

    async truncateTable(table: string): Promise<QueryResult> {
        // SQLite doesn't have TRUNCATE, use DELETE
        return this.executeQuery(`DELETE FROM "${table}"`);
    }

    async createDatabase(_name: string): Promise<QueryResult> {
        return {
            fields: [],
            rows: [],
            message: "SQLite does not support creating databases (each file is a database)",
        };
    }

    async dropDatabase(_name: string): Promise<QueryResult> {
        return {
            fields: [],
            rows: [],
            message: "SQLite does not support dropping databases (delete the file instead)",
        };
    }

    async createTable(
        table: string,
        columns: { name: string; type: string; nullable: boolean; primary: boolean; autoIncrement: boolean; defaultValue?: string }[]
    ): Promise<QueryResult> {
        const columnDefs = columns.map((col) => {
            let def = `"${col.name}" ${col.type}`;
            if (col.primary && col.autoIncrement) {
                // SQLite: INTEGER PRIMARY KEY is auto-increment by default
                def = `"${col.name}" INTEGER PRIMARY KEY AUTOINCREMENT`;
                if (!col.nullable) def += "";
                return def;
            }
            if (!col.nullable) def += " NOT NULL";
            if (col.defaultValue) def += ` DEFAULT ${col.defaultValue}`;
            return def;
        });

        // Add PRIMARY KEY constraint for non-autoincrement primaries
        const primaryKeys = columns
            .filter((c) => c.primary && !c.autoIncrement)
            .map((c) => c.name);
        if (primaryKeys.length > 0) {
            columnDefs.push(`PRIMARY KEY ("${primaryKeys.join('", "')}")`);
        }

        const sql = `CREATE TABLE "${table}" (\n  ${columnDefs.join(",\n  ")}\n)`;
        console.log("Creating table with SQL:", sql);
        const result = await this.executeQuery(sql);
        console.log("Create table result:", result);
        return result;
    }

    async exportTable(table: string): Promise<string> {
        const db = this.getDb();

        // Get CREATE TABLE statement
        const tableInfo = db.prepare(
            `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`
        ).get(table) as { sql: string } | undefined;

        const createTableSQL = tableInfo?.sql ?? `-- Could not get CREATE TABLE for ${table}`;

        const rows = db.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];

        let dump = `-- Table: ${table}\n`;
        dump += `-- Generated: ${new Date().toISOString()}\n\n`;
        dump += `DROP TABLE IF EXISTS "${table}";\n`;
        dump += createTableSQL + ";\n\n";

        if (rows.length > 0) {
            const columns = Object.keys(rows[0]!);
            dump += `INSERT INTO "${table}" ("${columns.join('", "')}") VALUES\n`;

            const values = rows.map((row) => {
                const vals = columns.map((col) => {
                    const val = row[col];
                    if (val === null) return "NULL";
                    if (typeof val === "number") return String(val);
                    return `'${String(val).replace(/'/g, "''")}'`;
                });
                return `  (${vals.join(", ")})`;
            });

            dump += values.join(",\n") + ";\n";
        }

        return dump;
    }

    async importSQL(sql: string): Promise<QueryResult> {
        const db = this.getDb();
        const statements = sql
            .split(";")
            .map((s) => s.trim())
            .filter((s) => s && !s.startsWith("--"));

        let affectedRows = 0;
        for (const stmt of statements) {
            try {
                const result = db.prepare(stmt).run();
                affectedRows += result.changes;
            } catch {
                // Some statements like CREATE TABLE return 0 changes
            }
        }

        return {
            fields: [],
            rows: [],
            affectedRows,
            message: `Executed ${statements.length} statement(s), affected ${affectedRows} row(s)`,
        };
    }

    async exportDatabase(): Promise<string> {
        const dbName = this.dbName ?? "database";

        let dump = `-- Database: ${dbName}\n`;
        dump += `-- Generated: ${new Date().toISOString()}\n\n`;

        const tables = await this.listTables();

        for (const table of tables) {
            const tableDump = await this.exportTable(table.name);
            dump += tableDump + "\n\n";
        }

        return dump;
    }
}
