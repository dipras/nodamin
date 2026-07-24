import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";
import * as db from "../src/db/index.js";
import { createSession, getSessionIdFromRequest } from "../src/session.js";

test("an expired session disconnects its database driver", () => {
  let cookie = "";
  const response = {
    setHeader(name: string, value: string) {
      if (name.toLowerCase() === "set-cookie") cookie = value;
    },
  } as unknown as ServerResponse;

  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;

  try {
    const sessionId = createSession(response);
    db.connect(sessionId, {
      id: "session-test",
      name: "session-test",
      type: "sqlite",
      filePath: ":memory:",
    });
    assert.ok(db.getConnection(sessionId));

    now += 3_600_001;
    const request = {
      headers: { cookie: cookie.split(";")[0] },
    } as IncomingMessage;

    assert.equal(getSessionIdFromRequest(request), null);
    assert.equal(db.getConnection(sessionId), null);
  } finally {
    Date.now = originalNow;
  }
});
