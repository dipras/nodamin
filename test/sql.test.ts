import assert from "node:assert/strict";
import test from "node:test";
import {
  isReadOnlySql,
  splitSqlStatements,
} from "../src/db/sql.js";

test("SQL splitter preserves delimiters inside strings and comments", () => {
  const statements = splitSqlStatements(`
    -- a comment with ;
    INSERT INTO notes(value) VALUES ('first;second');
    SELECT "still;one";
  `);

  assert.equal(statements.length, 2);
  assert.match(statements[0]!, /first;second/);
  assert.match(statements[1]!, /still;one/);
});

test("SQL splitter supports MySQL DELIMITER routines", () => {
  const statements = splitSqlStatements(`
    DELIMITER $$
    CREATE PROCEDURE add_note()
    BEGIN
      INSERT INTO notes(value) VALUES ('inside;routine');
      INSERT INTO notes(value) VALUES ('second');
    END$$
    DELIMITER ;
    SELECT 1;
  `);

  assert.equal(statements.length, 2);
  assert.match(statements[0]!, /CREATE PROCEDURE/);
  assert.match(statements[0]!, /inside;routine/);
  assert.match(statements[1]!, /SELECT 1/);
});

test("read-only SQL classification allows inspection and blocks mutation", () => {
  assert.equal(isReadOnlySql("SELECT * FROM users"), true);
  assert.equal(isReadOnlySql("WITH ids AS (SELECT id FROM users) SELECT * FROM ids"), true);
  assert.equal(isReadOnlySql("EXPLAIN SELECT * FROM users"), true);
  assert.equal(isReadOnlySql("PRAGMA table_info(users)"), true);
  assert.equal(isReadOnlySql("UPDATE users SET admin = 1"), false);
  assert.equal(isReadOnlySql("WITH ids AS (SELECT id FROM users) DELETE FROM users"), false);
  assert.equal(isReadOnlySql("PRAGMA journal_mode = WAL"), false);
  assert.equal(isReadOnlySql("SELECT 'DROP TABLE users' AS harmless"), true);
  assert.equal(isReadOnlySql("SELECT 1 /*!; DROP TABLE users */"), false);
  assert.equal(isReadOnlySql("SELECT * FROM users INTO OUTFILE '/tmp/users.txt'"), false);
});
