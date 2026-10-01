// Check da lógica pura da apps/web (roda em Node sem build: `npm run test:ui -w @playme/web`).
import assert from "node:assert/strict";
import { parseSseChunk } from "../api.ts";
import { activityForTool } from "../activity.ts";
import { compatibleKeys, groupBySection, relationLabel, transitionCard, weakestPosition } from "../setview.ts";
import { answersLine, applyEvent, initialState, itemsFromTurns, orderOptions, pendingApproval, pendingQuestions, reducer, selectVersion, splitLabel, type AppState } from "../state.ts";
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
  // Sprint 5: pensamento e streaming
  let live = applyEvent([], { type: "thinking_delta", text: "Vou " });
  live = applyEvent(live, { type: "thinking_delta", text: "montar." });
  assert.deepEqual(live, [{ kind: "thinking", id: live[0]?.id ?? "", text: "Vou montar.", live: true }]);
  live = applyEvent(live, { type: "thinking", text: "Vou montar o set." });
  assert.equal(live[0]?.kind === "thinking" && live[0].live, false);
  assert.equal(live[0]?.kind === "thinking" && live[0].text, "Vou montar o set.");
  live = applyEvent(live, { type: "text_delta", text: "Set " });
  live = applyEvent(live, { type: "text_delta", text: "pronto." });
  assert.equal(live[1]?.kind === "draft" && live[1].text, "Set pronto.");
  live = applyEvent(live, { type: "text", text: "Set pronto." });
  assert.deepEqual(live.map((i) => i.kind), ["thinking", "text"]);
  // rascunho sem bloco final vira texto quando a ferramenta começa
  const cut = applyEvent(applyEvent([], { type: "text_delta", text: "a" }), { type: "tool_start", tool: "dj_build_set", tool_use_id: "t9", detail: "" });
  assert.deepEqual(cut.map((i) => i.kind), ["text", "tool"]);
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

// Sprint 6: perguntas do agente (ask_dj → evento `questions`)
{
  const ask: Extract<ServerEvent, { type: "questions" }> = {
    type: "questions",
    questions_id: "q1",
    title: "Antes de montar",
    questions: [
      { id: "tamanho", text: "Qual o tamanho do set?", header: "Tamanho", options: [{ label: "1h30" }, { label: "1 hora", recommended: true }, { label: "2 horas" }], allow_other: true },
      { id: "abertura_fechamento", text: "Quer fixar a abertura ou o fechamento?", options: [{ label: "Sem faixa fixa", recommended: true }, { label: "Escolher a abertura" }], allow_other: false },
    ],
  };
  const answers = { tamanho: "1 hora", abertura_fechamento: null };
  const start = reducer(reducer(initialState, { type: "send", id: "u1", text: "monta um set" }), { type: "event", event: { type: "tool_start", tool: "ask_dj", tool_use_id: "t1", detail: "2 perguntas" } });
  const s = reducer(start, { type: "event", event: ask });
  const item = pendingQuestions(s);
  assert.equal(item?.id, "q1"); // ao vivo vem sem status: pendente
  assert.equal(item?.answers, null);
  assert.equal(s.busy, true);
  assert.equal(s.activity, "idle"); // o turno espera o DJ
  assert.deepEqual(s.overlay, { kind: "questions" }); // a janela abre sozinha
  const pill = s.items.find((i) => i.kind === "tool");
  assert.equal(pill?.kind === "tool" && pill.status, "waiting"); // a pílula espera o DJ em vez de "rodando"
  const prefixed = reducer(reducer(initialState, { type: "event", event: { type: "tool_start", tool: "mcp__playme__ask_dj", tool_use_id: "t2", detail: "" } }), { type: "event", event: ask });
  assert.equal(prefixed.items[0]?.kind === "tool" && prefixed.items[0].status, "waiting"); // o prefixo do servidor MCP em processo não atrapalha
  assert.equal(pendingQuestions(reducer(s, { type: "overlay", overlay: null }))?.id, "q1"); // fechar a janela não perde as perguntas
  // responder (otimista): sai de pendente e o agente volta a trabalhar
  const done = reducer(s, { type: "questions_done", questionsId: "q1", status: "answered", answers });
  assert.equal(pendingQuestions(done), null);
  assert.equal(done.activity, "composing");
  const doneItem = done.items.find((i) => i.kind === "questions");
  assert.equal(doneItem?.kind === "questions" && answersLine(doneItem), "tamanho 1 hora · abertura fechamento pulada");
  // erro de rede: volta a pendente e a esperar o DJ
  const back = reducer(done, { type: "questions_done", questionsId: "q1", status: "pending", answers: null });
  assert.equal(pendingQuestions(back)?.id, "q1");
  assert.equal(back.activity, "idle");
  // o turno acaba sem resposta (done, error, queda do stream): ninguém mais espera
  for (const ended of [reducer(s, { type: "event", event: { type: "done", cost_usd: null } }), reducer(s, { type: "event", event: { type: "error", message: "x" } }), reducer(s, { type: "turn_failed", text: "x" })]) {
    const q = ended.items.find((i) => i.kind === "questions");
    assert.equal(pendingQuestions(ended), null);
    assert.equal(q?.kind === "questions" && q.status, "expired");
  }
  // releitura: o turno gravado traz o estado final e as respostas; não pisca como pendente nem abre a janela
  const turn = (event: ServerEvent) => ({ id: "t1", user_message: "monta", events: [event], cost_usd: null, created_at: "" });
  const reread = itemsFromTurns([turn({ ...ask, status: "answered", answers })]);
  assert.deepEqual(reread.map((i) => i.kind), ["user", "questions"]);
  const rereadItem = reread[1];
  assert.equal(rereadItem?.kind === "questions" && rereadItem.status, "answered");
  assert.equal(rereadItem?.kind === "questions" && rereadItem.answers?.tamanho, "1 hora");
  assert.equal(pendingQuestions({ ...initialState, items: reread }), null);
  const skipped = itemsFromTurns([turn({ ...ask, status: "skipped", answers: { tamanho: null, abertura_fechamento: null } })])[1];
  assert.equal(skipped?.kind === "questions" && skipped.status, "skipped");
  assert.equal(reducer(reducer(initialState, { type: "send", id: "u", text: "x" }), { type: "event", event: { ...ask, status: "answered", answers } }).overlay, null);
  // a janela mostra a opção recomendada primeiro, sem mexer na ordem das outras
  assert.deepEqual(orderOptions(ask.questions[0]?.options ?? []).map((o) => o.label), ["1 hora", "1h30", "2 horas"]);
}

console.log("[ok] web logic: SSE, atividade, reducer, releitura, rótulos, cards, perguntas");
