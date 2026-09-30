import assert from "node:assert/strict";
import { ApprovalWaiter } from "../approvals.js";
import { extractCreated, extractProposal, finishCreate, gate, recordFromResult, structuredOf, type TurnCtx } from "../agent.js";
import type { Repo } from "../repo.js";
import type { Approval, PlanInput, ServerEvent, SetRow, SetStatus, SetVersion } from "../types.js";

/** Repo falso em memória: só o que o agente usa. */
function fakeRepo() {
  const now = "2026-01-01T00:00:00Z";
  let set: SetRow | undefined;
  const versions: SetVersion[] = [];
  const approvals: Approval[] = [];
  const plans: PlanInput[][] = [];
  const repo = {
    getSession: () => ({ id: "c1", agent_session_id: null, title: "Eletro", created_at: now, updated_at: now }),
    getSet: () => set,
    getCurrentSet: () => set,
    latestVersion: () => versions.at(-1),
    recordProposal(_c: string, name: string, curve: string, order: string[], note: string | null) {
      set ??= { id: "s1", chat_session_id: "c1", name, curve, status: "rascunho", spotify_playlist_id: null, spotify_url: null, created_at: now, updated_at: now };
      const last = versions.at(-1);
      if (!last || last.order.join() !== order.join()) versions.push({ id: `v${versions.length + 1}`, set_id: "s1", version: versions.length + 1, order, note, created_at: now });
      return { set, version: versions.at(-1) as SetVersion };
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
  return { repo: repo as unknown as Repo, get set() { return set; }, versions, approvals, plans };
}

function setup() {
  const f = fakeRepo();
  const events: ServerEvent[] = [];
  const waiter = new ApprovalWaiter();
  const ctx: TurnCtx = { repo: f.repo, waiter, emit: (e) => events.push(e), chatSessionId: "c1", note: "monte um set" };
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

console.log("[ok] agent: gate (aprovado, rejeitado, leitura, negado), extração de proposta e de playlist criada");
