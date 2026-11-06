import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("acceptance cleanup preserves failures and waits for its owned process group", { skip: process.platform === "win32", timeout: 20_000 }, () => {
  const script = fileURLToPath(new URL("./credential-namespace-migration-fixture-test.py", import.meta.url));
  const result = spawnSync("python3", [script], { encoding: "utf8", timeout: 15_000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Ran 5 tests/);
  assert.match(result.stderr, /\bOK\b/);
});
