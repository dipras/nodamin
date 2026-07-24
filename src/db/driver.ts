// ============================================================
// Nodamin - Database Driver Interface
// ============================================================

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
    addColumn(table: string, column: ColumnDefinition): Promise<QueryResult>;
    modifyColumn(table: string, column: string, definition: ColumnDefinition): Promise<QueryResult>;
    renameColumn(table: string, column: string, newName: string): Promise<QueryResult>;
    dropColumn(table: string, column: string): Promise<QueryResult>;
    listIndexes(table: string): Promise<IndexInfo[]>;
    createIndex(table: string, name: string, columns: string[], unique: boolean): Promise<QueryResult>;
    dropIndex(table: string, name: string): Promise<QueryResult>;
    listForeignKeys(table: string): Promise<ForeignKeyInfo[]>;
    createForeignKey(table: string, foreignKey: ForeignKeyInfo): Promise<QueryResult>;
    dropForeignKey(table: string, name: string): Promise<QueryResult>;
    getTableData(
        table: string,
        page?: number,
        perPage?: number,
        sort?: string,
        order?: string,
        filters?: Record<string, string>
    ): Promise<{ rows: Record<string, unknown>[]; total: number; fields: string[] }>;
    getTableRows(table: string): Promise<Record<string, unknown>[]>;
    getRow(table: string, where: Record<string, unknown>): Promise<Record<string, unknown> | null>;
    executeQuery(sql: string, options?: QueryExecutionOptions): Promise<QueryResult>;
    cancelQuery(queryId: string): Promise<boolean>;
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
    exportTable(table: string, structureOnly?: boolean): Promise<string>;
    importSQL(sql: string): Promise<QueryResult>;
    exportDatabase(structureOnly?: boolean): Promise<string>;
}
