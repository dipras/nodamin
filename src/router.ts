// ============================================================
// Nodamin - Router & Request Handler
// ============================================================

import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import type { RouteContext } from "./types.js";

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
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const method = req.method ?? "GET";
  const path = decodeURIComponent(url.pathname);

  // Parse query params
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    query[k] = v;
  });

  // Parse body for POST
  let body: Record<string, unknown> = {};
  if (method === "POST") {
    body = await parseBody(req);
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

      const ctx: RouteContext = { path, method, query, body, params };
      try {
        await route.handler(ctx, res);
      } catch (err: unknown) {
        console.error(`Error handling ${method} ${path}:`, err);
        sendHtml(res, 500, `<h1>Internal Server Error</h1><pre>${String(err)}</pre>`);
      }
      return;
    }
  }

  sendHtml(res, 404, `<h1>404 Not Found</h1><p>${path}</p>`);
}

import formidable from "formidable";

async function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = req.headers["content-type"] ?? "";

  if (contentType.includes("multipart/form-data")) {
    return new Promise((resolve, reject) => {
      const form = formidable({
        keepExtensions: true,
        multiples: false,
        allowEmptyFiles: true,
        minFileSize: 0
      });

      try {
        form.parse(req, (err, fields, files) => {
          if (err) {
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
            return reject(err);
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

  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });
    req.on("end", () => {
      if (contentType.includes("application/json")) {
        try {
          resolve(JSON.parse(data) as Record<string, unknown>);
        } catch {
          resolve({});
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
  });
}

export function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

export function redirect(res: ServerResponse, url: string): void {
  res.writeHead(302, { Location: url });
  res.end();
}
