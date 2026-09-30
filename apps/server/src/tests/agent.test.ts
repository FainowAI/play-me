import assert from "node:assert/strict";
import type { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AnalysisStore } from "spotify-dj-mcp-server/dist/services/analysis-store.js";
import { AuthRequiredError } from "spotify-dj-mcp-server/dist/services/auth.js";
import { ApprovalWaiter } from "../approvals.js";
import { extractCreated, extractProposal, finishCreate, gate, recordFromResult, reorderSnapshot, runChat, structuredOf, summarize, type ChatDeps, type TurnCtx } from "../agent.js";
import type { Repo } from "../repo.js";
import { createSpotify } from "../spotify.js";
import type { Approval, PlanInput, ServerEvent, SetRow, SetSnapshot, SetStatus, SetVersion } from "../types.js";

/** Repo falso em memória: só o que o agente usa. */
function fakeRepo() {
  const now = "2026-01-01T00:00:00Z";
  let set: SetRow | undefined;
  const versions: SetVersion[] = [];
  const approvals: Approval[] = [];
  const plans: PlanInput[][] = [];
  const turns: { userMessage: string; events: ServerEvent[]; cost: number | null }[] = [];
  const repo = {
    getSession: () => ({ id: "c1", agent_session_id: null, title: "Eletro", created_at: now, updated_at: now }),
    getSet: () => set,
    getCurrentSet: () => set,
    latestVersion: () => versions.at(-1),
    recordProposal(_c: string, name: string, curve: string, order: string[], note: string | null, snapshot: SetSnapshot | null) {
      set ??= { id: "s1", chat_session_id: "c1", name, curve, status: "rascunho", spotify_playlist_id: null, spotify_url: null, created_at: now, updated_at: now };
      const last = versions.at(-1);
      if (!last || last.order.join() !== order.join()) versions.push({ id: `v${versions.length + 1}`, set_id: "s1", version: versions.length + 1, order, note, created_at: now, snapshot });
      return { set, version: versions.at(-1) as SetVersion };
    },
    setAgentSessionId: () => undefined,
    addTurn(_c: string, userMessage: string, events: ServerEvent[], cost: number | null) {
      turns.push({ userMessage, events: [...events], cost });
    },
    savePlans: (_v: string, p: PlanInput[]) => void plans.push(p),
    setStatus(_id: string, status: SetStatus, sp?: { playlist_id: string | null; url: string | null }) {
      set = { ...(set as SetRow), status, spotify_playlist_id: sp?.playlist_id ?? null, spotify_url: sp?.url ?? null };
      return set;
    },
    createApproval(c: string, s: string | null, action: string, payload: unknown) {
      const a: Approval = { id: `a${approvals.length + 1}`, chat_session_id: c, set_id: s, action, payload, status: "pending", decided_at: null, created_at: now };
      approvals.push(a);
      return a;
    },
    getApproval: (id: string) => approvals.find((a) => a.id === id),
    decideApproval(id: string, decision: "approved" | "rejected") {
      const a = approvals.find((x) => x.id === id) as Approval;
      a.status = decision;
      return a;
    },
  };
  return { repo: repo as unknown as Repo, get set() { return set; }, versions, approvals, plans, turns };
}

// pasta do store do MCP: vazia por padrão; os testes de snapshot escrevem o analysis.json com o próprio AnalysisStore
const dirs: string[] = [];
process.on("exit", () => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), "playme-agent-"));
  dirs.push(dir);
  return dir;
};
const emptyStore = tmp();

function setup(storeDir = emptyStore) {
  const f = fakeRepo();
  const events: ServerEvent[] = [];
  const waiter = new ApprovalWaiter();
  const ctx: TurnCtx = { repo: f.repo, waiter, emit: (e) => events.push(e), chatSessionId: "c1", note: "monte um set", storeDir };
  return { f, events, waiter, ctx };
}

const CREATE = "mcp__spotify-dj__spotify_create_playlist_from_order";
const input = { track_ids: ["t1", "spotify:track:t2", "https://open.spotify.com/track/t3?si=x"], name: "[DJ MIX] Eletro" };

