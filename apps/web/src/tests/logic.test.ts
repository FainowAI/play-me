// Check da lógica pura da apps/web (roda em Node sem build: `npm run test:ui -w @playme/web`).
import assert from "node:assert/strict";
import { parseSseChunk } from "../api.ts";
import { activityForTool } from "../activity.ts";
import { compatibleKeys, groupBySection, relationLabel, transitionCard, weakestPosition } from "../setview.ts";
import { applyEvent, initialState, itemsFromTurns, pendingApproval, reducer, selectVersion, splitLabel, type AppState } from "../state.ts";
import type { PlanRow, ServerEvent, SetDetail, SetVersionDetail, SnapshotTrack, TransitionPlan } from "../types.ts";

// SSE: eventos completos saem, o resto fica
{
  const a = parseSseChunk('data: {"type":"text","text":"oi"}\n\ndata: {"type":"do');
  assert.deepEqual(a.events, [{ type: "text", text: "oi" }]);
  assert.equal(a.rest, 'data: {"type":"do');
  const b = parseSseChunk(a.rest + 'ne","cost_usd":0.01}\n\n');
  assert.deepEqual(b.events, [{ type: "done", cost_usd: 0.01 }]);
  assert.equal(b.rest, "");
  assert.equal(parseSseChunk("data: {oops}\n\n").events[0]?.type, "error");
}

// atividade por ferramenta
assert.equal(activityForTool("metadata_lookup"), "reading");
assert.equal(activityForTool("dj_build_set"), "composing");
assert.equal(activityForTool("spotify_create_playlist_from_order"), "shipping");
assert.equal(activityForTool("transition_plan"), "planning");
assert.equal(activityForTool("qualquer_coisa"), "working");

// fluxo de um turno: texto, ferramenta, set, approval pendente
const events: ServerEvent[] = [
  { type: "session", session_id: "c1" },
  { type: "tool_start", tool: "dj_build_set", tool_use_id: "t1", detail: "curva classic" },
  { type: "tool_end", tool: "dj_build_set", tool_use_id: "t1", is_error: false, detail: "21 faixas · curva classic" },
  { type: "set", set_id: "s1", version: 1, status: "rascunho" },
  { type: "text", text: "Set de 21 faixas." },
  { type: "tool_start", tool: "spotify_create_playlist_from_order", tool_use_id: "t2", detail: "21 faixas · privada" },
  { type: "approval", approval_id: "a1", set_id: "s1", playlist_name: "[DJ MIX] Eletro", track_count: 21, track_ids: ["x"] },
];
{
  let s: AppState = reducer(initialState, { type: "send", id: "u1", text: "monta um set" });
  assert.equal(s.busy, true);
  assert.equal(s.activity, "composing");
  for (const e of events) s = reducer(s, { type: "event", event: e });
  assert.equal(s.sessionId, "c1");
  assert.equal(s.busy, true);
  assert.equal(s.activity, "idle"); // gate aguardando = breathing
  assert.deepEqual(
    s.items.map((i) => i.kind),
    ["user", "tool", "set", "text", "tool", "approval"],
  );
  const create = s.items[4];
  assert.equal(create?.kind === "tool" && create.status, "waiting");
  assert.equal(pendingApproval(s)?.id, "a1");
  // rejeitar: a ferramenta vira "não aprovado", a approval sai de pendente
  const r = reducer(s, { type: "approval_decided", approvalId: "a1", status: "rejected" });
  assert.equal(pendingApproval(r), null);
  assert.equal(r.items[4]?.kind === "tool" && r.items[4].detail, "não aprovado");
  // fim do turno
  const d = reducer(s, { type: "event", event: { type: "done", cost_usd: 0.02 } });
  assert.equal(d.busy, false);
  assert.equal(d.activity, "idle");
  assert.equal(d.lastCost, 0.02);
  // ferramenta rodando dita a atividade
  const t = reducer(reducer(initialState, { type: "send", id: "u", text: "x" }), { type: "event", event: events[1] as ServerEvent });
  assert.equal(t.activity, "composing");
}

