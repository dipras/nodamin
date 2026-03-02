// ============================================================
// Build Script: Compile CSS & JS & Images to TypeScript Constants
// ============================================================

import { readFileSync, writeFileSync, existsSync } from "fs";

console.log("🎨 Compiling CSS, JS & Images assets...");

const css = readFileSync("src/views/styles.css", "utf-8");
const js = readFileSync("src/views/scripts.js", "utf-8");

// Read images as base64
let faviconBase64 = "";
if (existsSync("public/favicon.ico")) {
  const faviconBuffer = readFileSync("public/favicon.ico");
  faviconBase64 = faviconBuffer.toString("base64");
}

const output = `// ============================================================
// Auto-generated CSS, JS & Images Assets (DO NOT EDIT MANUALLY)
// Generated at: ${new Date().toISOString()}
// ============================================================

export const CSS = ${JSON.stringify(css)};

export const JS = ${JSON.stringify(js)};

export const FAVICON_BASE64 = ${JSON.stringify(faviconBase64)};
`;

writeFileSync("src/views/assets.ts", output);
console.log("✅ Compiled assets -> src/views/assets.ts");
