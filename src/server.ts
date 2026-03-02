// ============================================================
// Nodamin - HTTP Server
// ============================================================

import http from "node:http";
import { handleRequest } from "./router.js";
import type { ServerConfig } from "./types.js";

export function startServer(config: ServerConfig): void {
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error("Unhandled error:", err);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    });
  });

  server.listen(config.port, () => {
    console.log("");
    console.log("  ⚡ Nodamin is running!");
    console.log(`  🌐 http://localhost:${config.port}`);
    console.log("");
    console.log("  Press Ctrl+C to stop");
    console.log("");
  });
}
