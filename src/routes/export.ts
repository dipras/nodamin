import type { ServerResponse } from "node:http";
import * as db from "../db/index.js";
import { get, sendHtml } from "../router.js";
import type { RouteContext } from "../types.js";
import * as views from "../views/pages.js";
import { requireConnection } from "./shared.js";

export function registerExportRoutes(): void {
  get("/db/:db/table/:table/export", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const dbName = ctx.params["db"]!;
    const table = ctx.params["table"]!;
    db.setCurrentDatabase(ctx.sessionId!, dbName);

    const structureOnly = ctx.query["structureOnly"] === "1";
    const isDownload = ctx.query["download"] === "1";
    const isOpen = ctx.query["open"] === "1";
    if (isDownload || isOpen) {
      const dump = await db.exportTable(ctx.sessionId!, table, structureOnly);
      if (isDownload) {
        const filename = structureOnly ? `${table}_structure.sql` : `${table}.sql`;
        res.writeHead(200, {
          "Content-Type": "application/sql",
          "Content-Disposition": `attachment; filename="${filename}"`,
        });
        res.end(dump);
        return;
      }
      if (isOpen) {
        const tables = await db.listTables(ctx.sessionId!);
        sendHtml(res, 200, views.exportPage({
          database: dbName,
          table,
          dump,
          tables,
          preview: true,
        }));
        return;
      }
    }

    const tables = await db.listTables(ctx.sessionId!);
    sendHtml(res, 200, views.exportPage({
      database: dbName,
      table,
      dump: "",
      tables,
    }));
  });

  get("/db/:db/export", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const dbName = ctx.params["db"]!;
    db.setCurrentDatabase(ctx.sessionId!, dbName);

    const structureOnly = ctx.query["structureOnly"] === "1";
    const isDownload = ctx.query["download"] === "1";
    const isOpen = ctx.query["open"] === "1";
    if (isDownload || isOpen) {
      const dump = await db.exportDatabase(ctx.sessionId!, structureOnly);
      if (isDownload) {
        const filename = structureOnly ? `${dbName}_structure.sql` : `${dbName}_full_export.sql`;
        res.writeHead(200, {
          "Content-Type": "application/sql",
          "Content-Disposition": `attachment; filename="${filename}"`,
        });
        res.end(dump);
        return;
      }
      if (isOpen) {
        const tables = await db.listTables(ctx.sessionId!);
        sendHtml(res, 200, views.exportDatabasePage({
          database: dbName,
          dump,
          tables,
          preview: true,
        }));
        return;
      }
    }

    const tables = await db.listTables(ctx.sessionId!);
    sendHtml(res, 200, views.exportDatabasePage({
      database: dbName,
      dump: "",
      tables,
    }));
  });
}
