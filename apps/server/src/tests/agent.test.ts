import assert from "node:assert/strict";
import type { query } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AnalysisStore } from "spotify-dj-mcp-server/dist/services/analysis-store.js";
import { AuthRequiredError } from "spotify-dj-mcp-server/dist/services/auth.js";
import { answersStatus, ApprovalWaiter, Waiter, type Answers } from "../approvals.js";
import { extractCreated, extractProposal, finishCreate, gate, recordFromResult, reorderSnapshot, runChat, structuredOf, summarize, thinkingTokensFrom, type ChatDeps, type TurnCtx } from "../agent.js";
import { openRepo, type Repo } from "../repo.js";
import { createSpotify } from "../spotify.js";
import type { Approval, PlanInput, ServerEvent, SetRow, SetSnapshot, SetStatus, SetVersion } from "../types.js";

/** Repo falso em memória: só o que o agente usa. */
function fakeRepo(title = "Eletro") {
  const now = "2026-01-01T00:00:00Z";
  let set: SetRow | undefined;
  const versions: SetVersion[] = [];
  const approvals: Approval[] = [];
  const plans: PlanInput[][] = [];
  const saved = new Map<string, PlanInput[]>(); // planos por versão, para o listPlans
  const turns: { userMessage: string; events: ServerEvent[]; cost: number | null }[] = [];
  const repo = {
    getSession: () => ({ id: "c1", agent_session_id: null, title, created_at: now, updated_at: now }),
    getSet: () => set,
    getCurrentSet: () => set,
    latestVersion: () => versions.at(-1),
    recentTrackIds: () => ["r1", "r2"],
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
    savePlans(v: string, p: PlanInput[]) {
      plans.push(p);
      saved.set(v, p);
    },
    listPlans: (v: string) => saved.get(v) ?? [],
    setStatus(_id: string, status: SetStatus, sp?: { playlist_id: string | null; url: string | null }) {
      set = { ...(set as SetRow), status, spotify_playlist_id: sp?.playlist_id ?? null, spotify_url: sp?.url ?? null };
      return set;
    },
    renameSet(_id: string, name: string) {
      set = { ...(set as SetRow), name };
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
  const ctx: TurnCtx = { repo: f.repo, waiter, questions: new Waiter<Answers | null>(null), emit: (e) => events.push(e), chatSessionId: "c1", note: "monte um set", storeDir };
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
  assert.equal((await gate(ctx, "mcp__spotify-dj__dj_delete_track_analysis", {})).behavior, "deny");
  // Sprint 6: a pergunta ao DJ passa com o input como veio; só esse nome exato (outra ferramenta do servidor playme é negada)
  assert.deepEqual(await gate(ctx, "mcp__playme__ask_dj", { questions: [] }), { behavior: "allow", updatedInput: { questions: [] } });
  for (const name of ["Bash", "Read", "WebFetch", "mcp__outro__x", "mcp__playme__outra", "mcp__playme__ask_dj2"]) {
    const r = await gate(ctx, name, {});
    assert.deepEqual(r, { behavior: "deny", message: "Ferramenta não disponível no Play.Me." });
  }
}

// P17: set com tamanho recebe avoid com as faixas dos últimos sets; sem tamanho, ou com avoid do agente, entra como veio
{
  const { ctx } = setup();
  const BUILD = "mcp__spotify-dj__dj_build_set";
  assert.deepEqual(await gate(ctx, BUILD, { playlist: "Eletro", duration_minutes: 90 }), { behavior: "allow", updatedInput: { playlist: "Eletro", duration_minutes: 90, avoid: ["r1", "r2"] } });
  assert.deepEqual(await gate(ctx, BUILD, { playlist: "Eletro", max_tracks: 20, avoid: [] }), { behavior: "allow", updatedInput: { playlist: "Eletro", max_tracks: 20, avoid: [] } });
  assert.deepEqual(await gate(ctx, BUILD, { playlist: "Eletro" }), { behavior: "allow", updatedInput: { playlist: "Eletro" } });
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

// ---------- Sprint 4: tamanho do set (P10) e energia estimada (P12) no snapshot ----------
const sized = { ...full, pool_size: 30, duration_ms: 5_460_000, order: full.order.map((t) => (t.track_id === "b" ? { ...t, energy_estimated: true } : t)) };
{
  const { f, ctx } = setup(storeDir);
  recordFromResult(ctx, sized);
  const s = f.versions[0]?.snapshot;
  assert.deepEqual([s?.pool_size, s?.duration_ms], [30, 5_460_000]);
  assert.deepEqual(s?.order.map((t) => t.energy_estimated), [undefined, true, undefined, undefined]); // por faixa
  assert.equal("energy_estimated" in (s?.order[0] ?? {}), false); // o que o MCP não mandou continua ausente
  // reordenar no envio: pool_size segue, a duração da ordem nova não é conhecida e o energy_estimated anda com a faixa
  const moved = reorderSnapshot(s ?? null, ["c", "b", "a", "d"]);
  assert.deepEqual([moved?.pool_size, moved?.duration_ms], [30, null]);
  assert.deepEqual(moved?.order.map((t) => [t.track_id, t.energy_estimated]), [["c", undefined], ["b", true], ["a", undefined], ["d", undefined]]);
  assert.equal(reorderSnapshot(s ?? null, ["a", "b", "c", "d"]), s); // ordem igual: o próprio snapshot, com a duração
  assert.equal(s?.duration_ms, 5_460_000); // o original não muda
  // duration_ms null (o Spotify não deu a duração de alguma faixa) é copiado como null; valor de tipo errado é ignorado
  const nulled = setup(storeDir);
  recordFromResult(nulled.ctx, { ...full, pool_size: 12, duration_ms: null });
  assert.deepEqual([nulled.f.versions[0]?.snapshot?.pool_size, nulled.f.versions[0]?.snapshot?.duration_ms], [12, null]);
  const odd = setup(storeDir);
  recordFromResult(odd.ctx, { ...full, pool_size: "30", duration_ms: "5460000" });
  const keys = Object.keys(odd.f.versions[0]?.snapshot ?? {});
  assert.equal(keys.includes("pool_size") || keys.includes("duration_ms"), false);
}

// nota dada não trava o turno: resultado de mesma ordem devolve a mesma versão e não regrava os planos (a nota aponta para eles)
{
  const real = openRepo(":memory:");
  const session = real.createSession("Eletro");
  const ctx: TurnCtx = { repo: real, waiter: new ApprovalWaiter(), questions: new Waiter<Answers | null>(null), emit: () => undefined, chatSessionId: session.id, note: "monte um set", storeDir };
  recordFromResult(ctx, full);
  const setId = real.getCurrentSet(session.id)?.id ?? "";
  const versionId = real.latestVersion(setId)?.id ?? "";
  const planId = real.listPlans(versionId)[0]?.id ?? "";
  assert.equal(real.listPlans(versionId).length, 3);
  assert.equal(real.addFeedback(planId, 4, "boa")?.rating, 4);
  recordFromResult(ctx, full); // "mais energia no meio" com a mesma ordem: sem versão nova
  assert.equal(real.listVersions(setId).length, 1);
  const kept = real.listPlans(versionId);
  assert.deepEqual([kept.length, kept[0]?.id, kept[0]?.feedback?.rating], [3, planId, 4]); // planos e nota intactos
  real.close();
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
  // tamanho pedido (P10): no início o que o usuário pediu; no fim o que saiu (minutos de duration_ms, arredondados)
  assert.equal(d("dj_build_set", { playlist: "pl1", duration_minutes: 90, curve: "classic" }, "start"), "Eletro · 90 min · curva classic");
  assert.equal(d("dj_build_set", { playlist: "pl1", max_tracks: 20 }, "start"), "Eletro · 20 faixas");
  assert.equal(d("dj_build_set", { playlist: "pl1", duration_minutes: "90" }, "start"), "Eletro"); // tipo errado: ignora, nunca "NaN"
  assert.equal(d("dj_build_set", { order: new Array(20).fill({}), duration_ms: 5_460_000, curve: "classic" }, "end"), "20 faixas · 91 min · curva classic");
  assert.equal(d("dj_build_set", { order: new Array(20).fill({}), duration_ms: 5_399_999, curve: "classic" }, "end"), "20 faixas · 90 min · curva classic");
  assert.equal(d("dj_build_set", { order: new Array(20).fill({}), duration_ms: null, curve: "classic" }, "end"), "20 faixas · curva classic"); // alguma faixa sem duração
  assert.equal(d("dj_evaluate_order", { average_score: 0.84 }, "end"), "nota média 0,84");
  assert.equal(d("dj_evaluate_order", { average_score: 0.8 }, "end"), "nota média 0,80");
  assert.equal(d("transition_plan", { from_track: "t1", to_track: "spotify:track:t2" }, "start"), "Um — Artista → t2");
  assert.equal(d("transition_plan", { plan: { type: "blend", length_bars: 16 } }, "end"), "Blend · 16 c.");
  // Sprint 6: perguntas ao DJ
  assert.equal(d("ask_dj", { title: "x", questions: [{}, {}] }, "start"), "2 perguntas");
  assert.equal(d("ask_dj", { questions: [{}] }, "start"), "1 pergunta");
  assert.equal(d("ask_dj", { questions: "x" }, "start"), ""); // sem lista: nunca "NaN"
  const respostas = { tamanho: "1 hora", curva: "peak time", abertura_fechamento: "sem faixa fixa", playlist: "Eletro" };
  assert.equal(d("ask_dj", { status: "answered", answers: respostas }, "end"), "respondido: tamanho 1 hora · curva peak time · abertura fechamento sem faixa fixa"); // até 3
  assert.equal(d("ask_dj", { status: "answered", answers: { tamanho: null, curva: "peak time" } }, "end"), "respondido: curva peak time"); // pulada não aparece
  assert.equal(d("ask_dj", { status: "skipped", answers: { tamanho: null } }, "end"), "pulado");
  assert.equal(d("ask_dj", { status: "answered", answers: { tamanho: null } }, "end"), "pulado");
  assert.equal(d("ask_dj", { status: "answered", answers: { tamanho: "x".repeat(60) } }, "end"), `respondido: tamanho ${"x".repeat(39)}…`); // texto livre cortado
  assert.equal(d("ask_dj", "texto", "end"), ""); // sem resultado estruturado
  assert.equal(d("ask_dj", { content: [] }, "end"), "");
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
type Seen = { options?: { systemPrompt?: unknown; thinking?: unknown; includePartialMessages?: unknown; mcpServers?: Record<string, unknown> } };
const fakeQuery = (messages: unknown[], seen?: Seen) =>
  ((args: Seen) => {
    if (seen) seen.options = args.options;
    return (async function* () {
      for (const m of messages) {
        if (m instanceof Error) throw m;
        yield m;
      }
    })();
  }) as unknown as typeof query;
const chatDeps = (f: ReturnType<typeof fakeRepo>, q: typeof query): ChatDeps => ({
  repo: f.repo, waiter: new ApprovalWaiter(), questions: new Waiter<Answers | null>(null), mcpServerPath: "mcp.js", mcpEnv: {}, model: "m", maxBudgetUsd: 1, thinkingTokens: 1024,
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
  const seen: Seen = {};
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
  // Sprint 4: duração e quantidade só quando o usuário pede
  assert.match(String(seen.options?.systemPrompt), /duration_minutes em dj_build_set \(1h30 = 90\).*max_tracks; sem pedido, não passe nenhum dos dois\./);
  // Sprint 6: o Jev entra em todo set; ask_dj uma vez quando falta tamanho ou curva; tamanho pulado = playlist inteira; nunca limitar nem escolher subconjunto
  const prompt = String(seen.options?.systemPrompt);
  assert.match(prompt, /O Jev entra em todo set automaticamente \(dj_build_set já o usa\): nunca pergunte se deve usar o Jev\. Depois de montar, diga em uma frase quantos passos o Jev escolheu e quantos ficaram com as regras \(campo jev do resultado\)\./);
  assert.doesNotMatch(prompt, /quando o usuário pedir o Jev/);
  assert.match(prompt, /se faltar tamanho \(duração ou quantidade\), curva ou a playlist de origem, chame ask_dj UMA vez, só com as perguntas que faltam/);
  for (const id of ['id "tamanho"', 'id "curva"', 'id "abertura_fechamento"', 'id "playlist"']) assert.ok(prompt.includes(id), id);
  assert.match(prompt, /Tamanho pulado = playlist inteira \(sem duration_minutes nem max_tracks\); curva pulada = classic; abertura e fechamento pulados = nenhum\./);
  assert.match(prompt, /Nunca limite o set por conta própria \(nem a 10 faixas\) e nunca escolha um subconjunto por track_ids a partir de uma playlist: passe playlist e o tamanho; track_ids só quando o usuário nomear as faixas\./);
  assert.match(prompt, /nunca escreva "Recomendado" no label/);
  assert.match(prompt, /Você só tem as ferramentas do spotify-dj e a ask_dj/);
  // P17 (avoid) e P18 ([DJ MIX]) seguem no prompt
  assert.match(prompt, /passe avoid: \[\] só se o usuário pedir para repetir faixas de sets anteriores\./);
  assert.match(prompt, /Playlists cujo nome começa com \[DJ MIX\] são sets que o Play\.Me já enviou ao Spotify/);
  assert.deepEqual(Object.keys(seen.options?.mcpServers ?? {}), ["spotify-dj", "playme"]);
  // Sprint 5: cobertura de metadados antes do primeiro set da playlist (Q3) e emoji proibido até no fim das frases
  assert.match(String(seen.options?.systemPrompt), /Na primeira montagem de set de uma playlist nesta conversa, chame metadata_coverage antes de dj_build_set e comente a cobertura em uma frase\./);
  assert.match(String(seen.options?.systemPrompt), /Nunca use emojis, nem no fim das frases\./);
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

// ---------- Sprint 5: pensamento e streaming ao vivo ----------
const streamDelta = (delta: unknown, parent: string | null = null) => ({ type: "stream_event", parent_tool_use_id: parent, event: { type: "content_block_delta", index: 0, delta } });
const thinkingDelta = (thinking: string, parent: string | null = null) => streamDelta({ type: "thinking_delta", thinking }, parent);
const textDelta = (text: string) => streamDelta({ type: "text_delta", text });
const thought = (thinking: string) => ({ type: "assistant", message: { content: [{ type: "thinking", thinking, signature: "sig" }] } });
{
  const f = fakeRepo();
  const out: ServerEvent[] = [];
  const seen: Seen = {};
  const script = [
    sys,
    thinkingDelta(""), textDelta(""), // deltas vazios (pensamento omitido pela API): ignorados
    thinkingDelta("Vou olhar "), thinkingDelta("a playlist."),
    streamDelta({ type: "signature_delta", signature: "x" }), // outro tipo de delta e evento que não é delta: ignorados
    { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_stop", index: 0 } },
    thinkingDelta("de um subagente", "toolu_x"), // fora da conversa principal: ignorado
    thought("Vou olhar a playlist."),
    { type: "assistant", message: { content: [{ type: "redacted_thinking", data: "zzz" }] } }, // ignorado
    thought(""), // vazio: ignorado
    textDelta("Olá"), textDelta(", DJ."),
    said("Olá, DJ."),
    finished,
  ];
  await runChat(chatDeps(f, fakeQuery(script, seen)), "c1", "oi", (e) => out.push(e));
  assert.deepEqual(out, [
    { type: "thinking_delta", text: "Vou olhar " }, { type: "thinking_delta", text: "a playlist." },
    { type: "thinking", text: "Vou olhar a playlist." },
    { type: "text_delta", text: "Olá" }, { type: "text_delta", text: ", DJ." },
    { type: "text", text: "Olá, DJ." },
    { type: "done", cost_usd: 0.03 },
  ]);
  // o turno grava só os blocos finais (pensamento e texto), nunca os deltas
  assert.deepEqual(f.turns, [{ userMessage: "oi", events: [{ type: "thinking", text: "Vou olhar a playlist." }, { type: "text", text: "Olá, DJ." }], cost: 0.03 }]);
  assert.deepEqual(seen.options?.thinking, { type: "enabled", budgetTokens: 1024, display: "summarized" });
  assert.equal(seen.options?.includePartialMessages, true);
}
// PLAYME_THINKING_TOKENS: "0" desliga (não cai no padrão); vazio, ausente ou inválido valem 1024; abaixo do piso da API sobe para 1024
assert.deepEqual(["0", "2048", " 4096 ", "", undefined, "abc", "-5", "1.5"].map((v) => thinkingTokensFrom(v)), [0, 2048, 4096, 1024, 1024, 1024, 1024, 1024]);
for (const [tokens, thinking] of [[0, { type: "disabled" }], [2048, { type: "enabled", budgetTokens: 2048, display: "summarized" }], [500, { type: "enabled", budgetTokens: 1024, display: "summarized" }]] as const) {
  const seen: Seen = {};
  await runChat({ ...chatDeps(fakeRepo(), fakeQuery([sys, finished], seen)), thinkingTokens: tokens }, "c1", "oi", () => undefined);
  assert.deepEqual(seen.options?.thinking, thinking, `thinkingTokens ${tokens}`);
}

// a API recusa o pensamento: o turno é refeito uma vez, sem ele, e o erro cru não chega ao chat
/** Um script por chamada ao query, na ordem (a segunda é o turno refeito); guarda as opções de cada chamada. */
const fakeQueries = (scripts: unknown[][], calls: NonNullable<Seen["options"]>[]) => {
  let n = 0;
  return ((args: Seen) => {
    calls.push(args.options ?? {});
    const script = scripts[n++] ?? [];
    return (async function* () {
      for (const m of script) {
        if (m instanceof Error) throw m;
        yield m;
      }
    })();
  }) as unknown as typeof query;
};
{
  const refusal = "400 invalid_request_error: thinking.enabled.budget_tokens: Input should be greater than or equal to 1024";
  const apiErrorMessage = { type: "assistant", error: "invalid_request", message: { content: [{ type: "text", text: `API Error: ${refusal}` }] } };
  const refusals: [string, unknown[]][] = [
    ["exceção do SDK", [sys, new Error(refusal)]],
    ["result com is_error", [sys, apiErrorMessage, { type: "result", subtype: "success", is_error: true, result: `API Error: ${refusal}`, total_cost_usd: 0 }]],
    ["result de erro", [sys, apiErrorMessage, { type: "result", subtype: "error_during_execution", is_error: true, errors: [`API Error: ${refusal}`] }]],
  ];
  const run = async (thinkingTokens: number, scripts: unknown[][]) => {
    const f = fakeRepo();
    const out: ServerEvent[] = [];
    const calls: NonNullable<Seen["options"]>[] = [];
    await runChat({ ...chatDeps(f, fakeQueries(scripts, calls)), thinkingTokens }, "c1", "oi", (e) => out.push(e));
    return { f, out, calls: calls.map((c) => c.thinking) };
  };
  const logged: unknown[][] = [];
  const log = console.error;
  console.error = (...args: unknown[]) => void logged.push(args); // o runChat loga a recusa (esperada aqui)
  try {
    for (const [shape, refused] of refusals) {
      const { f, out, calls } = await run(1024, [refused, [sys, said("ok"), finished]]);
      assert.deepEqual(calls, [{ type: "enabled", budgetTokens: 1024, display: "summarized" }, { type: "disabled" }], shape); // refeito uma vez, sem pensamento
      assert.deepEqual(out, [{ type: "text", text: "ok" }, { type: "done", cost_usd: 0.03 }], shape); // nada do erro cru da API
      assert.deepEqual(f.turns, [{ userMessage: "oi", events: [{ type: "text", text: "ok" }], cost: 0.03 }], shape); // um turno só
    }
    assert.equal(logged.length, 3); // cada recusa foi ao log do servidor
    assert.ok(logged.every((args) => /pensamento recusado/.test(String(args[0])) && /budget_tokens/.test(String(args[1]))));
    // sem refazer: pensamento já desligado, evento já emitido (refazer repetiria ferramentas e o gate) ou erro que não é do pensamento
    const failure = { type: "error", message: "Falha no agente. Veja o log do servidor." };
    const spare = [sys, said("não deveria rodar"), finished];
    const off = await run(0, [[sys, new Error(refusal)], spare]);
    assert.deepEqual([off.calls.length, off.out], [1, [failure]]);
    const late = await run(1024, [[sys, said("começando"), new Error(refusal)], spare]);
    assert.deepEqual([late.calls.length, late.out], [1, [{ type: "text", text: "começando" }, failure]]);
    const other = await run(1024, [[sys, new Error("boom")], spare]);
    assert.deepEqual([other.calls.length, other.out], [1, [failure]]);
    // só uma segunda chance: a recusa repetida vira erro
    const twice = await run(1024, [[sys, new Error(refusal)], [sys, new Error(refusal)], spare]);
    assert.deepEqual([twice.calls.length, twice.out], [2, [failure]]);
  } finally {
    console.error = log;
  }
}

// ---------- Sprint 5: nome do set ("<playlist> · <curva>") quando o dj_build_set termina ----------
const rawTitle = "Monte um set da playlist Eletro, 1h30";
{
  const f = fakeRepo(rawTitle);
  let nameAtEvent: string | undefined;
  const build = [sys, used("u1", "dj_build_set", { playlist: "spotify:playlist:pl1", duration_minutes: 90 }), returned("u1", full), finished];
  await runChat(chatDeps(f, fakeQuery(build)), "c1", rawTitle, (e) => {
    if (e.type === "set") nameAtEvent = f.set?.name;
  });
  assert.equal(f.set?.name, "Eletro · peak time");
  assert.equal(nameAtEvent, "Eletro · peak time"); // renomeado antes do evento: a tela relê o set ao recebê-lo
  assert.equal(f.repo.getSession("c1")?.title, rawTitle); // o título da conversa não muda
  // nova montagem no mesmo set: o nome já não é o título cru, então fica
  const reversed = { ...full, order: [...full.order].reverse(), ordered_track_ids: [...full.ordered_track_ids].reverse() };
  await runChat(chatDeps(f, fakeQuery([sys, used("u2", "dj_build_set", { playlist: "zzz" }), returned("u2", reversed), finished])), "c1", "de novo", () => undefined);
  assert.equal(f.versions.length, 2);
  assert.equal(f.set?.name, "Eletro · peak time");
}
for (const [label, tool, call, result, expected] of [
  ["id fora do cache", "dj_build_set", { playlist: "0123456789abcdefghijkl" }, { ...full, curve: "classic" }, "Set · clássica"],
  ["link fora do cache não vira nome", "dj_build_set", { playlist: "https://open.spotify.com/playlist/0123456789abcdefghijkl?si=x" }, { ...full, curve: "classic" }, "Set · clássica"],
  ["NOME da playlist passado direto (P14)", "dj_build_set", { playlist: "  Eletro Clássicos " }, { ...full, curve: "sunrise" }, "Eletro Clássicos · sunrise"],
  ["sem playlist", "dj_build_set", { track_ids: ["a", "b"] }, { ...full, curve: "warm_up" }, "Set · warm up"],
  ["track_ids vence: a playlist (id do cache) não nomeia", "dj_build_set", { playlist: "pl1", track_ids: ["a", "b"] }, { ...full, curve: "warm_up" }, "Set · warm up"],
  ["track_ids vence: texto livre não vira nome", "dj_build_set", { playlist: "qualquer coisa", track_ids: ["a", "b"] }, { ...full, curve: "warm_up" }, "Set · warm up"],
  ["curva desconhecida: o texto cru, nunca o protótipo da tabela", "dj_build_set", { playlist: "pl1" }, { ...full, curve: "constructor" }, "Eletro · constructor"],
  ["dj_evaluate_order não renomeia", "dj_evaluate_order", { playlist: "pl1" }, full, rawTitle],
] as const) {
  const f = fakeRepo(rawTitle);
  await runChat(chatDeps(f, fakeQuery([sys, used("u1", tool, call), returned("u1", result), finished])), "c1", rawTitle, () => undefined);
  assert.equal(f.set?.name, expected, label);
}
for (const [curve, label] of [["classic", "clássica"], ["peak_time", "peak time"], ["warm_up", "warm up"], ["sunrise", "sunrise"]]) {
  const { f, ctx } = setup();
  recordFromResult(ctx, { ...full, curve }, { playlist: "Eletro" });
  assert.equal(f.set?.name, `Eletro · ${label}`);
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

// ---------- Sprint 6: Waiter e ask_dj (servidor MCP em processo "playme") ----------
// Waiter: abort entrega o valor de abort (null nas perguntas, "rejected" nas approvals); sinal já abortado não trava a espera
{
  const q = new Waiter<Answers | null>(null);
  const abort = new AbortController();
  const waiting = q.wait("x", abort.signal);
  assert.equal(q.has("x"), true);
  abort.abort();
  assert.equal(await waiting, null);
  assert.equal(q.has("x"), false);
  assert.equal(await q.wait("y", abort.signal), null); // já abortado: termina na hora
  assert.equal(q.has("y"), false);
  assert.equal(q.resolve("x", { tamanho: "1 hora" }), false); // ninguém esperando
  const approvals = new ApprovalWaiter();
  assert.equal(await approvals.wait("z", abort.signal), "rejected");
  const decided = approvals.wait("w");
  assert.equal(approvals.resolve("w", "approved"), true);
  assert.equal(await decided, "approved");
  // status das respostas: um texto basta para "answered"; nulo, vazio e só espaços valem "skipped"
  assert.deepEqual(([{ a: "x", b: null }, { a: null }, { a: "  " }, {}] as Answers[]).map(answersStatus), ["answered", "skipped", "skipped", "skipped"]);
}

type AskOptions = { mcpServers?: Record<string, unknown> };
type Run = { f: ReturnType<typeof fakeRepo>; live: ServerEvent[]; deps: ChatDeps; options?: AskOptions };
type QuestionsEvent = Extract<ServerEvent, { type: "questions" }>;
const questionsOf = (events: ServerEvent[]) => events.find((e): e is QuestionsEvent => e.type === "questions");
const textOfResult = (r: unknown): string => String(((r as { content?: { text?: string }[] }).content ?? [])[0]?.text);
const askInput = {
  title: "Antes de montar",
  questions: [
    { id: "tamanho", text: "Qual o tamanho do set?", options: [{ label: "1 hora", description: "o mais comum", recommended: true }, { label: "1h30" }, { label: "2 horas" }], allow_other: true },
    { id: "curva", text: "Qual curva de energia?", options: [{ label: "clássica", recommended: true }, { label: "peak time" }] },
  ],
};
const asked = (id: string, input: unknown) => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "mcp__playme__ask_dj", input }] } });
const answeredWith = (id: string, result: unknown) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: (result as { content: unknown }).content }] }, tool_use_result: result });
const until = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 400 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(cond(), "a condição não chegou a valer");
};
/**
 * runChat com um query falso que liga um cliente MCP ao servidor playme que o próprio runChat montou (InMemoryTransport):
 * a ferramenta ask_dj roda de verdade (schema zod, handler, evento, espera). `play` faz o papel do agente e do DJ.
 * `live` guarda cópias dos eventos no instante do emit: o objeto gravado no turno é o mesmo e muda depois.
 */
