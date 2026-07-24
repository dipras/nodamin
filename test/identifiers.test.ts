import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { quoteMySQLIdentifier } from "../src/db/mysql.js";
import { quoteSQLiteIdentifier, SQLiteDriver } from "../src/db/sqlite.js";

test("identifier helpers escape dialect quote characters", () => {
  assert.equal(quoteMySQLIdentifier("odd`name"), "`odd``name`");
  assert.equal(quoteSQLiteIdentifier('odd"name'), '"odd""name"');
});

test("SQLite CRUD supports quoted table and column names", async () => {
  const driver = new SQLiteDriver();
  driver.connect({
    id: "quoted",
    name: "quoted",
    type: "sqlite",
    filePath: ":memory:",
  });

  await driver.createTable('table"name', [{
    name: 'column"name',
    type: "TEXT",
    nullable: false,
    primary: true,
    autoIncrement: false,
  }]);
  await driver.insertRow('table"name', { 'column"name': "safe value" });

  assert.equal((await driver.getTableStructure('table"name'))[0]?.name, 'column"name');
  assert.deepEqual(
    await driver.getRow('table"name', { 'column"name': "safe value" }),
    { 'column"name': "safe value" }
  );
  driver.disconnect();
});

test("disconnect removes uploaded SQLite files and sidecars", () => {
  const filePath = join(tmpdir(), `nodamin-upload-${randomUUID()}.sqlite`);
  const driver = new SQLiteDriver();
  driver.connect({
    id: "upload",
    name: "upload",
    type: "sqlite",
    filePath,
    temporaryFile: true,
  });
  assert.equal(existsSync(filePath), true);

  driver.disconnect();

  assert.equal(existsSync(filePath), false);
  assert.equal(existsSync(`${filePath}-wal`), false);
  assert.equal(existsSync(`${filePath}-shm`), false);
});
