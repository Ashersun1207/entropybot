import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, type TestContext } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

const rules = "## Working rules\n- 先给结论，再给细节。\n- Ask before sending email.\n";
const rulesAtLimit = "规".repeat(1_333) + "!";
const rulesOverLimit = `${rulesAtLimit}🙂`;

async function startFixture({ onTestFinished }: TestContext) {
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_TOOL_CALLS: "[]" });
  const dataDir = fixture.info.dataDir;
  onTestFinished(async () => {
    await fixture.close();
    expect(existsSync(dataDir)).toBe(false);
  });
  const api = async <T = unknown>(method: string, path: string, body?: unknown, status = 200, token?: string): Promise<T> => {
    const res = await fetch(fixture.info.url + path, {
      method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(10_000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = await res.json() as T;
    expect(res.status, `${method} ${path} returned ${JSON.stringify(json)}`).toBe(status);
    return json;
  };
  const control = (...args: string[]) => runControlOmb([...args, "--url", fixture.info.url]);
  const dump = () => JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")) as { systemPrompt: string; prompt: unknown };
  const createBot = async (name: string) => (await api<{ bot: { id: string; threadId: string } }>("POST", "/api/bots", { name }, 201)).bot;
  const turn = async (botId: string, text: string, threadId?: string) => {
    const target = ["--bot", botId, ...(threadId ? ["--task", threadId] : [])];
    await control("send", ...target, "--text", text);
    expect(await control("wait", ...target, "--timeout", "30")).toMatchObject({ status: "settled" });
    const captured = dump();
    expect(JSON.stringify(captured.prompt)).toContain(text);
    return captured;
  };
  return { fixture, api, dump, createBot, turn };
}

it("accepts exactly 4,000 UTF-8 bytes, persists through restart, rejects overflow, and clears the rules", async (ctx) => {
  const { fixture, api, createBot, turn } = await startFixture(ctx);
  const configFile = () => JSON.parse(readFileSync(join(fixture.info.dataDir, "config.json"), "utf8")) as { memory: unknown };
  expect(Buffer.byteLength(rulesAtLimit)).toBe(4_000);
  expect(rulesOverLimit.length).toBeLessThan(4_000);
  await api("PATCH", "/api/config", { memory: { tidyHour: 9 } });
  expect(await api("PATCH", "/api/config", { memory: { defaultRules: rulesAtLimit } })).toMatchObject({ memory: { defaultRules: rulesAtLimit } });
  expect(configFile().memory).toEqual({ tidyHour: 9, defaultRules: rulesAtLimit });
  expect(await api("PATCH", "/api/config", { memory: { defaultRules: rulesOverLimit, tidyHour: 4 } }, 400)).toMatchObject({ error: expect.stringContaining("4000") });
  expect(configFile().memory).toEqual({ tidyHour: 9, defaultRules: rulesAtLimit });
  await fixture.restart();
  expect(await api("GET", "/api/config")).toMatchObject({ memory: { defaultRules: rulesAtLimit } });
  const bot = await createBot("Max rules fixture bot");
  await api("PATCH", `/api/bots/${bot.id}`, { memoryUpkeep: false });
  expect((await turn(bot.id, "Maximum budget fixture turn")).systemPrompt).toContain(rulesAtLimit);

  const { code } = await api<{ code: string }>("POST", "/api/auth/pairing", { scopes: ["client"] });
  const { token } = await api<{ token: string }>("POST", "/api/auth/pair", { code });
  expect(await api("GET", "/api/config", undefined, 200, token)).not.toHaveProperty("memory");
  await api("PATCH", "/api/config", { memory: { defaultRules: "unauthorized overwrite" } }, 403, token);
  expect(configFile().memory).toEqual({ tidyHour: 9, defaultRules: rulesAtLimit });

  expect(await api("PATCH", "/api/config", { memory: { defaultRules: null } })).toMatchObject({ memory: { defaultRules: "" } });
  expect(configFile().memory).toEqual({ tidyHour: 9 });
}, 90_000);

it("omits blank rules and sends saved Markdown separately from About me, bot memory and local recall", async (ctx) => {
  const { api, dump, createBot, turn } = await startFixture(ctx);
  const existing = await createBot("Existing fixture bot");
  await api("PATCH", `/api/bots/${existing.id}`, { memoryEnabled: false, memoryUpkeep: false });
  expect((await turn(existing.id, "First fixture check")).systemPrompt).not.toContain("## Default rules");
  await api("PATCH", "/api/config", { memory: { defaultRules: rules }, profile: { aboutMe: "fixture-background-canary" } });
  expect((await turn(existing.id, "Second fixture check")).systemPrompt).toContain(rules.trimEnd());

  const bot = await createBot("Rules fixture bot");
  await api("PATCH", `/api/bots/${bot.id}`, { memoryUpkeep: false });
  await api("PUT", `/api/bots/${bot.id}/memory/file`, { path: "MEMORY.md", text: "# Memory\n\n- The core memory canary is MICA.\n" });
  await api("PUT", `/api/bots/${bot.id}/memory/file`, { path: "memory/dining.md", text: "---\ntitle: Dining\naliases: [food, restaurants, lunch]\n---\n- Loves pasta, hates olives\n" });
  const preview = await api<{ sections: Array<{ id: string; text: string }> }>("GET", `/api/bots/${bot.id}/system-prompt`);
  expect(preview.sections.find(({ id }) => id === "default-rules")?.text).toContain(rules.trimEnd());
  expect(preview.sections.find(({ id }) => id === "user-profile")?.text).toContain("fixture-background-canary");
  expect(preview.sections.find(({ id }) => id === "memory")?.text).toContain("memory/dining.md — Dining");
  const first = await turn(bot.id, "Can you suggest some restaurants for Friday?");
  expect(first.systemPrompt).toContain(rules.trimEnd());
  expect(first.systemPrompt).toContain("fixture-background-canary");
  expect(first.systemPrompt).toContain("The core memory canary is MICA.");
  expect(first.systemPrompt).toContain("memory/dining.md — Dining");
  expect(JSON.stringify(first.prompt)).toContain("Recalled for this message");
  expect(JSON.stringify(first.prompt)).toContain("Loves pasta, hates olives");

  const { group } = await api<{ group: { id: string } }>("POST", "/api/groups", {
    name: "Rules fixture room", memberIds: [bot.id, existing.id],
    setup: { bulletin: "", defaultResponder: { kind: "member", botId: bot.id } },
  }, 201);
  const roomText = "Rules fixture room turn";
  await api("POST", `/api/groups/${group.id}/messages`, { text: roomText }, 202);
  await expect.poll(() => JSON.stringify(dump().prompt)).toContain(roomText);
  expect(dump().systemPrompt).toContain(rules.trimEnd());

  await api("PATCH", "/api/config", { memory: { defaultRules: " \n\t" } });
  const cleared = await turn(existing.id, "Rules fixture blank check");
  expect(cleared.systemPrompt).not.toContain("## Default rules");
  expect(cleared.systemPrompt).not.toContain("Ask before sending email.");
  expect(cleared.systemPrompt).toContain("fixture-background-canary");
}, 120_000);
