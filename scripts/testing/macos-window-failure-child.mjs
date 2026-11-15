import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendDesktopCrashRecord, formatDesktopCrashRecord } from "../../electron/diagnostics.mjs";
import { windowPaths } from "../macos-qualification/window-observer.mjs";
import { recordWindowFailure } from "../macos-qualification/failure-diagnostics.mjs";

const home = process.argv[2];
const paths = windowPaths(home);
for (const path of Object.values(paths)) mkdirSync(path, { recursive: true, mode: 0o700 });
const capability = JSON.parse(readFileSync(join(home, "verification-bootstrap.json"), "utf8"));
const error = new TypeError("synthetic main startup failure: fixture method unavailable");
recordWindowFailure(home, "entry", error);
appendDesktopCrashRecord(join(paths.logs, "desktop-crashes.log"), 65536, formatDesktopCrashRecord({ kind: "main", error, origin: "uncaughtException" }));
writeFileSync(join(paths.userData, "session.log"), `synthetic session failure detail\nprivate value ${capability.secret}\nhmac=${"b".repeat(64)}\naccountId="fixture-private-account" email=fixture-private@example.test\npassword="fixture-private-password"\n`);
writeFileSync(join(paths.logs, "server.log"), "PROFILE_BODY_CANARY".repeat(65536) + "\nsynthetic server tail detail\n");
writeFileSync(join(paths.userData, "credentials.bin"), "PRIVATE_PROFILE_BYTES_MUST_NOT_BE_UPLOADED");
writeFileSync(join(paths.crashDumps, "fixture.dmp"), "PRIVATE_CRASH_DUMP_MUST_NOT_BE_UPLOADED");
process.exitCode = 1;
