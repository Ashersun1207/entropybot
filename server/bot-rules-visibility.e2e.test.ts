import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { companionIdentityHeaders, createProxyHandler } from "../companion/src/proxy.ts";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import { openSse, type SseRecorder } from "./testing/sse.ts";

const privateFields = { defaultRules: "## Private fixture rules", vpsAlias: "fixture-host" };

async function listedBot(url: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${url}/api/bots?messages=0`, { headers });
  expect(response.status).toBe(200);
  const { bots } = await response.json() as { bots: Array<{ id: string; name: string }> };
  expect(bots).toHaveLength(1);
  return bots[0];
}

async function patch(url: string, id: string, body: object, headers: Record<string, string> = {}) {
  const response = await fetch(`${url}/api/bots/${id}`, {
    method: "PATCH", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  await response.json();
}

function expectPublic(bot: unknown, id: string, name: string) {
  expect(bot).toMatchObject({ id, name });
  for (const key of Object.keys(privateFields)) expect.soft(bot).not.toHaveProperty(key);
}

it("keeps service loopback bot lists free of private settings and refuses its event stream", async () => {
  const fixture = await launchVerificationServer();
  const { url } = fixture.info;
  try {
    const { id, name } = await listedBot(url);
    await patch(url, id, privateFields);
    expect(await listedBot(url)).toMatchObject(privateFields);
    await fixture.restart(undefined, { env: { OMB_LOOPBACK_TRUST: "service" } });
    expect(await (await fetch(`${url}/api/auth/session`)).json()).toMatchObject({ kind: "loopback", trust: "service", scopes: ["client"] });
    expectPublic(await listedBot(url), id, name);
    const events = await fetch(`${url}/api/events`, { signal: AbortSignal.timeout(5_000) });
    expect(events.status).toBe(403);
    expect(await events.text()).not.toContain(privateFields.defaultRules);
  } finally {
    await fixture.close();
  }
});

it("filters bot settings on both sides of the authenticated Companion relay, live and on replay", async () => {
  const fixture = await launchVerificationServer();
  const { url } = fixture.info;
  const ownerToken = "o".repeat(43), companionToken = "c".repeat(43);
  const owner = { "x-entropybot-desktop-owner": ownerToken };
  const phone = { authorization: "Bearer synthetic-phone" };
  const upstream = companionIdentityHeaders("paired-phone", companionToken);
  const sidecar = createServer(createProxyHandler({
    harnessPort: Number(new URL(url).port), mutationToken: () => companionToken,
    authenticate: (token) => token === "synthetic-phone" ? { id: "paired-phone", cloudDesktopAccess: false, browserControlAccess: false } : null,
    redeem: () => ({ error: "already paired" }), serverName: () => "Fixture",
  }));
  const streams: SseRecorder[] = [];
  const stream = async (base: string, headers: Record<string, string>) => {
    const sse = await openSse(`${base}/api/events`, headers);
    streams.push(sse);
    return sse;
  };
  try {
    const { id, name } = await listedBot(url);
    await patch(url, id, privateFields);
    await fixture.restart(undefined, { env: { OMB_DESKTOP_PARENT: "1", OMB_TEST_DESKTOP_OWNER_TOKEN: ownerToken, OMB_TEST_COMPANION_TOKEN: companionToken } });
    await new Promise<void>((resolve, reject) => sidecar.once("error", reject).listen(0, "127.0.0.1", resolve));
    const relay = `http://127.0.0.1:${(sidecar.address() as AddressInfo).port}`;
    const refused = await fetch(`${url}/api/bots`, { headers: companionIdentityHeaders("paired-phone", "wrong-token") });
    expect(refused.status).toBe(403);
    expect(await listedBot(url, owner)).toMatchObject({ id, ...privateFields });
    expectPublic(await listedBot(url, upstream), id, name);
    expectPublic(await listedBot(relay, phone), id, name);

    const adminStream = await stream(url, owner);
    const upstreamStream = await stream(url, upstream);
    const phoneStream = await stream(relay, phone);
    const { cursor } = await upstreamStream.until((frame) => frame.kind === "hello");
    const changedName = "Updated fixture bot";
    const updated = (sse: SseRecorder) => sse.until((frame) => frame.kind === "bot" && frame.bot?.id === id && frame.bot.name === changedName);
    await patch(url, id, { name: changedName }, owner);
    expect((await updated(adminStream)).bot).toMatchObject({ id, name: changedName, ...privateFields });
    expectPublic((await updated(upstreamStream)).bot, id, changedName);
    expectPublic((await updated(phoneStream)).bot, id, changedName);
    const replay = await stream(url, { ...upstream, "last-event-id": cursor });
    expect(await replay.until((frame) => frame.kind === "hello")).toMatchObject({ resumed: true });
    expectPublic((await updated(replay)).bot, id, changedName);
  } finally {
    for (const sse of streams) sse.close();
    if (sidecar.listening) await new Promise<void>((resolve) => { sidecar.close(() => resolve()); sidecar.closeAllConnections(); });
    await fixture.close();
  }
});