async function askRun(play: (client: Client, run: Run) => AsyncGenerator<unknown>, signal?: AbortSignal): Promise<Run> {
  const run = { f: fakeRepo(), live: [] as ServerEvent[] } as Run;
  const q = ((args: { options: AskOptions }) =>
    (async function* () {
      run.options = args.options;
      const { instance } = args.options.mcpServers?.playme as { instance: McpServer };
      const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
      await instance.connect(serverSide);
      const mcp = new Client({ name: "teste", version: "1" });
      await mcp.connect(clientSide);
      try {
        yield* play(mcp, run);
      } finally {
        await mcp.close();
      }
    })()) as unknown as typeof query;
  run.deps = chatDeps(run.f, q);
  await runChat(run.deps, "c1", "monte um set", (e) => run.live.push(JSON.parse(JSON.stringify(e)) as ServerEvent), signal);
  return run;
}
const savedQuestions = (run: Run) => run.f.turns[0]?.events.find((e) => e.type === "questions");

// o DJ responde: o agente recebe { status, answers }; o evento ao vivo vai sem status e o gravado sai com o estado final
{
  let reply: unknown;
  const run = await askRun(async function* (client, r) {
    yield sys;
    yield asked("u1", askInput);
    const call = client.callTool({ name: "ask_dj", arguments: askInput });
    await until(() => questionsOf(r.live) !== undefined);
    const id = questionsOf(r.live)?.questions_id ?? "";
    assert.equal(r.deps.questions.has(id), true);
    // pergunta que o agente não fez é descartada; texto só de espaços vale "pulada"
    assert.equal(r.deps.questions.resolve(id, { tamanho: " 1 hora ", curva: "  ", outra: "x" }), true);
    reply = await call;
    yield answeredWith("u1", reply);
    yield finished;
  });
  assert.deepEqual(Object.keys(run.options?.mcpServers ?? {}), ["spotify-dj", "playme"]);
  assert.deepEqual(run.live.map((e) => e.type), ["tool_start", "questions", "tool_end", "done"]);
  assert.deepEqual(run.live[0], { type: "tool_start", tool: "ask_dj", tool_use_id: "u1", detail: "2 perguntas" }); // sem o prefixo mcp__playme__
  const live = questionsOf(run.live);
  assert.match(live?.questions_id ?? "", /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  // ao vivo: sem status nem answers (= pendente); allow_other omitido vira false
  assert.deepEqual(live, { type: "questions", questions_id: live?.questions_id, title: "Antes de montar", questions: [askInput.questions[0], { ...askInput.questions[1], allow_other: false }] });
  assert.deepEqual(run.live[2], { type: "tool_end", tool: "ask_dj", tool_use_id: "u1", is_error: false, detail: "respondido: tamanho 1 hora" });
  // o que o agente recebeu: texto JSON, uma resposta por pergunta feita
  assert.deepEqual(JSON.parse(textOfResult(reply)), { status: "answered", answers: { tamanho: "1 hora", curva: null } });
  assert.deepEqual((reply as { structuredContent: unknown }).structuredContent, { status: "answered", answers: { tamanho: "1 hora", curva: null } });
  // o turno gravado: o mesmo evento, com o estado final
  assert.deepEqual(savedQuestions(run), { ...live, status: "answered", answers: { tamanho: "1 hora", curva: null } });
  assert.equal(run.deps.questions.has(live?.questions_id ?? ""), false);
}

// o DJ pula tudo: skipped, com null em cada pergunta
{
  const run = await askRun(async function* (client, r) {
    yield sys;
    yield asked("u1", askInput);
    const call = client.callTool({ name: "ask_dj", arguments: askInput });
    await until(() => questionsOf(r.live) !== undefined);
    r.deps.questions.resolve(questionsOf(r.live)?.questions_id ?? "", { tamanho: null, curva: null });
    const reply = await call;
    assert.deepEqual(JSON.parse(textOfResult(reply)), { status: "skipped", answers: { tamanho: null, curva: null } });
    yield answeredWith("u1", reply);
    yield finished;
  });
  assert.equal(run.live.find((e) => e.type === "tool_end")?.detail, "pulado");
  assert.deepEqual(savedQuestions(run), { ...questionsOf(run.live), status: "skipped", answers: { tamanho: null, curva: null } });
}

const quiet = async (fn: () => Promise<void>): Promise<void> => {
  const log = console.error;
  console.error = () => undefined; // o runChat loga a falha do agente (esperada nestes testes)
  try {
    await fn();
  } finally {
    console.error = log;
  }
};
// o cliente desconecta com a pergunta aberta: abort do turno = skipped
await quiet(async () => {
  const controller = new AbortController();
  let reply: unknown;
  const run = await askRun(async function* (client, r) {
    yield sys;
    yield asked("u1", askInput);
    const call = client.callTool({ name: "ask_dj", arguments: askInput });
    await until(() => questionsOf(r.live) !== undefined);
    controller.abort();
    reply = await call;
    throw new Error("aborted"); // o SDK encerra a iteração
  }, controller.signal);
  assert.deepEqual(JSON.parse(textOfResult(reply)), { status: "skipped", answers: { tamanho: null, curva: null } });
  assert.deepEqual(run.live.map((e) => e.type), ["tool_start", "questions", "error"]);
  assert.deepEqual(run.live.at(-1), { type: "error", message: "Conversa encerrada." });
  assert.deepEqual(savedQuestions(run), { ...questionsOf(run.live), status: "skipped", answers: { tamanho: null, curva: null } });
  assert.equal(run.deps.questions.has(questionsOf(run.live)?.questions_id ?? ""), false);
});

// o SDK cai com a pergunta aberta, sem abort: o turno grava "expired" (nunca pendente para sempre) e libera a espera
await quiet(async () => {
  let late: Promise<unknown> = Promise.resolve();
  const run = await askRun(async function* (client, r) {
    yield sys;
    yield asked("u1", askInput);
    late = client.callTool({ name: "ask_dj", arguments: askInput }).catch(() => undefined);
    await until(() => questionsOf(r.live) !== undefined);
    throw new Error("boom");
  });
  const id = questionsOf(run.live)?.questions_id ?? "";
  assert.equal(run.deps.questions.has(id), false); // liberada: um POST atrasado dá 409
  assert.equal(run.live.at(-1)?.type, "error");
  const expired = { ...questionsOf(run.live), status: "expired" };
  assert.deepEqual(savedQuestions(run), expired);
  await late;
  await new Promise((r) => setTimeout(r, 20)); // a continuação tardia da ferramenta não sobrescreve o estado gravado
  assert.deepEqual(savedQuestions(run), expired);
});

// entrada inválida volta como erro para o agente (que tenta de novo) e não abre janela nenhuma
{
  const one = (id: string, label = "a") => ({ id, text: "x", options: [{ label }, { label: "b" }] });
  const run = await askRun(async function* (client) {
    yield sys;
    const invalid: [string, unknown][] = [
      ["sem perguntas", { questions: [] }],
      ["5 perguntas", { questions: ["q", "qa", "qaa", "qaaa", "qaaaa"].map((id) => one(id)) }],
      ["1 opção", { questions: [{ id: "x", text: "x", options: [{ label: "a" }] }] }],
      ["id fora do padrão", { questions: [one("Tamanho 1")] }],
      ["ids repetidos", { questions: [one("x"), one("x")] }],
      ["label de 61 caracteres", { questions: [one("x", "a".repeat(61))] }],
      ["título de 81 caracteres", { title: "t".repeat(81), questions: [one("x")] }],
    ];
    for (const [label, args] of invalid) {
      const r = await client.callTool({ name: "ask_dj", arguments: args as Record<string, unknown> });
      assert.equal(r.isError, true, label);
      assert.match(textOfResult(r), /Input validation error/, label);
    }
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map((t) => t.name), ["ask_dj"]);
    assert.equal(tools[0]?._meta?.["anthropic/alwaysLoad"], true); // nunca adiada atrás de busca de ferramentas
    yield finished;
  });
  assert.equal(questionsOf(run.live), undefined);
  assert.equal(run.f.turns[0]?.events.some((e) => e.type === "questions"), false);
}

// a rodada de refazer o turno sem pensamento monta um servidor playme novo (um McpServer não se reconecta a outro transporte)
await quiet(async () => {
  const refusal = "400 invalid_request_error: thinking.enabled.budget_tokens: Input should be greater than or equal to 1024";
  const calls: NonNullable<Seen["options"]>[] = [];
  await runChat(chatDeps(fakeRepo(), fakeQueries([[sys, new Error(refusal)], [sys, finished]], calls)), "c1", "oi", () => undefined);
  assert.equal(calls.length, 2);
  assert.ok(calls[0]?.mcpServers?.playme && calls[1]?.mcpServers?.playme);
  assert.notEqual(calls[0]?.mcpServers?.playme, calls[1]?.mcpServers?.playme);
});

console.log("[ok] agent: gate, extração, snapshot com origem das faixas, tamanho e energia estimada, reorderSnapshot, detalhe das ferramentas com duração, runChat com turno gravado e pesos, pensamento e streaming, recusa do pensamento, nome do set, nota sem travar o turno, spotify, Waiter, ask_dj (respondida, pulada, abort, expirada, entrada inválida)");
