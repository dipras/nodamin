import type { ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import * as db from "../db/index.js";
import { get, post, sendHtml } from "../router.js";
import type { RouteContext } from "../types.js";
import * as views from "../views/pages.js";
import { requireConnection } from "./shared.js";

export function registerQueryRoutes(): void {
  get("/sql", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    sendHtml(res, 200, views.sqlPage(queryPageProps(ctx.sessionId!, null, [])));
  });

  post("/sql", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    await executeAndRender(ctx, res, null, []);
  });

  post("/query/cancel", cancelQuery);

  get("/db/:db/sql", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const dbName = ctx.params["db"]!;
    db.setCurrentDatabase(ctx.sessionId!, dbName);
    const tables = await db.listTables(ctx.sessionId!);
    sendHtml(res, 200, views.sqlPage(queryPageProps(ctx.sessionId!, dbName, tables)));
  });

  post("/db/:db/query/cancel", cancelQuery);

  post("/db/:db/sql", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const dbName = ctx.params["db"]!;
    db.setCurrentDatabase(ctx.sessionId!, dbName);
    const tables = await db.listTables(ctx.sessionId!);
    await executeAndRender(ctx, res, dbName, tables);
  });
}

async function executeAndRender(
  ctx: RouteContext,
  res: ServerResponse,
  database: string | null,
  tables: { name: string }[]
): Promise<void> {
  const sql = String(ctx.body["sql"] ?? "");
  const queryId = validQueryId(ctx.body["queryId"]) ?? randomUUID();
  const timeoutMs = normalizeTimeout(ctx.body["timeoutMs"]);
  const result = await db.executeQuery(ctx.sessionId!, sql, { queryId, timeoutMs });
  sendHtml(res, 200, views.sqlPage({
    ...queryPageProps(ctx.sessionId!, database, tables),
    result,
    sql,
    queryTimeoutMs: timeoutMs,
  }));
}

async function cancelQuery(ctx: RouteContext, res: ServerResponse): Promise<void> {
  if (!requireConnection(ctx, res)) return;
  const queryId = validQueryId(ctx.body["queryId"]);
  const cancelled = queryId ? await db.cancelQuery(ctx.sessionId!, queryId) : false;
  res.writeHead(cancelled ? 200 : 404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ cancelled }));
}

function queryPageProps(sessionId: string, database: string | null, tables: { name: string }[]) {
  const connection = db.getConnection(sessionId);
  return {
    database,
    tables,
    readOnly: connection?.readOnly === true,
    queryTimeoutMs: connection?.queryTimeoutMs ?? 30_000,
    canCancel: connection?.type === "mysql",
  };
}

function validQueryId(value: unknown): string | null {
  const queryId = String(value ?? "");
  return /^[a-zA-Z0-9_-]{1,100}$/.test(queryId) ? queryId : null;
}

function normalizeTimeout(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 30_000;
  return Math.min(300_000, Math.max(100, Math.round(parsed)));
}
