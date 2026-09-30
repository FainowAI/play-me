import http from "node:http";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { ApprovalWaiter } from "../approvals.js";
import type { Repo } from "../repo.js";
import { createHttpServer } from "../server.js";
import type { Approval, ChatSession } from "../types.js";

const now = new Date().toISOString();
const sessions: ChatSession[] = [];
const approvals = new Map<string, Approval>();
approvals.set("a1", { id: "a1", chat_session_id: "x", set_id: null, action: "t", payload: {}, status: "pending", decided_at: null, created_at: now });
approvals.set("a2", { id: "a2", chat_session_id: "x", set_id: null, action: "t", payload: {}, status: "pending", decided_at: null, created_at: now });

// Repo falso: só o que as rotas testadas usam.
const repo = {
  createSession(title: string) {
    const s: ChatSession = { id: `s${sessions.length + 1}`, agent_session_id: null, title, created_at: now, updated_at: now };
    sessions.push(s);
    return s;
  },
  getSession: (id: string) => sessions.find((s) => s.id === id),
  listSessions: () => sessions,
  getApproval: (id: string) => approvals.get(id),
  decideApproval(id: string, decision: "approved" | "rejected") {
    const a = approvals.get(id);
    if (!a || a.status !== "pending") throw new Error("inválida");
    const next = { ...a, status: decision, decided_at: now };
    approvals.set(id, next);
    return next;
  },
} as unknown as Repo;

const waiter = new ApprovalWaiter();
const server = createHttpServer({
  repo,
  waiter,
  chat: async (_id, _msg, emit) => {
    emit({ type: "text", text: "oi" });
    emit({ type: "done", cost_usd: null });
  },
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const post = (path: string, body: unknown) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

try {
  let r = await fetch(`${base}/api/sessions`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), []);

  r = await post("/api/chat", { message: "faz um set de eletro" });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /text\/event-stream/);
  const events = (await r.text()).split("\n\n").filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, "")) as { type: string });
  assert.deepEqual(events.map((e) => e.type), ["session", "text", "done"]);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.title, "faz um set de eletro");

  assert.equal((await post("/api/chat", { message: "  " })).status, 400);
  assert.equal((await post("/api/chat", { session_id: "nao-existe", message: "oi" })).status, 404);

  const pending = waiter.wait("a1");
  r = await post("/api/approvals/a1", { decision: "approved" });
  assert.equal(r.status, 200);
  assert.equal(((await r.json()) as Approval).status, "approved");
  assert.equal(await pending, "approved");
  assert.equal((await post("/api/approvals/a1", { decision: "rejected" })).status, 409);
  assert.equal((await post("/api/approvals/a1", { decision: "talvez" })).status, 400);
  // ninguém esperando (restart/desconexão): expira como rejeitada
  assert.equal((await post("/api/approvals/a2", { decision: "approved" })).status, 409);
  assert.equal(approvals.get("a2")?.status, "rejected");

  r = await fetch(`${base}/api/sessions`, { headers: { Origin: "http://localhost:5173" } });
  assert.equal(r.headers.get("access-control-allow-origin"), "http://localhost:5173");
  r = await fetch(`${base}/api/sessions`, { headers: { Origin: "http://evil.test" } });
  assert.equal(r.headers.get("access-control-allow-origin"), null);
  assert.equal(r.status, 403, "origem estranha é recusada");
  // DNS rebinding: Host de outro domínio é recusado
  const port = new URL(base).port;
  const rebind = await new Promise<number>((resolve) => {
    http.get({ host: "127.0.0.1", port, path: "/api/sessions", headers: { Host: `evil.test:${port}` } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
  });
  assert.equal(rebind, 403);
  // CSRF: POST sem JSON (text/plain não gera preflight) é recusado
  r = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ message: "oi" }) });
  assert.equal(r.status, 415);

  assert.equal((await fetch(`${base}/api/nada`)).status, 404);
} finally {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
console.log("[ok] http: sessions, chat SSE, validações, approvals, CORS e 404");