// gate aprovado
{
  const { f, events, waiter, ctx } = setup();
  const pending = gate(ctx, CREATE, input);
  assert.equal(f.set?.status, "aguardando_aprovacao");
  assert.equal(f.approvals.length, 1);
  assert.deepEqual(f.versions[0]?.order, ["t1", "t2", "t3"]);
  const ev = events.find((e) => e.type === "approval");
  assert.deepEqual(ev, { type: "approval", approval_id: "a1", set_id: "s1", playlist_name: "[DJ MIX] Eletro", track_count: 3, track_ids: ["t1", "t2", "t3"] });
  assert.equal(waiter.resolve("a1", "approved"), true);
  assert.deepEqual(await pending, { behavior: "allow", updatedInput: input });
  assert.equal(f.set?.status, "aguardando_aprovacao");
  // sucesso: enviado com id e url
  finishCreate(ctx, { playlist_id: "pl1", url: "https://open.spotify.com/playlist/pl1" }, false);
  assert.equal(f.set?.status, "enviado");
  assert.equal(f.set?.spotify_playlist_id, "pl1");
  assert.equal(f.set?.spotify_url, "https://open.spotify.com/playlist/pl1");
  assert.equal(events.at(-1)?.type, "set");
}

// gate aprovado, criação com erro: volta a rascunho
{
  const { f, waiter, ctx } = setup();
  const pending = gate(ctx, CREATE, input);
  waiter.resolve("a1", "approved");
  await pending;
  finishCreate(ctx, undefined, true);
  assert.equal(f.set?.status, "rascunho");
}

// gate rejeitado
{
  const { f, events, waiter, ctx } = setup();
  const pending = gate(ctx, CREATE, input);
  waiter.resolve("a1", "rejected");
  const r = await pending;
  assert.equal(r.behavior, "deny");
  assert.equal(r.behavior === "deny" && r.message, "O usuário não aprovou o envio ao Spotify. O set voltou para rascunho.");
  assert.equal(f.set?.status, "rascunho");
  assert.equal(events.at(-1)?.type, "set");
}

// leitura permitida; nativa/estranha negada
{
  const { ctx } = setup();
  assert.equal((await gate(ctx, "mcp__spotify-dj__dj_build_set", {})).behavior, "allow");
  assert.equal((await gate(ctx, "mcp__spotify-dj__spotify_get_playlist_tracks", {})).behavior, "allow");
  for (const name of ["Bash", "Read", "WebFetch", "mcp__outro__x"]) {
    const r = await gate(ctx, name, {});
    assert.deepEqual(r, { behavior: "deny", message: "Ferramenta não disponível no Play.Me." });
  }
}

// extração: dj_build_set
const plan = (from: string, to: string) => ({ from, to, planner_version: "meta-1", confidence: 0.8 });
const built = {
  ordered_track_ids: ["a", "b", "c"],
  order: [{ track_id: "a" }, { track_id: "b" }, { track_id: "c" }],
  curve: "peak_time",
  plans: [plan("a", "b"), plan("b", "c")],
  transitions: [{ scores: { total: 91 } }, { scores: { total: 77.5 } }],
};
{
  const p = extractProposal(built);
  assert.deepEqual(p?.order, ["a", "b", "c"]);
  assert.equal(p?.curve, "peak_time");
  assert.equal(p?.plans.length, 2);
  assert.deepEqual(p?.plans.map((x) => [x.position, x.from_track, x.to_track, x.score, x.planner_version]), [[1, "a", "b", 91, "meta-1"], [2, "b", "c", 77.5, "meta-1"]]);
  // via structuredContent do tool_use_result e via texto JSON
  assert.equal(structuredOf({ structuredContent: built }), built);
  assert.deepEqual(structuredOf(undefined, { content: [{ type: "text", text: JSON.stringify(built) }] }), built);
  assert.equal(structuredOf(undefined, { content: "# markdown" }), undefined);
  // gravação
  const { f, events, ctx } = setup();
  recordFromResult(ctx, built);
  assert.equal(f.set?.name, "Eletro");
  assert.equal(f.versions[0]?.note, "monte um set");
  assert.equal(f.plans[0]?.length, 2);
  assert.deepEqual(events[0], { type: "set", set_id: "s1", version: 1, status: "rascunho" });
}

