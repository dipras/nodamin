import type { ServerResponse } from "node:http";
import * as db from "../db/index.js";
import { post, redirect, sendHtml } from "../router.js";
import type { RouteContext } from "../types.js";
import * as views from "../views/pages.js";
import { requireConnection } from "./shared.js";

export function registerTableActionRoutes(): void {
  post("/db/:db/table/:table/drop", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const dbName = ctx.params["db"]!;
    const table = ctx.params["table"]!;
    db.setCurrentDatabase(ctx.sessionId!, dbName);
    try {
      await db.dropTable(ctx.sessionId!, table);
      redirect(res, databasePath(dbName));
    } catch (err: unknown) {
      const tables = await db.listTables(ctx.sessionId!);
      sendHtml(res, 200, views.tableListPage({
        database: dbName,
        tables,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  });

  post("/db/:db/table/:table/truncate", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const dbName = ctx.params["db"]!;
    const table = ctx.params["table"]!;
    db.setCurrentDatabase(ctx.sessionId!, dbName);
    try {
      await db.truncateTable(ctx.sessionId!, table);
      redirect(res, tablePath(dbName, table));
    } catch (err: unknown) {
      const [data, columns] = await Promise.all([
        db.getTableData(ctx.sessionId!, table, 1, 50),
        db.getTableStructure(ctx.sessionId!, table)
      ]);
      const primaryKeys = columns.filter((column) => column.key === "PRI").map((column) => column.name);
      sendHtml(res, 200, views.tableDataPage({
        database: dbName,
        table,
        fields: data.fields,
        rows: data.rows,
        total: data.total,
        page: 1,
        perPage: 50,
        primaryKeys,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  });

  post("/db/:db/tables/bulk", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const dbName = ctx.params["db"]!;
    db.setCurrentDatabase(ctx.sessionId!, dbName);

    const rawTables = ctx.body["tables[]"];
    const tables = rawTables === undefined
      ? []
      : (Array.isArray(rawTables) ? rawTables : [rawTables]).map(String);
    if (tables.length === 0) {
      redirect(res, databasePath(dbName));
      return;
    }

    try {
      const action = ctx.body["action"] as string;
      if (action === "drop" || action === "truncate") {
        for (const table of tables) {
          if (action === "drop") await db.dropTable(ctx.sessionId!, table);
          else await db.truncateTable(ctx.sessionId!, table);
        }
      } else if (action === "export") {
        const dumps: string[] = [];
        for (const table of tables) {
          dumps.push(await db.exportTable(ctx.sessionId!, table));
        }
        res.writeHead(200, {
          "Content-Type": "application/sql",
          "Content-Disposition": `attachment; filename="${dbName}_export.sql"`,
        });
        res.end(dumps.join("\n\n"));
        return;
      }
    } catch (err: unknown) {
      const tableList = await db.listTables(ctx.sessionId!);
      sendHtml(res, 200, views.tableListPage({
        database: dbName,
        tables: tableList,
        error: err instanceof Error ? err.message : String(err),
      }));
      return;
    }

    redirect(res, databasePath(dbName));
  });
}

function databasePath(database: string): string {
  return `/db/${encodeURIComponent(database)}`;
}

function tablePath(database: string, table: string): string {
  return `${databasePath(database)}/table/${encodeURIComponent(table)}`;
}
