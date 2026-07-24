import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { File } from "formidable";
import * as db from "../db/index.js";
import { get, post, redirect, sendHtml } from "../router.js";
import { clearSessionCookie, createSession, destroySession } from "../session.js";
import type { DbConnection, RouteContext } from "../types.js";
import * as views from "../views/pages.js";
import { cleanupTemporaryFile, requireConfirmation } from "./shared.js";

export function registerConnectionRoutes(): void {
  get("/", async (ctx: RouteContext, res: ServerResponse) => {
    const conn = db.getConnection(ctx.sessionId);
    if (!conn) {
      sendHtml(res, 200, views.loginPage());
      return;
    }
    if (conn.type === "sqlite") {
      const dbName = db.getCurrentDatabase(ctx.sessionId!) ?? "main";
      redirect(res, `/db/${encodeURIComponent(dbName)}`);
      return;
    }
    const databases = await db.listDatabases(ctx.sessionId!);
    sendHtml(res, 200, views.databaseListPage(
      databases,
      undefined,
      undefined,
      conn.readOnly === true
    ));
  });

  get("/connections", async (ctx: RouteContext, res: ServerResponse) => {
    const connections = db.listConnections(ctx.sessionId);
    if (!ctx.sessionId || connections.length === 0) {
      redirect(res, "/");
      return;
    }
    sendHtml(res, 200, views.connectionListPage(
      connections,
      db.getConnection(ctx.sessionId)?.id ?? ""
    ));
  });

  get("/connections/new", async (_ctx: RouteContext, res: ServerResponse) => {
    sendHtml(res, 200, views.loginPage(undefined, true));
  });

  post("/connect", async (ctx: RouteContext, res: ServerResponse) => {
    let uploadedFilePath: string | null = null;
    let createdSessionId: string | null = null;
    let createdNewSession = false;
    let connectedId: string | null = null;
    try {
      const connectionUrl = String(ctx.body["connectionUrl"] ?? "").trim();
      const parsedUrl = connectionUrl ? parseConnectionUrl(connectionUrl) : null;
      const dbType = parsedUrl?.type
        ?? (((ctx.body["type"] as string) ?? "mysql") as "mysql" | "sqlite");
      const sqliteMode = ctx.body["sqliteMode"] as string;
      const readOnly = ctx.body["readOnly"] === "1";
      const queryTimeoutMs = normalizeQueryTimeout(ctx.body["queryTimeoutMs"]);
      let conn: DbConnection;

      if (dbType === "sqlite") {
        if (sqliteMode === "create") {
          const dbName = (ctx.body["newDbName"] as string) || `memory_db_${Date.now()}`;
          conn = {
            id: randomUUID(),
            name: dbName,
            type: "sqlite",
            filePath: ":memory:",
            readOnly,
            queryTimeoutMs,
          };
        } else {
          const file = ctx.body["sqliteFile"] as File | undefined;
          if (!file?.filepath) {
            sendHtml(res, 200, views.loginPage("Please upload a valid SQLite database file."));
            return;
          }
          uploadedFilePath = file.filepath;
          conn = {
            id: randomUUID(),
            name: path.basename(file.filepath),
            type: "sqlite",
            filePath: file.filepath,
            temporaryFile: true,
            readOnly,
            queryTimeoutMs,
          };
        }
      } else {
        const { host, port, user, password } = ctx.body as Record<string, string>;
        conn = parsedUrl ?? {
          id: randomUUID(),
          name: `${user ?? "root"}@${host ?? "localhost"}:${port ?? "3306"}`,
          type: "mysql",
          host: host ?? "localhost",
          port: Number(port) || 3306,
          user: user ?? "root",
          password: password ?? "",
        };
        conn.readOnly = readOnly;
        conn.queryTimeoutMs = queryTimeoutMs;
      }

      if (!await db.testConnection(conn)) {
        cleanupTemporaryFile(uploadedFilePath);
        sendHtml(res, 200, views.loginPage(
          "Connection failed. Please check your credentials or file.",
          Boolean(ctx.sessionId)
        ));
        return;
      }

      createdNewSession = !ctx.sessionId;
      createdSessionId = ctx.sessionId ?? createSession(res);
      db.connect(createdSessionId, conn);
      connectedId = conn.id;
      uploadedFilePath = null;
      redirect(res, "/");
    } catch (err: unknown) {
      if (createdSessionId && createdNewSession) {
        destroySession(createdSessionId);
        clearSessionCookie(res);
      } else if (createdSessionId && connectedId) {
        db.removeConnection(createdSessionId, connectedId);
      }
      cleanupTemporaryFile(uploadedFilePath);
      console.error("[Connect Error]:", err);
      const message = err instanceof Error && (
        err.message === "Invalid database URL."
        || err.message.startsWith("Only mysql://")
        || err.message.startsWith("PostgreSQL URLs")
        || err.message.startsWith("The database URL")
      )
        ? err.message
        : "Internal error occurred during connection. Check server logs.";
      sendHtml(res, 200, views.loginPage(message, Boolean(ctx.sessionId)));
    }
  });

  post("/connections/:connection/switch", async (ctx: RouteContext, res: ServerResponse) => {
    if (ctx.sessionId) db.switchConnection(ctx.sessionId, ctx.params["connection"]!);
    redirect(res, "/");
  });

  post("/connections/:connection/remove", async (ctx: RouteContext, res: ServerResponse) => {
    if (!ctx.sessionId) {
      redirect(res, "/");
      return;
    }
    const connectionId = ctx.params["connection"]!;
    const connection = db.listConnections(ctx.sessionId)
      .find(({ id }) => id === connectionId);
    if (connection) {
      requireConfirmation(ctx, connection.name);
      db.removeConnection(ctx.sessionId, connectionId);
    }
    if (db.listConnections(ctx.sessionId).length === 0) {
      destroySession(ctx.sessionId);
      clearSessionCookie(res);
    }
    redirect(res, "/");
  });

  post("/disconnect", async (ctx: RouteContext, res: ServerResponse) => {
    if (ctx.sessionId) {
      destroySession(ctx.sessionId);
      clearSessionCookie(res);
    }
    redirect(res, "/");
  });
}

export function parseConnectionUrl(value: string): DbConnection {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid database URL.");
  }
  if (url.protocol === "postgres:" || url.protocol === "postgresql:") {
    throw new Error("PostgreSQL URLs require the PostgreSQL driver, which is not supported yet.");
  }
  if (url.protocol !== "mysql:") {
    throw new Error("Only mysql:// database URLs are currently supported.");
  }
  if (!url.hostname) throw new Error("The database URL must include a host.");
  const user = decodeURIComponent(url.username || "root");
  const port = Number(url.port) || 3306;
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  return {
    id: randomUUID(),
    name: `${user}@${url.hostname}:${port}${database ? `/${database}` : ""}`,
    type: "mysql",
    host: url.hostname,
    port,
    user,
    password: decodeURIComponent(url.password),
    ...(database ? { database } : {}),
  };
}

function normalizeQueryTimeout(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 30_000;
  return Math.min(300_000, Math.max(100, Math.round(parsed)));
}
