// ============================================================
// Nodamin - Database Driver Manager
// ============================================================
// Facade that delegates to per-session database drivers.
// Each session has its own isolated database connection.

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
import { MySQLDriver } from "./mysql.js";
import { PostgreSQLDriver } from "./postgresql.js";
import { SQLiteDriver } from "./sqlite.js";

interface SessionDrivers {
    activeId: string;
    drivers: Map<string, DatabaseDriver>;
}

// Every browser session owns an isolated collection of drivers. Only the active
// driver is exposed through the facade used by routes.
const sessionDrivers = new Map<string, SessionDrivers>();

function getDriverForType(type: string): DatabaseDriver {
    switch (type) {
        case "mysql":
        case "mariadb":
            return new MySQLDriver();
        case "postgresql":
            return new PostgreSQLDriver();
        case "sqlite":
            return new SQLiteDriver();
        default:
            throw new Error(`Unsupported database type: ${type}`);
    }
}

function requireDriver(sessionId: string | null): DatabaseDriver {
    if (!sessionId) throw new Error("No session ID provided");
    const collection = sessionDrivers.get(sessionId);
    const driver = collection?.drivers.get(collection.activeId);
    if (!driver) throw new Error("Not connected to database");
    return driver;
}

export function connect(sessionId: string, conn: DbConnection): void {
    let collection = sessionDrivers.get(sessionId);
    if (!collection) {
        collection = { activeId: conn.id, drivers: new Map() };
        sessionDrivers.set(sessionId, collection);
    }
    collection.drivers.get(conn.id)?.disconnect();
    const driver = getDriverForType(conn.type);
    collection.drivers.set(conn.id, driver);
    collection.activeId = conn.id;
    driver.connect(conn);
}

export function disconnect(sessionId: string): void {
    const collection = sessionDrivers.get(sessionId);
    if (collection) {
        for (const driver of collection.drivers.values()) driver.disconnect();
        sessionDrivers.delete(sessionId);
    }
}

export function getConnection(sessionId: string | null): DbConnection | null {
    if (!sessionId) return null;
    const collection = sessionDrivers.get(sessionId);
    return collection?.drivers.get(collection.activeId)?.getConnection() ?? null;
}

export function getCurrentDatabase(sessionId: string | null): string | null {
    if (!sessionId) return null;
    const collection = sessionDrivers.get(sessionId);
    return collection?.drivers.get(collection.activeId)?.getCurrentDatabase() ?? null;
}

export function listConnections(sessionId: string | null): DbConnection[] {
    if (!sessionId) return [];
    const collection = sessionDrivers.get(sessionId);
    if (!collection) return [];
    return [...collection.drivers.values()]
        .map((driver) => driver.getConnection())
        .filter((connection): connection is DbConnection => connection !== null);
}

export function switchConnection(sessionId: string, connectionId: string): boolean {
    const collection = sessionDrivers.get(sessionId);
    if (!collection?.drivers.has(connectionId)) return false;
    collection.activeId = connectionId;
    return true;
}

export function removeConnection(sessionId: string, connectionId: string): boolean {
    const collection = sessionDrivers.get(sessionId);
    const driver = collection?.drivers.get(connectionId);
    if (!collection || !driver) return false;
    driver.disconnect();
    collection.drivers.delete(connectionId);
    if (collection.drivers.size === 0) {
        sessionDrivers.delete(sessionId);
    } else if (collection.activeId === connectionId) {
        collection.activeId = collection.drivers.keys().next().value as string;
    }
    return true;
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

export async function addColumn(
    sessionId: string,
    table: string,
    column: ColumnDefinition
): Promise<QueryResult> {
    return requireDriver(sessionId).addColumn(table, column);
}

export async function modifyColumn(
    sessionId: string,
    table: string,
    column: string,
    definition: ColumnDefinition
): Promise<QueryResult> {
    return requireDriver(sessionId).modifyColumn(table, column, definition);
}

export async function renameColumn(
    sessionId: string,
    table: string,
    column: string,
    newName: string
): Promise<QueryResult> {
    return requireDriver(sessionId).renameColumn(table, column, newName);
}

export async function dropColumn(
    sessionId: string,
    table: string,
    column: string
): Promise<QueryResult> {
    return requireDriver(sessionId).dropColumn(table, column);
}

export async function listIndexes(sessionId: string, table: string): Promise<IndexInfo[]> {
    return requireDriver(sessionId).listIndexes(table);
}

export async function createIndex(
    sessionId: string,
    table: string,
    name: string,
    columns: string[],
    unique: boolean
): Promise<QueryResult> {
    return requireDriver(sessionId).createIndex(table, name, columns, unique);
}

export async function dropIndex(
    sessionId: string,
    table: string,
    name: string
): Promise<QueryResult> {
    return requireDriver(sessionId).dropIndex(table, name);
}

export async function listForeignKeys(
    sessionId: string,
    table: string
): Promise<ForeignKeyInfo[]> {
    return requireDriver(sessionId).listForeignKeys(table);
}

export async function createForeignKey(
    sessionId: string,
    table: string,
    foreignKey: ForeignKeyInfo
): Promise<QueryResult> {
    return requireDriver(sessionId).createForeignKey(table, foreignKey);
}

export async function dropForeignKey(
    sessionId: string,
    table: string,
    name: string
): Promise<QueryResult> {
    return requireDriver(sessionId).dropForeignKey(table, name);
}

export async function getTableData(
    sessionId: string,
    table: string,
    page?: number,
    perPage?: number,
    sort?: string,
    order?: string,
    filters?: Record<string, string>
): Promise<{ rows: Record<string, unknown>[]; total: number; fields: string[] }> {
    return requireDriver(sessionId).getTableData(table, page, perPage, sort, order, filters);
}

export async function getTableRows(
    sessionId: string,
    table: string
): Promise<Record<string, unknown>[]> {
    return requireDriver(sessionId).getTableRows(table);
}

export async function getRow(
    sessionId: string,
    table: string,
    where: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
    return requireDriver(sessionId).getRow(table, where);
}

export function isReadOnly(sessionId: string | null): boolean {
    return getConnection(sessionId)?.readOnly === true;
}

export async function executeQuery(
    sessionId: string,
    sql: string,
    options?: QueryExecutionOptions
): Promise<QueryResult> {
    return requireDriver(sessionId).executeQuery(sql, options);
}

export async function cancelQuery(sessionId: string, queryId: string): Promise<boolean> {
    return requireDriver(sessionId).cancelQuery(queryId);
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
