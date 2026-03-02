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
    js: 'import{createRequire}from"module";const require=createRequire(import.meta.url);',
  },
  minify: !isDev,
  sourcemap: isDev,
  external: [],
};

if (isDev) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("👀 Watching for changes...");
} else {
  await esbuild.build(buildOptions);
  console.log("✅ Built dist/nodamin.js");
}
