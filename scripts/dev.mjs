/**
 * Cross-platform dev launcher: `next dev` with output teed to dev.log.
 *
 * Replaces the old `next dev -p 3000 2>&1 | tee dev.log` script, which
 * fails on Windows because bun's shell there has no `tee`. This module
 * does the same thing with plain Node streams: everything Next writes
 * to stdout/stderr goes to the console AND appends to dev.log.
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const logPath = path.join(root, "dev.log");
const log = createWriteStream(logPath, { flags: "a" });
log.write(`\n--- dev server started ${new Date().toISOString()} ---\n`);

// shell:true lets Windows resolve bunx/next off PATH without a .cmd shim.
const child = spawn("bunx", ["next", "dev", "-p", "3000"], {
  cwd: root,
  stdio: ["inherit", "pipe", "pipe"],
  shell: process.platform === "win32",
});

child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.stdout.pipe(log);
child.stderr.pipe(log);

const shutdown = () => {
  if (process.platform === "win32") {
    // kill() only terminates the shell, not next itself.
    spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], { shell: true });
    process.exit(0);
  }
  child.kill();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
