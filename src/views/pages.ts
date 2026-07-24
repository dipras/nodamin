// ============================================================
// Nodamin - HTML Views (Using Pre-compiled EJS Templates)
// ============================================================

import * as compiled from "./compiled.js";
import { CSS, JS } from "./assets.js";
import type { ColumnInfo, QueryResult, TableInfo } from "../types.js";

// Wrapper to call EJS compiled functions (they expect 4 params: data, escapeFn, include, rethrow)
type CompiledTemplate = (
  data: unknown,
  escapeFn: undefined,
  include: undefined,
  rethrow: undefined
) => string | undefined;

function render<T extends object>(fn: CompiledTemplate, data: T): string {
  const output = fn(data, undefined, undefined, undefined);
  if (output === undefined) {
    throw new Error("Compiled template returned no output");
  }
  return output;
}

interface Breadcrumb {
  label: string;
  href?: string;
}

function layout(
  title: string,
  content: string,
  sidebar: string = navigationSidebar(),
  breadcrumbs: Breadcrumb[] = []
): string {
  return render(compiled.layout, { title, content, sidebar, breadcrumbs, css: CSS, js: JS });
}

type SidebarTable = Pick<TableInfo, "name">;

function navigationSidebar(active = ""): string {
  return render(compiled.sidebar, {
    title: "Navigation",
    items: [
      { href: "/", name: "Databases", icon: "◉", active: active === "databases" },
      { href: "/sql", name: "SQL Query", icon: "⌘", active: active === "sql" },
    ],
  });
}

function connectSidebar(): string {
  return render(compiled.sidebar, {
    title: "Nodamin",
    items: [{ href: "/", name: "Connect", icon: "↗", active: true }],
  });
}

function databaseSidebar(databases: string[], activeDatabase = ""): string {
  return render(compiled.sidebar, {
    title: "Databases",
    items: databases.map((database) => ({
      href: `/db/${encodeURIComponent(database)}`,
      name: database,
      icon: "◉",
      active: database === activeDatabase,
    })),
  });
}

function tableSidebar(database: string, tables: SidebarTable[], activeTable = ""): string {
  return render(compiled.sidebar, {
    title: "Tables",
    items: tables.map(({ name }) => ({
      href: `/db/${encodeURIComponent(database)}/table/${encodeURIComponent(name)}`,
      name,
      icon: "▦",
      active: name === activeTable,
    })),
  });
}

function databaseBreadcrumbs(database: string, current?: string): Breadcrumb[] {
  const databaseHref = `/db/${encodeURIComponent(database)}`;
  return [
    { label: "Databases", href: "/" },
    { label: database, ...(current ? { href: databaseHref } : {}) },
    ...(current ? [{ label: current }] : []),
  ];
}

function tableBreadcrumbs(database: string, table: string, current?: string): Breadcrumb[] {
  const databaseHref = `/db/${encodeURIComponent(database)}`;
  const tableHref = `${databaseHref}/table/${encodeURIComponent(table)}`;
  return [
    { label: "Databases", href: "/" },
    { label: database, href: databaseHref },
    { label: table, ...(current ? { href: tableHref } : {}) },
    ...(current ? [{ label: current }] : []),
  ];
}

interface TableListPageProps {
  database: string;
  tables: TableInfo[];
  message?: string;
  error?: string;
  readOnly?: boolean;
}

