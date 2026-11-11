import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parse } from "yaml";
import { insist } from "./core.mjs";

export function sourcePath(root, file, directory = false) {
  insist(typeof file === "string" && file.length > 0 && !file.includes("\\") && !file.includes("\0"), "unsafe producer path");
  const parts = file.split("/");
  insist(parts.every(part => part && part !== "." && part !== "..") && !file.includes(":"), `unsafe producer path: ${file}`);
  let path = root;
  for (const [index, part] of parts.entries()) {
    path = join(path, part);
    const stat = lstatSync(path);
    insist(!stat.isSymbolicLink() && (index < parts.length - 1 || directory ? stat.isDirectory() : stat.isFile()), `nonregular producer path: ${file}`);
  }
  return path;
}
export function localPath(root, file, value) {
  insist(typeof value === "string" && value.length > 0 && !value.includes("\\") && !/[\0?#:]/.test(value) && !value.startsWith("/"), `unsafe config dependency: ${file}`);
  const path = relative(root, resolve(root, dirname(file), value)).split(sep).join("/");
  insist(path && path !== ".." && !path.startsWith("../"), `producer dependency outside tree: ${file}`);
  let parent = resolve(root, dirname(file));
  for (const part of value.split("/").slice(0, -1)) {
    if (part === ".") continue;
    parent = resolve(parent, part);
    const within = relative(root, parent).split(sep).join("/");
    insist(within !== ".." && !within.startsWith("../"), `producer dependency outside tree: ${file}`);
    if (within) sourcePath(root, within, true);
  }
  return path;
}
function tree(root, directory) {
  const files = [];
  for (const name of readdirSync(sourcePath(root, directory, true))) {
    const file = `${directory}/${name}`;
    const stat = lstatSync(join(root, file));
    insist(!stat.isSymbolicLink(), `symlink producer input: ${file}`);
    if (stat.isDirectory()) files.push(...tree(root, file));
    else { sourcePath(root, file); files.push(file); }
  }
  return files;
}
function jsonc(bytes) {
  return JSON.parse(bytes.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, token => token.startsWith('"') ? token : " "));
}
export function configDependencies(root, file, bytes) {
  const files = [];
  if (/\/wrangler\.jsonc?$/.test(file)) {
    const walk = value => {
      if (!value || typeof value !== "object") return;
      for (const [key, entry] of Object.entries(value)) {
        if (key === "main") files.push(localPath(root, file, entry));
        else if (key === "migrations_dir") files.push(...tree(root, localPath(root, file, entry)));
        else walk(entry);
      }
    };
    const config = jsonc(bytes);
    insist(typeof config.main === "string", `missing wrangler main: ${file}`);
    walk(config);
  }
  if (/\.config\.[cm]?[jt]s$/.test(file)) {
    for (const match of bytes.matchAll(/\brunner\s*:\s*["']([^"']+)["']/g)) files.push(localPath(root, file, match[1]));
  }
  return files;
}
export function discoveredInputs(root) {
  const workspace = parse(readFileSync(sourcePath(root, "pnpm-workspace.yaml"), "utf8"));
  insist(Array.isArray(workspace.packages) && workspace.packages.length > 0 && new Set(workspace.packages).size === workspace.packages.length, "invalid workspace packages");
  const directories = new Set([".", "cloudflare/composio-broker", "cloudflare/control-plane"]);
  const files = [];
  for (const directory of workspace.packages) {
    insist(typeof directory === "string" && !/[*!?{}[\]]/.test(directory), "unsupported workspace pattern; review required");
    if (directory !== ".") sourcePath(root, directory, true);
    directories.add(directory);
    const file = directory === "." ? "package.json" : `${directory}/package.json`;
    sourcePath(root, file); files.push(file);
  }
  for (const directory of directories) {
    const path = directory === "." ? root : sourcePath(root, directory, true);
    for (const name of readdirSync(path)) {
      if (/^(?:.*\.config\.[cm]?[jt]s|tsconfig(?:\.[\w-]+)?\.json|wrangler\.(?:jsonc?|toml)|\.npmrc|\.pnpmfile\.cjs)$/.test(name)) {
        insist(name !== "wrangler.toml", "unsupported wrangler format; review required");
        const file = directory === "." ? name : `${directory}/${name}`;
        sourcePath(root, file); files.push(file);
      }
    }
  }
  // The source producer never accepts a compiled worker fallback, even if Git ignores it.
  try { lstatSync(join(root, "server/message-search.worker.js")); }
  catch (error) { if (error.code === "ENOENT") return files; throw error; }
  throw new Error("Full gate blocked: generated worker fallback in source checkout");
}
