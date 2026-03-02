// ============================================================
// Build Script - Pre-compile EJS templates to JavaScript
// ============================================================

import fs from "node:fs/promises";
import path from "node:path";
import ejs from "ejs";

const TEMPLATES_DIR = "src/views/templates";
const OUTPUT_FILE = "src/views/compiled.ts";

async function compileTemplates() {
  console.log("🔨 Pre-compiling EJS templates...");

  const files = await fs.readdir(TEMPLATES_DIR);
  const ejsFiles = files.filter((f) => f.endsWith(".ejs"));

  const compiledFunctions = [];

  for (const file of ejsFiles) {
    const templatePath = path.join(TEMPLATES_DIR, file);
    const templateContent = await fs.readFile(templatePath, "utf-8");
    const templateName = path.basename(file, ".ejs");

    // Compile EJS to JS function
    const compiled = ejs.compile(templateContent, {
      client: true,
      strict: true,
      _with: false,
      localsName: "data",
    });

    compiledFunctions.push({
      name: templateName,
      fn: compiled.toString(),
    });
  }

  // Generate TypeScript file
  let output = `// @ts-nocheck
// ============================================================
// Auto-generated compiled templates - DO NOT EDIT MANUALLY
// Generated at: ${new Date().toISOString()}
// ============================================================

`;

  for (const { name, fn } of compiledFunctions) {
    output += `export const ${name} = ${fn};\n\n`;
  }

  await fs.writeFile(OUTPUT_FILE, output, "utf-8");
  console.log(`✅ Compiled ${ejsFiles.length} templates -> ${OUTPUT_FILE}`);
}

compileTemplates().catch((err) => {
  console.error("❌ Template compilation failed:", err);
  process.exit(1);
});
