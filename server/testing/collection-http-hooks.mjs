import dns from "node:dns/promises";
import http from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Store } from "../store.ts";
import { join } from "node:path";

const settings = JSON.parse(readFileSync(join(process.env.OMB_DATA_DIR, "collection-fixture.json"), "utf8"));
if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535) throw new Error("Invalid collection fixture port");
const lookup = dns.lookup;
dns.lookup = (host, ...args) => host === "collection-fixture.invalid"
  ? Promise.resolve([{ address: "93.184.216.34", family: 4 }]) : lookup(host, ...args);
const request = http.request;
http.request = (url, options, callback) => {
  if (url instanceof URL && url.hostname === "collection-fixture.invalid") {
    if (Number(url.port) !== settings.port) throw new Error("Unexpected collection fixture destination");
    return request(url, { ...options, lookup: (_host, _options, done) => done(null, "127.0.0.1", 4) }, callback);
  }
  return request(url, options, callback);
};
syncBuiltinESMExports();
const marker = join(process.env.OMB_DATA_DIR, "collection-report-committed.json");
const append = Store.prototype.appendMessage;
Store.prototype.appendMessage = function(threadId, message, command) {
  const result = append.call(this, threadId, message, command);
  if (settings.crashAfterReport && message.automation && !existsSync(marker)) {
    writeFileSync(marker, JSON.stringify({ threadId, messageId: result.id, runId: message.automation.runId }), { mode: 0o600, flag: "wx" });
    process.kill(process.pid, "SIGKILL");
  }
  return result;
};
