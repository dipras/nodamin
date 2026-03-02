// ============================================================
// Build Script: Compile CSS & JS to TypeScript Constants
// ============================================================

import { readFileSync, writeFileSync } from "fs";

console.log("🎨 Compiling CSS & JS assets...");

const css = readFileSync("src/views/styles.css", "utf-8");
const js = readFileSync("src/views/scripts.js", "utf-8");

const output = `// ============================================================
// Auto-generated CSS & JS Assets (DO NOT EDIT MANUALLY)
// Generated at: ${new Date().toISOString()}
// ============================================================

export const CSS = ${JSON.stringify(css)};

export const JS = ${JSON.stringify(js)};
`;

writeFileSync("src/views/assets.ts", output);
console.log("✅ Compiled assets -> src/views/assets.ts");
