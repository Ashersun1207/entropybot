import { expect, it } from "vitest";
import { ledgerKey, armLedgerRace, multitabFixture } from "./manual-run-multitab-fixture.ts";

const enabled = process.env.OMB_UI_E2E === "1";
type Page = Awaited<ReturnType<Awaited<ReturnType<typeof multitabFixture>>["open"]>>;
const ledger = (page: Page) => page.evaluate(`JSON.parse(localStorage.getItem('${ledgerKey}'))`);
const settled = async (page: Page) => await page.has("Run now") || await page.has("Retry");

it.runIf(enabled).each(["same", "different", "capacity"] as const)("coordinates %s ledger reservations through two actual pages", async (kind) => {
  const fixture = await multitabFixture(`ledger-${kind}`);
  try {
    const a = await fixture.open();
    const b = await fixture.open(fixture.routines[kind === "same" ? 0 : 1].id);
    if (kind === "capacity") {
      const environment = await fixture.api("GET", "/.well-known/entropybot/environment");
      const session = await fixture.api("GET", "/api/auth/session");
      const entries = Array.from({ length: 31 }, (_, i) => ({ environmentId: environment.environmentId, contextId: session.manualRoutineRequests.contextId, routineId: `synthetic-retained-${i}`, key: crypto.randomUUID(), phase: "pending" }));
      await a.evaluate(`localStorage.setItem('${ledgerKey}',${JSON.stringify(JSON.stringify({ version: 1, entries }))});true`);
      fixture.report.originalMarkers = entries;
    } else fixture.hold();
    await armLedgerRace(a, "A"); await armLedgerRace(b, "B");
    await Promise.all([a.click("Run now"), b.click("Run now")]);
    if (kind === "capacity") {
      await expect.poll(async () => await settled(a) && await settled(b), { timeout: 20_000 }).toBe(true);
      expect(fixture.posts).toHaveLength(1);
      const stored = await ledger(a);
      expect(stored.entries).toHaveLength(32);
      expect(stored.entries.slice(0, 31)).toEqual(fixture.report.originalMarkers);
    } else {
      await expect.poll(() => fixture.posts.length, { timeout: 20_000 }).toBe(2);
      const pending = await ledger(a); fixture.report.ledgerWhileResponseHeld = pending;
      expect(new Set(fixture.posts.map((post) => post.key)).size).toBe(kind === "same" ? 1 : 2);
      expect(pending.entries).toHaveLength(kind === "same" ? 1 : 2);
      fixture.release();
      await expect.poll(async () => await a.has("Run now") && await b.has("Run now")).toBe(true);
    }
    const runs = (await fixture.runs()).filter((run) => fixture.posts.some((post) => post.runId === run.id));
    fixture.report.admittedRuns = runs; fixture.report.finalLedger = await ledger(a);
    expect(runs).toHaveLength(kind === "different" ? 2 : 1);
    expect(fixture.posts.every((post) => post.status === 201)).toBe(true);
    expect(fixture.report.legacyPosts ?? 0).toBe(0); fixture.report.passed = true;
  } finally { fixture.release(); await fixture.close(); }
}, 90_000);

