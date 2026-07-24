import path from "node:path";
import type { ServerResponse } from "node:http";
import type { File } from "formidable";
import * as db from "../db/index.js";
import { get, post, redirect, sendHtml } from "../router.js";
import { clearSessionCookie, createSession, destroySession } from "../session.js";
import type { DbConnection, RouteContext } from "../types.js";
import * as views from "../views/pages.js";
import { cleanupTemporaryFile } from "./shared.js";

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
    sendHtml(res, 200, views.databaseListPage(databases));
  });

  post("/connect", async (ctx: RouteContext, res: ServerResponse) => {
    let uploadedFilePath: string | null = null;
    try {
      const dbType = ((ctx.body["type"] as string) ?? "mysql") as "mysql" | "sqlite";
      const sqliteMode = ctx.body["sqliteMode"] as string;
      let conn: DbConnection;

      if (dbType === "sqlite") {
        if (sqliteMode === "create") {
          const dbName = (ctx.body["newDbName"] as string) || `memory_db_${Date.now()}`;
          conn = {
            id: "default",
            name: dbName,
            type: "sqlite",
            filePath: ":memory:",
          };
        } else {
          const file = ctx.body["sqliteFile"] as File | undefined;
          if (!file?.filepath) {
            sendHtml(res, 200, views.loginPage("Please upload a valid SQLite database file."));
            return;
          }
          uploadedFilePath = file.filepath;
          conn = {
            id: "default",
            name: path.basename(file.filepath),
            type: "sqlite",
            filePath: file.filepath,
            temporaryFile: true,
          };
        }
      } else {
        const { host, port, user, password } = ctx.body as Record<string, string>;
        conn = {
          id: "default",
          name: `${user ?? "root"}@${host ?? "localhost"}:${port ?? "3306"}`,
          type: "mysql",
          host: host ?? "localhost",
          port: Number(port) || 3306,
          user: user ?? "root",
          password: password ?? "",
        };
      }

      if (!await db.testConnection(conn)) {
        cleanupTemporaryFile(uploadedFilePath);
        sendHtml(res, 200, views.loginPage("Connection failed. Please check your credentials or file."));
        return;
      }

      const sessionId = createSession(res);
      db.connect(sessionId, conn);
      uploadedFilePath = null;
      redirect(res, "/");
    } catch (err: unknown) {
      cleanupTemporaryFile(uploadedFilePath);
      console.error("[Connect Error]:", err);
      sendHtml(res, 200, views.loginPage("Internal error occurred during connection. Check server logs."));
    }
  });

  post("/disconnect", async (ctx: RouteContext, res: ServerResponse) => {
    if (ctx.sessionId) {
      destroySession(ctx.sessionId);
      clearSessionCookie(res);
    }
    redirect(res, "/");
  });
}
