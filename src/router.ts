// ============================================================
// Nodamin - Router & Request Handler
// ============================================================

import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import type { RouteContext } from "./types.js";
import { getSessionIdFromRequest } from "./session.js";
import { randomUUID } from "node:crypto";
import formidable, { errors as formidableErrors, type File } from "formidable";

const MAX_BODY_SIZE = 1024 * 1024;
const MAX_FILE_SIZE = 64 * 1024 * 1024;
const MAX_FIELDS = 200;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

type Handler = (ctx: RouteContext, res: ServerResponse) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

const routes: Route[] = [];

export function get(path: string, handler: Handler): void {
  addRoute("GET", path, handler);
}

export function post(path: string, handler: Handler): void {
  addRoute("POST", path, handler);
}

function addRoute(method: string, path: string, handler: Handler): void {
  const paramNames: string[] = [];
  const pattern = path.replace(/:([a-zA-Z_]+)/g, (_, name: string) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  routes.push({
    method,
    pattern: new RegExp(`^${pattern}$`),
    paramNames,
    handler,
  });
}

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  let url: URL;
  try {
    url = new URL(req.url ?? "/", requestOrigin(req));
  } catch {
    sendHtml(res, 400, "<h1>Bad Request</h1>");
    return;
  }
  const method = req.method ?? "GET";
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    sendHtml(res, 400, "<h1>Bad Request</h1>");
    return;
  }

  // Get session ID from cookie
  const sessionId = getSessionIdFromRequest(req);

  // Parse query params
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    query[k] = v;
  });

  // Parse body for POST
  let body: Record<string, unknown> = {};
  if (method === "POST") {
    if (!isSameOriginRequest(req, url)) {
      sendHtml(res, 403, "<h1>Forbidden</h1>");
      return;
    }
    try {
      body = await parseBody(req);
    } catch (err: unknown) {
      cleanupUploadedFiles(body);
      const status = err instanceof HttpError ? err.status : 400;
      sendHtml(res, status, `<h1>${status === 413 ? "Payload Too Large" : "Bad Request"}</h1>`);
      return;
    }
  }

  // Match routes
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = path.match(route.pattern);
    if (match) {
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]!);
      });

      const ctx: RouteContext = { path, method, query, body, params, sessionId };
      try {
        await route.handler(ctx, res);
      } catch (err: unknown) {
        const requestId = randomUUID();
        console.error(`[${requestId}] Error handling ${method} ${path}:`, err);
        sendHtml(res, 500, `<h1>Internal Server Error</h1><p>Request ID: ${requestId}</p>`);
      }
      return;
    }
  }

  sendHtml(res, 404, "<h1>404 Not Found</h1>");
}

function requestOrigin(req: IncomingMessage): string {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const firstForwardedProto = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto?.split(",")[0]?.trim();
  const encrypted = (req.socket as IncomingMessage["socket"] & { encrypted?: boolean } | undefined)?.encrypted;
  const protocol = firstForwardedProto === "https" || (!firstForwardedProto && encrypted)
    ? "https"
    : "http";
  return `${protocol}://${req.headers.host ?? "localhost"}`;
}

function isSameOriginRequest(req: IncomingMessage, url: URL): boolean {
  const fetchSite = req.headers["sec-fetch-site"];
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;

  const source = req.headers.origin ?? req.headers.referer;
  if (!source) return process.env["NODE_ENV"] !== "production";

  try {
    return new URL(source).origin === url.origin;
  } catch {
    return false;
  }
}

async function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = req.headers["content-type"] ?? "";

  if (contentType.includes("multipart/form-data")) {
    return new Promise((resolve, reject) => {
      const form = formidable({
        keepExtensions: true,
        multiples: false,
        allowEmptyFiles: true,
        minFileSize: 0,
        maxFileSize: MAX_FILE_SIZE,
        maxTotalFileSize: MAX_FILE_SIZE,
        maxFields: MAX_FIELDS,
        maxFieldsSize: MAX_BODY_SIZE,
      });

      try {
        form.parse(req, (err, fields, files) => {
          if (err) {
            cleanupUploadedFiles(files);
            // Formidable throws specific errors when file is empty even with allowEmptyFiles in some versions
            if (err.message && err.message.includes("options.allowEmptyFiles is false")) {
              // We consider this a success but with no files
              console.warn("[Formidable] Caught empty file error, treating as no-file upload");
              const result: Record<string, unknown> = {};
              for (const key in fields) {
                result[key] = Array.isArray(fields[key]) ? fields[key][0] : fields[key];
              }
              return resolve(result);
            }
            const errorCodes = formidableErrors as Record<string, number>;
            const status = err.code === errorCodes["biggerThanMaxFileSize"]
              || err.code === errorCodes["biggerThanTotalMaxFileSize"]
              || err.code === errorCodes["maxFieldsExceeded"]
              || err.code === errorCodes["maxFieldsSizeExceeded"]
              ? 413
              : 400;
            return reject(new HttpError(status, err.message));
          }
          const result: Record<string, unknown> = {};
          for (const key in fields) {
            result[key] = Array.isArray(fields[key]) ? fields[key][0] : fields[key];
          }
          for (const key in files) {
            const file = Array.isArray(files[key]) ? files[key][0] : files[key];
            if (file && (file.size > 0 || file.originalFilename)) {
              result[key] = file;
            }
          }
          resolve(result);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        settled = true;
        reject(new HttpError(413, "Request body is too large"));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      const data = Buffer.concat(chunks).toString("utf8");
      if (contentType.includes("application/json")) {
        try {
          resolve(JSON.parse(data) as Record<string, unknown>);
        } catch {
          reject(new HttpError(400, "Invalid JSON body"));
        }
      } else {
        // URL-encoded form
        const params = new URLSearchParams(data);
        const result: Record<string, unknown> = {};
        params.forEach((v, k) => {
          result[k] = v;
        });
        resolve(result);
      }
    });
    req.on("error", reject);
  });
}

function cleanupUploadedFiles(files: Record<string, unknown>): void {
  for (const value of Object.values(files)) {
    const values = Array.isArray(value) ? value : [value];
    for (const candidate of values) {
      const file = candidate as File | undefined;
      if (file?.filepath) {
        import("node:fs").then(({ unlink }) => unlink(file.filepath, () => {})).catch(() => {});
      }
    }
  }
}

export function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

export function redirect(res: ServerResponse, url: string): void {
  res.writeHead(302, { Location: url });
  res.end();
}
