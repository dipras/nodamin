import type { ServerResponse } from "node:http";
import * as db from "../db/index.js";
import { post, redirect, sendHtml } from "../router.js";
import type { ColumnDefinition, ForeignKeyInfo, RouteContext } from "../types.js";
import * as views from "../views/pages.js";
import { requireConfirmation, requireConnection } from "./shared.js";

export function registerSchemaManagementRoutes(): void {
  post("/db/:db/table/:table/columns/add", async (ctx, res) => {
    await runAction(ctx, res, () =>
      db.addColumn(ctx.sessionId!, ctx.params["table"]!, columnDefinition(ctx)));
  });

  post("/db/:db/table/:table/columns/:column/modify", async (ctx, res) => {
    await runAction(ctx, res, () =>
      db.modifyColumn(
        ctx.sessionId!,
        ctx.params["table"]!,
        ctx.params["column"]!,
        columnDefinition(ctx, ctx.params["column"]!)
      ));
  });

  post("/db/:db/table/:table/columns/:column/rename", async (ctx, res) => {
    await runAction(ctx, res, () =>
      db.renameColumn(
        ctx.sessionId!,
        ctx.params["table"]!,
        ctx.params["column"]!,
        requiredText(ctx.body["newName"], "New column name")
      ));
  });

  post("/db/:db/table/:table/columns/:column/drop", async (ctx, res) => {
    await runAction(ctx, res, async () => {
      requireConfirmation(ctx, ctx.params["column"]!);
      return db.dropColumn(ctx.sessionId!, ctx.params["table"]!, ctx.params["column"]!);
    });
  });

  post("/db/:db/table/:table/indexes/create", async (ctx, res) => {
    await runAction(ctx, res, () =>
      db.createIndex(
        ctx.sessionId!,
        ctx.params["table"]!,
        requiredText(ctx.body["name"], "Index name"),
        asArray(ctx.body["columns[]"]),
        ctx.body["unique"] === "1"
      ));
  });

  post("/db/:db/table/:table/indexes/:index/drop", async (ctx, res) => {
    await runAction(ctx, res, async () => {
      requireConfirmation(ctx, ctx.params["index"]!);
      return db.dropIndex(ctx.sessionId!, ctx.params["table"]!, ctx.params["index"]!);
    });
  });

  post("/db/:db/table/:table/foreign-keys/create", async (ctx, res) => {
    await runAction(ctx, res, () => {
      const foreignKey: ForeignKeyInfo = {
        name: requiredText(ctx.body["name"], "Constraint name"),
        columns: [requiredText(ctx.body["column"], "Column")],
        referencedTable: requiredText(ctx.body["referencedTable"], "Referenced table"),
        referencedColumns: [requiredText(ctx.body["referencedColumn"], "Referenced column")],
        onUpdate: String(ctx.body["onUpdate"] ?? "NO ACTION"),
        onDelete: String(ctx.body["onDelete"] ?? "NO ACTION"),
      };
      return db.createForeignKey(ctx.sessionId!, ctx.params["table"]!, foreignKey);
    });
  });

  post("/db/:db/table/:table/foreign-keys/:foreignKey/drop", async (ctx, res) => {
    await runAction(ctx, res, async () => {
      requireConfirmation(ctx, ctx.params["foreignKey"]!);
      return db.dropForeignKey(
        ctx.sessionId!,
        ctx.params["table"]!,
        ctx.params["foreignKey"]!
      );
    });
  });
}

async function runAction(
  ctx: RouteContext,
  res: ServerResponse,
  action: () => Promise<unknown>
): Promise<void> {
  if (!requireConnection(ctx, res)) return;
  const database = ctx.params["db"]!;
  const table = ctx.params["table"]!;
  db.setCurrentDatabase(ctx.sessionId!, database);
  try {
    await action();
    redirect(res, structurePath(database, table));
  } catch (error: unknown) {
    await renderStructure(
      ctx,
      res,
      error instanceof Error ? error.message : String(error)
    );
  }
}

export async function renderStructure(
  ctx: RouteContext,
  res: ServerResponse,
  error?: string
): Promise<void> {
  const database = ctx.params["db"]!;
  const table = ctx.params["table"]!;
  db.setCurrentDatabase(ctx.sessionId!, database);
  const [columns, indexes, foreignKeys, tables] = await Promise.all([
    db.getTableStructure(ctx.sessionId!, table),
    db.listIndexes(ctx.sessionId!, table),
    db.listForeignKeys(ctx.sessionId!, table),
    db.listTables(ctx.sessionId!),
  ]);
  const references = await Promise.all(tables.map(async ({ name }) => ({
    name,
    columns: (await db.getTableStructure(ctx.sessionId!, name)).map(({ name: column }) => column),
  })));
  sendHtml(res, 200, views.tableStructurePage({
    database,
    table,
    columns,
    indexes,
    foreignKeys,
    references,
    tables,
    readOnly: db.isReadOnly(ctx.sessionId),
    ...(error ? { error } : {}),
  }));
}

function columnDefinition(ctx: RouteContext, fallbackName = ""): ColumnDefinition {
  const defaultValue = String(ctx.body["defaultValue"] ?? "").trim();
  return {
    name: requiredText(ctx.body["name"] ?? fallbackName, "Column name"),
    type: requiredText(ctx.body["type"], "Column type"),
    nullable: ctx.body["nullable"] === "1",
    ...(defaultValue ? { defaultValue } : {}),
  };
}

function requiredText(value: unknown, label: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function asArray(value: unknown): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map(String).filter(Boolean);
}

function structurePath(database: string, table: string): string {
  return `/db/${encodeURIComponent(database)}/table/${encodeURIComponent(table)}/structure`;
}
