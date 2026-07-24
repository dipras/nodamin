import type { ServerResponse } from "node:http";
import * as db from "../db/index.js";
import { get, sendHtml } from "../router.js";
import type { RouteContext } from "../types.js";
import * as views from "../views/pages.js";
import { requireConnection } from "./shared.js";

export function registerTableBrowseRoutes(): void {
  get("/db/:db/table/:table/structure", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const dbName = ctx.params["db"]!;
    const table = ctx.params["table"]!;
    db.setCurrentDatabase(ctx.sessionId!, dbName);
    const [columns, tables] = await Promise.all([
      db.getTableStructure(ctx.sessionId!, table),
      db.listTables(ctx.sessionId!)
    ]);
    sendHtml(res, 200, views.tableStructurePage({
      database: dbName,
      table,
      columns,
      tables,
    }));
  });

  // Keep this generic route last within the table domain.
  get("/db/:db/table/:table", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const dbName = ctx.params["db"]!;
    const table = ctx.params["table"]!;
    db.setCurrentDatabase(ctx.sessionId!, dbName);

    const page = Number(ctx.query["page"]) || 1;
    const sort = ctx.query["sort"];
    const order = ctx.query["order"];
    const [data, columns, tables] = await Promise.all([
      db.getTableData(ctx.sessionId!, table, page, 50, sort, order),
      db.getTableStructure(ctx.sessionId!, table),
      db.listTables(ctx.sessionId!)
    ]);
    const primaryKeys = columns.filter((column) => column.key === "PRI").map((column) => column.name);

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
      ...(sort ? { sort } : {}),
      ...(order ? { order } : {}),
    }));
  });
}
