import assert from "node:assert/strict";
import test from "node:test";
import * as db from "../src/db/index.js";
import { parseConnectionUrl } from "../src/routes/connection.js";
import * as views from "../src/views/pages.js";

test("server database URLs are parsed without exposing passwords in labels", () => {
  const connection = parseConnectionUrl(
    "mysql://dev:p%40ss@db.example.test:3307/app%20db"
  );
  assert.equal(connection.type, "mysql");
  assert.equal(connection.host, "db.example.test");
  assert.equal(connection.port, 3307);
  assert.equal(connection.user, "dev");
  assert.equal(connection.password, "p@ss");
  assert.equal(connection.database, "app db");
  assert.equal(connection.name, "dev@db.example.test:3307/app db");
  assert.doesNotMatch(connection.name, /p@ss/);
  const mariaConnection = parseConnectionUrl(
    "mariadb://admin:secret@maria.example.test/inventory"
  );
  assert.equal(mariaConnection.type, "mariadb");
  assert.equal(mariaConnection.port, 3306);
  assert.equal(mariaConnection.database, "inventory");
  assert.doesNotMatch(mariaConnection.name, /secret/);
  const postgresConnection = parseConnectionUrl(
    "postgresql://pguser:pgsecret@postgres.example.test/app?sslmode=require"
  );
  assert.equal(postgresConnection.type, "postgresql");
  assert.equal(postgresConnection.port, 5432);
  assert.equal(postgresConnection.database, "app");
  assert.equal(postgresConnection.ssl, true);
  assert.doesNotMatch(postgresConnection.name, /pgsecret/);
});

test("MariaDB and PostgreSQL are shown in the connection UI", () => {
  const sessionId = "mariadb-driver-selection";
  db.connect(sessionId, {
    id: "maria",
    name: "MariaDB",
    type: "mariadb",
    host: "localhost",
  });
  assert.equal(db.getConnection(sessionId)?.type, "mariadb");
  db.disconnect(sessionId);

  const html = views.loginPage();
  assert.match(html, /option value="mariadb">MariaDB/);
  assert.match(html, /option value="postgresql">PostgreSQL/);
  assert.match(html, /postgresql:\/\//);
});

test("a session can switch between isolated active connections", async () => {
  const sessionId = "daily-workflow-connections";
  db.connect(sessionId, {
    id: "first",
    name: "First",
    type: "sqlite",
    filePath: ":memory:",
  });
  await db.executeQuery(sessionId, "CREATE TABLE first_table (id INTEGER)");

  db.connect(sessionId, {
    id: "second",
    name: "Second",
    type: "sqlite",
    filePath: ":memory:",
  });
  await db.executeQuery(sessionId, "CREATE TABLE second_table (id INTEGER)");

  assert.deepEqual(db.listConnections(sessionId).map(({ id }) => id), ["first", "second"]);
  assert.equal(db.getConnection(sessionId)?.id, "second");
  assert.equal(db.switchConnection(sessionId, "first"), true);
  assert.deepEqual(
    (await db.listTables(sessionId)).map(({ name }) => name),
    ["first_table"]
  );
  assert.equal(db.removeConnection(sessionId, "first"), true);
  assert.equal(db.getConnection(sessionId)?.id, "second");
  db.disconnect(sessionId);
});

test("column filters and full data export use the shared driver contract", async () => {
  const sessionId = "daily-workflow-filter";
  db.connect(sessionId, {
    id: "filter",
    name: "Filter",
    type: "sqlite",
    filePath: ":memory:",
  });
  await db.executeQuery(
    sessionId,
    "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);"
  );
  await db.executeQuery(sessionId, "INSERT INTO users VALUES (1, 'Ada')");
  await db.executeQuery(sessionId, "INSERT INTO users VALUES (2, 'Grace')");

  const filtered = await db.getTableData(
    sessionId,
    "users",
    1,
    50,
    undefined,
    undefined,
    { name: "rac" }
  );
  assert.equal(filtered.total, 1);
  assert.deepEqual(filtered.rows, [{ id: 2, name: "Grace" }]);
  assert.equal((await db.getTableRows(sessionId, "users")).length, 2);
  db.disconnect(sessionId);
});

test("SQL workspace exposes save, autocomplete, export, and explain controls", () => {
  const html = views.sqlPage({
    database: "app",
    tables: [{ name: "users" }],
    result: {
      fields: [{
        name: "id",
        type: "INTEGER",
        nullable: false,
        key: "PRI",
        defaultValue: null,
        extra: "",
      }],
      rows: [{ id: 1 }],
    },
    autocomplete: {
      schemas: ["app"],
      tables: ["users"],
      columns: ["id"],
    },
  });
  assert.match(html, /id="saveQueryButton"/);
  assert.match(html, /id="sqlSuggestions"/);
  assert.match(html, /Saved & snippets/);
  assert.match(html, /data-export-result="csv"/);
  assert.match(html, /data-export-result="json"/);
  assert.match(html, /id="explainQueryButton"/);
  for (const match of html.matchAll(/<script(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/g)) {
    assert.doesNotThrow(() => new Function(match[1]!));
  }
});
