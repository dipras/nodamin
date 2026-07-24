import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import test from "node:test";
import { get, handleRequest } from "../src/router.js";

interface TestResponse {
  status: number;
  body: string;
}

async function request(
  url: string,
  options: {
    method?: string;
    origin?: string;
    body?: string;
    contentType?: string;
    forwardedProto?: string;
  } = {}
): Promise<TestResponse> {
  const req = Readable.from(options.body ? [Buffer.from(options.body)] : []) as IncomingMessage;
  req.url = url;
  req.method = options.method ?? "GET";
  req.headers = {
    host: "localhost",
    ...(options.origin ? { origin: options.origin } : {}),
    ...(options.forwardedProto ? { "x-forwarded-proto": options.forwardedProto } : {}),
    ...(options.body ? {
      "content-type": options.contentType ?? "application/x-www-form-urlencoded",
      "content-length": String(Buffer.byteLength(options.body)),
    } : {}),
  };

  const result: TestResponse = { status: 0, body: "" };
  const res = {
    writeHead(status: number) {
      result.status = status;
      return this;
    },
    end(chunk?: string | Buffer) {
      if (chunk) result.body += chunk.toString();
      return this;
    },
  } as unknown as ServerResponse;

  await handleRequest(req, res);
  return result;
}

get("/test-internal-error", async () => {
  throw new Error("<script>internal-secret</script>");
});

test("404 responses do not reflect the request path", async () => {
  const response = await request("/%3Cscript%3Ealert(1)%3C/script%3E");
  assert.equal(response.status, 404);
  assert.doesNotMatch(response.body, /script|alert/);
});

test("internal errors return a generic request ID", async () => {
  const response = await request("/test-internal-error");
  assert.equal(response.status, 500);
  assert.match(response.body, /Request ID:/);
  assert.doesNotMatch(response.body, /internal-secret|<script>/);
});

test("cross-origin POST requests are rejected", async () => {
  const response = await request("/missing", {
    method: "POST",
    origin: "https://attacker.example",
    body: "value=1",
  });
  assert.equal(response.status, 403);
});

test("same-origin checks support HTTPS reverse proxies", async () => {
  const response = await request("/missing", {
    method: "POST",
    origin: "https://localhost",
    forwardedProto: "https",
    body: "value=1",
  });
  assert.equal(response.status, 404);
});

test("URL-encoded request bodies are limited", async () => {
  const response = await request("/missing", {
    method: "POST",
    origin: "http://localhost",
    body: `value=${"x".repeat(1024 * 1024)}`,
  });
  assert.equal(response.status, 413);
});

test("multipart field counts are limited", async () => {
  const boundary = "nodamin-test-boundary";
  const fields = Array.from({ length: 201 }, (_, index) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="field${index}"\r\n\r\nvalue\r\n`
  ).join("");
  const response = await request("/missing", {
    method: "POST",
    origin: "http://localhost",
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: `${fields}--${boundary}--\r\n`,
  });
  assert.equal(response.status, 413);
});
