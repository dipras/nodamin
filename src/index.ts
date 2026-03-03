#!/usr/bin/env node
// ============================================================
// Nodamin - Lightweight Database Admin for Node.js
// A single-file Adminer alternative powered by Node.js
// ============================================================

import { startServer } from "./server.js";
import { registerRoutes } from "./routes.js";

// Parse CLI args
function parseArgs(): { port: number; host?: string } {
  const args = process.argv.slice(2);
  let port = 3088;
  let host: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port" || arg === "-p") {
      port = Number(args[i + 1]) || 3088;
      i++;
    } else if (arg?.startsWith("--port=")) {
      port = Number(arg.split("=")[1]) || 3088;
    } else if (arg === "--host" || arg === "-h") {
      host = args[i + 1];
      i++;
    } else if (arg?.startsWith("--host=")) {
      host = arg.split("=")[1];
    }
  }

  // Also check env
  if (process.env["NODAMIN_PORT"]) {
    port = Number(process.env["NODAMIN_PORT"]) || port;
  }
  if (process.env["NODAMIN_HOST"]) {
    host = process.env["NODAMIN_HOST"] || host;
  }

  return host ? { port, host } : { port };
}

const config = parseArgs();

// Register all routes
registerRoutes();

// Start server
startServer(config);
