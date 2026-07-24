import type { ServerResponse } from "node:http";
import { get } from "../router.js";
import type { RouteContext } from "../types.js";
import { FAVICON_BASE64 } from "../views/assets.js";

export function registerStaticRoutes(): void {
  get("/favicon.ico", async (_ctx: RouteContext, res: ServerResponse) => {
    if (!FAVICON_BASE64) {
      res.writeHead(404);
      res.end();
      return;
    }

    res.writeHead(200, {
      "Content-Type": "image/x-icon",
      "Cache-Control": "public, max-age=86400",
    });
    res.end(Buffer.from(FAVICON_BASE64, "base64"));
  });
}
