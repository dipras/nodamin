// ============================================================
// Nodamin - SQLite Database Driver
// ============================================================

import Database from "better-sqlite3";
import path from "node:path";
import { unlinkSync } from "node:fs";
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
import { assertSqlReadOnly, assertWritable } from "./sql.js";

export function quoteSQLiteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
}

interface SQLiteColumn {
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
}

export class SQLiteDriver implements DatabaseDriver {
    private db: Database.Database | null = null;
    private currentConnection: DbConnection | null = null;
    private dbName: string | null = null;

    connect(conn: DbConnection): void {
        if (this.db) {
            try { this.db.close(); } catch { }
            this.cleanupTemporaryFile();
        }
        const filePath = conn.filePath ?? ":memory:";
        const options = conn.readOnly && filePath !== ":memory:"
            ? { readonly: true, fileMustExist: true }
            : undefined;
        this.db = new Database(filePath, options);
        this.db.pragma("foreign_keys = ON");
        if (!conn.readOnly) this.db.pragma("journal_mode = WAL");
        this.currentConnection = conn;
        this.dbName = path.basename(filePath, path.extname(filePath));
    }

    disconnect(): void {
        if (this.db) {
            try { this.db.close(); } catch { }
            this.db = null;
        }
        this.cleanupTemporaryFile();
        this.currentConnection = null;
        this.dbName = null;
    }

