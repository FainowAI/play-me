import http from "node:http";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthRequiredError } from "spotify-dj-mcp-server/dist/services/auth.js";
import type { MixGuideStep } from "spotify-dj-mcp-server/dist/types.js";
import { ApprovalWaiter } from "../approvals.js";
import { openRepo, type Repo } from "../repo.js";
import { createHttpServer, type HttpDeps } from "../server.js";
import { InvalidSettingsError, SettingsStore, validateWeights } from "../settings.js";
import type { Approval, ChatSession, PlanRow, Playlist, ServerEvent, SetRow, SetSnapshot, SetVersion, Status, TransitionFeedback, Turn } from "../types.js";

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
  getCurrentSet: () => undefined,
  getApproval: (id: string) => approvals.get(id),
  decideApproval(id: string, decision: "approved" | "rejected") {
    const a = approvals.get(id);
    if (!a || a.status !== "pending") throw new Error("inválida");
    const next = { ...a, status: decision, decided_at: now };
    approvals.set(id, next);
    return next;
  },
} as unknown as Repo;

const dir = mkdtempSync(join(tmpdir(), "playme-http-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
const STATUS: Status = { model: "claude-haiku-4-5", anthropic: true, spotify: { connected: true }, reccobeats: true, jev: false };
const PLAYLISTS: Playlist[] = [{ id: "pl1", name: "Eletro", total: 557, url: "https://open.spotify.com/playlist/pl1" }];
let playlistsImpl: () => Promise<Playlist[]> = async () => PLAYLISTS;
const settingsFile = join(dir, "settings.json");
const settings = new SettingsStore(settingsFile);
const extra = { status: () => STATUS, playlists: () => playlistsImpl(), settings };

const waiter = new ApprovalWaiter();
const listen = async (deps: HttpDeps) => {
  const s = createHttpServer(deps);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return { server: s, base: `http://127.0.0.1:${(s.address() as AddressInfo).port}` };
};
const { server, base } = await listen({
  repo,
  waiter,
  ...extra,
  chat: async (_id, _msg, emit) => {
    emit({ type: "text", text: "oi" });
    emit({ type: "done", cost_usd: null });
  },
});
const post = (path: string, body: unknown) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const put = (path: string, body: unknown) =>
  fetch(base + path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

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

  // status: só diz se as chaves existem
  r = await fetch(`${base}/api/status`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), STATUS);

  // playlists: a lista; 503 sem conexão com o Spotify; 502 sem o detalhe interno
  r = await fetch(`${base}/api/playlists`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { items: PLAYLISTS });
  playlistsImpl = async () => {
    throw new AuthRequiredError("tokens em C:\segredo");
  };
  r = await fetch(`${base}/api/playlists`);
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { error: "Spotify não conectado. Rode npm run auth -w packages/mcp-server." });
  playlistsImpl = async () => {
    throw new Error("detalhe interno do Spotify");
  };
  const log = console.error;
  console.error = () => undefined; // o servidor loga o detalhe (esperado aqui)
  try {
    r = await fetch(`${base}/api/playlists`);
  } finally {
    console.error = log;
  }
  assert.equal(r.status, 502);
  assert.deepEqual(await r.json(), { error: "Spotify indisponível." });

  // configurações: padrões sem arquivo; PUT válido grava; inválido é 400 com a mensagem e não mexe no salvo
  const W = { camelot: 35, bpm: 25, energy: 25, style: 10, progression: 5 };
  r = await fetch(`${base}/api/settings`);
  assert.deepEqual(await r.json(), { weights: W });
  const mine = { camelot: 40, bpm: 20, energy: 20, style: 10, progression: 10 };
  r = await put("/api/settings", { weights: mine });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { weights: mine });
  assert.deepEqual(await (await fetch(`${base}/api/settings`)).json(), { weights: mine });
  assert.deepEqual(new SettingsStore(settingsFile).get(), { weights: mine }); // gravado em arquivo
  const invalid: [unknown, RegExp][] = [
    [{ weights: { ...mine, camelot: 41 } }, /soma é 101/],
    [{ weights: { ...mine, camelot: 40.5, bpm: 19.5 } }, /inteiro/],
    [{ weights: { ...mine, camelot: 101, bpm: -1 } }, /inteiro de 0 a 100/],
    [{ weights: { camelot: 40, bpm: 20, energy: 20, style: 10 } }, /exatamente/],
    [{ weights: { ...mine, extra: 0 } }, /exatamente/],
    [{ weights: "40" }, /weights/],
    [{}, /weights/],
  ];
  for (const [body, message] of invalid) {
    r = await put("/api/settings", body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(((await r.json()) as { error: string }).error, message);
  }
  assert.deepEqual(await (await fetch(`${base}/api/settings`)).json(), { weights: mine });
  assert.equal((await fetch(`${base}/api/settings`, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ weights: mine }) })).status, 415);
  assert.equal((await fetch(`${base}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{" })).status, 400);
  // o preflight do PUT só libera o navegador se PUT estiver em Allow-Methods
  r = await fetch(`${base}/api/settings`, { method: "OPTIONS", headers: { Origin: "http://127.0.0.1:5173", "Access-Control-Request-Method": "PUT" } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-methods"), "GET, POST, PUT");
  assert.equal(r.headers.get("access-control-allow-origin"), "http://127.0.0.1:5173");
  // arquivo inválido ou com pesos que não fecham 100: valem os padrões
  assert.deepEqual(validateWeights(W), W);
  assert.throws(() => validateWeights({ ...W, bpm: 26 }), InvalidSettingsError);
  writeFileSync(settingsFile, "{ não é json");
  assert.deepEqual(settings.get(), { weights: W });
  writeFileSync(settingsFile, JSON.stringify({ weights: { ...W, bpm: 26 } }));
  assert.deepEqual(settings.get(), { weights: W });

  assert.equal((await fetch(`${base}/api/nada`)).status, 404);
} finally {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}

// ---------- repo real em memória: sessões com o set, sessão com turnos e versões detalhadas, set com snapshot, planos e guia ----------
{
  type VersionJson = SetVersion & { plans: PlanRow[]; guide: MixGuideStep[] };
  const PLAN = {
    from: "t1", to: "t2", type: "blend", length_bars: 16, bass_swap_bar: 8,
    tempo: { from_bpm: 124, to_bpm: 124, diff: 0, mode: "normal", strategy: "match_incoming" },
    harmonic: { from: "8A", to: "9A", relation: "adjacente +1", class: "segura" },
    energy_delta: 0, confidence: 0.9, alerts: [], reason: "ok", planner_version: "meta-1",
  };
  const SNAP: SetSnapshot = {
    curve: "classic",
    average_score: 0.9,
    order: [
      { position: 1, track_id: "t1", label: "Um — Artista", bpm: 124, camelot: "8A", energy: 6, target_energy: 4, section: "abertura", source: "web", key_review: true },
      { position: 2, track_id: "t2", label: "Dois — Artista", bpm: 124, camelot: "9A", energy: 7, target_energy: 5.5, section: "encerramento", source: "spotify-mixar", key_review: false },
    ],
    transitions: [],
    weak_transitions: [],
    problem_tracks: [],
    warnings: [],
  };
  const real = openRepo(":memory:");
  const empty = real.createSession("Sem set");
  const s = real.createSession("Eletro");
  const v1 = real.recordProposal(s.id, "[DJ MIX] Eletro", "classic", ["t1", "t2"], "monte", SNAP);
  real.savePlans(v1.version.id, [{ position: 1, from_track: "t1", to_track: "t2", plan: PLAN, planner_version: "meta-1", score: 0.9 }]);
  const v2 = real.recordProposal(s.id, "x", "classic", ["t2", "t1"], "inverte", null); // sem snapshot, como as versões do banco antigo
  real.savePlans(v2.version.id, [{ position: 1, from_track: "t2", to_track: "t1", plan: PLAN, planner_version: "meta-1", score: 0.5 }]);
  const ap = real.createApproval(s.id, v1.set.id, "spotify_create_playlist_from_order", {});
  real.decideApproval(ap.id, "rejected");
  const approval: ServerEvent = { type: "approval", approval_id: ap.id, set_id: v1.set.id, playlist_name: "[DJ MIX] Eletro", track_count: 2, track_ids: ["t1", "t2"] };
  const events: ServerEvent[] = [{ type: "text", text: "pronto" }, approval, { type: "error", message: "x" }];
  real.addTurn(s.id, "monte um set", events, 0.03);
  const { server: srv, base: b } = await listen({ repo: real, waiter, ...extra, chat: async () => undefined });
  try {
    // GET /api/sessions: cada sessão com o set atual (ou null)
    const list = (await (await fetch(`${b}/api/sessions`)).json()) as (ChatSession & { set: unknown })[];
    assert.equal(list.length, 2);
    assert.deepEqual(list.find((x) => x.id === s.id)?.set, { id: v1.set.id, name: "[DJ MIX] Eletro", status: "rascunho", spotify_url: null });
    assert.equal(list.find((x) => x.id === empty.id)?.set, null);

    // GET /api/sessions/:id: turnos (a approval com o estado de agora), set e versões com snapshot, planos e guia
    type Detail = { session: ChatSession; turns: Turn[]; set: SetRow | null; versions: VersionJson[] };
    const detail = (await (await fetch(`${b}/api/sessions/${s.id}`)).json()) as Detail & { plans?: unknown };
    assert.equal(detail.session.id, s.id);
    assert.equal(detail.set?.id, v1.set.id);
    assert.equal(detail.turns.length, 1);
    assert.equal(detail.turns[0]?.user_message, "monte um set");
    assert.equal(detail.turns[0]?.cost_usd, 0.03);
    assert.deepEqual(detail.turns[0]?.events, [events[0], { ...approval, status: "rejected" }, events[2]]);
    assert.equal(detail.plans, undefined); // os planos vêm dentro de cada versão
    assert.deepEqual(detail.versions.map((v) => v.version), [1, 2]);
    const [d1, d2] = detail.versions;
    assert.deepEqual(d1?.snapshot, SNAP);
    assert.equal(d1?.plans.length, 1);
    assert.equal(d1?.plans[0]?.position, 1);
    assert.equal(d1?.guide[0]?.position, "1 → 2");
    assert.equal(d1?.guide[0]?.text, "1 → 2 · Um — Artista → Dois — Artista: preset Fade, 16 compassos. Tire o grave de A e entre com o grave de B no compasso 8.");
    assert.equal(d2?.snapshot, null); // sem snapshot o guia usa os ids
    assert.deepEqual([d2?.guide[0]?.from_label, d2?.guide[0]?.to_label], ["t2", "t1"]);
    const none = (await (await fetch(`${b}/api/sessions/${empty.id}`)).json()) as Detail;
    assert.deepEqual([none.set, none.versions, none.turns], [null, [], []]);
    assert.equal((await fetch(`${b}/api/sessions/nao-existe`)).status, 404);

    // GET /api/sets/:id: o set e todas as versões detalhadas
    const setBody = (await (await fetch(`${b}/api/sets/${v1.set.id}`)).json()) as { set: SetRow; versions: VersionJson[] };
    assert.equal(setBody.set.name, "[DJ MIX] Eletro");
    assert.deepEqual(setBody.versions.map((v) => v.guide.length), [1, 1]);
    assert.deepEqual(setBody.versions[0]?.snapshot?.order.map((t) => t.label), ["Um — Artista", "Dois — Artista"]);
    assert.equal((await fetch(`${b}/api/sets/nao-existe`)).status, 404);

    // POST /api/plans/:id/feedback: nota 1–5 gravada, a última vale, e o set e a sessão devolvem `feedback` no plano
    const planId = real.listPlans(v1.version.id)[0]?.id ?? "";
    const rate = (id: string, body: unknown, contentType = "application/json") =>
      fetch(`${b}/api/plans/${id}/feedback`, { method: "POST", headers: { "Content-Type": contentType }, body: typeof body === "string" ? body : JSON.stringify(body) });
    const planIn = async (path: string) => ((await (await fetch(`${b}${path}`)).json()) as { versions: VersionJson[] }).versions[0]?.plans[0];
    assert.equal((await planIn(`/api/sets/${v1.set.id}`))?.feedback, null); // sem nota: null
    let rated = await rate(planId, { rating: 4, notes: "entrada boa" });
    assert.equal(rated.status, 200);
    const given = (await rated.json()) as TransitionFeedback;
    assert.deepEqual(Object.keys(given).sort(), ["created_at", "notes", "rating"]);
    assert.deepEqual([given.rating, given.notes], [4, "entrada boa"]);
    assert.deepEqual((await planIn(`/api/sets/${v1.set.id}`))?.feedback, given);
    assert.deepEqual((await planIn(`/api/sessions/${s.id}`))?.feedback, given);
    rated = await rate(planId, { rating: 2 }); // trocar a nota: a última vale; sem notes, notes null
    assert.deepEqual([((await rated.json()) as TransitionFeedback).notes, (await planIn(`/api/sets/${v1.set.id}`))?.feedback?.rating], [null, 2]);
    assert.equal((await rate(planId, { rating: 5, notes: "x".repeat(500) })).status, 200); // 500 caracteres passa
    // inválido: 400, e nada é gravado
    const invalidRatings: unknown[] = [{ rating: 6 }, { rating: 0 }, { rating: 3.5 }, { rating: "4" }, { rating: true }, { rating: null }, {}, { rating: 3, notes: 7 }, { rating: 3, notes: "x".repeat(501) }];
    for (const body of invalidRatings) assert.equal((await rate(planId, body)).status, 400, JSON.stringify(body));
    assert.equal((await rate(planId, "{")).status, 400); // JSON quebrado
    assert.equal((await rate("%E0%A4%A", { rating: 3 })).status, 400); // id com % malformado
    assert.equal((await fetch(`${b}/api/plans/${planId}/feedback`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://evil.test" }, body: JSON.stringify({ rating: 1 }) })).status, 403); // origem estranha: barrada antes da rota
    assert.equal((await planIn(`/api/sets/${v1.set.id}`))?.feedback?.rating, 5); // nem as inválidas nem a recusada gravaram
    assert.equal((await rate(planId, { rating: 3 }, "text/plain")).status, 415); // sem JSON (CSRF)
    assert.equal((await rate("nao-existe", { rating: 3 })).status, 404); // plano inexistente
    assert.equal((await fetch(`${b}/api/plans/${planId}/feedback`)).status, 404); // só POST
  } finally {
    srv.closeAllConnections();
    await new Promise((r) => srv.close(r));
    real.close();
  }
}
console.log("[ok] http: sessions, chat SSE, validações, approvals, CORS, status, playlists, configurações, sessão com turnos, set com snapshot e guia, notas das passagens, 404");
