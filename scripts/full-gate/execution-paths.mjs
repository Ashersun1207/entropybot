import { realpathSync, readFileSync } from "node:fs";
import { posix, win32 } from "node:path";
import { insist, digest } from "./core.mjs";

function pathTools(platform) { return platform === "win32" ? win32 : posix; }
export function absoluteArgument(root, argument, platform) {
  const paths = pathTools(platform);
  insist(typeof argument === "string" && argument.length > 0 && !argument.includes("\0") && !argument.split(/[\\/]/).some(part => part === "." || part === ".."), "noncanonical execution path alias");
  const full = paths.isAbsolute(argument) ? argument : `${root}${paths.sep}${argument}`;
  insist(full === paths.normalize(full) && paths.isAbsolute(full), "noncanonical execution path spelling");
  return full;
}
function inside(root, path, platform) {
  const paths = pathTools(platform);
  const relative = paths.relative(root, path);
  return relative !== ".." && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative);
}
function componentPaths(root, full, platform) {
  const paths = pathTools(platform);
  insist(inside(root, full, platform), "execution path escapes checkout");
  const relative = paths.relative(root, full);
  const parts = relative ? relative.split(paths.sep) : [];
  return parts.map((_, index) => `${root}${paths.sep}${parts.slice(0, index + 1).join(paths.sep)}`);
}
function approvedEntry(installation, path) {
  return [installation.entry, ...Object.values(installation.nodeTests ?? {})].find(row => row.path === path);
}
export function captureExecutionPaths(installation, command, reportRoot, arguments_, platform = process.platform) {
  const root = realpathSync.native(installation.root);
  insist(root === installation.root, "checkout root is not canonical");
  const cwd = { path: command.cwd, resolvedPath: realpathSync.native(command.cwd) };
  const report = { path: reportRoot, resolvedPath: realpathSync.native(reportRoot) };
  insist(cwd.path === root && cwd.resolvedPath === root && report.path === root && report.resolvedPath === root, "cwd/report realpath escapes checkout");
  const entries = arguments_.map(argument => {
    const paths = pathTools(platform);
    const raw = paths.isAbsolute(argument) ? argument : `${root}${paths.sep}${argument}`;
    const resolvedPath = realpathSync.native(raw);
    const path = absoluteArgument(root, argument, platform);
    const approved = approvedEntry(installation, path);
    insist(approved && realpathSync.native(approved.path) === approved.resolvedPath && resolvedPath === approved.resolvedPath, "effective/installation entry realpath mismatch");
    const components = componentPaths(root, path, platform).map(prefix => ({ path: prefix, resolvedPath: realpathSync.native(prefix) }));
    insist(components.every(row => inside(root, row.resolvedPath, platform)), "symlink component escapes captured checkout");
    const sha256 = digest(readFileSync(raw));
    insist(sha256 === approved.sha256, "effective entry bytes differ from approved installation");
    return { argument, path, resolvedPath, sha256, components };
  });
  return { root, cwd, reportRoot: report, entries };
}
export function validateExecutionPaths(receipt, installation, arguments_) {
  const root = installation.root;
  absoluteArgument(root, root, receipt.platform);
  const proof = receipt.filesystem;
  insist(proof?.root === root && proof.cwd?.path === receipt.command.cwd && proof.cwd.resolvedPath === root && proof.reportRoot?.path === receipt.report.root && proof.reportRoot.resolvedPath === root, "missing/mismatched captured cwd/report realpaths");
  insist(Array.isArray(proof.entries) && proof.entries.length === arguments_.length, "effective argv realpath coverage missing");
  arguments_.forEach((argument, index) => {
    const full = absoluteArgument(root, argument, receipt.platform);
    const approved = approvedEntry(installation, full);
    const recorded = proof.entries[index];
    insist(approved && recorded.argument === argument && recorded.path === full && recorded.resolvedPath === approved.resolvedPath && recorded.sha256 === approved.sha256, "effective argv entry differs from approved captured realpath");
    const expected = componentPaths(root, full, receipt.platform);
    insist(Array.isArray(recorded.components) && recorded.components.length === expected.length && recorded.components.every((row, i) => row.path === expected[i] && absoluteArgument(root, row.resolvedPath, receipt.platform) === row.resolvedPath && inside(root, row.resolvedPath, receipt.platform)), "missing or escaping symlink component resolution");
    insist(recorded.components.at(-1)?.resolvedPath === approved.resolvedPath, "final component does not resolve to approved entry target");
  });
}
