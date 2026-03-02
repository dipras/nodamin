// ============================================================
// Nodamin - Route Handlers
// ============================================================

import type { ServerResponse } from "node:http";
import { get, post, sendHtml, redirect } from "./router.js";
import * as db from "./db/mysql.js";
import * as views from "./views/pages.js";
import type { RouteContext } from "./types.js";

// Helper to check if connected to database
function requireConnection(res: ServerResponse): boolean {
  if (!db.getConnection()) {
    redirect(res, "/");
    return false;
  }
  return true;
}

export function registerRoutes(): void {
  // ---- Connection ----

  get("/", async (_ctx: RouteContext, res: ServerResponse) => {
    const conn = db.getConnection();
    if (!conn) {
      sendHtml(res, 200, views.loginPage());
      return;
    }
    const databases = await db.listDatabases();
    sendHtml(res, 200, views.databaseListPage(databases, conn.name));
  });

  post("/connect", async (ctx: RouteContext, res: ServerResponse) => {
    const { host, port, user, password, type } = ctx.body as Record<string, string>;
    const conn = {
      id: "default",
      name: `${user}@${host}:${port}`,
      type: (type ?? "mysql") as "mysql",
      host: host ?? "localhost",
      port: Number(port) || 3306,
      user: user ?? "root",
      password: password ?? "",
    };

    const ok = await db.testConnection(conn);
    if (!ok) {
      sendHtml(res, 200, views.loginPage("Connection failed. Please check your credentials."));
      return;
    }
    db.connect(conn);
    redirect(res, "/");
  });

  get("/disconnect", async (_ctx: RouteContext, res: ServerResponse) => {
    db.disconnect();
    redirect(res, "/");
  });

  // ---- Database operations ----

  post("/db/create", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const name = ctx.body["name"] as string;
    if (name) {
      await db.createDatabase(name);
    }
    redirect(res, "/");
  });

  get("/db/:db/drop", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    await db.dropDatabase(ctx.params["db"]!);
    db.setCurrentDatabase(null);
    redirect(res, "/");
  });

  get("/db/:db", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const dbName = ctx.params["db"]!;
    db.setCurrentDatabase(dbName);
    const tables = await db.listTables();
    sendHtml(res, 200, views.tableListPage(dbName, tables));
  });

  // ---- Table operations ----

  get("/db/:db/table/:table", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const dbName = ctx.params["db"]!;
    const table = ctx.params["table"]!;
    db.setCurrentDatabase(dbName);

    const page = Number(ctx.query["page"]) || 1;
    const sort = ctx.query["sort"];
    const order = ctx.query["order"];

    const [data, columns] = await Promise.all([
      db.getTableData(table, page, 50, sort, order),
      db.getTableStructure(table)
    ]);
    const primaryKeys = columns.filter(c => c.key === 'PRI').map(c => c.name);
    
    sendHtml(
      res,
      200,
      views.tableDataPage(dbName, table, data.fields, data.rows, data.total, page, 50, primaryKeys, sort, order)
    );
  });

  get("/db/:db/table/:table/structure", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const dbName = ctx.params["db"]!;
    const table = ctx.params["table"]!;
    db.setCurrentDatabase(dbName);
    const columns = await db.getTableStructure(table);
    sendHtml(res, 200, views.tableStructurePage(dbName, table, columns));
  });

  get("/db/:db/table/:table/insert", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const dbName = ctx.params["db"]!;
    const table = ctx.params["table"]!;
    db.setCurrentDatabase(dbName);
    const columns = await db.getTableStructure(table);
    sendHtml(res, 200, views.insertPage(dbName, table, columns));
  });

  post("/db/:db/table/:table/insert", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const dbName = ctx.params["db"]!;
    const table = ctx.params["table"]!;
    db.setCurrentDatabase(dbName);

    const columns = await db.getTableStructure(table);
    const data: Record<string, unknown> = {};
    for (const col of columns) {
      if (col.extra.includes("auto_increment")) continue;
      const val = ctx.body[col.name];
      if (val === "" && col.nullable) {
        data[col.name] = null;
      } else if (val !== undefined && val !== "") {
        data[col.name] = val;
      }
    }

    try {
      await db.insertRow(table, data);
      redirect(res, `/db/${encodeURIComponent(dbName)}/table/${encodeURIComponent(table)}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendHtml(res, 200, views.insertPage(dbName, table, columns, msg));
    }
  });

  get("/db/:db/table/:table/edit", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const dbName = ctx.params["db"]!;
    const table = ctx.params["table"]!;
    db.setCurrentDatabase(dbName);

    const columns = await db.getTableStructure(table);
    // Build WHERE from query params
    const where = { ...ctx.query };
    delete where["page"];
    delete where["sort"];
    delete where["order"];

    // Get the specific row
    const whereClauses = Object.entries(where)
      .map(([k, v]) => `\`${k}\` = '${v.replace(/'/g, "\\'")}'`)
      .join(" AND ");
    const result = await db.executeQuery(
      `SELECT * FROM \`${table}\` WHERE ${whereClauses} LIMIT 1`
    );

    if (result.rows.length === 0) {
      sendHtml(res, 404, views.errorPage("Row Not Found", "The requested row was not found.", `/db/${encodeURIComponent(dbName)}/table/${encodeURIComponent(table)}`));
      return;
    }

    sendHtml(res, 200, views.editPage(dbName, table, columns, result.rows[0]!));
  });

  post("/db/:db/table/:table/update", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const dbName = ctx.params["db"]!;
    const table = ctx.params["table"]!;
    db.setCurrentDatabase(dbName);

    // Original values from query string (WHERE clause)
    const where: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(ctx.query)) {
      where[k] = v;
    }

    // New values from body
    const data: Record<string, unknown> = {};
    const columns = await db.getTableStructure(table);
    for (const col of columns) {
      const val = ctx.body[col.name];
      if (val === "" && col.nullable) {
        data[col.name] = null;
      } else if (val !== undefined) {
        data[col.name] = val;
      }
    }

    try {
      await db.updateRow(table, data, where);
      redirect(res, `/db/${encodeURIComponent(dbName)}/table/${encodeURIComponent(table)}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendHtml(res, 200, views.editPage(dbName, table, columns, ctx.body as Record<string, unknown>, msg));
    }
  });

  get("/db/:db/table/:table/delete", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const dbName = ctx.params["db"]!;
    const table = ctx.params["table"]!;
    db.setCurrentDatabase(dbName);

    const where: Record<string, unknown> = { ...ctx.query };
    await db.deleteRow(table, where);
    redirect(res, `/db/${encodeURIComponent(dbName)}/table/${encodeURIComponent(table)}`);
  });

  get("/db/:db/table/:table/drop", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const dbName = ctx.params["db"]!;
    const table = ctx.params["table"]!;
    db.setCurrentDatabase(dbName);
    await db.dropTable(table);
    redirect(res, `/db/${encodeURIComponent(dbName)}`);
  });

  get("/db/:db/table/:table/truncate", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const dbName = ctx.params["db"]!;
    const table = ctx.params["table"]!;
    db.setCurrentDatabase(dbName);
    await db.truncateTable(table);
    redirect(res, `/db/${encodeURIComponent(dbName)}/table/${encodeURIComponent(table)}`);
  });

  // ---- SQL Query ----

  get("/sql", async (_ctx: RouteContext, res: ServerResponse) => {
    sendHtml(res, 200, views.sqlPage(null));
  });

  post("/sql", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const sql = (ctx.body["sql"] as string) ?? "";
    const result = await db.executeQuery(sql);
    sendHtml(res, 200, views.sqlPage(null, result, sql));
  });

  get("/db/:db/sql", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const dbName = ctx.params["db"]!;
    db.setCurrentDatabase(dbName);
    sendHtml(res, 200, views.sqlPage(dbName));
  });

  post("/db/:db/sql", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const dbName = ctx.params["db"]!;
    db.setCurrentDatabase(dbName);
    const sql = (ctx.body["sql"] as string) ?? "";
    const result = await db.executeQuery(sql);
    sendHtml(res, 200, views.sqlPage(dbName, result, sql));
  });
}
