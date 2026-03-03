// ============================================================
// Nodamin - Database Driver Manager
// ============================================================
// Facade that delegates to the active database driver (MySQL or SQLite).
// Exports the same function signatures as the old mysql.ts module
// so routes.ts needs minimal changes.

import type { DatabaseDriver } from "./driver.js";
import type { DbConnection, QueryResult, ColumnInfo, TableInfo } from "../types.js";
import { MySQLDriver } from "./mysql.js";
import { SQLiteDriver } from "./sqlite.js";

let activeDriver: DatabaseDriver | null = null;

function getDriverForType(type: string): DatabaseDriver {
    switch (type) {
        case "mysql":
            return new MySQLDriver();
        case "sqlite":
            return new SQLiteDriver();
        default:
            throw new Error(`Unsupported database type: ${type}`);
    }
}

function requireDriver(): DatabaseDriver {
    if (!activeDriver) throw new Error("Not connected to database");
    return activeDriver;
}

export function connect(conn: DbConnection): void {
    // If switching driver type, disconnect old one
    if (activeDriver) {
        const currentConn = activeDriver.getConnection();
        if (currentConn && currentConn.type !== conn.type) {
            activeDriver.disconnect();
            activeDriver = null;
        }
    }
    if (!activeDriver) {
        activeDriver = getDriverForType(conn.type);
    }
    activeDriver.connect(conn);
}

export function disconnect(): void {
    if (activeDriver) {
        activeDriver.disconnect();
        activeDriver = null;
    }
}

export function getConnection(): DbConnection | null {
    return activeDriver?.getConnection() ?? null;
}

export function getCurrentDatabase(): string | null {
    return activeDriver?.getCurrentDatabase() ?? null;
}

export function setCurrentDatabase(db: string | null): void {
    requireDriver().setCurrentDatabase(db);
}

export async function testConnection(conn: DbConnection): Promise<boolean> {
    const driver = getDriverForType(conn.type);
    return driver.testConnection(conn);
}

export async function listDatabases(): Promise<string[]> {
    return requireDriver().listDatabases();
}

export async function listTables(): Promise<TableInfo[]> {
    return requireDriver().listTables();
}

export async function getTableStructure(table: string): Promise<ColumnInfo[]> {
    return requireDriver().getTableStructure(table);
}

export async function getTableData(
    table: string,
    page?: number,
    perPage?: number,
    sort?: string,
    order?: string
): Promise<{ rows: Record<string, unknown>[]; total: number; fields: string[] }> {
    return requireDriver().getTableData(table, page, perPage, sort, order);
}

export async function executeQuery(sql: string): Promise<QueryResult> {
    return requireDriver().executeQuery(sql);
}

export async function insertRow(table: string, data: Record<string, unknown>): Promise<QueryResult> {
    return requireDriver().insertRow(table, data);
}

export async function updateRow(
    table: string,
    data: Record<string, unknown>,
    where: Record<string, unknown>
): Promise<QueryResult> {
    return requireDriver().updateRow(table, data, where);
}

export async function deleteRow(table: string, where: Record<string, unknown>): Promise<QueryResult> {
    return requireDriver().deleteRow(table, where);
}

export async function dropTable(table: string): Promise<QueryResult> {
    return requireDriver().dropTable(table);
}

export async function truncateTable(table: string): Promise<QueryResult> {
    return requireDriver().truncateTable(table);
}

export async function createDatabase(name: string): Promise<QueryResult> {
    return requireDriver().createDatabase(name);
}

export async function dropDatabase(name: string): Promise<QueryResult> {
    return requireDriver().dropDatabase(name);
}

export async function createTable(
    table: string,
    columns: { name: string; type: string; nullable: boolean; primary: boolean; autoIncrement: boolean; defaultValue?: string }[]
): Promise<QueryResult> {
    return requireDriver().createTable(table, columns);
}

export async function exportTable(table: string): Promise<string> {
    return requireDriver().exportTable(table);
}

export async function importSQL(sql: string): Promise<QueryResult> {
    return requireDriver().importSQL(sql);
}

export async function exportDatabase(): Promise<string> {
    return requireDriver().exportDatabase();
}
