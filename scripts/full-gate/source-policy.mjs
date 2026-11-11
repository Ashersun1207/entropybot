import { lstatSync } from "node:fs";
import { join } from "node:path";

function optionalStat(path) {
  try { return lstatSync(path); }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}
export function assertSourceExecutables(root) {
  const server = optionalStat(join(root, "server"));
  if (!server) return;
  if (!server.isDirectory() || server.isSymbolicLink()) throw new Error("Full gate blocked: nonregular source server directory");
  // Git status and tracked hashes omit ignored executable overrides, including dangling symlinks.
  if (optionalStat(join(root, "server/message-search.worker.js"))) throw new Error("Full gate blocked: generated worker fallback in source checkout");
}
