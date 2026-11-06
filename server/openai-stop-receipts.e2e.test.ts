import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { RECEIPT_MCP_SCRIPT, startLateToolFixture } from "./testing/late-tool-fixture.ts";
import { openSse } from "./testing/sse.ts";

type Message = { id: string; turnId?: string; text?: string; tool?: { itemId?: string; ok?: boolean; output?: unknown }; card?: { requestId?: string; answered?: string; dismissed?: boolean } };

it("isolates stopped tool receipts at each acceptance phase through production dispatch and approval", async () => {
  const upstream = await startLateToolFixture();
  onTestFinished(() => upstream.close());
  const fixture = await launchVerificationServer();
  onTestFinished(() => fixture.close());
  const events = await openSse(`${fixture.info.url}/api/events`, { origin: fixture.info.url });
  onTestFinished(() => events.close());
  const evidence: unknown[] = [{ fixture: fixture.info }];
  onTestFinished(() => {
    const evidencePath = `${fixture.info.logPath}.stop-receipts.json`;
    writeFileSync(evidencePath, JSON.stringify({ evidence, calls: upstream.calls, effects: upstream.effects, receiptAttempts: upstream.receiptAttempts }, null, 2), { mode: 0o600 });
    console.info(JSON.stringify({ evidencePath }));
  });
  const control = async (...args: string[]) => {
    const result = await runControlOmb([...args, "--url", fixture.info.url]) as any;
    evidence.push({ command: args, result });
    return result;
  };
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method, headers: { "content-type": "application/json", origin: fixture.info.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json() as any;
    expect(response.ok, JSON.stringify(result)).toBe(true);
    return result;
  };
  await api("PATCH", "/api/config", { openaiCompat: { key: "synthetic-stop-fixture-key", url: `${upstream.origin}/v1`, model: "fixture-model" } });
  await api("POST", "/api/instances/openaiCompat/refresh-models", {});
  for (const starter of (await api("GET", "/api/bots")).bots) await api("PATCH", `/api/bots/${starter.id}`, { mcpServers: [] });
  const script = join(fixture.info.dataDir, "receipt-mcp.mjs");
  writeFileSync(script, RECEIPT_MCP_SCRIPT);
  await api("POST", "/api/mcp/servers", { name: "receipt", command: process.execPath, args: [script, upstream.origin], env: {}, enabled: true });
  await api("PATCH", "/api/mcp/servers/receipt", { enabled: true });
  for (const phase of ["approval", "unaccepted", "accepted", "completed"] as const) {
    const { bot } = await control("new-bot", "--name", `Stop ${phase}`);
    const threadId = bot.activeTaskId as string;
    await control("set-model", "--bot", bot.id, "--instance", "openaiCompat", "--model", "fixture-model");
    await api("PATCH", `/api/bots/${bot.id}`, { mcpServers: ["receipt"], approvalMode: "ask", soul: "Use the controlled receipt tool when requested." });
    const oldLabel = `STOP_FIXTURE_old_${phase}`, newLabel = `STOP_FIXTURE_new_${phase}`;
    const old = upstream.prepare(oldLabel, phase === "approval" ? "unaccepted" : phase);
    const next = upstream.prepare(newLabel, "accepted");
    const messages = async (): Promise<Message[]> => (await api("GET", `/api/threads/${threadId}/messages`)).messages;
    const send = (label: string) => control("send", "--bot", bot.id, "--task", threadId, "--text", label);
    const wait = () => control("wait", "--bot", bot.id, "--task", threadId, "--timeout", "20");
    const decide = (requestId: string) => api("POST", `/api/bots/${bot.id}/respond`, { threadId, requestId, behavior: "allow" });
    const pendingCard = async () => (await messages()).findLast((message) => message.card?.requestId && !message.card.answered)!;
    await send(oldLabel);
    expect((await wait()).status).toBe("needs-user");
    const oldCard = await pendingCard();
    expect(oldCard?.card?.requestId).toBeTruthy();
    if (phase !== "approval") {
      expect(await decide(oldCard.card!.requestId!)).toMatchObject({ outcome: "allowed-once" });
      await expect.poll(() => old.received).toBe(true);
      expect(old.accepted).toBe(phase !== "unaccepted");
      expect(old.completed).toBe(phase === "completed");
    }
    const atStop = { received: old.received, accepted: old.accepted, completed: old.completed };
    await control("interrupt", "--bot", bot.id, "--task", threadId);
    expect((await wait()).status).toBe("settled");
    const stopped = await messages();
    const oldTool = stopped.findLast((message) => message.tool?.itemId === "reused-call-id")!;
    expect(oldTool?.tool?.ok).toBe(false);
    await events.until((frame) => frame.kind === "runtime" && frame.event.type === "turn.completed" && frame.event.turnId === oldTool.turnId);
    const afterStop = events.frames.length;
    if (phase !== "approval") {
      expect(JSON.stringify(oldTool.tool?.output)).toContain("may have taken effect");
      expect(JSON.stringify(oldTool.tool?.output)).toContain("Verify its state before retrying");
      await expect.poll(() => old.disconnected).toBe(true);
    }
    await send(newLabel);
    expect((await wait()).status).toBe("needs-user");
    const newCard = await pendingCard();
    expect(newCard.card!.requestId).not.toBe(oldCard.card!.requestId);
    expect(await decide(oldCard.card!.requestId!)).toMatchObject({ outcome: "unavailable" });
    expect((await pendingCard()).card!.requestId).toBe(newCard.card!.requestId);
    expect(await decide(newCard.card!.requestId!)).toMatchObject({ outcome: "allowed-once" });
    await expect.poll(() => next.received).toBe(true);
    const beforeRelease = await messages();
    const newTool = beforeRelease.findLast((message) => message.tool?.itemId === "reused-call-id")!;
    expect(newTool.id).not.toBe(oldTool.id);
    expect(oldTool.turnId).toBeTruthy();
    expect(newTool.turnId).toBeTruthy();
    expect(newTool.turnId).not.toBe(oldTool.turnId);
    expect(newTool.tool?.ok).toBeUndefined();
    old.release.resolve();
    if (phase !== "approval") await old.finished.promise;
    const afterRelease = await messages();
    expect(afterRelease.find((message) => message.id === newTool.id)?.tool?.ok).toBeUndefined();
    expect(afterRelease.find((message) => message.id === oldTool.id)?.tool).toEqual(oldTool.tool);
    expect(JSON.stringify(afterRelease)).not.toContain(`RECEIPT_${oldLabel}`);
    const state = (await api("GET", "/api/bots?messages=0")).bots.find((candidate: any) => candidate.id === bot.id);
    expect(state.busy).toBe(true);
    expect(upstream.calls.filter((label) => label === oldLabel)).toHaveLength(phase === "approval" ? 0 : 1);
    expect(upstream.effects.filter((label) => label === oldLabel)).toHaveLength(phase === "accepted" || phase === "completed" ? 1 : 0);
    expect(old.accepted).toBe(phase === "accepted" || phase === "completed");
    expect(upstream.receiptAttempts.filter((label) => label === oldLabel)).toHaveLength(phase === "accepted" || phase === "completed" ? 1 : 0);
    expect(upstream.requests.filter((request) => request.label === oldLabel)).toHaveLength(1);
    expect(upstream.requests.filter((request) => request.label === newLabel)).toHaveLength(1);
    next.release.resolve();
    expect((await wait()).status).toBe("settled");
    const final = await messages();
    await events.until((frame) => frame.kind === "runtime" && frame.event.type === "turn.completed" && frame.event.turnId === newTool.turnId);
    const runtime = events.frames.filter((frame) => frame.kind === "runtime" && frame.event.threadId === threadId).map((frame) => frame.event);
    expect(runtime.filter((event) => event.type === "turn.completed" && event.turnId === oldTool.turnId)).toHaveLength(1);
    expect(runtime.filter((event) => event.type === "turn.completed" && event.turnId === newTool.turnId)).toEqual([expect.objectContaining({ ok: true })]);
    expect(events.frames.slice(afterStop).filter((frame) => frame.kind === "runtime" && frame.event.turnId === oldTool.turnId)).toEqual([]);
    expect(JSON.stringify(runtime)).not.toContain(`RECEIPT_${oldLabel}`);
    expect(final.find((message) => message.id === newTool.id)?.tool).toMatchObject({ ok: true, output: expect.anything() });
    expect(JSON.stringify(final.find((message) => message.id === newTool.id)?.tool?.output)).toContain(`RECEIPT_${newLabel}`);
    expect(JSON.stringify(final)).not.toContain(`RECEIPT_${oldLabel}`);
    expect(final.filter((message) => message.text === `Verified ${newLabel}`)).toHaveLength(1);
    const newRequests = upstream.requests.filter((request) => request.label === newLabel);
    expect(newRequests).toHaveLength(2);
    expect(JSON.stringify(newRequests)).not.toContain(`RECEIPT_${oldLabel}`);
    expect(upstream.calls.filter((label) => label === newLabel)).toHaveLength(1);
    expect(upstream.calls.filter((label) => label === oldLabel)).toHaveLength(phase === "approval" ? 0 : 1);
    expect(upstream.requests.filter((request) => request.label === oldLabel)).toHaveLength(1);
    expect(upstream.errors).toEqual([]);
    evidence.push({ phase, atStop, oldTurnId: oldTool.turnId, newTurnId: newTool.turnId, stoppedTool: oldTool.tool, finalTool: final.find((message) => message.id === newTool.id)?.tool,
      oldAccepted: old.accepted, oldCompleted: old.completed, oldReceiptAttempted: upstream.receiptAttempts.includes(oldLabel), newTurnBusyAfterOldReceipt: state.busy,
      runtime: runtime.map(({ type, turnId, ok, stopReason, itemId }) => ({ type, turnId, ok, stopReason, itemId })) });
  }
}, 120_000);
