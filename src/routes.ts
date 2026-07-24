// ============================================================
// Nodamin - Route Registration
// ============================================================

import { registerConnectionRoutes } from "./routes/connection.js";
import { registerExportRoutes } from "./routes/export.js";
import { registerQueryRoutes } from "./routes/query.js";
import { registerRowRoutes } from "./routes/rows.js";
import { registerSchemaRoutes } from "./routes/schema.js";
import { registerSchemaManagementRoutes } from "./routes/schema-management.js";
import { registerStaticRoutes } from "./routes/static.js";
import { registerTableActionRoutes } from "./routes/table-actions.js";
import { registerTableBrowseRoutes } from "./routes/table-browse.js";

export function registerRoutes(): void {
  registerStaticRoutes();
  registerConnectionRoutes();
  registerSchemaRoutes();
  registerSchemaManagementRoutes();
  registerQueryRoutes();
  registerExportRoutes();
  registerRowRoutes();
  registerTableActionRoutes();

  // Keep generic /db/:db/table/:table registration after all specific table routes.
  registerTableBrowseRoutes();
}
