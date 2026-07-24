import { readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import type { File } from "formidable";
import * as db from "../db/index.js";
import { get, post, redirect, sendHtml } from "../router.js";
import type { RouteContext } from "../types.js";
import * as views from "../views/pages.js";
import { cleanupTemporaryFile, requireConnection } from "./shared.js";

interface NewColumn {
  name: string;
  type: string;
  nullable: boolean;
  primary: boolean;
  autoIncrement: boolean;
  defaultValue?: string;
}

export function registerSchemaRoutes(): void {
  post("/db/create", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const name = ctx.body["name"] as string;
    if (name) await db.createDatabase(ctx.sessionId!, name);
    redirect(res, "/");
  });

  post("/db/:db/drop", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    await db.dropDatabase(ctx.sessionId!, ctx.params["db"]!);
    db.setCurrentDatabase(ctx.sessionId!, null);
    redirect(res, "/");
  });

  get("/db/:db", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const dbName = ctx.params["db"]!;
    db.setCurrentDatabase(ctx.sessionId!, dbName);
    const tables = await db.listTables(ctx.sessionId!);
    sendHtml(res, 200, views.tableListPage({ database: dbName, tables }));
  });

  // These routes must be registered before /db/:db/table/:table.
  get("/db/:db/table/create", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const dbName = ctx.params["db"]!;
    db.setCurrentDatabase(ctx.sessionId!, dbName);
    const tables = await db.listTables(ctx.sessionId!);
    sendHtml(res, 200, views.createTablePage(dbName, tables));
  });

  post("/db/:db/table/create", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const dbName = ctx.params["db"]!;
    db.setCurrentDatabase(ctx.sessionId!, dbName);

    const tableName = ctx.body["tableName"] as string;
    const colNames = asArray(ctx.body["colName[]"]);
    const colTypes = asArray(ctx.body["colType[]"]);
    const colLengths = asArray(ctx.body["colLength[]"]);
    const colPrimary = asArray(ctx.body["colPrimary[]"]);
    const colNullable = asArray(ctx.body["colNullable[]"]);
    const colAutoInc = asArray(ctx.body["colAutoInc[]"]);
    const colDefault = asArray(ctx.body["colDefault[]"]);

    const columns = colNames.map((name, i): NewColumn => {
      const baseType = colTypes[i] ?? "TEXT";
      const length = colLengths[i];
      const column: NewColumn = {
        name,
        type: length?.trim() ? `${baseType}(${length})` : baseType,
        nullable: colNullable.includes(String(i)),
        primary: colPrimary.includes(String(i)),
        autoIncrement: colAutoInc.includes(String(i)),
      };
      const defaultValue = colDefault[i];
      if (defaultValue?.trim()) column.defaultValue = defaultValue;
      return column;
    });

    try {
      await db.createTable(ctx.sessionId!, tableName, columns);
      redirect(res, `/db/${encodeURIComponent(dbName)}/table/${encodeURIComponent(tableName)}`);
    } catch (err: unknown) {
      console.error("Failed to create table:", err);
      const message = err instanceof Error ? err.message : String(err);
      const tables = await db.listTables(ctx.sessionId!);
      sendHtml(res, 200, views.createTablePage(dbName, tables, message));
    }
  });

  get("/db/:db/import", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const dbName = ctx.params["db"]!;
    db.setCurrentDatabase(ctx.sessionId!, dbName);
    const tables = await db.listTables(ctx.sessionId!);
    sendHtml(res, 200, views.importPage({ database: dbName, tables }));
  });

  post("/db/:db/import", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const dbName = ctx.params["db"]!;
    db.setCurrentDatabase(ctx.sessionId!, dbName);

    const sqlFile = ctx.body["sqlfile"] as File | undefined;
    let sql = (ctx.body["sql"] as string) ?? "";
    if (sqlFile?.filepath) {
      try {
        sql = readFileSync(sqlFile.filepath, "utf8");
      } finally {
        cleanupTemporaryFile(sqlFile.filepath);
      }
    }

    try {
      const result = await db.importSQL(ctx.sessionId!, sql);
      const tables = await db.listTables(ctx.sessionId!);
      sendHtml(res, 200, views.importPage({
        database: dbName,
        tables,
        result: { message: result.message || "Import successful" },
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const tables = await db.listTables(ctx.sessionId!);
      sendHtml(res, 200, views.importPage({ database: dbName, tables, error: message }));
    }
  });
}

function asArray(value: unknown): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}
