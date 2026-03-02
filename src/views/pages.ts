// ============================================================
// Nodamin - HTML Views (Using Pre-compiled EJS Templates)
// ============================================================

import * as compiled from "./compiled.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Wrapper to call EJS compiled functions (they expect 4 params: data, escapeFn, include, rethrow)
function render(fn: Function, data: any): string {
  return fn(data, undefined, undefined, undefined);
}

function layout(title: string, content: string, sidebar: string = ""): string {
  return render(compiled.layout, { title, content, sidebar, css: css(), js: js() });
}

function css(): string {
  return readFileSync(join(__dirname, "styles.css"), "utf-8");
}

function js(): string {
  return readFileSync(join(__dirname, "scripts.js"), "utf-8");
}

// ---- Page Renderers ----

export function loginPage(error?: string): string {
  const content = render(compiled.login, { error });
  return layout("Connect", content);
}

export function databaseListPage(
  databases: string[],
  connName: string,
  message?: string
): string {
  const sidebar = render(compiled.sidebar, {
    title: "Databases",
    items: databases.map((db) => ({
      href: `/db/${encodeURIComponent(db)}`,
      name: db,
    })),
  });

  const content = render(compiled.databaseList, { databases, message });
  return layout("Databases", content, sidebar);
}

export function tableListPage(
  database: string,
  tables: { name: string; engine: string; rows: number; size: string; collation: string }[],
  message?: string
): string {
  const sidebar = render(compiled.sidebar, {
    title: "Tables",
    items: tables.map((t) => ({
      href: `/db/${encodeURIComponent(database)}/table/${encodeURIComponent(t.name)}`,
      name: t.name,
    })),
  });

  const content = render(compiled.tableList, { database, tables, message });
  return layout(database, content, sidebar);
}

export function tableDataPage(
  database: string,
  table: string,
  fields: string[],
  rows: Record<string, unknown>[],
  total: number,
  page: number,
  perPage: number,
  sort?: string,
  order?: string,
  message?: string
): string {
  const content = render(compiled.tableData, {
    database,
    table,
    fields,
    rows,
    total,
    page,
    perPage,
    sort,
    order,
    message,
  });
  return layout(`${table} - ${database}`, content);
}

export function tableStructurePage(
  database: string,
  table: string,
  columns: { name: string; type: string; nullable: boolean; key: string; defaultValue: unknown; extra: string }[]
): string {
  const content = render(compiled.tableStructure, { database, table, columns });
  return layout(`Structure: ${table}`, content);
}

export function insertPage(
  database: string,
  table: string,
  columns: { name: string; type: string; nullable: boolean; key: string; defaultValue: unknown; extra: string }[],
  error?: string
): string {
  const content = render(compiled.insert, { database, table, columns, error });
  return layout(`Insert - ${table}`, content);
}

export function editPage(
  database: string,
  table: string,
  columns: { name: string; type: string; nullable: boolean; key: string; defaultValue: unknown; extra: string }[],
  row: Record<string, unknown>,
  error?: string
): string {
  const content = render(compiled.edit, { database, table, columns, row, error });
  return layout(`Edit - ${table}`, content);
}

export function sqlPage(
  database: string | null,
  result?: {
    fields: { name: string }[];
    rows: Record<string, unknown>[];
    affectedRows?: number;
    message?: string;
  },
  sql?: string
): string {
  const content = render(compiled.sql, { database, result, sql });
  return layout("SQL Query", content);
}

export function errorPage(title: string, message: string, backUrl: string = "/"): string {
  const content = render(compiled.error, { title, message, backUrl });
  return layout(title, content);
}
