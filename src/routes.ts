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

  // ---- Create Table (must be before generic /db/:db/table/:table) ----

  get("/db/:db/table/create", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const dbName = ctx.params["db"]!;
    db.setCurrentDatabase(dbName);
    const tables = await db.listTables();
    sendHtml(res, 200, views.createTablePage(dbName, tables));
  });

  post("/db/:db/table/create", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const dbName = ctx.params["db"]!;
    db.setCurrentDatabase(dbName);

    const tableName = ctx.body["tableName"] as string;
    const colNames = Array.isArray(ctx.body["colName[]"]) ? ctx.body["colName[]"] : [ctx.body["colName[]"]];
    const colTypes = Array.isArray(ctx.body["colType[]"]) ? ctx.body["colType[]"] : [ctx.body["colType[]"]];
    const colLengths = Array.isArray(ctx.body["colLength[]"]) ? ctx.body["colLength[]"] : [ctx.body["colLength[]"]];
    const colPrimary = ctx.body["colPrimary[]"] ? (Array.isArray(ctx.body["colPrimary[]"]) ? ctx.body["colPrimary[]"] : [ctx.body["colPrimary[]"]]) : [];
    const colNullable = ctx.body["colNullable[]"] ? (Array.isArray(ctx.body["colNullable[]"]) ? ctx.body["colNullable[]"] : [ctx.body["colNullable[]"]]) : [];
    const colAutoInc = ctx.body["colAutoInc[]"] ? (Array.isArray(ctx.body["colAutoInc[]"]) ? ctx.body["colAutoInc[]"] : [ctx.body["colAutoInc[]"]]) : [];
    const colDefault = ctx.body["colDefault[]"] ? (Array.isArray(ctx.body["colDefault[]"]) ? ctx.body["colDefault[]"] : [ctx.body["colDefault[]"]]) : [];

    const columns = (colNames as string[]).map((name, i) => {
      const baseType = (colTypes as string[])[i]!;
      const length = (colLengths as string[])[i];
      // Combine type with length if length provided
      const fullType = length && length.trim() ? `${baseType}(${length})` : baseType;
      
      const col: any = {
        name,
        type: fullType,
        nullable: (colNullable as string[]).includes(String(i)),
        primary: (colPrimary as string[]).includes(String(i)),
        autoIncrement: (colAutoInc as string[]).includes(String(i)),
      };
      const defVal = (colDefault as string[])[i];
      if (defVal && defVal.trim() !== '') {
        col.defaultValue = defVal;
      }
      return col;
    });

    console.log("Creating table:", tableName, "with columns:", JSON.stringify(columns, null, 2));

    try {
      await db.createTable(tableName, columns);
      redirect(res, `/db/${encodeURIComponent(dbName)}/table/${encodeURIComponent(tableName)}`);
    } catch (err: unknown) {
      console.error("Failed to create table:", err);
      const msg = err instanceof Error ? err.message : String(err);
      const tables = await db.listTables();
      sendHtml(res, 200, views.createTablePage(dbName, tables, msg));
    }
  });

  // ---- Import SQL (must be before generic /db/:db/table/:table) ----

  get("/db/:db/import", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const dbName = ctx.params["db"]!;
    db.setCurrentDatabase(dbName);
    const tables = await db.listTables();
    sendHtml(res, 200, views.importPage(dbName, tables));
  });

  post("/db/:db/import", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const dbName = ctx.params["db"]!;
    db.setCurrentDatabase(dbName);

    const sql = ctx.body["sql"] as string;
    
    try {
      const result = await db.importSQL(sql);
      const tables = await db.listTables();
      sendHtml(res, 200, views.importPage(dbName, tables, { message: result.message || 'Import successful' }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const tables = await db.listTables();
      sendHtml(res, 200, views.importPage(dbName, tables, undefined, msg));
    }
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
    const [columns, tables] = await Promise.all([
      db.getTableStructure(table),
      db.listTables()
    ]);
    sendHtml(res, 200, views.tableStructurePage(dbName, table, columns, tables));
  });

  get("/db/:db/table/:table/insert", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const dbName = ctx.params["db"]!;
    const table = ctx.params["table"]!;
    db.setCurrentDatabase(dbName);
    const [columns, tables] = await Promise.all([
      db.getTableStructure(table),
      db.listTables()
    ]);
    sendHtml(res, 200, views.insertPage(dbName, table, columns, tables));
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
      const tables = await db.listTables();
      sendHtml(res, 200, views.insertPage(dbName, table, columns, tables, msg));
    }
  });

  get("/db/:db/table/:table/edit", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const dbName = ctx.params["db"]!;
    const table = ctx.params["table"]!;
    db.setCurrentDatabase(dbName);

    const [columns, tables] = await Promise.all([
      db.getTableStructure(table),
      db.listTables()
    ]);
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

    sendHtml(res, 200, views.editPage(dbName, table, columns, result.rows[0]!, tables));
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
      const tables = await db.listTables();
      sendHtml(res, 200, views.editPage(dbName, table, columns, ctx.body as Record<string, unknown>, tables, msg));
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

  // ---- Bulk Actions for Tables ----

  post("/db/:db/tables/bulk", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const dbName = ctx.params["db"]!;
    db.setCurrentDatabase(dbName);

    const action = ctx.body["action"] as string;
    const tables = Array.isArray(ctx.body["tables[]"]) 
      ? ctx.body["tables[]"] as string[] 
      : [ctx.body["tables[]"] as string];

    if (!tables || tables.length === 0) {
      redirect(res, `/db/${encodeURIComponent(dbName)}`);
      return;
    }

    try {
      if (action === "drop") {
        for (const table of tables) {
          await db.dropTable(table);
        }
      } else if (action === "truncate") {
        for (const table of tables) {
          await db.truncateTable(table);
        }
      } else if (action === "export") {
        // Generate combined SQL dump
        let combinedDump = "";
        for (const table of tables) {
          const dump = await db.exportTable(table);
          combinedDump += dump + "\n\n";
        }
        
        res.writeHead(200, {
          "Content-Type": "application/sql",
          "Content-Disposition": `attachment; filename="${dbName}_export.sql"`,
        });
        res.end(combinedDump);
        return;
      }
    } catch (err: unknown) {
      console.error("Bulk action failed:", err);
    }

    redirect(res, `/db/${encodeURIComponent(dbName)}`);
  });

  // ---- Bulk Delete for Rows ----

  post("/db/:db/table/:table/bulk-delete", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const dbName = ctx.params["db"]!;
    const table = ctx.params["table"]!;
    db.setCurrentDatabase(dbName);

    const rowIds = Array.isArray(ctx.body["rows[]"]) 
      ? ctx.body["rows[]"] as string[] 
      : [ctx.body["rows[]"] as string];

    if (!rowIds || rowIds.length === 0) {
      redirect(res, `/db/${encodeURIComponent(dbName)}/table/${encodeURIComponent(table)}`);
      return;
    }

    // Get primary keys
    const columns = await db.getTableStructure(table);
    const primaryKeys = columns.filter(c => c.key === 'PRI').map(c => c.name);

    if (primaryKeys.length === 0) {
      console.warn("No primary keys found, cannot bulk delete");
      redirect(res, `/db/${encodeURIComponent(dbName)}/table/${encodeURIComponent(table)}`);
      return;
    }

    try {
      // Each rowId is a pipe-separated string of primary key values
      for (const rowId of rowIds) {
        const values = rowId.split('|');
        const where: Record<string, unknown> = {};
        
        primaryKeys.forEach((pk, i) => {
          where[pk] = values[i];
        });

        await db.deleteRow(table, where);
      }
    } catch (err: unknown) {
      console.error("Bulk delete failed:", err);
    }

    redirect(res, `/db/${encodeURIComponent(dbName)}/table/${encodeURIComponent(table)}`);
  });

  // ---- SQL Query ----

  get("/sql", async (_ctx: RouteContext, res: ServerResponse) => {
    sendHtml(res, 200, views.sqlPage(null, []));
  });

  post("/sql", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const sql = (ctx.body["sql"] as string) ?? "";
    const result = await db.executeQuery(sql);
    sendHtml(res, 200, views.sqlPage(null, [], result, sql));
  });

  get("/db/:db/sql", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const dbName = ctx.params["db"]!;
    db.setCurrentDatabase(dbName);
    const tables = await db.listTables();
    sendHtml(res, 200, views.sqlPage(dbName, tables));
  });

  post("/db/:db/sql", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const dbName = ctx.params["db"]!;
    db.setCurrentDatabase(dbName);
    const sql = (ctx.body["sql"] as string) ?? "";
    const [result, tables] = await Promise.all([
      db.executeQuery(sql),
      db.listTables()
    ]);
    sendHtml(res, 200, views.sqlPage(dbName, tables, result, sql));
  });

  // ---- Export Table ----

  get("/db/:db/table/:table/export", async (ctx: RouteContext, res: ServerResponse) => {
    if (!requireConnection(res)) return;
    const dbName = ctx.params["db"]!;
    const table = ctx.params["table"]!;
    db.setCurrentDatabase(dbName);

    const dump = await db.exportTable(table);

    // If download param exists, send as file
    if (ctx.query["download"]) {
      res.writeHead(200, {
        "Content-Type": "application/sql",
        "Content-Disposition": `attachment; filename="${table}.sql"`,
      });
      res.end(dump);
      return;
    }

    const tables = await db.listTables();
    sendHtml(res, 200, views.exportPage(dbName, table, dump, tables));
  });
}
