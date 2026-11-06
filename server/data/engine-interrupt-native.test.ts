import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { expect, it } from "vitest";
import { Lane, nativeRequire } from "./engine.ts";

it("redelivers an early public interrupt to a finite native query in an owned temporary database", async ({ onTestFinished }) => {
  const root = mkdtempSync(join(tmpdir(), "omb-native-stop-"));
  let instance: DuckDBInstance | undefined;
  let connection: DuckDBConnection | undefined;
  let opening = false;
  let inFlight = false;
  let lanePending = false;
  onTestFinished(async () => {
    if (opening || inFlight || lanePending) throw new Error(`Native operation has not settled; handles and evidence retained at ${root}`);
    connection?.closeSync();
    instance?.closeSync();
    await rm(root, { recursive: true, force: true });
    console.info(JSON.stringify({ nativeCleanup: root, removed: !existsSync(root) }));
  });
  const binding = nativeRequire(null)("@duckdb/node-api") as typeof import("@duckdb/node-api");
  console.info(JSON.stringify({ nativeFixture: root, version: binding.version(), node: process.version, platform: process.platform, arch: process.arch }));
  try {
    opening = true;
    instance = await binding.DuckDBInstance.create(join(root, "fixture.duckdb"), {
      threads: "1", memory_limit: "256MiB", temp_directory: join(root, "spill"),
      autoinstall_known_extensions: "false", autoload_known_extensions: "false", allow_persistent_secrets: "false",
    });
    connection = await instance.connect();
  } finally { opening = false; }
  const lane = new Lane(connection);
  let entered!: () => void;
  const atWork = new Promise<void>((resolve) => { entered = resolve; });
  let dispatch!: () => void;
  const gate = new Promise<void>((resolve) => { dispatch = resolve; });
  const sql = "SELECT sum(sin(i::DOUBLE)) FROM range(50000000) t(i)";
  lanePending = true;
  const result = lane.run(sql, { timeoutMs: 2_000 }, async (conn) => {
    entered();
    await gate;
    inFlight = true;
    try { return await conn.run(sql); } finally { inFlight = false; }
  }).finally(() => { lanePending = false; }).then((value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
  await atWork;
  lane.interrupt();
  dispatch();
  const interrupted = await result;
  expect(interrupted.error).toMatchObject({ error: { code: "cancelled", sql } });
  lanePending = true;
  const reader = await lane.run("SELECT 1", { timeoutMs: 2_000 }, async (conn) => {
    inFlight = true;
    try { return await conn.runAndReadAll("SELECT 1"); } finally { inFlight = false; }
  }).finally(() => { lanePending = false; });
  expect(reader.getRowsJson()).toEqual([[1]]);
  console.info(JSON.stringify({ nativeInterrupted: true, followingRows: reader.getRowsJson(), inFlight }));
}, 10_000);
