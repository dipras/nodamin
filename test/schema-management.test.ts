import assert from "node:assert/strict";
import test from "node:test";
import { SQLiteDriver } from "../src/db/sqlite.js";
import * as views from "../src/views/pages.js";

test("SQLite manages columns, indexes, and foreign keys", async () => {
  const driver = new SQLiteDriver();
  driver.connect({
    id: "schema-management",
    name: "schema-management",
    type: "sqlite",
    filePath: ":memory:",
  });

  try {
    await driver.createTable("parents", [
      { name: "id", type: "INTEGER", nullable: false, primary: true, autoIncrement: true },
    ]);
    await driver.createTable("children", [
      { name: "id", type: "INTEGER", nullable: false, primary: true, autoIncrement: true },
      { name: "parent_id", type: "INTEGER", nullable: true, primary: false, autoIncrement: false },
      { name: "label", type: "TEXT", nullable: false, primary: false, autoIncrement: false },
    ]);
    await assert.rejects(
      driver.addColumn("children", {
        name: "unsafe",
        type: "TEXT",
        nullable: true,
        defaultValue: "0; DROP TABLE parents",
      }),
      /Invalid default value/
    );

    await driver.addColumn("children", {
      name: "note",
      type: "TEXT",
      nullable: true,
    });
    await driver.modifyColumn("children", "note", {
      name: "note",
      type: "VARCHAR(200)",
      nullable: true,
      defaultValue: "'none'",
    });
    await driver.renameColumn("children", "note", "description");
    assert.deepEqual(
      (await driver.getTableStructure("children")).map(({ name }) => name),
      ["id", "parent_id", "label", "description"]
    );

    await driver.createIndex("children", "children_label_unique", ["label"], true);
    const index = (await driver.listIndexes("children"))
      .find(({ name }) => name === "children_label_unique");
    assert.equal(index?.unique, true);
    assert.deepEqual(index?.columns, ["label"]);
    await driver.dropIndex("children", "children_label_unique");
    await driver.createIndex("children", "children_parent_idx", ["parent_id"], false);
    await driver.executeQuery("CREATE TABLE schema_audit (message TEXT)");
    await driver.executeQuery(`
      CREATE TRIGGER children_schema_audit AFTER INSERT ON children
      BEGIN
        INSERT INTO schema_audit(message) VALUES (NEW.label);
      END
    `);

    await driver.createForeignKey("children", {
      name: "children_parent_fk",
      columns: ["parent_id"],
      referencedTable: "parents",
      referencedColumns: ["id"],
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    });
    const foreignKey = (await driver.listForeignKeys("children"))[0]!;
    assert.deepEqual(foreignKey.columns, ["parent_id"]);
    assert.equal(foreignKey.referencedTable, "parents");
    await assert.rejects(
      driver.insertRow("children", { parent_id: 999, label: "orphan" }),
      /FOREIGN KEY/
    );

    await driver.dropForeignKey("children", foreignKey.name);
    await driver.insertRow("children", { parent_id: 999, label: "allowed" });
    assert.ok(
      (await driver.listIndexes("children"))
        .some(({ name }) => name === "children_parent_idx")
    );
    assert.equal((await driver.executeQuery("SELECT * FROM schema_audit")).rows.length, 1);
    await driver.dropColumn("children", "description");
    assert.doesNotMatch(
      (await driver.getTableStructure("children")).map(({ name }) => name).join(","),
      /description/
    );
  } finally {
    driver.disconnect();
  }
});

test("structure page exposes schema management controls and hides them in read-only mode", () => {
  const props = {
    database: "app",
    table: "children",
    columns: [{
      name: "parent_id",
      type: "INTEGER",
      nullable: true,
      key: "MUL",
      defaultValue: null,
      extra: "",
    }],
    indexes: [{
      name: "children_parent_idx",
      unique: false,
      columns: ["parent_id"],
      primary: false,
    }],
    foreignKeys: [{
      name: "children_parent_fk",
      columns: ["parent_id"],
      referencedTable: "parents",
      referencedColumns: ["id"],
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    }],
    references: [{ name: "parents", columns: ["id"] }],
    tables: [{ name: "children" }, { name: "parents" }],
  };

  const writable = views.tableStructurePage(props);
  assert.match(writable, /Add column/);
  assert.match(writable, /Create index/);
  assert.match(writable, /Create foreign key/);
  assert.match(writable, /children_parent_fk/);
  for (const match of writable.matchAll(
    /<script(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/g
  )) {
    assert.doesNotThrow(() => new Function(match[1]!));
  }

  const readOnly = views.tableStructurePage({ ...props, readOnly: true });
  assert.match(readOnly, /Read-only/);
  assert.doesNotMatch(readOnly, /Add column|Create index|Create foreign key|Drop column/);
});
