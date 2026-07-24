import type { ServerResponse } from "node:http";
import * as db from "../db/index.js";
import { get, post, sendHtml } from "../router.js";
import type { RouteContext } from "../types.js";
import * as views from "../views/pages.js";
import { requireConnection } from "./shared.js";

export function registerQueryRoutes(): void {
  get("/sql", async (_ctx: RouteContext, res: ServerResponse) => {
    sendHtml(res, 200, views.sqlPage({ database: null, tables: [] }));
  });

  post("/sql", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const sql = (ctx.body["sql"] as string) ?? "";
    const result = await db.executeQuery(ctx.sessionId!, sql);
    sendHtml(res, 200, views.sqlPage({ database: null, tables: [], result, sql }));
  });

  get("/db/:db/sql", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const dbName = ctx.params["db"]!;
    db.setCurrentDatabase(ctx.sessionId!, dbName);
    const tables = await db.listTables(ctx.sessionId!);
    sendHtml(res, 200, views.sqlPage({ database: dbName, tables }));
  });

  post("/db/:db/sql", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const dbName = ctx.params["db"]!;
    db.setCurrentDatabase(ctx.sessionId!, dbName);
    const sql = (ctx.body["sql"] as string) ?? "";
    const [result, tables] = await Promise.all([
      db.executeQuery(ctx.sessionId!, sql),
      db.listTables(ctx.sessionId!)
    ]);
    sendHtml(res, 200, views.sqlPage({ database: dbName, tables, result, sql }));
  });
}