// extração: dj_evaluate_order (sem ordered_track_ids nem transitions)
{
  const p = extractProposal({ order: [{ track_id: "x" }, { track_id: "y" }], curve: "warm_up", plans: [plan("x", "y")] });
  assert.deepEqual(p?.order, ["x", "y"]);
  assert.equal(p?.plans[0]?.score, null);
  assert.equal(extractProposal({ order: [] }), null);
  assert.equal(extractProposal("texto"), null);
}

// extração da playlist criada
assert.deepEqual(extractCreated({ playlist_id: "pl1", url: "u", name: "n", tracks_added: 3, public: false }), { playlist_id: "pl1", url: "u" });
assert.deepEqual(extractCreated({ playlist_id: "pl1" }), { playlist_id: "pl1", url: null });
assert.equal(extractCreated({}), null);

// cliente desconecta durante a espera: approval pendente vira rejeitada e o set volta a rascunho
{
  const { f, ctx } = setup();
  const abort = new AbortController();
  const pending = gate(ctx, CREATE, input, abort.signal);
  abort.abort();
  assert.equal((await pending).behavior, "deny");
  assert.equal(f.approvals[0]?.status, "rejected");
  assert.equal(f.set?.status, "rascunho");
}

// ---------- snapshot da versão: resultado do MCP + origem de cada faixa no store ----------
const pos = (n: number, id: string) => ({ position: n, track_id: id, label: `Faixa ${id} — Artista`, bpm: 120 + n, camelot: "8A", energy: 5 + n, target_energy: 5, section: "abertura" });
const tr = (from: string, to: string, total: number) => ({ from_id: from, to_id: to, scores: { total } });
const full = {
  curve: "peak_time",
  average_score: 0.84,
  order: [pos(1, "a"), pos(2, "b"), pos(3, "c"), pos(4, "d")],
  ordered_track_ids: ["a", "b", "c", "d"],
  transitions: [tr("a", "b", 0.9), tr("b", "c", 0.5), tr("c", "d", 0.8)],
  weak_transitions: [1],
  problem_tracks: [{ track_id: "d", label: "Faixa d — Artista", reasons: ["energia não informada"] }],
  bridges: [{ between: ["x", "y"] }],
  weights: { camelot: 0.35 },
  plans: [plan("a", "b"), plan("b", "c"), plan("c", "d")],
  warnings: ["aviso"],
};
const storeDir = tmp();
new AnalysisStore(storeDir).upsert([
  { track_id: "a", bpm: 121, camelot: "8A", source: "web", notes: "[A VALIDAR] tom da web (ReccoBeats); confira no Mixar" },
  { track_id: "b", bpm: 122, camelot: "9A", source: "spotify-mixar" },
  { track_id: "c", bpm: 123, camelot: "10A" },
]);
let snapshot: SetSnapshot | null | undefined;
{
  const { f, ctx } = setup(storeDir);
  recordFromResult(ctx, full);
  snapshot = f.versions[0]?.snapshot;
  assert.deepEqual(snapshot?.order.map((t) => [t.track_id, t.source, t.key_review]), [["a", "web", true], ["b", "spotify-mixar", false], ["c", "usuário", false], ["d", null, false]]);
  assert.deepEqual(snapshot?.order[1], { ...pos(2, "b"), source: "spotify-mixar", key_review: false });
  // só o reduzido: sem planos, pontes nem pesos
  assert.deepEqual(Object.keys(snapshot ?? {}).sort(), ["average_score", "curve", "order", "problem_tracks", "transitions", "warnings", "weak_transitions"]);
  assert.equal(snapshot?.curve, "peak_time");
  assert.equal(snapshot?.average_score, 0.84);
  assert.deepEqual(snapshot?.transitions, full.transitions);
  assert.deepEqual(snapshot?.weak_transitions, [1]);
  assert.deepEqual(snapshot?.problem_tracks, full.problem_tracks);
  assert.deepEqual(snapshot?.warnings, ["aviso"]);
}
// campos ausentes viram [] / 0; sem a ordem estruturada, sem snapshot
{
  const { f, ctx } = setup(storeDir);
  recordFromResult(ctx, { ordered_track_ids: ["a", "b"], order: [pos(1, "a"), pos(2, "b")] });
  const s = f.versions[0]?.snapshot;
  assert.deepEqual([s?.curve, s?.average_score, s?.transitions, s?.weak_transitions, s?.problem_tracks, s?.warnings], ["classic", 0, [], [], [], []]);
  const other = setup(storeDir);
  recordFromResult(other.ctx, { ordered_track_ids: ["a", "b"] });
  assert.equal(other.f.versions[0]?.snapshot, null);
}
// store ilegível: a versão é gravada mesmo assim, sem a origem das faixas
{
  const broken = tmp();
  writeFileSync(join(broken, "analysis.json"), "{");
  const { f, ctx } = setup(broken);
  recordFromResult(ctx, full);
  assert.deepEqual(f.versions[0]?.snapshot?.order.map((t) => [t.source, t.key_review]), [[null, false], [null, false], [null, false], [null, false]]);
}

