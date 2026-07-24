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
    tables: [{ name: "users" }],
    readOnly: true,
  });
  assert.match(tableHtml, /Read-only/);
  assert.doesNotMatch(tableHtml, /Insert Row|Delete row|>Edit</);
  assert.match(tableHtml, /id="app-sidebar"/);
  assert.match(tableHtml, /data-label="users"/);
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
  assert.match(html, /id="explainQueryButton"/);
  assert.match(html, /Ctrl\/⌘ \+ Enter to execute/);
  assert.match(html, /Recent Queries/);
});

test("layout renders a persistent sidebar toggle on contextual pages", () => {
  const html = views.tableStructurePage({
    database: "app",
    table: "users",
    columns: [],
    tables: [{ name: "users" }, { name: "roles" }],
  });
  assert.match(html, /id="sidebar-toggle"/);
  assert.match(html, /id="app-sidebar"/);
  assert.match(html, /localStorage\.getItem\('nodamin-sidebar-collapsed'\)/);
  assert.match(html, /data-label="users"[\s\S]*?class="active"/);
});

test("writable table browse keeps row actions sticky and hover-revealed", () => {
  const html = views.tableDataPage({
    database: "app",
    table: "users",
    fields: ["id", "email"],
    rows: [{ id: 1, email: "user@example.com" }],
    total: 1,
    page: 1,
    perPage: 50,
    primaryKeys: ["id"],
    tables: [{ name: "users" }],
  });
  assert.match(html, /class="browse-table"/);
  assert.match(html, /class="browse-actions-heading"/);
  assert.match(html, /class="browse-actions-cell"/);
  assert.match(html, /class="browse-row-actions"/);
});

test("table list prioritizes safe actions and hides destructive actions in a menu", () => {
  const html = views.tableListPage({
    database: "app",
    tables: [{
      name: "users",
      engine: "InnoDB",
      rows: 1_500,
      size: "64 KB",
      collation: "utf8mb4_unicode_520_ci",
    }],
  });
  assert.match(html, />Browse</);
  assert.match(html, />Structure</);
  assert.match(html, />SQL</);
  assert.match(html, /class="action-menu table-action-menu"/);
  assert.match(html, /class="table-number">1,500</);
  assert.match(html, /title="utf8mb4_unicode_520_ci"/);
});
