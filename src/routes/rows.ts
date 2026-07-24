import type { ServerResponse } from "node:http";
import * as db from "../db/index.js";
import { get, post, redirect, sendHtml } from "../router.js";
import type { RouteContext } from "../types.js";
import * as views from "../views/pages.js";
import { requireConfirmation, requireConnection } from "./shared.js";

export function registerRowRoutes(): void {
  get("/db/:db/table/:table/insert", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const dbName = ctx.params["db"]!;
    const table = ctx.params["table"]!;
    db.setCurrentDatabase(ctx.sessionId!, dbName);
    const [columns, tables] = await Promise.all([
      db.getTableStructure(ctx.sessionId!, table),
      db.listTables(ctx.sessionId!)
    ]);
    sendHtml(res, 200, views.insertPage({ database: dbName, table, columns, tables }));
  });

  post("/db/:db/table/:table/insert", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const dbName = ctx.params["db"]!;
    const table = ctx.params["table"]!;
    db.setCurrentDatabase(ctx.sessionId!, dbName);

    const columns = await db.getTableStructure(ctx.sessionId!, table);
    const data: Record<string, unknown> = {};
    for (const column of columns) {
      if (column.extra.includes("auto_increment")) continue;
      const value = ctx.body[column.name];
      if (value === "" && column.nullable) {
        data[column.name] = null;
      } else if (value !== undefined && value !== "") {
        data[column.name] = value;
      }
    }

    try {
      await db.insertRow(ctx.sessionId!, table, data);
      redirect(res, tablePath(dbName, table));
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      const tables = await db.listTables(ctx.sessionId!);
      sendHtml(res, 200, views.insertPage({
        database: dbName,
        table,
        columns,
        tables,
        error,
      }));
    }
  });

  get("/db/:db/table/:table/edit", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const dbName = ctx.params["db"]!;
    const table = ctx.params["table"]!;
    db.setCurrentDatabase(ctx.sessionId!, dbName);

    const [columns, tables] = await Promise.all([
      db.getTableStructure(ctx.sessionId!, table),
      db.listTables(ctx.sessionId!)
    ]);
    const where = { ...ctx.query };
    delete where["page"];
    delete where["sort"];
    delete where["order"];
    const row = await db.getRow(ctx.sessionId!, table, where);

    if (!row) {
      sendHtml(res, 404, views.errorPage(
        "Row Not Found",
        "The requested row was not found.",
        tablePath(dbName, table)
      ));
      return;
    }

    sendHtml(res, 200, views.editPage({
      database: dbName,
      table,
      columns,
      row,
      tables,
    }));
  });

  post("/db/:db/table/:table/update", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const dbName = ctx.params["db"]!;
    const table = ctx.params["table"]!;
    db.setCurrentDatabase(ctx.sessionId!, dbName);

    const where: Record<string, unknown> = { ...ctx.query };
    const data: Record<string, unknown> = {};
    const columns = await db.getTableStructure(ctx.sessionId!, table);
    for (const column of columns) {
      const value = ctx.body[column.name];
      if (value === "" && column.nullable) {
        data[column.name] = null;
      } else if (value !== undefined) {
        data[column.name] = value;
      }
    }

    try {
      await db.updateRow(ctx.sessionId!, table, data, where);
      redirect(res, tablePath(dbName, table));
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      const tables = await db.listTables(ctx.sessionId!);
      sendHtml(res, 200, views.editPage({
        database: dbName,
        table,
        columns,
        row: ctx.body,
        tables,
        error,
      }));
    }
  });

  post("/db/:db/table/:table/delete", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const dbName = ctx.params["db"]!;
    const table = ctx.params["table"]!;
    db.setCurrentDatabase(ctx.sessionId!, dbName);

    try {
      requireConfirmation(ctx, "DELETE");
      await db.deleteRow(ctx.sessionId!, table, { ...ctx.query });
      redirect(res, tablePath(dbName, table));
    } catch (err: unknown) {
      await renderTableError(ctx, res, err);
    }
  });

  post("/db/:db/table/:table/bulk-delete", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const dbName = ctx.params["db"]!;
    const table = ctx.params["table"]!;
    db.setCurrentDatabase(ctx.sessionId!, dbName);

    const rawRowIds = ctx.body["rows[]"];
    const rowIds = rawRowIds === undefined
      ? []
      : (Array.isArray(rawRowIds) ? rawRowIds : [rawRowIds]).map(String);
    if (rowIds.length === 0) {
      redirect(res, tablePath(dbName, table));
      return;
    }

    const columns = await db.getTableStructure(ctx.sessionId!, table);
    const primaryKeys = columns.filter((column) => column.key === "PRI").map((column) => column.name);
    if (primaryKeys.length === 0) {
      await renderTableError(ctx, res, new Error("No primary keys found, cannot bulk delete"), primaryKeys);
      return;
    }

    try {
      requireConfirmation(ctx, "DELETE");
      for (const rowId of rowIds) {
        const values = rowId.split("|");
        const where: Record<string, unknown> = {};
        primaryKeys.forEach((primaryKey, index) => {
          where[primaryKey] = values[index];
        });
        await db.deleteRow(ctx.sessionId!, table, where);
      }
      redirect(res, tablePath(dbName, table));
    } catch (err: unknown) {
      await renderTableError(ctx, res, err, primaryKeys);
    }
  });
}

async function renderTableError(
  ctx: RouteContext,
  res: ServerResponse,
  err: unknown,
  knownPrimaryKeys?: string[]
): Promise<void> {
  const dbName = ctx.params["db"]!;
  const table = ctx.params["table"]!;
  const page = Number(ctx.query["page"]) || 1;
  const [data, columns, tables] = await Promise.all([
    db.getTableData(ctx.sessionId!, table, page, 50),
    knownPrimaryKeys ? Promise.resolve([]) : db.getTableStructure(ctx.sessionId!, table),
    db.listTables(ctx.sessionId!),
  ]);
  const primaryKeys = knownPrimaryKeys
    ?? columns.filter((column) => column.key === "PRI").map((column) => column.name);
  sendHtml(res, 200, views.tableDataPage({
    database: dbName,
    table,
    fields: data.fields,
    rows: data.rows,
    total: data.total,
    page,
    perPage: 50,
    primaryKeys,
    tables,
    readOnly: db.isReadOnly(ctx.sessionId),
    error: err instanceof Error ? err.message : String(err),
  }));
}

function tablePath(database: string, table: string): string {
  return `/db/${encodeURIComponent(database)}/table/${encodeURIComponent(table)}`;
}
