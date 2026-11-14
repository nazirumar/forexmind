/**
 * Post-build step for the standalone output.
 *
 * `next build` with output:"standalone" produces .next/standalone with
 * server.js + minimal node_modules, but NOT the client static assets
 * or public files. package.json used to shell out to `cp -r`, which
 * bun's Windows shell rejects ("illegal option -- r"). This script
 * does the same copies with node's fs.cpSync, so it runs identically
 * on Windows, Linux and macOS.
 *
 * Run as part of `bun run build` (see package.json).
 */
import { cpSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");

if (!existsSync(standalone)) {
  console.error("[standalone-postbuild] .next/standalone not found — did `next build` succeed?");
  process.exit(1);
}

function copyDir(src, dest, label) {
  if (!existsSync(src)) {
    console.error(`[standalone-postbuild] missing ${label}: ${src}`);
    process.exitCode = 1;
    return;
  }
  cpSync(src, dest, { recursive: true });
  const files = statSync(dest).isDirectory() ? "dir" : "file";
  console.log(`[standalone-postbuild] copied ${label} -> ${path.relative(root, dest)} (${files})`);
}

copyDir(
  path.join(root, ".next", "static"),
  path.join(standalone, ".next", "static"),
  ".next/static",
);
copyDir(path.join(root, "public"), path.join(standalone, "public"), "public");

console.log("[standalone-postbuild] done. Run with: NODE_ENV=production bun .next/standalone/server.js");