interface TableDataPageProps {
  database: string;
  table: string;
  fields: string[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  perPage: number;
  primaryKeys: string[];
  tables: SidebarTable[];
  sort?: string;
  order?: string;
  message?: string;
  error?: string;
  readOnly?: boolean;
}

interface TableStructurePageProps {
  database: string;
  table: string;
  columns: ColumnInfo[];
  tables: SidebarTable[];
}

interface InsertPageProps extends TableStructurePageProps {
  error?: string;
}

interface EditPageProps extends InsertPageProps {
  row: Record<string, unknown>;
}

interface SqlPageProps {
  database: string | null;
  tables: SidebarTable[];
  databases?: string[];
  result?: QueryResult;
  sql?: string;
  readOnly?: boolean;
  queryTimeoutMs?: number;
  canCancel?: boolean;
  explainPrefix?: string;
  executionTimeMs?: number;
}

interface ExportTablePageProps {
  database: string;
  table: string;
  dump: string;
  tables: SidebarTable[];
  preview?: boolean;
}

interface ExportDatabasePageProps {
  database: string;
  dump: string;
  tables: SidebarTable[];
  preview?: boolean;
}

interface ImportPageProps {
  database: string;
  tables: SidebarTable[];
  result?: Required<Pick<QueryResult, "message">>;
  error?: string;
}

// ---- Page Renderers ----

export function loginPage(error?: string): string {
  const content = render(compiled.login, { error });
  return layout("Connect", content, connectSidebar());
}

export function databaseListPage(
  databases: string[],
  message?: string,
  error?: string,
  readOnly = false
): string {
  const content = render(compiled.databaseList, { databases, message, error, readOnly });
  return layout("Databases", content, databaseSidebar(databases));
}

export function tableListPage({
  database,
  tables,
  message,
  error,
  readOnly = false,
}: TableListPageProps): string {
  const content = render(compiled.tableList, { database, tables, message, error, readOnly });
  return layout(database, content, tableSidebar(database, tables), databaseBreadcrumbs(database));
}

export function tableDataPage(props: TableDataPageProps): string {
  const content = render(compiled.tableData, props);
  const { database, table, tables } = props;
  return layout(
    `${table} - ${database}`,
    content,
    tableSidebar(database, tables, table),
    tableBreadcrumbs(database, table)
  );
}

export function tableStructurePage({
  database,
  table,
  columns,
  tables,
}: TableStructurePageProps): string {
  const content = render(compiled.tableStructure, { database, table, columns });
  return layout(
    `Structure: ${table}`,
    content,
    tableSidebar(database, tables, table),
    tableBreadcrumbs(database, table, "Structure")
  );
}

export function insertPage({
  database,
  table,
  columns,
  tables,
  error,
}: InsertPageProps): string {
  const content = render(compiled.insert, { database, table, columns, error });
  return layout(
    `Insert - ${table}`,
    content,
    tableSidebar(database, tables, table),
    tableBreadcrumbs(database, table, "Insert row")
  );
}

export function editPage({
  database,
  table,
  columns,
  row,
  tables,
  error,
}: EditPageProps): string {
  const content = render(compiled.edit, { database, table, columns, row, error });
  return layout(
    `Edit - ${table}`,
    content,
    tableSidebar(database, tables, table),
    tableBreadcrumbs(database, table, "Edit row")
  );
}

export function sqlPage({
  database,
  tables,
  databases = [],
  result,
  sql,
  readOnly = false,
  queryTimeoutMs = 30_000,
  canCancel = false,
  explainPrefix = "EXPLAIN ",
  executionTimeMs,
}: SqlPageProps): string {
  const sidebar = database
    ? tableSidebar(database, tables)
    : databaseSidebar(databases);
  const content = render(compiled.sql, {
    database,
    result,
    sql,
    readOnly,
    queryTimeoutMs,
    canCancel,
    explainPrefix,
    executionTimeMs,
  });
  return layout(
    "SQL Query",
    content,
    sidebar,
    database
      ? databaseBreadcrumbs(database, "SQL Query")
      : [{ label: "Databases", href: "/" }, { label: "SQL Query" }]
  );
}

export function errorPage(title: string, message: string, backUrl: string = "/"): string {
  const content = render(compiled.error, { title, message, backUrl });
  return layout(title, content, navigationSidebar());
}

export function createTablePage(
  database: string,
  tables: SidebarTable[],
  error?: string
): string {
  const content = render(compiled.createTable, { database, error });
  return layout(
    `Create Table - ${database}`,
    content,
    tableSidebar(database, tables),
    databaseBreadcrumbs(database, "Create table")
  );
}

export function exportPage({
  database,
  table,
  dump,
  tables,
  preview = false,
}: ExportTablePageProps): string {
  const content = render(compiled.exportTable, { database, table, dump, preview });
  return layout(
    `Export - ${table}`,
    content,
    tableSidebar(database, tables, table),
    tableBreadcrumbs(database, table, "Export")
  );
}

export function exportDatabasePage({
  database,
  dump,
  tables,
  preview = false,
}: ExportDatabasePageProps): string {
  const content = render(compiled.exportDatabase, { database, dump, preview });
  return layout(
    `Export - ${database}`,
    content,
    tableSidebar(database, tables),
    databaseBreadcrumbs(database, "Export")
  );
}

export function importPage({
  database,
  tables,
  result,
  error,
}: ImportPageProps): string {
  const content = render(compiled.importSQL, { database, result, error });
  return layout(
    `Import - ${database}`,
    content,
    tableSidebar(database, tables),
    databaseBreadcrumbs(database, "Import SQL")
  );
}