// ---------- reorderSnapshot: ordem nova a partir do snapshot da versão anterior ----------
{
  assert.equal(reorderSnapshot(null, ["a"]), null);
  assert.equal(reorderSnapshot(snapshot ?? null, ["a", "b", "c", "d"]), snapshot); // ordem igual: o próprio snapshot, com as passagens
  assert.equal(reorderSnapshot(snapshot ?? null, ["c", "zz"]), null); // id que não está no snapshot
  const r = reorderSnapshot(snapshot ?? null, ["c", "a", "b", "d"]);
  assert.deepEqual(r?.order.map((t) => [t.position, t.track_id, t.source]), [[1, "c", "usuário"], [2, "a", "web"], [3, "b", "spotify-mixar"], [4, "d", null]]);
  // seção e energia-alvo são da vaga (curva peak_time em t = 0, 1/3, 2/3 e 1), não da faixa
  assert.deepEqual(r?.order.map((t) => [t.section, t.target_energy]), [["abertura", 6.5], ["crescimento", 8.1], ["pico", 9.1], ["encerramento", 8]]);
  assert.equal(r?.order[0]?.bpm, 123); // o resto da faixa anda com ela
  assert.deepEqual([r?.transitions, r?.weak_transitions], [[], []]);
  assert.deepEqual(r?.problem_tracks, snapshot?.problem_tracks);
  assert.deepEqual(r?.warnings, ["aviso"]);
  assert.equal(snapshot?.order[0]?.track_id, "a"); // o original não muda
  assert.deepEqual(reorderSnapshot(snapshot ?? null, ["b", "a"])?.order.map((t) => [t.position, t.section]), [[1, "abertura"], [2, "encerramento"]]); // subconjunto
}
// o gate grava a versão do envio com o snapshot reordenado
{
  const { f, waiter, ctx } = setup(storeDir);
  recordFromResult(ctx, full);
  const pending = gate(ctx, CREATE, { track_ids: ["c", "a", "b", "d"], name: "[DJ MIX] Eletro" });
  assert.deepEqual(f.versions.at(-1)?.snapshot?.order.map((t) => t.track_id), ["c", "a", "b", "d"]);
  assert.deepEqual(f.versions.at(-1)?.snapshot?.transitions, []);
  waiter.resolve("a1", "rejected");
  await pending;
}

