import { unlinkSync } from "node:fs";
import type { ServerResponse } from "node:http";
import * as db from "../db/index.js";
import { redirect } from "../router.js";
import type { RouteContext } from "../types.js";

export function requireConnection(ctx: RouteContext, res: ServerResponse): boolean {
  if (!ctx.sessionId || !db.getConnection(ctx.sessionId)) {
    redirect(res, "/");
    return false;
  }
  return true;
}

export function cleanupTemporaryFile(filePath: string | null): void {
  if (!filePath) return;
  for (const candidate of [filePath, `${filePath}-wal`, `${filePath}-shm`]) {
    try { unlinkSync(candidate); } catch { }
  }
}