it.runIf(enabled).each(["lost", "confirmed"] as const)("recovers %s identity in another page and after reload without automatic resend", async (fault) => {
  const fixture = await multitabFixture(`recovery-${fault}`);
  try {
    const a = await fixture.open();
    if (fault === "lost") await a.evaluate(`(()=>{const original=fetch;let lost=false;window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).endsWith('/run-protected')&&!lost){lost=true;throw Error('Synthetic accepted response lost')}return response};return true})()`);
    await a.click("Run now");
    await expect.poll(() => fixture.posts.length).toBe(1);
    await expect.poll(() => a.has(fault === "lost" ? "Retry" : "Run now")).toBe(true);
    const original = fixture.posts[0];
    const b = await fixture.open(); await expect.poll(() => b.has("Retry")).toBe(true);
    await b.reload(); expect(fixture.posts).toHaveLength(1);
    await b.click("Retry"); await expect.poll(() => fixture.posts.length).toBe(2);
    await expect.poll(() => b.has("Run now")).toBe(true);
    expect(fixture.posts[1]).toEqual(original); expect(await fixture.runs()).toHaveLength(1);
    await b.click("Run now"); await expect.poll(() => fixture.posts.length).toBe(3);
    await expect.poll(() => b.has("Run now")).toBe(true);
    expect(fixture.posts[2].key).not.toBe(original.key); expect(fixture.posts[2].runId).not.toBe(original.runId);
    expect(await fixture.runs()).toHaveLength(2); fixture.report.passed = true;
  } finally { await fixture.close(); }
}, 90_000);

it.runIf(enabled)("keeps an explicit replacement when the original response arrives late", async () => {
  const fixture = await multitabFixture("acknowledged-replacement");
  try {
    fixture.hold(); const a = await fixture.open(); await a.click("Run now");
    await expect.poll(() => fixture.posts.length).toBe(1);
    const b = await fixture.open();
    await b.evaluate("window.confirm=()=>false;true"); await b.click("Start another run…"); expect(fixture.posts).toHaveLength(1);
    await b.evaluate("window.confirm=()=>true;true"); await b.click("Start another run…");
    await expect.poll(() => fixture.posts.length).toBe(2); await expect.poll(() => b.has("Run now")).toBe(true);
    const stored = await ledger(b); expect(fixture.posts[1].key).not.toBe(fixture.posts[0].key);
    fixture.release(); await expect.poll(() => a.has("Retry")).toBe(true);
    expect(await ledger(a)).toEqual(stored); expect(await fixture.runs()).toHaveLength(2);
    fixture.report.finalLedger = stored; fixture.report.passed = true;
  } finally { fixture.release(); await fixture.close(); }
}, 90_000);

it.runIf(enabled).each(["missing", "replaced"] as const)("refuses a fresh owner's explicit Retry when the marker is %s during preflight", async (change) => {
  const fixture = await multitabFixture(`stale-${change}`);
  try {
    const a = await fixture.open(); await a.click("Run now");
    await expect.poll(() => a.has("Run now")).toBe(true); expect(fixture.posts).toHaveLength(1);
    const b = await fixture.open();
    await b.evaluate(`(()=>{const original=fetch;let held=false;window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0])==='/api/auth/session'&&!held){held=true;await new Promise(resolve=>window.releasePreflight=resolve)}return response};return true})()`);
    await b.click("Retry"); await expect.poll(() => b.evaluate("typeof window.releasePreflight==='function'")).toBe(true);
    await a.evaluate(`navigator.locks.request('${ledgerKey}',()=>{const stored=JSON.parse(localStorage.getItem('${ledgerKey}'));if(${JSON.stringify(change)}==='missing')stored.entries=[];else stored.entries[0].key=crypto.randomUUID();localStorage.setItem('${ledgerKey}',JSON.stringify(stored))})`);
    const stored = await ledger(a); await b.evaluate("window.releasePreflight();true");
    await expect.poll(() => settled(b)).toBe(true); expect(fixture.posts).toHaveLength(1); expect(await ledger(b)).toEqual(stored);
    fixture.report.finalLedger = stored; fixture.report.passed = true;
  } finally { await fixture.close(); }
}, 90_000);

