import { createServer, type ServerResponse } from "node:http";

export type AcceptancePhase = "unaccepted" | "accepted" | "completed";
type ChatMessage = { role: string; content?: unknown; tool_call_id?: string };
export type ReceiptRequest = { messages: ChatMessage[]; tools?: Array<{ function: { name: string; description?: string } }> };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

export const RECEIPT_MCP_SCRIPT = `
import { createInterface } from "node:readline";
const origin = process.argv[2];
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
createInterface({ input: process.stdin }).on("line", async (line) => {
  const frame = JSON.parse(line);
  if (frame.method === "initialize") reply(frame.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "receipt-fixture", version: "1" } });
  else if (frame.method === "tools/list") reply(frame.id, { tools: [{ name: "receipt", description: "Controlled receipt operation for stop verification", inputSchema: { type: "object", properties: { label: { type: "string" } }, required: ["label"], additionalProperties: false } }] });
  else if (frame.method === "tools/call") {
    const response = await fetch(origin + "/operation", { method: "POST", body: JSON.stringify(frame.params.arguments) });
    reply(frame.id, await response.json());
  }
});
`;

export async function startLateToolFixture() {
  const plans = new Map<string, ReturnType<typeof prepare>>();
  const requests: Array<{ label: string; body: ReceiptRequest }> = [];
  const calls: string[] = [], effects: string[] = [], receiptAttempts: string[] = [];
  const handlers = new Set<Promise<void>>();
  const errors: unknown[] = [];
  function prepare(label: string, phase: AcceptancePhase) {
    const release = deferred(), finished = deferred();
    const state = { label, phase, received: false, accepted: false, completed: false, disconnected: false, release, finished };
    plans.set(label, state);
    return state;
  }
  function reply(response: ServerResponse, delta: unknown, finishReason: string) {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\ndata: [DONE]\n\n`);
  }
  const server = createServer((request, response) => {
    const handling = (async () => {
      if (request.method === "GET") {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
        return;
      }
      let raw = "";
      for await (const part of request) raw += part.toString();
      if (request.url === "/operation") {
        const { label } = JSON.parse(raw) as { label: string };
        const plan = plans.get(label);
        if (!plan) throw new Error(`Unplanned operation ${label}`);
        calls.push(label);
        plan.received = true;
        response.on("close", () => { plan.disconnected = true; });
        const accept = () => { plan.accepted = true; };
        const complete = () => { plan.completed = true; effects.push(label); };
        if (plan.phase !== "unaccepted") accept();
        if (plan.phase === "completed") complete();
        await plan.release.promise;
        if (plan.phase === "unaccepted" && response.destroyed) {
          plan.finished.resolve();
          return;
        }
        if (!plan.accepted) accept();
        if (!plan.completed) complete();
        receiptAttempts.push(label);
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ content: [{ type: "text", text: `RECEIPT_${label}` }] }));
        plan.finished.resolve();
        return;
      }
      const body = JSON.parse(raw) as ReceiptRequest;
      const lastUser = body.messages?.findLast((message) => message.role === "user")?.content;
      const label = typeof lastUser === "string" ? lastUser.match(/STOP_FIXTURE_[a-z_]+/)?.[0] : undefined;
      if (!label) { reply(response, { content: "Fixture helper response." }, "stop"); return; }
      requests.push({ label, body });
      const result = body.messages.findLast((message) => message.role === "tool");
      if (result) { reply(response, { content: `Verified ${label}` }, "stop"); return; }
      const name = body.tools?.find((tool) => tool.function.description?.includes("Controlled receipt operation"))?.function.name;
      if (!name) throw new Error("Controlled receipt tool was not advertised");
      reply(response, { tool_calls: [{ index: 0, id: "reused-call-id", type: "function", function: { name, arguments: JSON.stringify({ label }) } }] }, "tool_calls");
    })().catch((error: unknown) => {
      errors.push(error);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
    handlers.add(handling);
    void handling.finally(() => handlers.delete(handling));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture failed to bind");
  return {
    origin: `http://127.0.0.1:${address.port}`, prepare, requests, calls, effects, receiptAttempts, errors,
    async close() {
      server.closeAllConnections();
      for (const plan of plans.values()) plan.release.resolve();
      await Promise.all(handlers);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
