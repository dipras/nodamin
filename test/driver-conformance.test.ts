import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { DatabaseDriver } from "../src/db/driver.js";
import { MySQLDriver } from "../src/db/mysql.js";
import { PostgreSQLDriver } from "../src/db/postgresql.js";
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
  const parentTable = `${table.slice(0, 52)}_parent`;
  const indexName = `${table.slice(0, 54)}_idx`;
  const foreignKeyName = `${table.slice(0, 53)}_fk`;
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

    await driver.addColumn(table, {
      name: "notes",
      type: "TEXT",
      nullable: true,
    });
    await driver.modifyColumn(table, "notes", {
      name: "notes",
      type: "VARCHAR(255)",
      nullable: true,
    });
    await driver.renameColumn(table, "notes", "description");
    assert.ok((await driver.getTableStructure(table)).some(({ name }) => name === "description"));

    await driver.createIndex(table, indexName, ["label"], true);
    assert.ok((await driver.listIndexes(table)).some(({ name }) => name === indexName));
    await driver.dropIndex(table, indexName);

    await driver.createTable(parentTable, [{
      name: "id",
      type: "INTEGER",
      nullable: false,
      primary: true,
      autoIncrement: true,
    }]);
    await driver.addColumn(table, {
      name: "parent_id",
      type: "INTEGER",
      nullable: true,
    });
    await driver.createForeignKey(table, {
      name: foreignKeyName,
      columns: ["parent_id"],
      referencedTable: parentTable,
      referencedColumns: ["id"],
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });
    const listedForeignKey = (await driver.listForeignKeys(table))[0];
    assert.equal(listedForeignKey?.referencedTable, parentTable);
    await driver.dropForeignKey(table, listedForeignKey!.name);
    await driver.dropColumn(table, "parent_id");
    await driver.dropColumn(table, "description");

    assert.match(await driver.exportTable(table), /CREATE TABLE/i);

    await driver.deleteRow(table, { id });
    assert.equal((await driver.getTableData(table)).total, 0);
  } finally {
    try {
      await driver.dropTable(table);
    } finally {
      try {
        await driver.dropTable(parentTable);
      } catch { }
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
const mariadbHost = process.env["NODAMIN_TEST_MARIADB_HOST"];
const mariadbDatabase = process.env["NODAMIN_TEST_MARIADB_DATABASE"];
const postgresqlHost = process.env["NODAMIN_TEST_POSTGRESQL_HOST"];
const postgresqlDatabase = process.env["NODAMIN_TEST_POSTGRESQL_DATABASE"];

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

test("MariaDB satisfies the shared server database driver contract", {
  skip: !mariadbHost || !mariadbDatabase
    ? "Set NODAMIN_TEST_MARIADB_HOST and NODAMIN_TEST_MARIADB_DATABASE to run"
    : false,
}, async () => {
  await assertDriverConformance({
    driver: new MySQLDriver(),
    database: mariadbDatabase!,
    connection: {
      id: "mariadb-conformance",
      name: "mariadb-conformance",
      type: "mariadb",
      host: mariadbHost!,
      port: Number(process.env["NODAMIN_TEST_MARIADB_PORT"] ?? 3306),
      user: process.env["NODAMIN_TEST_MARIADB_USER"] ?? "root",
      password: process.env["NODAMIN_TEST_MARIADB_PASSWORD"] ?? "",
    },
  });
});

test("PostgreSQL satisfies the shared database driver contract", {
  skip: !postgresqlHost || !postgresqlDatabase
    ? "Set NODAMIN_TEST_POSTGRESQL_HOST and NODAMIN_TEST_POSTGRESQL_DATABASE to run"
    : false,
}, async () => {
  await assertDriverConformance({
    driver: new PostgreSQLDriver(),
    database: postgresqlDatabase!,
    connection: {
      id: "postgresql-conformance",
      name: "postgresql-conformance",
      type: "postgresql",
      host: postgresqlHost!,
      port: Number(process.env["NODAMIN_TEST_POSTGRESQL_PORT"] ?? 5432),
      user: process.env["NODAMIN_TEST_POSTGRESQL_USER"] ?? "postgres",
      password: process.env["NODAMIN_TEST_POSTGRESQL_PASSWORD"] ?? "",
      ssl: process.env["NODAMIN_TEST_POSTGRESQL_SSL"] === "1",
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

test("PostgreSQL query timeout and cancellation interrupt active work", {
  skip: !postgresqlHost || !postgresqlDatabase
    ? "Set NODAMIN_TEST_POSTGRESQL_HOST and NODAMIN_TEST_POSTGRESQL_DATABASE to run"
    : false,
}, async () => {
  const driver = new PostgreSQLDriver();
  driver.connect({
    id: "postgresql-query-controls",
    name: "postgresql-query-controls",
    type: "postgresql",
    host: postgresqlHost!,
    port: Number(process.env["NODAMIN_TEST_POSTGRESQL_PORT"] ?? 5432),
    user: process.env["NODAMIN_TEST_POSTGRESQL_USER"] ?? "postgres",
    password: process.env["NODAMIN_TEST_POSTGRESQL_PASSWORD"] ?? "",
    database: postgresqlDatabase!,
    ssl: process.env["NODAMIN_TEST_POSTGRESQL_SSL"] === "1",
  });

  try {
    const timedOut = await driver.executeQuery("SELECT pg_sleep(1)", {
      queryId: "postgresql-timeout-test",
      timeoutMs: 100,
    });
    assert.match(timedOut.message ?? "", /timed out/);

    const running = driver.executeQuery("SELECT pg_sleep(10)", {
      queryId: "postgresql-cancel-test",
      timeoutMs: 30_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await driver.cancelQuery("postgresql-cancel-test"), true);
    assert.match((await running).message ?? "", /cancelled/);
  } finally {
    driver.disconnect();
  }
});