// ---------- detalhe das ferramentas ----------
{
  const names = { playlist: (id: string) => (id === "pl1" ? "Eletro" : id), track: (id: string) => (id === "t1" ? "Um — Artista" : id) };
  const d = (tool: string, data: unknown, phase: "start" | "end") => summarize(tool, data, phase, names).detail;
  assert.equal(d("spotify_get_playlist_tracks", { playlist: "spotify:playlist:pl1" }, "start"), "Eletro"); // URI vira id, id vira nome do cache
  assert.equal(d("spotify_get_playlist_tracks", { playlist: "https://open.spotify.com/playlist/xyz?si=1" }, "start"), "xyz"); // sem nome no cache: o id
  assert.equal(d("spotify_get_playlist_tracks", { total: 557 }, "end"), "557 faixas");
  assert.equal(d("spotify_get_playlist_tracks", { total: 1 }, "end"), "1 faixa");
  assert.equal(d("dj_build_set", { playlist: "pl1", curve: "classic" }, "start"), "Eletro · curva classic");
  assert.equal(d("dj_build_set", { track_ids: ["a", "b"] }, "start"), "2 faixas");
  assert.equal(d("dj_build_set", { order: new Array(21).fill({}), curve: "classic" }, "end"), "21 faixas · curva classic");
  assert.equal(d("dj_evaluate_order", { average_score: 0.84 }, "end"), "nota média 0,84");
  assert.equal(d("dj_evaluate_order", { average_score: 0.8 }, "end"), "nota média 0,80");
  assert.equal(d("transition_plan", { from_track: "t1", to_track: "spotify:track:t2" }, "start"), "Um — Artista → t2");
  assert.equal(d("transition_plan", { plan: { type: "blend", length_bars: 16 } }, "end"), "Blend · 16 c.");
  assert.equal(d("spotify_create_playlist_from_order", { track_ids: ["a", "b", "c"] }, "start"), "3 faixas · privada");
  assert.equal(d("spotify_create_playlist_from_order", { tracks_added: 21, public: false }, "end"), "21 faixas · privada");
  assert.equal(d("metadata_lookup", { playlist: "pl1" }, "start"), "Eletro · dry run");
  assert.equal(d("metadata_lookup", { playlist: "pl1", dry_run: false }, "start"), "Eletro · gravar");
  assert.deepEqual(summarize("metadata_coverage", { total: 557, counts: { mixar: 22, web: 414, a_validar: 0, pendente: 121 }, pending: [] }, "end", names), {
    detail: "Mixar 22 · web 414 · a validar 0 · pendentes 121",
    summary: { total: 557, mixar: 22, web: 414, a_validar: 0, pendente: 121 },
  });
  const rows = [{ outcome: { action: "save" } }, { outcome: { action: "pending" } }, { outcome: { action: "keep" } }];
  assert.deepEqual(summarize("metadata_lookup", { dry_run: true, saved: 0, stopped: null, rows }, "end", names), {
    detail: "3 faixas · 1 pendente · dry run",
    summary: { total: 3, saved: 0, pending: 1, dry_run: true },
  });
  assert.deepEqual(summarize("metadata_lookup", { dry_run: false, saved: 1, stopped: null, rows }, "end", names).summary, { total: 3, saved: 1, pending: 1, dry_run: false });
  // sem resultado estruturado ou ferramenta sem detalhe: linha vazia, nunca "undefined" nem "NaN"
  assert.deepEqual(summarize("dj_build_set", "texto", "end", names), { detail: "" });
  assert.deepEqual(summarize("metadata_coverage", { total: 5 }, "end", names), { detail: "" });
  assert.deepEqual(summarize("dj_convert_key", { camelot: "8A" }, "end", names), { detail: "" });
  for (const odd of ["constructor", "toString", "__proto__"]) {
    assert.deepEqual([summarize(odd, { a: 1 }, "start", names), summarize(odd, { a: 1 }, "end", names)], [{ detail: "" }, { detail: "" }], odd); // nome estranho de ferramenta
  }
}

// ---------- runChat inteiro com um query falso: detalhes, versão com snapshot, turno gravado e pesos ----------
const fakeQuery = (messages: unknown[], seen?: { options?: { systemPrompt?: unknown } }) =>
  ((args: { options?: { systemPrompt?: unknown } }) => {
    if (seen) seen.options = args.options;
    return (async function* () {
      for (const m of messages) {
        if (m instanceof Error) throw m;
        yield m;
      }
    })();
  }) as unknown as typeof query;
