// ============================================================
// Nodamin - Database Driver Manager
// ============================================================
// Facade that delegates to per-session database drivers (MySQL or SQLite).
// Each session has its own isolated database connection.

import type { DatabaseDriver } from "./driver.js";
import type { DbConnection, QueryResult, ColumnInfo, TableInfo } from "../types.js";
import { MySQLDriver } from "./mysql.js";
import { SQLiteDriver } from "./sqlite.js";

// Map of sessionId -> DatabaseDriver for per-session isolation
const sessionDrivers = new Map<string, DatabaseDriver>();

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

function requireDriver(sessionId: string | null): DatabaseDriver {
    if (!sessionId) throw new Error("No session ID provided");
    const driver = sessionDrivers.get(sessionId);
    if (!driver) throw new Error("Not connected to database");
    return driver;
}

export function connect(sessionId: string, conn: DbConnection): void {
    // Get or create driver for this session
    let driver = sessionDrivers.get(sessionId);
    
    // If switching driver type, disconnect old one
    if (driver) {
        const currentConn = driver.getConnection();
        if (currentConn && currentConn.type !== conn.type) {
            driver.disconnect();
            driver = getDriverForType(conn.type);
            sessionDrivers.set(sessionId, driver);
        }
    } else {
        driver = getDriverForType(conn.type);
        sessionDrivers.set(sessionId, driver);
    }
    
    driver.connect(conn);
}

export function disconnect(sessionId: string): void {
    const driver = sessionDrivers.get(sessionId);
    if (driver) {
        driver.disconnect();
        sessionDrivers.delete(sessionId);
    }
}

export function getConnection(sessionId: string | null): DbConnection | null {
    if (!sessionId) return null;
    const driver = sessionDrivers.get(sessionId);
    return driver?.getConnection() ?? null;
}

export function getCurrentDatabase(sessionId: string | null): string | null {
    if (!sessionId) return null;
    const driver = sessionDrivers.get(sessionId);
    return driver?.getCurrentDatabase() ?? null;
}

export function setCurrentDatabase(sessionId: string, db: string | null): void {
    requireDriver(sessionId).setCurrentDatabase(db);
}

export async function testConnection(conn: DbConnection): Promise<boolean> {
    const driver = getDriverForType(conn.type);
    return driver.testConnection(conn);
}

export async function listDatabases(sessionId: string): Promise<string[]> {
    return requireDriver(sessionId).listDatabases();
}

export async function listTables(sessionId: string): Promise<TableInfo[]> {
    return requireDriver(sessionId).listTables();
}

export async function getTableStructure(sessionId: string, table: string): Promise<ColumnInfo[]> {
    return requireDriver(sessionId).getTableStructure(table);
}

export async function getTableData(
    sessionId: string,
    table: string,
    page?: number,
    perPage?: number,
    sort?: string,
    order?: string
): Promise<{ rows: Record<string, unknown>[]; total: number; fields: string[] }> {
    return requireDriver(sessionId).getTableData(table, page, perPage, sort, order);
}

export async function executeQuery(sessionId: string, sql: string): Promise<QueryResult> {
    return requireDriver(sessionId).executeQuery(sql);
}

export async function insertRow(sessionId: string, table: string, data: Record<string, unknown>): Promise<QueryResult> {
    return requireDriver(sessionId).insertRow(table, data);
}

export async function updateRow(
    sessionId: string,
    table: string,
    data: Record<string, unknown>,
    where: Record<string, unknown>
): Promise<QueryResult> {
    return requireDriver(sessionId).updateRow(table, data, where);
}

export async function deleteRow(sessionId: string, table: string, where: Record<string, unknown>): Promise<QueryResult> {
    return requireDriver(sessionId).deleteRow(table, where);
}

export async function dropTable(sessionId: string, table: string): Promise<QueryResult> {
    return requireDriver(sessionId).dropTable(table);
}

export async function truncateTable(sessionId: string, table: string): Promise<QueryResult> {
    return requireDriver(sessionId).truncateTable(table);
}

export async function createDatabase(sessionId: string, name: string): Promise<QueryResult> {
    return requireDriver(sessionId).createDatabase(name);
}

export async function dropDatabase(sessionId: string, name: string): Promise<QueryResult> {
    return requireDriver(sessionId).dropDatabase(name);
}

export async function createTable(
    sessionId: string,
    table: string,
    columns: { name: string; type: string; nullable: boolean; primary: boolean; autoIncrement: boolean; defaultValue?: string }[]
): Promise<QueryResult> {
    return requireDriver(sessionId).createTable(table, columns);
}

export async function exportTable(sessionId: string, table: string, structureOnly?: boolean): Promise<string> {
    return requireDriver(sessionId).exportTable(table, structureOnly);
}

export async function importSQL(sessionId: string, sql: string): Promise<QueryResult> {
    return requireDriver(sessionId).importSQL(sql);
}

export async function exportDatabase(sessionId: string, structureOnly?: boolean): Promise<string> {
    return requireDriver(sessionId).exportDatabase(structureOnly);
}
