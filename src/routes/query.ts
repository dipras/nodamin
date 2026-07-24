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
    const databases = await db.listDatabases(ctx.sessionId!);
    sendHtml(res, 200, views.sqlPage({
      ...queryPageProps(ctx.sessionId!, null, [], databases, {
        schemas: databases,
        tables: [],
        columns: [],
      }),
      ...(ctx.query["sql"] ? { sql: ctx.query["sql"] } : {}),
    }));
  });

  post("/sql", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const databases = await db.listDatabases(ctx.sessionId!);
    await executeAndRender(ctx, res, null, [], databases);
  });

  post("/query/cancel", cancelQuery);

  get("/db/:db/sql", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(ctx, res)) return;
    const dbName = ctx.params["db"]!;
    db.setCurrentDatabase(ctx.sessionId!, dbName);
    const [tables, databases] = await Promise.all([
      db.listTables(ctx.sessionId!),
      db.listDatabases(ctx.sessionId!),
    ]);
    const autocomplete = await loadAutocomplete(ctx.sessionId!, tables, databases);
    sendHtml(res, 200, views.sqlPage({
      ...queryPageProps(ctx.sessionId!, dbName, tables, databases, autocomplete),
      ...(ctx.query["sql"] ? { sql: ctx.query["sql"] } : {}),
    }));
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
  tables: { name: string }[],
  databases: string[] = []
): Promise<void> {
  const sql = String(ctx.body["sql"] ?? "");
  const queryId = validQueryId(ctx.body["queryId"]) ?? randomUUID();
  const timeoutMs = normalizeTimeout(ctx.body["timeoutMs"]);
  const startedAt = performance.now();
  const result = await db.executeQuery(ctx.sessionId!, sql, { queryId, timeoutMs });
  const executionTimeMs = Math.max(0, Math.round((performance.now() - startedAt) * 10) / 10);
  const pageTables = database ? await db.listTables(ctx.sessionId!) : tables;
  const pageDatabases = database ? await db.listDatabases(ctx.sessionId!) : databases;
  const autocomplete = database
    ? await loadAutocomplete(ctx.sessionId!, pageTables, pageDatabases)
    : { schemas: databases, tables: [], columns: [] };
  sendHtml(res, 200, views.sqlPage({
    ...queryPageProps(ctx.sessionId!, database, pageTables, pageDatabases, autocomplete),
    result,
    sql,
    queryTimeoutMs: timeoutMs,
    executionTimeMs,
  }));
}

async function cancelQuery(ctx: RouteContext, res: ServerResponse): Promise<void> {
  if (!requireConnection(ctx, res)) return;
  const queryId = validQueryId(ctx.body["queryId"]);
  const cancelled = queryId ? await db.cancelQuery(ctx.sessionId!, queryId) : false;
  res.writeHead(cancelled ? 200 : 404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ cancelled }));
}

function queryPageProps(
  sessionId: string,
  database: string | null,
  tables: { name: string }[],
  databases: string[] = [],
  autocomplete: { schemas: string[]; tables: string[]; columns: string[] } = {
    schemas: [],
    tables: [],
    columns: [],
  }
) {
  const connection = db.getConnection(sessionId);
  return {
    database,
    tables,
    databases,
    readOnly: connection?.readOnly === true,
    queryTimeoutMs: connection?.queryTimeoutMs ?? 30_000,
    canCancel: connection?.type === "mysql" || connection?.type === "mariadb",
    explainPrefix: connection?.type === "sqlite" ? "EXPLAIN QUERY PLAN " : "EXPLAIN ",
    autocomplete,
  };
}

async function loadAutocomplete(
  sessionId: string,
  tables: { name: string }[],
  schemas: string[]
): Promise<{ schemas: string[]; tables: string[]; columns: string[] }> {
  const structures = await Promise.all(
    tables.map(({ name }) => db.getTableStructure(sessionId, name).catch(() => []))
  );
  return {
    schemas,
    tables: tables.map(({ name }) => name),
    columns: [...new Set(structures.flatMap((columns) => columns.map(({ name }) => name)))],
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