    private cleanupTemporaryFile(): void {
        const filePath = this.currentConnection?.temporaryFile
            ? this.currentConnection.filePath
            : undefined;
        if (!filePath || filePath === ":memory:") return;
        for (const candidate of [filePath, `${filePath}-wal`, `${filePath}-shm`]) {
            try { unlinkSync(candidate); } catch { }
        }
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
            const options = conn.readOnly && filePath !== ":memory:"
                ? { readonly: true, fileMustExist: true }
                : undefined;
            const testDb = new Database(filePath, options);
            if (!conn.readOnly) testDb.pragma("journal_mode = WAL");
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
                const countResult = db.prepare(`SELECT COUNT(*) as cnt FROM ${quoteSQLiteIdentifier(r.name)}`).get() as { cnt: number };
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
        const rows = db.prepare(`PRAGMA table_info(${quoteSQLiteIdentifier(table)})`).all() as {
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

    async addColumn(table: string, column: ColumnDefinition): Promise<QueryResult> {
        assertWritable(this.currentConnection?.readOnly);
        this.getDb().exec(
            `ALTER TABLE ${quoteSQLiteIdentifier(table)} ADD COLUMN ${sqliteColumnDefinition(column)}`
        );
        return schemaResult(`Added column ${column.name}`);
    }

    async modifyColumn(
        table: string,
        column: string,
        definition: ColumnDefinition
    ): Promise<QueryResult> {
        assertWritable(this.currentConnection?.readOnly);
        const currentColumns = this.sqliteColumns(table);
        if (!currentColumns.some(({ name }) => name === column)) {
            throw new Error(`Column "${column}" does not exist`);
        }
        const columns = currentColumns.map((current) =>
            current.name === column
                ? {
                    ...current,
                    name: definition.name,
                    type: validatedSQLiteType(definition.type),
                    notnull: definition.nullable ? 0 : 1,
                    dflt_value: definition.defaultValue?.trim()
                        ? validatedSQLiteDefault(definition.defaultValue)
                        : null,
                }
                : current
        );
        this.rebuildTable(table, columns, await this.listForeignKeys(table));
        return schemaResult(`Modified column ${column}`);
    }

    async renameColumn(table: string, column: string, newName: string): Promise<QueryResult> {
        assertWritable(this.currentConnection?.readOnly);
        this.getDb().exec(
            `ALTER TABLE ${quoteSQLiteIdentifier(table)} RENAME COLUMN ${quoteSQLiteIdentifier(column)} TO ${quoteSQLiteIdentifier(newName)}`
        );
        return schemaResult(`Renamed column ${column} to ${newName}`);
    }

    async dropColumn(table: string, column: string): Promise<QueryResult> {
        assertWritable(this.currentConnection?.readOnly);
        this.getDb().exec(
            `ALTER TABLE ${quoteSQLiteIdentifier(table)} DROP COLUMN ${quoteSQLiteIdentifier(column)}`
        );
        return schemaResult(`Dropped column ${column}`);
    }

    async listIndexes(table: string): Promise<IndexInfo[]> {
        const db = this.getDb();
        const rows = db.prepare(`PRAGMA index_list(${quoteSQLiteIdentifier(table)})`).all() as {
            name: string;
            unique: number;
            origin: string;
        }[];
        return rows.map((row) => ({
            name: row.name,
            unique: row.unique === 1,
            columns: (db.prepare(`PRAGMA index_info(${quoteSQLiteIdentifier(row.name)})`).all() as {
                name: string;
            }[]).map(({ name }) => name),
            primary: row.origin === "pk",
        }));
    }

    async createIndex(
        table: string,
        name: string,
        columns: string[],
        unique: boolean
    ): Promise<QueryResult> {
        assertWritable(this.currentConnection?.readOnly);
        if (columns.length === 0) throw new Error("Choose at least one index column");
        this.getDb().exec(
            `CREATE ${unique ? "UNIQUE " : ""}INDEX ${quoteSQLiteIdentifier(name)} ON ${quoteSQLiteIdentifier(table)} (${columns.map(quoteSQLiteIdentifier).join(", ")})`
        );
        return schemaResult(`Created index ${name}`);
    }

    async dropIndex(_table: string, name: string): Promise<QueryResult> {
        assertWritable(this.currentConnection?.readOnly);
        if (name.startsWith("sqlite_autoindex_")) {
            throw new Error("Implicit primary/unique indexes cannot be dropped directly");
        }
        this.getDb().exec(`DROP INDEX ${quoteSQLiteIdentifier(name)}`);
        return schemaResult(`Dropped index ${name}`);
    }

    async listForeignKeys(table: string): Promise<ForeignKeyInfo[]> {
        const rows = this.getDb()
            .prepare(`PRAGMA foreign_key_list(${quoteSQLiteIdentifier(table)})`)
            .all() as {
                id: number;
                seq: number;
                table: string;
                from: string;
                to: string;
                on_update: string;
                on_delete: string;
            }[];
        const foreignKeys = new Map<number, ForeignKeyInfo>();
        for (const row of rows) {
            const current = foreignKeys.get(row.id) ?? {
                name: `fk_${row.id}`,
                columns: [],
                referencedTable: row.table,
                referencedColumns: [],
                onUpdate: row.on_update,
                onDelete: row.on_delete,
            };
            current.columns.push(row.from);
            current.referencedColumns.push(row.to);
            foreignKeys.set(row.id, current);
        }
        return [...foreignKeys.values()];
    }

    async createForeignKey(table: string, foreignKey: ForeignKeyInfo): Promise<QueryResult> {
        assertWritable(this.currentConnection?.readOnly);
        validateSQLiteForeignKey(foreignKey);
        const foreignKeys = await this.listForeignKeys(table);
        foreignKeys.push(foreignKey);
        this.rebuildTable(table, this.sqliteColumns(table), foreignKeys);
        return schemaResult(`Created foreign key ${foreignKey.name}`);
    }

    async dropForeignKey(table: string, name: string): Promise<QueryResult> {
        assertWritable(this.currentConnection?.readOnly);
        const currentForeignKeys = await this.listForeignKeys(table);
        const foreignKeys = currentForeignKeys.filter((foreignKey) => foreignKey.name !== name);
        if (foreignKeys.length === currentForeignKeys.length) {
            throw new Error(`Foreign key "${name}" does not exist`);
        }
        this.rebuildTable(table, this.sqliteColumns(table), foreignKeys);
        return schemaResult(`Dropped foreign key ${name}`);
    }

    private sqliteColumns(table: string): SQLiteColumn[] {
        return this.getDb()
            .prepare(`PRAGMA table_info(${quoteSQLiteIdentifier(table)})`)
            .all() as SQLiteColumn[];
    }

    private rebuildTable(
        table: string,
        columns: SQLiteColumn[],
        foreignKeys: ForeignKeyInfo[]
    ): void {
        if (columns.length === 0) throw new Error("A table must keep at least one column");
        const db = this.getDb();
        const indexes = db.prepare(
            "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=?"
        ).all(table) as { name: string; sql: string | null }[];
        const indexMetadata = new Map(
            (db.prepare(`PRAGMA index_list(${quoteSQLiteIdentifier(table)})`).all() as {
                name: string;
                unique: number;
                origin: string;
            }[]).map((index) => [index.name, index])
        );
        const indexColumns = new Map(indexes.map((index) => [
            index.name,
            (db.prepare(`PRAGMA index_info(${quoteSQLiteIdentifier(index.name)})`).all() as {
                name: string;
            }[]).map(({ name }) => name),
        ]));
        const triggers = db.prepare(
            "SELECT sql FROM sqlite_master WHERE type='trigger' AND tbl_name=? AND sql IS NOT NULL"
        ).all(table) as { sql: string }[];
        const temporaryTable = `__nodamin_${randomUUID().replaceAll("-", "")}`;
        const primaryColumns = columns
            .filter(({ pk }) => pk > 0)
            .sort((left, right) => left.pk - right.pk);
        const definitions = columns.map((column) => {
            let definition = `${quoteSQLiteIdentifier(column.name)} ${validatedSQLiteType(column.type)}`;
            if (column.notnull) definition += " NOT NULL";
            if (column.dflt_value !== null) definition += ` DEFAULT ${column.dflt_value}`;
            return definition;
        });
        if (primaryColumns.length > 0) {
            definitions.push(
                `PRIMARY KEY (${primaryColumns.map(({ name }) => quoteSQLiteIdentifier(name)).join(", ")})`
            );
        }
        for (const foreignKey of foreignKeys) {
            validateSQLiteForeignKey(foreignKey);
            definitions.push(
                `CONSTRAINT ${quoteSQLiteIdentifier(foreignKey.name)} FOREIGN KEY (${foreignKey.columns.map(quoteSQLiteIdentifier).join(", ")}) REFERENCES ${quoteSQLiteIdentifier(foreignKey.referencedTable)} (${foreignKey.referencedColumns.map(quoteSQLiteIdentifier).join(", ")}) ON UPDATE ${sqliteForeignAction(foreignKey.onUpdate)} ON DELETE ${sqliteForeignAction(foreignKey.onDelete)}`
            );
        }
        const columnList = columns.map(({ name }) => quoteSQLiteIdentifier(name)).join(", ");

        db.pragma("foreign_keys = OFF");
        try {
            db.transaction(() => {
                db.exec(
                    `CREATE TABLE ${quoteSQLiteIdentifier(temporaryTable)} (${definitions.join(", ")})`
                );
                db.exec(
                    `INSERT INTO ${quoteSQLiteIdentifier(temporaryTable)} (${columnList}) SELECT ${columnList} FROM ${quoteSQLiteIdentifier(table)}`
                );
                db.exec(`DROP TABLE ${quoteSQLiteIdentifier(table)}`);
                db.exec(
                    `ALTER TABLE ${quoteSQLiteIdentifier(temporaryTable)} RENAME TO ${quoteSQLiteIdentifier(table)}`
                );
                for (const index of indexes) {
                    if (index.sql) {
                        db.exec(index.sql);
                        continue;
                    }
                    const metadata = indexMetadata.get(index.name);
                    if (!metadata || metadata.origin !== "u") continue;
                    const columnsToRestore = indexColumns.get(index.name) ?? [];
                    if (columnsToRestore.length > 0) {
                        const restoredName = `nodamin_unique_${randomUUID().slice(0, 8)}`;
                        db.exec(
                            `CREATE UNIQUE INDEX ${quoteSQLiteIdentifier(restoredName)} ON ${quoteSQLiteIdentifier(table)} (${columnsToRestore.map(quoteSQLiteIdentifier).join(", ")})`
                        );
                    }
                }
                for (const trigger of triggers) db.exec(trigger.sql);
            })();
        } finally {
            db.pragma("foreign_keys = ON");
        }
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
        order?: string,
        filters: Record<string, string> = {}
    ): Promise<{ rows: Record<string, unknown>[]; total: number; fields: string[] }> {
        const db = this.getDb();
        const columns = await this.getTableStructure(table);
        const columnNames = new Set(columns.map((column) => column.name));
        const activeFilters = Object.entries(filters)
            .filter(([column, value]) => columnNames.has(column) && value.length > 0);
        const where = activeFilters.length
            ? ` WHERE ${activeFilters.map(([column]) => `CAST(${quoteSQLiteIdentifier(column)} AS TEXT) LIKE ?`).join(" AND ")}`
            : "";
        const values = activeFilters.map(([, value]) => `%${value}%`);

        const countResult = db.prepare(
            `SELECT COUNT(*) as total FROM ${quoteSQLiteIdentifier(table)}${where}`
        ).get(...values) as { total: number };
        const total = countResult.total;

        const offset = (page - 1) * perPage;
        let query = `SELECT * FROM ${quoteSQLiteIdentifier(table)}${where}`;
        if (sort) {
            const dir = order === "desc" ? "DESC" : "ASC";
            query += ` ORDER BY ${quoteSQLiteIdentifier(sort)} ${dir}`;
        }
        query += ` LIMIT ${perPage} OFFSET ${offset}`;

        const rows = db.prepare(query).all(...values) as Record<string, unknown>[];
        const fields = columns.map((column) => column.name);

        return { rows, total, fields };
    }

    async getTableRows(table: string): Promise<Record<string, unknown>[]> {
        return this.getDb()
            .prepare(`SELECT * FROM ${quoteSQLiteIdentifier(table)}`)
            .all() as Record<string, unknown>[];
    }

    async getRow(
        table: string,
        where: Record<string, unknown>
    ): Promise<Record<string, unknown> | null> {
        const keys = Object.keys(where);
        if (keys.length === 0) throw new Error("A row selector is required");
        const clauses = keys.map((key) => `${quoteSQLiteIdentifier(key)} = ?`).join(" AND ");
        return this.getDb()
            .prepare(`SELECT * FROM ${quoteSQLiteIdentifier(table)} WHERE ${clauses} LIMIT 1`)
            .get(...Object.values(where)) as Record<string, unknown> | undefined ?? null;
    }

    async executeQuery(sql: string, _options?: QueryExecutionOptions): Promise<QueryResult> {
        const db = this.getDb();
        try {
            if (this.currentConnection?.readOnly) assertSqlReadOnly(sql);
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

    async cancelQuery(_queryId: string): Promise<boolean> {
        // better-sqlite3 executes on the current thread, so there is no independently
        // running query that another HTTP request can interrupt.
        return false;
    }

    async insertRow(
        table: string,
        data: Record<string, unknown>
    ): Promise<QueryResult> {
        assertWritable(this.currentConnection?.readOnly);
        const db = this.getDb();
        const keys = Object.keys(data);
        if (keys.length === 0) throw new Error("At least one value is required");
        const placeholders = keys.map(() => "?").join(", ");
        const values = keys.map((k) => data[k]);
        const sql = `INSERT INTO ${quoteSQLiteIdentifier(table)} (${keys.map(quoteSQLiteIdentifier).join(", ")}) VALUES (${placeholders})`;
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
        assertWritable(this.currentConnection?.readOnly);
        const db = this.getDb();
        if (Object.keys(data).length === 0) throw new Error("At least one value is required");
        if (Object.keys(where).length === 0) throw new Error("A row selector is required");
        const setClauses = Object.keys(data)
            .map((k) => `${quoteSQLiteIdentifier(k)} = ?`)
            .join(", ");
        const whereClauses = Object.keys(where)
            .map((k) => `${quoteSQLiteIdentifier(k)} = ?`)
            .join(" AND ");
        const values = [...Object.values(data), ...Object.values(where)];
        const sql = `UPDATE ${quoteSQLiteIdentifier(table)} SET ${setClauses} WHERE ${whereClauses}`;
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
        assertWritable(this.currentConnection?.readOnly);
        const db = this.getDb();
        if (Object.keys(where).length === 0) throw new Error("A row selector is required");
        const whereClauses = Object.keys(where)
            .map((k) => `${quoteSQLiteIdentifier(k)} = ?`)
            .join(" AND ");
        const values = Object.values(where);
        const sql = `DELETE FROM ${quoteSQLiteIdentifier(table)} WHERE ${whereClauses}`;
        const result = db.prepare(sql).run(...values);
        return {
            fields: [],
            rows: [],
            affectedRows: result.changes,
            message: `Deleted ${result.changes} row(s)`,
        };
    }

    async dropTable(table: string): Promise<QueryResult> {
        assertWritable(this.currentConnection?.readOnly);
        return this.executeQuery(`DROP TABLE ${quoteSQLiteIdentifier(table)}`);
    }

    async truncateTable(table: string): Promise<QueryResult> {
        assertWritable(this.currentConnection?.readOnly);
        // SQLite doesn't have TRUNCATE, use DELETE
        return this.executeQuery(`DELETE FROM ${quoteSQLiteIdentifier(table)}`);
    }

    async createDatabase(_name: string): Promise<QueryResult> {
        assertWritable(this.currentConnection?.readOnly);
        return {
            fields: [],
            rows: [],
            message: "SQLite does not support creating databases (each file is a database)",
        };
    }

    async dropDatabase(_name: string): Promise<QueryResult> {
        assertWritable(this.currentConnection?.readOnly);
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
        assertWritable(this.currentConnection?.readOnly);
        const columnDefs = columns.map((col) => {
            let def = `${quoteSQLiteIdentifier(col.name)} ${col.type}`;
            if (col.primary && col.autoIncrement) {
                // SQLite: INTEGER PRIMARY KEY is auto-increment by default
                def = `${quoteSQLiteIdentifier(col.name)} INTEGER PRIMARY KEY AUTOINCREMENT`;
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
            columnDefs.push(`PRIMARY KEY (${primaryKeys.map(quoteSQLiteIdentifier).join(", ")})`);
        }

        const sql = `CREATE TABLE ${quoteSQLiteIdentifier(table)} (\n  ${columnDefs.join(",\n  ")}\n)`;
        console.log("Creating table with SQL:", sql);
        const result = await this.executeQuery(sql);
        console.log("Create table result:", result);
        return result;
    }

    async exportTable(table: string, structureOnly: boolean = false): Promise<string> {
        const db = this.getDb();

        // Get CREATE TABLE statement
        const tableInfo = db.prepare(
            `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`
        ).get(table) as { sql: string } | undefined;

        const createTableSQL = tableInfo?.sql ?? `-- Could not get CREATE TABLE for ${table}`;

        let dump = `-- Table: ${table}\n`;
        dump += `-- Generated: ${new Date().toISOString()}\n`;
        dump += structureOnly ? `-- Export: Structure Only\n\n` : `-- Export: Structure and Data\n\n`;
        const quotedTable = quoteSQLiteIdentifier(table);
        dump += `DROP TABLE IF EXISTS ${quotedTable};\n`;
        dump += createTableSQL + ";\n\n";

        if (!structureOnly) {
            const rows = db.prepare(`SELECT * FROM ${quotedTable}`).all() as Record<string, unknown>[];

            if (rows.length > 0) {
                const columns = Object.keys(rows[0]!);
                dump += `INSERT INTO ${quotedTable} (${columns.map(quoteSQLiteIdentifier).join(", ")}) VALUES\n`;

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
        }

        return dump;
    }

    async importSQL(sql: string): Promise<QueryResult> {
        assertWritable(this.currentConnection?.readOnly);
        const db = this.getDb();
        const before = db.prepare("SELECT total_changes() AS count").get() as { count: number };
        const managesOwnTransaction = hasExplicitTransaction(sql);
        try {
            if (managesOwnTransaction) {
                db.exec(sql);
            } else {
                db.transaction(() => db.exec(sql))();
            }
        } catch (err: unknown) {
            if (db.inTransaction) {
                try { db.exec("ROLLBACK"); } catch { }
            }
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(managesOwnTransaction
                ? `Import failed; the script controlled its own transaction: ${message}`
                : `Import failed and was rolled back: ${message}`);
        }
        const after = db.prepare("SELECT total_changes() AS count").get() as { count: number };
        const affectedRows = after.count - before.count;

        return {
            fields: [],
            rows: [],
            affectedRows,
            message: `Import completed, affected ${affectedRows} row(s)`,
        };
    }

    async exportDatabase(structureOnly: boolean = false): Promise<string> {
        const dbName = this.dbName ?? "database";

        let dump = `-- Database: ${dbName}\n`;
        dump += `-- Generated: ${new Date().toISOString()}\n`;
        dump += structureOnly ? `-- Export: Structure Only\n\n` : `-- Export: Structure and Data\n\n`;

        const tables = await this.listTables();

        for (const table of tables) {
            const tableDump = await this.exportTable(table.name, structureOnly);
            dump += tableDump + "\n\n";
        }

        return dump;
    }
}

function hasExplicitTransaction(sql: string): boolean {
    return /^\s*BEGIN(?:\s+(?:DEFERRED|IMMEDIATE|EXCLUSIVE))?(?:\s+TRANSACTION)?\s*;/im.test(sql);
}

function validatedSQLiteType(type: string): string {
    const normalized = type.trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_ ]*(?:\(\s*\d+(?:\s*,\s*\d+)?\s*\))?$/.test(normalized)) {
        throw new Error("Invalid column type");
    }
    return normalized;
}

function sqliteColumnDefinition(column: ColumnDefinition): string {
    let sql = `${quoteSQLiteIdentifier(column.name)} ${validatedSQLiteType(column.type)}`;
    if (!column.nullable) sql += " NOT NULL";
    if (column.defaultValue?.trim()) sql += ` DEFAULT ${validatedSQLiteDefault(column.defaultValue)}`;
    return sql;
}

function validatedSQLiteDefault(value: string): string {
    const normalized = value.trim();
    if (!/^(?:NULL|[-+]?\d+(?:\.\d+)?|'(?:''|[^'])*'|"(?:[^"]|"")*"|CURRENT_(?:TIME|DATE|TIMESTAMP))$/i.test(normalized)) {
        throw new Error("Invalid default value");
    }
    return normalized;
}

function sqliteForeignAction(action: string): string {
    const normalized = action.trim().toUpperCase();
    if (!["NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"].includes(normalized)) {
        throw new Error("Invalid foreign-key action");
    }
    return normalized;
}

function validateSQLiteForeignKey(foreignKey: ForeignKeyInfo): void {
    if (
        foreignKey.columns.length === 0
        || foreignKey.columns.length !== foreignKey.referencedColumns.length
    ) {
        throw new Error("Foreign-key columns must have matching referenced columns");
    }
}

function schemaResult(message: string): QueryResult {
    return { fields: [], rows: [], message };
}
