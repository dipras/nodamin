const MUTATING_SQL_KEYWORDS = new Set([
  "ALTER",
  "ANALYZE",
  "ATTACH",
  "BEGIN",
  "CALL",
  "COMMIT",
  "CREATE",
  "DELETE",
  "DETACH",
  "DROP",
  "DUMPFILE",
  "GRANT",
  "INSERT",
  "LOAD",
  "LOCK",
  "MERGE",
  "OPTIMIZE",
  "OUTFILE",
  "REINDEX",
  "RELEASE",
  "RENAME",
  "REPLACE",
  "REVOKE",
  "ROLLBACK",
  "SAVEPOINT",
  "SET",
  "TRUNCATE",
  "UNLOCK",
  "UPDATE",
  "VACUUM",
]);

const MUTATING_SQLITE_PRAGMAS = new Set([
  "APPLICATION_ID",
  "AUTO_VACUUM",
  "AUTOMATIC_INDEX",
  "BUSY_TIMEOUT",
  "CACHE_SIZE",
  "CACHE_SPILL",
  "CASE_SENSITIVE_LIKE",
  "CELL_SIZE_CHECK",
  "CHECKPOINT_FULLFSYNC",
  "DEFER_FOREIGN_KEYS",
  "FOREIGN_KEYS",
  "FREELIST_COUNT",
  "FULLFSYNC",
  "IGNORE_CHECK_CONSTRAINTS",
  "JOURNAL_MODE",
  "JOURNAL_SIZE_LIMIT",
  "LEGACY_ALTER_TABLE",
  "LOCKING_MODE",
  "MAX_PAGE_COUNT",
  "MMAP_SIZE",
  "PAGE_SIZE",
  "QUERY_ONLY",
  "READ_UNCOMMITTED",
  "RECURSIVE_TRIGGERS",
  "REVERSE_UNORDERED_SELECTS",
  "SCHEMA_VERSION",
  "SECURE_DELETE",
  "SOFT_HEAP_LIMIT",
  "SYNCHRONOUS",
  "TEMP_STORE",
  "THREADS",
  "TRUSTED_SCHEMA",
  "USER_VERSION",
  "WAL_AUTOCHECKPOINT",
  "WAL_CHECKPOINT",
  "WRITABLE_SCHEMA",
]);

export class ReadOnlyViolationError extends Error {
  constructor(message = "Read-only mode blocks this operation") {
    super(message);
    this.name = "ReadOnlyViolationError";
  }
}

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let statement = "";
  let delimiter = ";";
  let quote: "'" | "\"" | "`" | null = null;
  let lineComment = false;
  let blockComment = false;
  let hasCode = false;
  let lineStart = true;

  const flush = (): void => {
    const trimmed = statement.trim();
    if (trimmed && hasCode) statements.push(trimmed);
    statement = "";
    hasCode = false;
  };

  for (let i = 0; i < sql.length;) {
    if (lineStart && !quote && !lineComment && !blockComment) {
      const lineEnd = sql.indexOf("\n", i);
      const end = lineEnd === -1 ? sql.length : lineEnd + 1;
      const line = sql.slice(i, end);
      const directive = line.match(/^[\t ]*DELIMITER[\t ]+(\S+)[\t ]*(?:\r?\n)?$/i);
      if (directive?.[1]) {
        flush();
        delimiter = directive[1];
        i = end;
        lineStart = true;
        continue;
      }
    }

    const char = sql[i]!;
    const next = sql[i + 1];

    if (lineComment) {
      statement += char;
      i++;
      if (char === "\n") {
        lineComment = false;
        lineStart = true;
      }
      continue;
    }

    if (blockComment) {
      statement += char;
      if (char === "*" && next === "/") {
        statement += next;
        i += 2;
        blockComment = false;
      } else {
        lineStart = char === "\n";
        i++;
      }
      continue;
    }

    if (quote) {
      statement += char;
      if (char === "\\" && next !== undefined) {
        statement += next;
        i += 2;
        continue;
      }
      if (char === quote) {
        if (next === quote) {
          statement += next;
          i += 2;
          continue;
        }
        quote = null;
      }
      lineStart = char === "\n";
      i++;
      continue;
    }

    if (char === "-" && next === "-" && (sql[i + 2] === undefined || /\s/.test(sql[i + 2]!))) {
      statement += "--";
      lineComment = true;
      i += 2;
      continue;
    }
    if (char === "#") {
      statement += char;
      lineComment = true;
      i++;
      continue;
    }
    if (char === "/" && next === "*") {
      statement += "/*";
      blockComment = true;
      i += 2;
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      statement += char;
      hasCode = true;
      lineStart = false;
      i++;
      continue;
    }
    if (delimiter && sql.startsWith(delimiter, i)) {
      flush();
      i += delimiter.length;
      lineStart = false;
      continue;
    }

    statement += char;
    if (!/\s/.test(char)) hasCode = true;
    lineStart = char === "\n";
    i++;
  }

  flush();
  return statements;
}

export function isReadOnlySql(sql: string): boolean {
  const statements = splitSqlStatements(sql);
  if (statements.length === 0) return true;

  return statements.every((statement) => {
    const tokens = sqlTokens(statement);
    if (tokens.length === 0) return true;
    if (tokens.some((token) => MUTATING_SQL_KEYWORDS.has(token))) return false;

    if (tokens[0] === "PRAGMA") {
      const pragmaName = tokens[1];
      if (!pragmaName) return false;
      if (statement.includes("=")) return false;
      return !MUTATING_SQLITE_PRAGMAS.has(pragmaName);
    }

    return ["DESC", "DESCRIBE", "EXPLAIN", "SELECT", "SHOW", "TABLE", "VALUES", "WITH"]
      .includes(tokens[0]!);
  });
}

export function assertSqlReadOnly(sql: string): void {
  if (!isReadOnlySql(sql)) {
    throw new ReadOnlyViolationError("Read-only mode only allows inspection queries");
  }
}

export function assertWritable(readOnly: boolean | undefined): void {
  if (readOnly) throw new ReadOnlyViolationError();
}

function sqlTokens(sql: string): string[] {
  const executableCommentsExpanded = sql.replace(
    /\/\*![0-9]*\s*([\s\S]*?)\*\//g,
    " $1 "
  );
  const withoutLiteralsAndComments = executableCommentsExpanded.replace(
    /'(?:''|\\.|[^'])*'|"(?:""|\\.|[^"])*"|`(?:``|\\.|[^`])*`|--[^\r\n]*|#[^\r\n]*|\/\*[\s\S]*?\*\//g,
    " "
  );
  return withoutLiteralsAndComments.toUpperCase().match(/[A-Z_][A-Z0-9_$]*/g) ?? [];
}