it.runIf(enabled)("bounds native lock acquisition, does not dispatch after expiry, and releases on document close", async () => {
  const fixture = await multitabFixture("deadline-and-document-close");
  try {
    const a = await fixture.open(); const b = await fixture.open();
    await a.evaluate(`window.held=false;navigator.locks.request('${ledgerKey}',()=>{window.held=true;return new Promise(resolve=>window.releaseLock=resolve)});true`);
    await expect.poll(() => a.evaluate("window.held")).toBe(true);
    await b.click("Run now");
    await expect.poll(() => b.evaluate("document.body.textContent.includes('This browser could not safely coordinate task runs.')"), { timeout: 10_000 }).toBe(true);
    expect(fixture.posts).toHaveLength(0); expect(await ledger(b)).toBeNull();
    await a.evaluate("window.releaseLock();true");
    await b.evaluate(`navigator.locks.request('${ledgerKey}',()=>true)`); expect(fixture.posts).toHaveLength(0);
    await a.evaluate(`window.heldAgain=false;navigator.locks.request('${ledgerKey}',()=>{window.heldAgain=true;return new Promise(()=>{})});true`);
    await expect.poll(() => a.evaluate("window.heldAgain")).toBe(true);
    await a.close();
    await expect.poll(() => b.evaluate(`navigator.locks.request('${ledgerKey}',{ifAvailable:true},lock=>!!lock)`)).toBe(true);
    await b.click("Run now"); await expect.poll(() => fixture.posts.length).toBe(1); await expect.poll(() => b.has("Run now")).toBe(true);
    fixture.report.passed = true;
  } finally { await fixture.close(); }
}, 90_000);

it.runIf(enabled)("cancels a real running routine while another page waits on ledger coordination", async () => {
  const fixture = await multitabFixture("cancel-while-held", "hang");
  try {
    const a = await fixture.open(); await a.click("Run now");
    await expect.poll(() => fixture.posts.length).toBe(1); await expect.poll(() => a.has("Cancel run")).toBe(true);
    const b = await fixture.open();
    await a.evaluate(`window.holding=false;navigator.locks.request('${ledgerKey}',()=>{window.holding=true;return new Promise(resolve=>window.releaseLock=resolve)});true`);
    await expect.poll(() => a.evaluate("window.holding")).toBe(true);
    await b.click("Retry"); await a.click("Cancel run");
    await expect.poll(async () => (await fixture.runs()).find((run) => run.id === fixture.posts[0].runId)?.status, { timeout: 4_000 }).toBe("cancelled");
    await expect.poll(() => b.has("Retry"), { timeout: 10_000 }).toBe(true);
    expect(fixture.posts).toHaveLength(1); await a.evaluate("window.releaseLock();true");
    await b.evaluate(`navigator.locks.request('${ledgerKey}',()=>true)`); expect(fixture.posts).toHaveLength(1);
    fixture.report.admittedRuns = await fixture.runs(); fixture.report.passed = true;
  } finally { await fixture.close(); }
}, 90_000);

it.runIf(enabled)("blocks actual insecure HTTP with clear feedback while preserving prior records", async () => {
  const fixture = await multitabFixture("insecure-http");
  try {
    const page = await fixture.open(fixture.routines[0].id, true);
    const capabilities = await page.evaluate("({secure:isSecureContext,locks:typeof navigator.locks})");
    fixture.report.capabilities = capabilities; expect(capabilities).toEqual({ secure: false, locks: "undefined" });
    const environment = await fixture.api("GET", "/.well-known/entropybot/environment"); const session = await fixture.api("GET", "/api/auth/session");
    const stored = { version: 1, entries: [{ environmentId: environment.environmentId, contextId: session.manualRoutineRequests.contextId, routineId: fixture.routines[0].id, key: crypto.randomUUID(), phase: "pending" }] };
    await page.evaluate(`localStorage.setItem('${ledgerKey}',${JSON.stringify(JSON.stringify(stored))});true`);
    await page.reload(); await page.click("Retry");
    await expect.poll(() => page.evaluate("document.body.textContent.includes('Use the desktop app or a supported browser over HTTPS')")).toBe(true);
    expect(fixture.posts).toHaveLength(0); expect(await ledger(page)).toEqual(stored); expect(await page.has("Edit")).toBe(true);
    fixture.report.passed = true;
  } finally { await fixture.close(); }
}, 90_000);
