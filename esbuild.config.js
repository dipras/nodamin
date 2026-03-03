import esbuild from "esbuild";
import { writeFileSync, readFileSync, chmodSync } from "fs";

const isDev = process.argv.includes("--dev");

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  outfile: "dist/nodamin.js",
  format: "esm",
  banner: {
    js: `import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname } from "path";
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);`,
  },
  minify: !isDev,
  sourcemap: isDev,
  external: ["better-sqlite3"],
};

if (isDev) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("👀 Watching for changes...");
} else {
  await esbuild.build(buildOptions);
  console.log("✅ Built dist/nodamin.js");
}
