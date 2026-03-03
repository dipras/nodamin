// ============================================================
// Nodamin - Database Driver Interface
// ============================================================

import type { DbConnection, QueryResult, ColumnInfo, TableInfo } from "../types.js";

export interface DatabaseDriver {
    connect(conn: DbConnection): void;
    disconnect(): void;
    getConnection(): DbConnection | null;
    getCurrentDatabase(): string | null;
    setCurrentDatabase(db: string | null): void;
    testConnection(conn: DbConnection): Promise<boolean>;
    listDatabases(): Promise<string[]>;
    listTables(): Promise<TableInfo[]>;
    getTableStructure(table: string): Promise<ColumnInfo[]>;
    getTableData(
        table: string,
        page?: number,
        perPage?: number,
        sort?: string,
        order?: string
    ): Promise<{ rows: Record<string, unknown>[]; total: number; fields: string[] }>;
    executeQuery(sql: string): Promise<QueryResult>;
    insertRow(table: string, data: Record<string, unknown>): Promise<QueryResult>;
    updateRow(
        table: string,
        data: Record<string, unknown>,
        where: Record<string, unknown>
    ): Promise<QueryResult>;
    deleteRow(table: string, where: Record<string, unknown>): Promise<QueryResult>;
    dropTable(table: string): Promise<QueryResult>;
    truncateTable(table: string): Promise<QueryResult>;
    createDatabase(name: string): Promise<QueryResult>;
    dropDatabase(name: string): Promise<QueryResult>;
    createTable(
        table: string,
        columns: {
            name: string;
            type: string;
            nullable: boolean;
            primary: boolean;
            autoIncrement: boolean;
            defaultValue?: string;
        }[]
    ): Promise<QueryResult>;
    exportTable(table: string): Promise<string>;
    importSQL(sql: string): Promise<QueryResult>;
    exportDatabase(): Promise<string>;
}
