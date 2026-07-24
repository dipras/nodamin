import assert from "node:assert/strict";
import test from "node:test";
import * as views from "../src/views/pages.js";
import { requireConfirmation } from "../src/routes/shared.js";
import type { RouteContext } from "../src/types.js";

test("typed destructive confirmation must match exactly", () => {
  const context = {
    body: { confirmation: "orders" },
  } as unknown as RouteContext;
  assert.doesNotThrow(() => requireConfirmation(context, "orders"));
  assert.throws(() => requireConfirmation(context, "ORDERS"), /Type "ORDERS" exactly/);
});

test("read-only database pages hide mutation controls", () => {
  const databaseHtml = views.databaseListPage(["app"], undefined, undefined, true);
  assert.match(databaseHtml, /Read-only/);
  assert.doesNotMatch(databaseHtml, /Create Database|Drop database/);

  const tableHtml = views.tableDataPage({
    database: "app",
    table: "users",
    fields: ["id"],
    rows: [{ id: 1 }],
    total: 1,
    page: 1,
    perPage: 50,
    primaryKeys: ["id"],
    readOnly: true,
  });
  assert.match(tableHtml, /Read-only/);
  assert.doesNotMatch(tableHtml, /Insert Row|Delete row|>Edit</);
});

test("MySQL SQL page exposes timeout and cancellation controls", () => {
  const html = views.sqlPage({
    database: "app",
    tables: [],
    queryTimeoutMs: 12_000,
    canCancel: true,
  });
  assert.match(html, /name="timeoutMs" value="12000"/);
  assert.match(html, /id="cancelQueryButton"/);
  assert.match(html, /\/db\/app\/query\/cancel/);
});