// releitura de turnos: approval já decidida não fica pendente
{
  const approval = events[6] as Extract<ServerEvent, { type: "approval" }>;
  const items = itemsFromTurns([{ id: "t1", user_message: "manda", events: [{ ...approval, status: "approved" }], cost_usd: null, created_at: "" }]);
  assert.deepEqual(items.map((i) => i.kind), ["user", "approval"]);
  assert.equal(items[1]?.kind === "approval" && items[1].status, "approved");
  assert.equal(applyEvent([], { type: "error", message: "x" })[0]?.kind, "error");
  // summary do tool_end fica no item (card de cobertura)
  const cov = applyEvent(applyEvent([], { type: "tool_start", tool: "metadata_coverage", tool_use_id: "c1", detail: "Eletro" }), { type: "tool_end", tool: "metadata_coverage", tool_use_id: "c1", is_error: false, detail: "Mixar 22 · web 414", summary: { total: 557, mixar: 22, web: 414, a_validar: 0, pendente: 121 } });
  assert.equal(cov[0]?.kind === "tool" && cov[0].summary?.pendente, 121);
}

// rótulos e versões
assert.deepEqual(splitLabel("Adored — J. Worra"), { title: "Adored", artist: "J. Worra" });
assert.deepEqual(splitLabel("Sem artista"), { title: "Sem artista", artist: "" });
assert.deepEqual(compatibleKeys("12A"), ["11A", "1A", "12B"]);
assert.deepEqual(compatibleKeys("1B"), ["12B", "2B", "1A"]);
assert.deepEqual(compatibleKeys("x"), []);

const track = (position: number, section: string, camelot: string, bpm: number, energy: number | null): SnapshotTrack => ({
  position, track_id: `id${position}`, label: `Faixa ${position} — Artista`, bpm, camelot, energy, target_energy: 5, section, source: "web", key_review: true,
});
const plan = (from: string, to: string, over: Partial<TransitionPlan> = {}): TransitionPlan => ({
  from, to, type: "blend", length_bars: 16, bass_swap_bar: 9,
  tempo: { from_bpm: 124, to_bpm: 125, diff: 1, mode: "normal", strategy: "match_incoming" },
  harmonic: { from: "8A", to: "9A", relation: "adjacente +1", class: "segura" },
  energy_delta: 1, confidence: 0.8, alerts: [], reason: "ok", planner_version: "meta-1", ...over,
});
const row = (position: number, p: TransitionPlan, score: number | null): PlanRow => ({ id: `p${position}`, set_version_id: "v1", position, from_track: p.from, to_track: p.to, plan: p, planner_version: "meta-1", score, created_at: "" });
const version: SetVersionDetail = {
  id: "v1", set_id: "s1", version: 1, order: ["id1", "id2", "id3"], note: null, created_at: "",
  snapshot: { curve: "classic", average_score: 0.8, order: [track(1, "warm_up", "8A", 124, 4), track(2, "warm_up", "9A", 125, 5), track(3, "peak", "3A", 131, 9)], transitions: [], weak_transitions: [1], problem_tracks: [], warnings: [] },
  plans: [row(1, plan("id1", "id2"), 0.9), row(2, plan("id2", "id3", { type: "echo_out", length_bars: 4, tempo: { from_bpm: 125, to_bpm: 131, diff: 6, mode: "normal", strategy: "match_incoming" }, harmonic: { from: "9A", to: "3A", relation: "choque", class: "arriscada" }, energy_delta: 4 }), 0.4)],
  guide: [],
};
{
  assert.deepEqual(groupBySection(version.snapshot!.order).map((g) => [g.name, g.tracks.length]), [["Aquecimento", 2], ["Pico", 1]]);
  assert.equal(weakestPosition(version), 2);
  const card = transitionCard(version, 2);
  assert.equal(card?.index, "2 → 3");
  assert.equal(card?.trackA.title, "Faixa 2");
  assert.equal(card?.type, "Echo out");
  assert.equal(card?.deltaBpm, 6);
  assert.deepEqual(card?.relation, { tone: "warn", label: "Arriscada · choque · +6 BPM" });
  assert.deepEqual(relationLabel(plan("a", "b")), { tone: "ok", label: "Segura · adjacente +1 · +1 BPM" });
  assert.equal(transitionCard(version, 3), null);
  const set: SetDetail = { set: { id: "s1", chat_session_id: "c1", name: "Eletro", curve: "classic", status: "rascunho", spotify_playlist_id: null, spotify_url: null, created_at: "", updated_at: "" }, versions: [version, { ...version, id: "v2", version: 2 }] };
  const s = reducer(initialState, { type: "set_loaded", set });
  assert.equal(selectVersion(s)?.version, 2);
  assert.equal(selectVersion(reducer(s, { type: "view_version", version: 1 }))?.version, 1);
  assert.equal(selectVersion(reducer(s, { type: "view_version", version: 9 }))?.version, 2);
}

console.log("[ok] web logic: SSE, atividade, reducer, releitura, rótulos, cards");