const chatDeps = (f: ReturnType<typeof fakeRepo>, q: typeof query): ChatDeps => ({
  repo: f.repo, waiter: new ApprovalWaiter(), mcpServerPath: "mcp.js", mcpEnv: {}, model: "m", maxBudgetUsd: 1,
  storeDir, settings: { get: () => ({ weights: { camelot: 35, bpm: 25, energy: 25, style: 10, progression: 5 } }) },
  playlistName: (id) => (id === "pl1" ? "Eletro" : undefined), query: q,
});
const sys = { type: "system", subtype: "init", session_id: "agent-1" };
const said = (text: string) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });
const used = (id: string, name: string, input: unknown) => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name: `mcp__spotify-dj__${name}`, input }] } });
const returned = (id: string, structuredContent: unknown) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text: "texto" }] }] }, tool_use_result: { structuredContent } });
const failed = (id: string, text: string) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: true, content: [{ type: "text", text }] }] }, tool_use_result: text });
const finished = { type: "result", subtype: "success", total_cost_usd: 0.03 };
{
  const f = fakeRepo();
  const out: ServerEvent[] = [];
  const seen: { options?: { systemPrompt?: unknown } } = {};
  const script = [
    sys, said("Vou ver a cobertura."),
    used("u1", "metadata_coverage", { playlist: "spotify:playlist:pl1" }),
    returned("u1", { total: 557, counts: { mixar: 22, web: 414, a_validar: 0, pendente: 121 }, pending: [] }),
    used("u2", "dj_build_set", { playlist: "pl1", curve: "peak_time" }), returned("u2", full),
    used("u3", "spotify_get_playlist_tracks", { playlist: "zzz" }), failed("u3", "Erro: Sem permissão (403).\nDetalhe do Spotify: nada."),
    finished,
  ];
  await runChat(chatDeps(f, fakeQuery(script, seen)), "c1", "monte um set", (e) => out.push(e));
  assert.deepEqual(out.map((e) => e.type), ["text", "tool_start", "tool_end", "tool_start", "tool_end", "set", "tool_start", "tool_end", "done"]);
  assert.deepEqual(out[1], { type: "tool_start", tool: "metadata_coverage", tool_use_id: "u1", detail: "Eletro" });
  assert.deepEqual(out[2], {
    type: "tool_end", tool: "metadata_coverage", tool_use_id: "u1", is_error: false,
    detail: "Mixar 22 · web 414 · a validar 0 · pendentes 121", summary: { total: 557, mixar: 22, web: 414, a_validar: 0, pendente: 121 },
  });
  assert.deepEqual(out[3], { type: "tool_start", tool: "dj_build_set", tool_use_id: "u2", detail: "Eletro · curva peak_time" });
  assert.deepEqual(out[4], { type: "tool_end", tool: "dj_build_set", tool_use_id: "u2", is_error: false, detail: "4 faixas · curva peak_time" });
  assert.deepEqual(out[7], { type: "tool_end", tool: "spotify_get_playlist_tracks", tool_use_id: "u3", is_error: true, detail: "Erro: Sem permissão (403)." }); // erro: primeira linha
  assert.equal(f.versions[0]?.snapshot?.order.length, 4);
  // o turno gravado: todos os eventos menos o done, o custo do done e o pedido do usuário
  assert.deepEqual(f.turns, [{ userMessage: "monte um set", events: out.filter((e) => e.type !== "done"), cost: 0.03 }]);
  // pesos do usuário no system prompt: fração com ponto e duas casas
  assert.match(String(seen.options?.systemPrompt), /Pesos da nota do par escolhidos pelo usuário \(frações que somam 1\): camelot 0\.35, bpm 0\.25, energy 0\.25, style 0\.10, progression 0\.05\. Passe-os no parâmetro weights de dj_build_set e dj_evaluate_order\./);
}
// erro no agente vira evento error e o turno é gravado assim mesmo; falha ao gravar o turno não derruba o runChat
{
  const log = console.error;
  console.error = () => undefined; // o runChat loga a falha do agente (esperada aqui)
  try {
    const f = fakeRepo();
    const out: ServerEvent[] = [];
    await runChat(chatDeps(f, fakeQuery([sys, said("começando"), new Error("boom sk-abc123")])), "c1", "oi", (e) => out.push(e));
    assert.deepEqual(out, [{ type: "text", text: "começando" }, { type: "error", message: "Falha no agente. Veja o log do servidor." }]);
    assert.deepEqual(f.turns, [{ userMessage: "oi", events: out, cost: null }]);
    const g = fakeRepo();
    g.repo.addTurn = () => {
      throw new Error("banco");
    };
    await runChat(chatDeps(g, fakeQuery([sys, finished])), "c1", "oi", () => undefined);
  } finally {
    console.error = log;
  }
}

