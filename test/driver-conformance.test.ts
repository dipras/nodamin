import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { DatabaseDriver } from "../src/db/driver.js";
import { MySQLDriver } from "../src/db/mysql.js";
import { SQLiteDriver } from "../src/db/sqlite.js";
import type { DbConnection } from "../src/types.js";

interface ConformanceTarget {
  driver: DatabaseDriver;
  connection: DbConnection;
  database?: string;
}

async function assertDriverConformance(target: ConformanceTarget): Promise<void> {
  const { driver, connection, database } = target;
  const table = `nodamin_conformance_${randomUUID().replaceAll("-", "")}`;
  driver.connect(connection);
  if (database) driver.setCurrentDatabase(database);

  try {
    assert.equal(driver.getConnection()?.type, connection.type);
    await driver.createTable(table, [
      {
        name: "id",
        type: "INTEGER",
        nullable: false,
        primary: true,
        autoIncrement: true,
      },
      {
        name: "label",
        type: "TEXT",
        nullable: false,
        primary: false,
        autoIncrement: false,
      },
    ]);
    assert.ok((await driver.listTables()).some((item) => item.name === table));
    assert.deepEqual(
      (await driver.getTableStructure(table)).map((column) => column.name),
      ["id", "label"]
    );

    await driver.insertRow(table, { label: "first" });
    const initial = await driver.getTableData(table, 1, 10, "id", "asc");
    assert.equal(initial.total, 1);
    const id = initial.rows[0]?.["id"];
    assert.notEqual(id, undefined);

    await driver.updateRow(table, { label: "updated" }, { id });
    assert.equal((await driver.getRow(table, { id }))?.["label"], "updated");
    assert.match(await driver.exportTable(table), /CREATE TABLE/i);

    await driver.deleteRow(table, { id });
    assert.equal((await driver.getTableData(table)).total, 0);
  } finally {
    try {
      await driver.dropTable(table);
    } finally {
      driver.disconnect();
    }
  }
}

test("SQLite satisfies the shared database driver contract", async () => {
  await assertDriverConformance({
    driver: new SQLiteDriver(),
    connection: {
      id: "sqlite-conformance",
      name: "sqlite-conformance",
      type: "sqlite",
      filePath: ":memory:",
    },
  });
});

const mysqlHost = process.env["NODAMIN_TEST_MYSQL_HOST"];
const mysqlDatabase = process.env["NODAMIN_TEST_MYSQL_DATABASE"];

test("MySQL satisfies the shared database driver contract", {
  skip: !mysqlHost || !mysqlDatabase
    ? "Set NODAMIN_TEST_MYSQL_HOST and NODAMIN_TEST_MYSQL_DATABASE to run"
    : false,
}, async () => {
  await assertDriverConformance({
    driver: new MySQLDriver(),
    database: mysqlDatabase!,
    connection: {
      id: "mysql-conformance",
      name: "mysql-conformance",
      type: "mysql",
      host: mysqlHost!,
      port: Number(process.env["NODAMIN_TEST_MYSQL_PORT"] ?? 3306),
      user: process.env["NODAMIN_TEST_MYSQL_USER"] ?? "root",
      password: process.env["NODAMIN_TEST_MYSQL_PASSWORD"] ?? "",
    },
  });
});

test("MySQL query timeout and cancellation interrupt active work", {
  skip: !mysqlHost || !mysqlDatabase
    ? "Set NODAMIN_TEST_MYSQL_HOST and NODAMIN_TEST_MYSQL_DATABASE to run"
    : false,
}, async () => {
  const driver = new MySQLDriver();
  driver.connect({
    id: "mysql-query-controls",
    name: "mysql-query-controls",
    type: "mysql",
    host: mysqlHost!,
    port: Number(process.env["NODAMIN_TEST_MYSQL_PORT"] ?? 3306),
    user: process.env["NODAMIN_TEST_MYSQL_USER"] ?? "root",
    password: process.env["NODAMIN_TEST_MYSQL_PASSWORD"] ?? "",
  });
  driver.setCurrentDatabase(mysqlDatabase!);

  try {
    const timedOut = await driver.executeQuery("SELECT SLEEP(1)", {
      queryId: "timeout-test",
      timeoutMs: 100,
    });
    assert.match(timedOut.message ?? "", /timed out/);

    const running = driver.executeQuery("SELECT SLEEP(10)", {
      queryId: "cancel-test",
      timeoutMs: 30_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await driver.cancelQuery("cancel-test"), true);
    assert.match((await running).message ?? "", /cancelled/);
  } finally {
    driver.disconnect();
  }
});
