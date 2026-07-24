import assert from "node:assert/strict";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { SQLiteDriver } from "../src/db/sqlite.js";

test("SQLite integration covers CRUD, pagination, sorting, import, and export", async () => {
  const driver = new SQLiteDriver();
  driver.connect({
    id: "integration",
    name: "integration",
    type: "sqlite",
    filePath: ":memory:",
  });

  try {
    await driver.createTable("items", [
      {
        name: "id",
        type: "INTEGER",
        nullable: false,
        primary: true,
        autoIncrement: true,
      },
      {
        name: "name",
        type: "TEXT",
        nullable: false,
        primary: false,
        autoIncrement: false,
      },
    ]);

    for (const name of ["delta", "alpha", "charlie", "bravo", "echo"]) {
      await driver.insertRow("items", { name });
    }

    const firstPage = await driver.getTableData("items", 1, 2, "name", "asc");
    const secondPage = await driver.getTableData("items", 2, 2, "name", "asc");
    assert.equal(firstPage.total, 5);
    assert.deepEqual(firstPage.rows.map((row) => row["name"]), ["alpha", "bravo"]);
    assert.deepEqual(secondPage.rows.map((row) => row["name"]), ["charlie", "delta"]);

    const alpha = firstPage.rows[0]!;
    await driver.updateRow("items", { name: "alpine" }, { id: alpha["id"] });
    assert.equal((await driver.getRow("items", { id: alpha["id"] }))?.["name"], "alpine");
    await driver.deleteRow("items", { id: alpha["id"] });
    assert.equal(await driver.getRow("items", { id: alpha["id"] }), null);

    const dump = await driver.exportTable("items");
    assert.match(dump, /CREATE TABLE "items"/);
    assert.match(dump, /INSERT INTO "items"/);

    await driver.importSQL(`
      CREATE TABLE source (id INTEGER PRIMARY KEY, value TEXT);
      CREATE TABLE audit (message TEXT);
      CREATE TRIGGER source_audit AFTER INSERT ON source
      BEGIN
        INSERT INTO audit(message) VALUES ('created;successfully');
      END;
      INSERT INTO source(value) VALUES ('hello');
    `);
    const audit = await driver.executeQuery("SELECT message FROM audit");
    assert.equal(audit.rows[0]?.["message"], "created;successfully");
  } finally {
    driver.disconnect();
  }
});

test("SQLite import rolls back the full script after an error", async () => {
  const driver = new SQLiteDriver();
  driver.connect({ id: "rollback", name: "rollback", type: "sqlite", filePath: ":memory:" });
  try {
    await driver.executeQuery("CREATE TABLE entries (value TEXT)");
    await assert.rejects(
      driver.importSQL(`
        INSERT INTO entries(value) VALUES ('before failure');
        INSERT INTO missing_table(value) VALUES ('failure');
      `),
      /rolled back/
    );
    const result = await driver.executeQuery("SELECT * FROM entries");
    assert.equal(result.rows.length, 0);
  } finally {
    driver.disconnect();
  }
});

test("SQLite read-only mode permits inspection and rejects mutation", async () => {
  const filePath = join(tmpdir(), `nodamin-read-only-${randomUUID()}.sqlite`);
  const writer = new SQLiteDriver();
  writer.connect({ id: "writer", name: "writer", type: "sqlite", filePath });
  await writer.executeQuery("CREATE TABLE entries (value TEXT)");
  await writer.insertRow("entries", { value: "preserved" });
  writer.disconnect();

  const reader = new SQLiteDriver();
  try {
    reader.connect({
      id: "reader",
      name: "reader",
      type: "sqlite",
      filePath,
      readOnly: true,
    });
    const result = await reader.executeQuery("SELECT value FROM entries");
    assert.equal(result.rows[0]?.["value"], "preserved");
    await assert.rejects(reader.insertRow("entries", { value: "blocked" }), /Read-only mode/);
    assert.match(
      (await reader.executeQuery("DELETE FROM entries")).message ?? "",
      /Read-only mode/
    );
  } finally {
    reader.disconnect();
    if (existsSync(filePath)) unlinkSync(filePath);
  }
});