// ---------- spotify.ts: conexão pelos tokens do MCP, playlists paginadas (50 por página) com cache, sem rede ----------
{
  const dir = tmp();
  const env = ["SPOTIFY_CLIENT_ID", "SPOTIFY_REDIRECT_URI", "SPOTIFY_DJ_DATA_DIR"].map((k) => [k, process.env[k]] as const);
  const realFetch = globalThis.fetch;
  try {
    delete process.env.SPOTIFY_CLIENT_ID;
    delete process.env.SPOTIFY_REDIRECT_URI;
    process.env.SPOTIFY_DJ_DATA_DIR = dir; // nunca o ~/.spotify-dj-mcp de verdade
    const sp = createSpotify();
    assert.equal(sp.connected(), false); // sem SPOTIFY_CLIENT_ID
    await assert.rejects(sp.playlists(), AuthRequiredError);
    process.env.SPOTIFY_CLIENT_ID = "0123456789abcdef0123456789abcdef";
    assert.equal(sp.connected(), false); // sem tokens
    await assert.rejects(sp.playlists(), AuthRequiredError);
    writeFileSync(join(dir, "tokens.json"), JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: Date.now() + 3_600_000, scope: "" }));
    assert.equal(sp.connected(), true);
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      assert.equal(url.host, "api.spotify.com");
      calls.push(url.search);
      const offset = Number(url.searchParams.get("offset"));
      const items = Array.from({ length: Math.min(50, 120 - offset) }, (_, i) => ({
        id: `p${offset + i}`, name: `Lista ${offset + i}`, items: { total: offset + i }, external_urls: { spotify: `https://open.spotify.com/playlist/p${offset + i}` },
      }));
      return new Response(JSON.stringify({ items, total: 120, limit: 50, offset, next: null }), { status: 200 });
    }) as typeof fetch;
    assert.equal(sp.nameOf("p7"), undefined); // a lista ainda não foi lida
    const [first, second] = await Promise.all([sp.playlists(), sp.playlists()]); // chamadas simultâneas dividem a busca
    assert.equal(first?.length, 120);
    assert.equal(second, first);
    assert.deepEqual(calls, ["?limit=50&offset=0", "?limit=50&offset=50", "?limit=50&offset=100"]);
    assert.deepEqual(first?.[7], { id: "p7", name: "Lista 7", total: 7, url: "https://open.spotify.com/playlist/p7" });
    assert.equal(sp.nameOf("p7"), "Lista 7");
    assert.equal(sp.nameOf("nada"), undefined);
    await sp.playlists();
    assert.equal(calls.length, 3); // cache de 5 min: sem busca nova
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of env) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// gate recusa IDs fora do set atual (D36): sem approval, sem versão nova, sem evento
{
  const { f, events, ctx } = setup();
  const snap: SetSnapshot = {
    curve: "classic", average_score: 0.8, transitions: [], weak_transitions: [], problem_tracks: [], warnings: [],
    order: ["t1", "t2", "t3"].map((id, i) => ({ position: i + 1, track_id: id, label: `${id} — x`, bpm: 124, camelot: "8A", energy: null, target_energy: 5, section: "abertura", source: "web", key_review: true })),
  };
  f.repo.recordProposal("c1", "Eletro", "classic", ["t1", "t2", "t3"], null, snap);
  const r = await gate(ctx, CREATE, { track_ids: ["zz1", "t1"], name: "[DJ MIX] X" });
  assert.equal(r.behavior, "deny");
  assert.match(r.behavior === "deny" ? r.message : "", /não são os do set atual/);
  assert.equal(f.approvals.length, 0);
  assert.equal(f.versions.length, 1);
  assert.equal(events.length, 0);
  // subconjunto conhecido continua passando pelo gate normal
  const ok = gate(ctx, CREATE, { track_ids: ["t3", "t1"], name: "[DJ MIX] X" });
  assert.equal(f.approvals.length, 1);
  ctx.waiter.resolve("a1", "rejected");
  assert.equal((await ok).behavior, "deny");
}

console.log("[ok] agent: gate, extração, snapshot com origem das faixas, reorderSnapshot, detalhe das ferramentas, runChat com turno gravado e pesos, spotify");
