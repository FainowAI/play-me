import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSet, normalizeWeights, scoreTransition, targetEnergy, type BuildOptions } from "../services/dj-engine.js";
import { setToMarkdown } from "../services/format.js";
import {
  agreementOf,
  compareTransitions,
  createJev,
  decideWithJev,
  isJevAnswer,
  isNextAnswer,
  jevFromEnv,
  minConfidenceFromEnv,
  pearson,
  ping,
  type ComparedPair,
  type JevAnswer,
  type JevFailure,
  type JevResult,
  type NextStep,
} from "../services/jev.js";
import { buildSetWithJev, passKey } from "../services/jev-order.js";
import type { HttpDeps } from "../services/metadata/http.js";
import { planTransition } from "../services/planner.js";
import { attachPlans } from "../tools/dj-tools.js";
import type { JevSetInfo, SetResult, TrackAnalysis, TransitionType } from "../types.js";

// Só http falso: nenhuma chamada real ao Jev, mesmo que TYPESAFE_API_KEY exista no ambiente.

// ---------- fixtures: seis faixas e cinco pares consecutivos com regras variadas ----------
const id = (n: number) => String(n).padStart(22, "0");
const track = (n: number, label: string, camelot: string, bpm: number, energy: number): TrackAnalysis => ({
  track_id: id(n),
  label,
  bpm,
  camelot,
  energy,
  updated_at: "2026-01-01T00:00:00Z",
});
const T: TrackAnalysis[] = [
  track(1, "Adored – J. Worra", "8A", 124, 4),
  track(2, "Nothing Wrong – OMRI.", "9A", 125, 5),
  track(3, "Ghost Dance – Brunello", "9B", 127, 6),
  track(4, "Like I Like It – Mau P", "10B", 131, 8),
  track(5, "Paranoia – JUNTARO", "4B", 131, 7),
  track(6, "You Were Right – RÜFÜS DU SOL", "4B", 122, 5),
];
const at = (n: number): TrackAnalysis => T[n] as TrackAnalysis;
const PAIRS: [TrackAnalysis, TrackAnalysis][] = T.slice(0, -1).map((a, i) => [a, at(i + 1)]);
const plans = PAIRS.map(([a, b]) => planTransition(a, b));
assert.deepEqual(
  plans.map((p) => [p.type, p.length_bars, p.bass_swap_bar]),
  [["blend", 32, 17], ["blend", 16, 9], ["bass_swap", 8, 5], ["echo_out", 4, null], ["echo_out", 4, null]],
  "fixtures: as regras do planejador dão estes cinco tipos",
);

// ---------- http falso ----------
interface Side {
  bpm: number;
  camelot_number: number;
  camelot_letter: string;
  energy: number | null;
}
interface State {
  from: Side;
  to: Side;
  harmonic: { relation: string; class: string; score: number };
  bpm_diff: number;
  bpm_mode: string;
  energy_delta: number | null;
}
interface Sent {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: { state: State; model: string; questions: Record<string, { type: string; instructions: string; criteria: unknown }> };
}
interface Reply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  throws?: Error;
}
function fakeHttp(respond: (sent: Sent, n: number) => Reply): { http: HttpDeps; sent: Sent[] } {
  const sent: Sent[] = [];
  let clock = 0;
  const http: HttpDeps = {
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const request: Sent = {
        url: String(input),
        method: init?.method,
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body)) as Sent["body"],
      };
      sent.push(request);
      const reply = respond(request, sent.length);
      if (reply.throws) throw reply.throws;
      return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: reply.headers });
    }) as typeof fetch,
    sleep: async () => {},
    now: () => (clock += 25),
  };
  return { http, sent };
}

/** Resposta REAL do Jev (jev-1.13.0), obtida pelo orquestrador em 30/09/2026 (HTTP 200 em 0,36 s). */
const REAL_RESPONSE = {
  model: "jev-1.13.0",
  answers: {
    transition_type: {
      type: "choice",
      choice: "blend",
      confidence: 0.85,
      probabilities: { filter: 0.0, echo_out: 0.0, blend: 0.88, bass_swap: 0.12 },
    },
    pair_score: {
      type: "score",
      score: 3.61,
      confidence: 0.68,
      legend: {
        "0": "1 · choque, não mixar",
        "1": "2 · ruim, só com corte",
        "2": "3 · aceitável com cuidado",
        "3": "4 · boa",
        "4": "5 · encaixe perfeito",
      },
      probabilities: { "0": 0.0, "1": 0.01, "2": 0.02, "3": 0.32, "4": 0.65 },
    },
  },
  usage: { input_tokens: 680, output_tokens: 63 },
};

/** "Cérebro" do Jev falso: decide pelo state, com tipo, confiança e nota que variam de par para par. */
function answerFor(state: State) {
  const clash = state.bpm_diff > 6 || state.harmonic.score <= 0.18;
  const longSafe = state.harmonic.class === "segura" && state.bpm_diff <= 3;
  const [choice, confidence]: [string, number] = clash ? ["echo_out", 0.95] : longSafe ? ["blend", 0.9] : ["filter", 0.5];
  return {
    model: "jev-1.13.0",
    answers: {
      transition_type: { type: "choice", choice, probabilities: { [choice]: confidence }, confidence },
      pair_score: {
        type: "score",
        score: Math.max(0, 4 - state.bpm_diff / 2),
        probabilities: {},
        confidence: 0.7,
        legend: REAL_RESPONSE.answers.pair_score.legend,
      },
    },
    usage: { input_tokens: 296, output_tokens: 20 },
  };
}
const brain = (sent: Sent): Reply => ({ body: answerFor(sent.body.state) });

// ---------- Jev falso da ordem (P16): responde à pergunta next_track e, na mesma chamada, à passagem anterior ----------
interface Cand extends Side {
  harmonic: { relation: string; class: string; score: number } | null;
  bpm_diff: number | null;
  bpm_mode: string | null;
  energy_delta: number | null;
  rules_score: number;
}
interface NextState {
  position: number;
  total: number;
  target_energy: number;
  current: Side | null;
  candidates: Record<string, Cand>;
  passage?: State;
}
const isChoice = (sent: Sent): boolean => "next_track" in sent.body.questions;
const nextOf = (sent: Sent): NextState => sent.body.state as unknown as NextState;
/** `pick` devolve [candidata, confiança] de cada escolha (ou uma resposta pronta); chamada de par e passagem anterior saem do `brain` dos pares. */
const orderBrain =
  (pick: (state: NextState, call: number) => [choice: number, confidence: number] | Reply) =>
  (sent: Sent, call: number): Reply => {
    if (!isChoice(sent)) return brain(sent);
    const state = nextOf(sent);
    const decision = pick(state, call);
    if (!Array.isArray(decision)) return decision;
    const [choice, confidence] = decision;
    return {
      body: {
        model: "jev-1.13.0",
        answers: {
          next_track: { type: "choice", choice: String(choice), confidence, probabilities: { [String(choice)]: confidence } },
          ...(state.passage ? answerFor(state.passage).answers : {}),
        },
        usage: { input_tokens: 900, output_tokens: 30 },
      },
    };
  };

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}
/** Pool sintético determinístico (nunca música comercial): BPM 118–132, 24 tons, energia 1–10. */
function pool(size: number, seed: number): TrackAnalysis[] {
  const rnd = lcg(seed);
  return Array.from({ length: size }, (_, i) => ({
    track_id: `syn${String(i).padStart(19, "0")}`,
    label: `S${String(i).padStart(3, "0")}`,
    bpm: 118 + Math.floor(rnd() * 15),
    camelot: `${1 + Math.floor(rnd() * 12)}${rnd() < 0.5 ? "A" : "B"}`,
    energy: 1 + Math.floor(rnd() * 10),
    updated_at: "2026-01-01T00:00:00.000Z",
  }));
}

const answered = (result: JevResult): JevAnswer => {
  assert.ok(isJevAnswer(result), `esperava resposta, veio ${JSON.stringify(result)}`);
  return result;
};
const failed = (result: JevResult): JevFailure => {
  assert.ok(!isJevAnswer(result), `esperava erro, veio ${JSON.stringify(result)}`);
  return result;
};
const verdict = (type: TransitionType, type_confidence: number): JevAnswer => ({
  type,
  type_confidence,
  score: 3.5,
  score_confidence: 0.6,
  latency_ms: 10,
  model: "jev-1.13.0",
});

const dir = mkdtempSync(join(tmpdir(), "dj-jev-test-"));
try {
  const [a, b] = [at(0), at(1)];
  const rules = plans[0] as (typeof plans)[number];

  // ---------- resposta real: parse (o score vem na escala dos índices, 0–4, e vira 1–5) ----------
  const logPath = join(dir, "jev-calls.jsonl");
  const example = fakeHttp(() => ({ body: REAL_RESPONSE }));
  const jev = createJev({ apiKey: "chave-de-teste", minConfidence: 0.7, http: example.http, logPath });
  assert.equal(jev.available(), true);
  assert.equal(jev.minConfidence, 0.7);
  const first = answered(await jev.askTransition(a, b, rules));
  assert.deepEqual(
    { ...first, latency_ms: 0 },
    { type: "blend", type_confidence: 0.85, score: 4.61, score_confidence: 0.68, latency_ms: 0, model: "jev-1.13.0" },
  );
  assert.ok(first.latency_ms > 0, "latência medida pelo relógio do http");

  // nota fora da faixa é limitada a 1–5; resposta de outro tipo de par sai do mesmo parse
  const edge = (score: number) =>
    fakeHttp(() => ({ body: { ...REAL_RESPONSE, answers: { ...REAL_RESPONSE.answers, pair_score: { ...REAL_RESPONSE.answers.pair_score, score } } } }));
  assert.equal(answered(await createJev({ apiKey: "k", http: edge(4.9).http, logPath }).askTransition(a, b, rules)).score, 5);
  assert.equal(answered(await createJev({ apiKey: "k", http: edge(-0.3).http, logPath }).askTransition(a, b, rules)).score, 1);

  // ---------- a requisição: endpoint, chave no cabeçalho, perguntas e regra 8 (só números) ----------
  const sent = example.sent[0] as Sent;
  assert.equal(sent.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(sent.method, "POST");
  assert.equal(sent.headers.Authorization, "Bearer chave-de-teste");
  assert.equal(sent.headers["Content-Type"], "application/json");
  assert.equal(sent.body.model, "jev-latest");
  assert.deepEqual(Object.keys(sent.body.questions), ["transition_type", "pair_score"]);
  assert.equal(sent.body.questions.transition_type?.type, "choice");
  assert.deepEqual(Object.keys(sent.body.questions.transition_type?.criteria as object), ["blend", "bass_swap", "filter", "echo_out"]);
  assert.equal(sent.body.questions.pair_score?.type, "score");
  assert.equal((sent.body.questions.pair_score?.criteria as string[]).length, 5);
  assert.deepEqual(
    sent.body.questions.pair_score?.criteria,
    Object.values(REAL_RESPONSE.answers.pair_score.legend),
    "os critérios enviados são os que a legend da resposta real ecoa",
  );
  assert.deepEqual(Object.keys(sent.body.state), ["from", "to", "harmonic", "bpm_diff", "bpm_mode", "energy_delta"]);
  assert.deepEqual(sent.body.state.from, { bpm: 124, camelot_number: 8, camelot_letter: "A", energy: 4 });
  assert.deepEqual(sent.body.state.to, { bpm: 125, camelot_number: 9, camelot_letter: "A", energy: 5 });
  assert.deepEqual(sent.body.state.harmonic, { relation: "adjacente +1", class: "segura", score: 0.92 });
  assert.deepEqual([sent.body.state.bpm_diff, sent.body.state.bpm_mode, sent.body.state.energy_delta], [1, "normal", 1]);
  // regra 8: nenhum nome, artista ou ID do Spotify em lugar nenhum do corpo enviado
  const wire = JSON.stringify(sent.body);
  for (const secret of [a.track_id, b.track_id, a.label as string, b.label as string, "Worra", "OMRI", "Adored", "Nothing Wrong"]) {
    assert.ok(!wire.includes(secret), `"${secret}" vazou para o Jev`);
  }
  const leaves = (value: unknown, path = ""): [string, unknown][] =>
    value !== null && typeof value === "object"
      ? Object.entries(value).flatMap(([key, inner]) => leaves(inner, path ? `${path}.${key}` : key))
      : [[path, value]];
  const TEXT_FIELDS = new Set(["from.camelot_letter", "to.camelot_letter", "harmonic.relation", "harmonic.class", "bpm_mode"]);
  for (const [path, value] of leaves(sent.body.state)) {
    assert.ok(typeof value === "number" || value === null || (TEXT_FIELDS.has(path) && typeof value === "string"), `state.${path} não é número`);
  }
  // energia ausente vai como null (nunca inventada)
  const noEnergy = fakeHttp(brain);
  await createJev({ apiKey: "k", http: noEnergy.http, logPath }).askTransition({ ...a, energy: undefined }, b, { ...rules, energy_delta: null });
  assert.equal(noEnergy.sent[0]?.body.state.from.energy, null);
  assert.equal(noEnergy.sent[0]?.body.state.energy_delta, null);

  // ---------- decisão: o Jev vence só com confiança ≥ limiar; comprimento e grave vêm das regras ----------
  const [blendLong, blendShort, bassSwap, echoClash] = plans as [(typeof plans)[number], (typeof plans)[number], (typeof plans)[number], (typeof plans)[number]];
  const same = decideWithJev(blendLong, verdict("blend", 0.9), 0.7);
  assert.deepEqual([same.type, same.length_bars, same.bass_swap_bar, same.source], ["blend", 32, 17, "jev"]);
  assert.deepEqual(same.jev, { type: "blend", type_confidence: 0.9, score: 3.5, score_confidence: 0.6 });
  assert.match(same.reason, /^Jev \(confiança 0\.9\) confirmou blend de 32 compassos, grave troca no compasso 17\.$/);
  assert.deepEqual(same.alerts, blendLong.alerts, "sem divergência, sem alerta novo");

  const toBlend = decideWithJev(bassSwap, verdict("blend", 0.81), 0.7); // segura, ΔBPM 4: blend curto
  assert.deepEqual([toBlend.type, toBlend.length_bars, toBlend.bass_swap_bar, toBlend.source], ["blend", 16, 9, "jev"]);
  assert.match(toBlend.reason, /escolheu blend de 16 compassos, grave troca no compasso 9; as regras sugeriam bass swap\./);
  assert.deepEqual(decideWithJev(bassSwap, verdict("echo_out", 0.8), 0.7).length_bars, 4);
  assert.deepEqual(
    [decideWithJev(bassSwap, verdict("filter", 0.8), 0.7).length_bars, decideWithJev(bassSwap, verdict("filter", 0.8), 0.7).bass_swap_bar],
    [8, null],
  );
  assert.deepEqual(
    [decideWithJev(blendLong, verdict("bass_swap", 0.8), 0.7).length_bars, decideWithJev(blendLong, verdict("bass_swap", 0.8), 0.7).bass_swap_bar],
    [8, 5],
  );
  assert.equal(decideWithJev(blendShort, verdict("blend", 0.8), 0.7).length_bars, 16, "ΔBPM 2: blend curto");

  // Jev contra um par que as regras só aceitam em echo out: vence com confiança alta, mas avisa
  const against = decideWithJev(echoClash, verdict("blend", 0.95), 0.7);
  assert.deepEqual([against.type, against.length_bars, against.source], ["blend", 16, "jev"]);
  assert.match(against.alerts[0] as string, /^as regras só aceitavam echo out/);
  assert.equal(against.alerts.at(-1), "vocal e grave: sem dado (plano por metadados)");

  // confiança baixa: as regras decidem, o palpite do Jev fica registrado e avisado
  const low = decideWithJev(bassSwap, verdict("blend", 0.55), 0.7);
  assert.deepEqual([low.type, low.length_bars, low.bass_swap_bar, low.source], ["bass_swap", 8, 5, "rules"]);
  assert.deepEqual(low.jev, { type: "blend", type_confidence: 0.55, score: 3.5, score_confidence: 0.6 });
  assert.match(low.alerts[0] as string, /^Jev sugeriu blend com confiança 0\.55 \(abaixo de 0\.7\): as regras decidiram$/);
  assert.equal(low.reason, bassSwap.reason);
  assert.equal(decideWithJev(bassSwap, verdict("filter", 0.7), 0.7).source, "jev", "confiança igual ao limiar vence");
  assert.equal(bassSwap.source, undefined, "o plano das regras não é alterado");

  // ---------- sem chave, erro de tom: {error} sem tocar a rede; as regras decidem ----------
  const offline = fakeHttp(() => {
    throw new Error("não devia chamar a rede");
  });
  const off = createJev({ apiKey: "  ", http: offline.http, logPath });
  assert.equal(off.available(), false);
  const noKey = failed(await off.askTransition(a, b, rules));
  assert.match(noKey.error, /TYPESAFE_API_KEY/);
  assert.equal(offline.sent.length, 0, "sem chave não há requisição");
  const viaRules = decideWithJev(rules, noKey, 0.7);
  assert.deepEqual([viaRules.type, viaRules.length_bars, viaRules.source, viaRules.jev], [rules.type, rules.length_bars, "rules", null]);
  assert.equal(viaRules.alerts[0], "Jev indisponível (Sem TYPESAFE_API_KEY: o Jev não foi consultado): as regras decidiram");
  assert.equal(viaRules.alerts.at(-1), "vocal e grave: sem dado (plano por metadados)");
  const badKey = failed(await createJev({ apiKey: "k", http: offline.http, logPath }).askTransition({ ...a, camelot: "??" }, b, rules));
  assert.match(badKey.error, /Tom inválido/);
  assert.equal(offline.sent.length, 0);

  // ---------- falhas: HTTP, limite, timeout, rede, formato → {error}, nunca exceção ----------
  const errLog = join(dir, "erros.jsonl");
  const fail = async (reply: Reply): Promise<JevFailure> =>
    failed(await createJev({ apiKey: "chave-de-teste", http: fakeHttp(() => reply).http, logPath: errLog }).askTransition(a, b, rules));
  const e500 = await fail({ status: 500, body: { detail: "falha interna" } });
  assert.match(e500.error, /HTTP 500.*falha interna/);
  assert.equal(e500.backoff, undefined);
  assert.match((await fail({ status: 401 })).error, /HTTP 401.*TYPESAFE_API_KEY/);
  assert.match((await fail({ status: 422, body: { detail: "criteria inválido" } })).error, /HTTP 422.*criteria/);
  const e429 = await fail({ status: 429, headers: { "Retry-After": "7" } });
  assert.deepEqual([e429.backoff, /Jev.*HTTP 429, Retry-After 7/.test(e429.error)], [true, true]);
  assert.equal((await fail({ status: 529 })).backoff, true, "529 também é backoff");
  assert.match((await fail({ throws: Object.assign(new Error("tempo"), { name: "TimeoutError" }) })).error, /não respondeu/);
  assert.match((await fail({ throws: new TypeError("fetch failed") })).error, /Falha de rede/);
  assert.match((await fail({ body: {} })).error, /fora do formato/);
  const wrongChoice = { ...REAL_RESPONSE, answers: { ...REAL_RESPONSE.answers, transition_type: { ...REAL_RESPONSE.answers.transition_type, choice: "cut" } } };
  assert.match((await fail({ body: wrongChoice })).error, /fora do formato/, "escolha fora dos 4 tipos");
  assert.equal(decideWithJev(rules, e500, 0.7).source, "rules");

  // ---------- log: uma linha por chamada, hash do state, sem chave nem nomes ----------
  await jev.askTransition(a, b, rules); // mesmo par de novo
  await jev.askTransition(at(2), at(3), plans[2] as (typeof plans)[number]); // outro par
  const rows = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  const firstRow = rows[0] as Record<string, unknown>;
  assert.match(String(firstRow.at), /^\d{4}-\d{2}-\d{2}T/);
  assert.match(String(firstRow.state_sha256), /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(firstRow.questions as object), ["transition_type", "pair_score"]);
  assert.deepEqual(firstRow.confidence, { transition_type: 0.85, pair_score: 0.68 }, "a confiança do score é separada da da choice");
  assert.equal(typeof firstRow.latency_ms, "number");
  assert.equal(firstRow.model, "jev-1.13.0");
  assert.deepEqual(firstRow.usage, { input_tokens: 680, output_tokens: 63 });
  assert.equal((firstRow.answers as { transition_type: { choice: string } }).transition_type.choice, "blend");
  assert.ok(!("error" in firstRow));
  // linha 0 = par A→B; as duas últimas = A→B de novo e outro par
  assert.equal(firstRow.state_sha256, rows.at(-2)?.state_sha256, "mesmo par, mesmo hash");
  assert.notEqual(firstRow.state_sha256, rows.at(-1)?.state_sha256, "outro par, outro hash");
  const errRows = readFileSync(errLog, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.equal(errRows.length, 9, "as falhas também entram no log");
  assert.ok(errRows.every((row) => typeof row.error === "string" && row.confidence === null));
  assert.ok(errRows.slice(0, -1).every((row) => row.answers === null && row.usage === null), "sem resposta válida, sem answers nem usage");
  assert.deepEqual(errRows.at(-1)?.usage, { input_tokens: 680, output_tokens: 63 }, "resposta de formato errado ainda traz o uso de tokens");
  // escolha fora dos 4 tipos: o log guarda o que o Jev respondeu, para depurar
  assert.equal((errRows.at(-1)?.answers as { transition_type: { choice: string } }).transition_type.choice, "cut");
  for (const text of [readFileSync(logPath, "utf8"), readFileSync(errLog, "utf8")]) {
    for (const secret of ["chave-de-teste", a.track_id, b.track_id, "Adored", "Worra", "OMRI"]) assert.ok(!text.includes(secret), `"${secret}" no log`);
  }
  // pasta do log inexistente: a resposta segue valendo
  const silent = createJev({ apiKey: "k", http: fakeHttp(brain).http, logPath: join(dir, "nao", "existe", "x.jsonl") });
  assert.ok(isJevAnswer(await silent.askTransition(a, b, rules)));

  // ---------- jev_compare: o Jev contra as regras ----------
  const full = fakeHttp(brain);
  const compared = await compareTransitions(PAIRS, createJev({ apiKey: "k", minConfidence: 0.7, http: full.http, logPath: join(dir, "cmp.jsonl") }));
  assert.equal(compared.calls, 5);
  assert.equal(full.sent.length, 5, "uma chamada por par, em sequência");
  assert.deepEqual(compared.errors, []);
  assert.equal(compared.model, "jev-1.13.0");
  assert.deepEqual(
    compared.pairs.map((p) => [p.from_label, p.rules_type, p.jev_type, p.agree]),
    [
      ["Adored – J. Worra", "blend", "blend", true],
      ["Nothing Wrong – OMRI.", "blend", "blend", true],
      ["Ghost Dance – Brunello", "bass_swap", "filter", false],
      ["Like I Like It – Mau P", "echo_out", "echo_out", true],
      ["Paranoia – JUNTARO", "echo_out", "echo_out", true],
    ],
  );
  assert.deepEqual(compared.pairs.map((p) => p.jev_type_confidence), [0.9, 0.9, 0.5, 0.95, 0.95]);
  assert.deepEqual(compared.pairs.map((p) => p.jev_score), [4.5, 4, 3, 5, 1]);
  assert.deepEqual(compared.pairs.map((p) => p.jev_score_confidence), [0.7, 0.7, 0.7, 0.7, 0.7]);
  PAIRS.forEach(([x, y], i) => {
    const expected = scoreTransition(x, y, { curve: "classic", weights: normalizeWeights(), tFrom: 0.47, tTo: 0.5 }).scores.total;
    assert.equal(compared.pairs[i]?.rules_score, expected, `nota das regras do par ${i + 1}`);
  });
  // correlação conferida por uma implementação independente (definição de Pearson)
  const xs = compared.pairs.map((p) => p.rules_score);
  const ys = compared.pairs.map((p) => p.jev_score);
  const mean = (list: number[]) => list.reduce((sum, value) => sum + value, 0) / list.length;
  const cov = mean(xs.map((x, i) => (x - mean(xs)) * ((ys[i] as number) - mean(ys))));
  const sd = (list: number[]) => Math.sqrt(mean(list.map((value) => (value - mean(list)) ** 2)));
  const expectedR = Math.round((cov / (sd(xs) * sd(ys))) * 100) / 100;
  assert.ok(Number.isFinite(expectedR) && expectedR !== 0, "a nota do Jev varia: a correlação é calculável");
  assert.deepEqual(compared.agreement, { type_pct: 80, confident_pct: 100, score_correlation: expectedR, answered: 5, confident: 4 });

  // 429 na terceira chamada: para o lote e devolve o que já tem
  const limited = fakeHttp((s, n) => (n === 3 ? { status: 429, headers: { "Retry-After": "7" } } : brain(s)));
  const cut = await compareTransitions(PAIRS, createJev({ apiKey: "k", http: limited.http, logPath: join(dir, "lim.jsonl") }));
  assert.equal(cut.calls, 3);
  assert.equal(limited.sent.length, 3, "sem 4ª requisição depois do 429");
  assert.equal(cut.pairs.length, 2);
  assert.match(cut.errors[0] as string, /^Ghost Dance – Brunello → Like I Like It – Mau P: .*HTTP 429/);
  assert.match(cut.errors[1] as string, /Lote interrompido pelo limite ou sobrecarga/);
  assert.deepEqual(cut.agreement, { type_pct: 100, confident_pct: 100, score_correlation: cut.agreement.score_correlation, answered: 2, confident: 2 });
  const overloaded = fakeHttp((s, n) => (n === 2 ? { status: 529 } : brain(s)));
  assert.equal((await compareTransitions(PAIRS, createJev({ apiKey: "k", http: overloaded.http, logPath }))).calls, 2, "529 também para o lote");

  // três falhas seguidas encerram o lote; falha isolada não
  const down = fakeHttp(() => ({ status: 500, body: { detail: "fora do ar" } }));
  const dead = await compareTransitions(PAIRS, createJev({ apiKey: "k", http: down.http, logPath }));
  assert.equal(dead.calls, 3);
  assert.equal(dead.errors.length, 4);
  assert.match(dead.errors[3] as string, /Lote interrompido após 3 falhas seguidas/);
  assert.deepEqual(dead.agreement, { type_pct: null, confident_pct: null, score_correlation: null, answered: 0, confident: 0 });
  const flaky = fakeHttp((s, n) => (n === 2 ? { status: 500 } : brain(s)));
  const flakyRun = await compareTransitions(PAIRS, createJev({ apiKey: "k", http: flaky.http, logPath }));
  assert.deepEqual([flakyRun.calls, flakyRun.pairs.length, flakyRun.errors.length], [5, 4, 1]);

  // ---------- ping: teste de conexão do painel (Sprint 5, Q1); não é decisão de DJ, então não grava log ----------
  const pingLog = join(dir, "ping.jsonl"); // caminho só do ping: se algum dia ele gravar, o arquivo aparece
  const PONG = { model: "jev-1.13.0", answers: { ping: { type: "noul", noul: 0.97 } }, usage: { input_tokens: 25, output_tokens: 20 } };
  const pinged = fakeHttp(() => ({ body: PONG }));
  const pong = await createJev({ apiKey: "chave-de-teste", http: pinged.http, logPath: pingLog }).ping();
  assert.ok(pong.ok, `esperava ok, veio ${JSON.stringify(pong)}`);
  assert.equal(pong.model, "jev-1.13.0");
  assert.ok(pong.latency_ms > 0, "latência medida pelo relógio do http");
  assert.equal(pinged.sent.length, 1);
  const pingSent = pinged.sent[0] as Sent;
  assert.deepEqual(
    [pingSent.url, pingSent.method, pingSent.headers.Authorization, pingSent.body.model],
    ["https://api.typesafe.ai/v1/systemone", "POST", "Bearer chave-de-teste", "jev-latest"],
  );
  assert.deepEqual(pingSent.body.state, { ping: true });
  // formato da doc da TypeSafe (docs.typesafe.ai/api): uma pergunta noul só com type e instructions
  assert.deepEqual(pingSent.body.questions, { ping: { type: "noul", instructions: "O state é um teste de conexão?" } });
  assert.equal(existsSync(pingLog), false, "o ping não grava em jev-calls.jsonl");
  // HTTP 200 = conectado, mesmo com corpo fora do esperado; o modelo cai no nome da requisição
  const bare = await createJev({ apiKey: "k", http: fakeHttp(() => ({ body: {} })).http, logPath: pingLog }).ping();
  assert.ok(bare.ok);
  assert.equal(bare.model, "jev-latest");
  // sem chave: nenhuma requisição e o erro curto que o painel espera
  const noKeyPing = await createJev({ apiKey: "  ", http: offline.http, logPath: pingLog }).ping();
  assert.deepEqual(noKeyPing, { ok: false, error: "sem chave" });
  assert.equal(offline.sent.length, 0, "sem chave não há requisição");
  // falhas viram { ok: false }, nunca exceção: chave recusada, pergunta inválida (422), limite, timeout de 5 s, rede
  const pingDown = async (reply: Reply, error: RegExp): Promise<void> => {
    const result = await createJev({ apiKey: "k", http: fakeHttp(() => reply).http, logPath: pingLog }).ping();
    assert.ok(!result.ok, `esperava falha, veio ${JSON.stringify(result)}`);
    assert.match(result.error, error);
  };
  await pingDown({ status: 401 }, /HTTP 401.*TYPESAFE_API_KEY/);
  await pingDown({ status: 422, body: { detail: "pergunta inválida" } }, /HTTP 422.*pergunta inválida/);
  await pingDown({ status: 429, headers: { "Retry-After": "7" } }, /Limite de requisições do Jev.*HTTP 429/);
  await pingDown({ throws: Object.assign(new Error("tempo"), { name: "TimeoutError" }) }, /não respondeu em 5 s/);
  await pingDown({ throws: new TypeError("fetch failed") }, /Falha de rede/);
  assert.equal(existsSync(pingLog), false, "nem o ping com falha grava log");

  // ---------- funções puras ----------
  assert.equal(pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1);
  assert.equal(pearson([1, 2, 3, 4], [8, 6, 4, 2]), -1);
  assert.equal(pearson([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]), 0.8);
  assert.equal(pearson([1, 1, 1], [1, 2, 3]), null, "sem variação");
  assert.equal(pearson([1], [1]), null, "um ponto só");
  assert.deepEqual(agreementOf([], 0.7), { type_pct: null, confident_pct: null, score_correlation: null, answered: 0, confident: 0 });
  // confiante = confiança ≥ limiar (igual conta); percentuais com uma casa
  const pair = (confidence: number, agree: boolean): ComparedPair => ({
    from_label: "A",
    to_label: "B",
    rules_type: "blend",
    jev_type: agree ? "blend" : "filter",
    jev_type_confidence: confidence,
    rules_score: 0.5,
    jev_score: 3,
    jev_score_confidence: 0.5,
    agree,
  });
  assert.deepEqual(agreementOf([pair(0.7, true), pair(0.69, false), pair(0.9, false)], 0.7), {
    type_pct: 33.3,
    confident_pct: 50,
    score_correlation: null,
    answered: 3,
    confident: 2,
  });
  for (const bad of [undefined, "", " ", "abc", "0", "-0.5", "1.5", "NaN"]) assert.equal(minConfidenceFromEnv(bad), 0.7, `"${bad}" → padrão`);
  assert.deepEqual([minConfidenceFromEnv("0.85"), minConfidenceFromEnv("1"), minConfidenceFromEnv(" 0.5 ")], [0.85, 1, 0.5]);

  // ambiente: chave e limiar; vazio = sem chave (o teste restaura o ambiente original)
  const saved = { key: process.env.TYPESAFE_API_KEY, min: process.env.JEV_MIN_CONFIDENCE };
  try {
    process.env.TYPESAFE_API_KEY = "abc";
    process.env.JEV_MIN_CONFIDENCE = "0.85";
    const fromEnv = jevFromEnv(dir, fakeHttp(brain).http);
    assert.deepEqual([fromEnv.available(), fromEnv.minConfidence], [true, 0.85]);
    // ping() do módulo (o que o servidor do painel chama): chave do ambiente, ou a passada; sempre com http falso
    const envPing = fakeHttp(() => ({ body: PONG }));
    assert.ok((await ping(envPing.http)).ok);
    assert.ok((await ping(envPing.http, "explicita")).ok);
    assert.deepEqual(envPing.sent.map((s) => s.headers.Authorization), ["Bearer abc", "Bearer explicita"]);
    // o Jev criado sem chave não herda a do ambiente (só o ping() do módulo, sem argumento, lê o ambiente)
    const keyless = createJev({ http: offline.http, logPath: pingLog });
    assert.deepEqual(await keyless.ping(), { ok: false, error: "sem chave" });
    process.env.TYPESAFE_API_KEY = "";
    delete process.env.JEV_MIN_CONFIDENCE;
    const empty = jevFromEnv(dir, fakeHttp(brain).http);
    assert.deepEqual([empty.available(), empty.minConfidence], [false, 0.7]);
    assert.deepEqual(await ping(offline.http), { ok: false, error: "sem chave" });
    assert.deepEqual(await empty.ping(), { ok: false, error: "sem chave" });
    assert.equal(offline.sent.length, 0, "sem chave não há requisição");
  } finally {
    for (const [name, value] of [["TYPESAFE_API_KEY", saved.key], ["JEV_MIN_CONFIDENCE", saved.min]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  // ---------- ordem com o Jev (P16): o Jev escolhe entre as candidatas das regras, passo a passo ----------
  const optsT: BuildOptions = { curve: "classic" };
  const idsOf = (r: { order: { track_id: string }[] }): string[] => r.order.map((p) => p.track_id);
  const printOf = (t: TrackAnalysis): string => `${t.bpm}|${t.camelot}|${t.energy}`;
  const printSide = (s: Side): string => `${s.bpm}|${s.camelot_number}${s.camelot_letter}|${s.energy}`;
  /** O state só tem números: a faixa de uma candidata se acha pelos números (as fixtures não repetem BPM, tom e energia). */
  const trackOf = (tracks: TrackAnalysis[], s: Side): TrackAnalysis => {
    const found = tracks.filter((t) => printOf(t) === printSide(s));
    assert.equal(found.length, 1, `faixa de ${printSide(s)} única na fixture`);
    return found[0] as TrackAnalysis;
  };
  let orderLogs = 0;
  const runOrder = async (respond: (sent: Sent, n: number) => Reply, tracks: TrackAnalysis[] = T, opts: BuildOptions = optsT) => {
    const fake = fakeHttp(respond);
    const logFile = join(dir, `ordem-${(orderLogs += 1)}.jsonl`);
    const jevForOrder = createJev({ apiKey: "chave-de-teste", minConfidence: 0.7, http: fake.http, logPath: logFile });
    const out = await buildSetWithJev(tracks, opts, buildSet(tracks, opts), jevForOrder);
    return { ...out, sent: fake.sent, logFile };
  };
  const stateAt = (sentList: Sent[], i: number): NextState => nextOf(sentList[i] as Sent);
  const jevInfo = (r: SetResult): Extract<JevSetInfo, { used: true }> => {
    assert.ok(r.jev?.used, `esperava jev.used, veio ${JSON.stringify(r.jev)}`);
    return r.jev as Extract<JevSetInfo, { used: true }>;
  };
  const TEXT_LEAVES = new Set(["camelot_letter", "relation", "class", "bpm_mode"]);
  /** Regra 8 em TODOS os corpos enviados (state e perguntas): nenhum ID, rótulo ou nome; no state, só números, null e os rótulos do planejador. */
  const assertRule8 = (sentList: Sent[], tracks: TrackAnalysis[]): void => {
    assert.ok(sentList.length > 0);
    for (const one of sentList) {
      const wire = JSON.stringify(one.body);
      for (const secret of [...tracks.flatMap((t) => [t.track_id, t.label as string]), "Worra", "OMRI", "Brunello", "Mau P", "JUNTARO", "chave-de-teste"]) {
        assert.ok(!wire.includes(secret), `"${secret}" vazou para o Jev`);
      }
      for (const [path, value] of leaves(one.body.state)) {
        const field = path.split(".").pop() as string;
        assert.ok(typeof value === "number" || value === null || (TEXT_LEAVES.has(field) && typeof value === "string"), `state.${path} não é número`);
      }
    }
  };
  /** Reescreve a regra das candidatas para conferir o que foi enviado: nota do par na posição (curva clássica, N = total), desempate pelo índice. */
  const rankFrom = (from: TrackAnalysis, candidates: TrackAnalysis[], position: number, total: number): TrackAnalysis[] =>
    candidates
      .map((t, i) => ({
        t,
        i,
        score: scoreTransition(from, t, { curve: "classic", weights: normalizeWeights(), tFrom: (position - 1) / (total - 1), tTo: position / (total - 1) }).scores.total,
      }))
      .sort((x, y) => y.score - x.score || x.i - y.i)
      .map((x) => x.t);

  const beamT = buildSet(T, optsT);
  const greedy = await runOrder(orderBrain(() => [1, 0.9])); // a cadeia da candidata 1 (gulosa), referência dos próximos cenários
  const greedyIds = idsOf(greedy.result);

  // 1) o Jev escolhe a candidata 2 no passo 2 (confiança alta) e a 1 nos demais
  const run1 = await runOrder(orderBrain((state) => [state.position === 2 ? 2 : 1, 0.9]));
  const { sent: s1, result: r1, answers: a1 } = run1;
  assert.deepEqual(Object.keys((s1[0] as Sent).body.questions), ["next_track"], "abertura: só a escolha, sem passagem");
  assert.deepEqual(Object.keys(stateAt(s1, 0)), ["position", "total", "target_energy", "current", "candidates"]);
  assert.deepEqual([stateAt(s1, 0).position, stateAt(s1, 0).total, stateAt(s1, 0).target_energy, stateAt(s1, 0).current], [1, 6, 4, null]);
  const openCands = stateAt(s1, 0).candidates;
  assert.deepEqual(Object.keys(openCands), ["1", "2", "3", "4", "5"], "K = 5 candidatas, com as mesmas chaves do choice");
  assert.deepEqual(Object.values(openCands).map(printSide), [0, 1, 5, 2, 4].map((i) => printOf(at(i))), "startFit (energia perto do alvo 4), empate pelo índice, sem a de energia 8");
  assert.deepEqual(Object.values(openCands).map((c) => c.rules_score), [1, 0.8, 0.8, 0.6, 0.4]);
  assert.ok(Object.values(openCands).every((c) => c.harmonic === null && c.bpm_diff === null && c.bpm_mode === null && c.energy_delta === null), "na abertura não há relação com a faixa atual");
  const openQuestion = (s1[0] as Sent).body.questions.next_track;
  assert.equal(openQuestion?.type, "choice");
  assert.deepEqual(Object.keys(openQuestion?.criteria as object), ["1", "2", "3", "4", "5"]);

  const second = stateAt(s1, 1);
  assert.deepEqual([second.position, second.total, second.target_energy], [2, 6, Math.round(targetEnergy("classic", 0.2) * 10) / 10]);
  assert.equal(printSide(second.current as Side), printOf(at(0)), "o Jev escolheu a candidata 1 da abertura");
  assert.deepEqual(
    Object.values(second.candidates).map(printSide),
    rankFrom(at(0), T.slice(1), 1, 6).map(printOf),
    "candidatas = as melhores pela nota do par na posição (alvo da curva), a das regras primeiro",
  );
  const secondScores = Object.values(second.candidates).map((c) => c.rules_score);
  assert.deepEqual(secondScores, [...secondScores].sort((x, y) => y - x), "a candidata 1 tem a maior nota das regras");
  const best = second.candidates["1"] as Cand;
  const bestPlan = planTransition(at(0), trackOf(T, best));
  assert.deepEqual([best.harmonic?.relation, best.harmonic?.class, best.bpm_diff, best.bpm_mode], [bestPlan.harmonic.relation, bestPlan.harmonic.class, bestPlan.tempo.diff, bestPlan.tempo.mode]);
  assert.equal(best.energy_delta, bestPlan.energy_delta);

  const third = stateAt(s1, 2);
  assert.deepEqual(Object.keys((s1[2] as Sent).body.questions), ["next_track", "transition_type", "pair_score"], "a passagem anterior vai na mesma chamada");
  assert.deepEqual(Object.keys(third.passage as State), ["from", "to", "harmonic", "bpm_diff", "bpm_mode", "energy_delta"], "state.passage = o state de askTransition");
  assert.equal(printSide((third.passage as State).from), printOf(at(0)));
  assert.equal(printSide((third.passage as State).to), printSide(third.current as Side));
  const passageQuestions = (s1[2] as Sent).body.questions;
  assert.match(passageQuestions.transition_type?.instructions as string, /state\.passage/);
  assert.match(passageQuestions.pair_score?.instructions as string, /state\.passage/);
  assert.deepEqual(passageQuestions.transition_type?.criteria, (sent.body.questions.transition_type as { criteria: unknown }).criteria, "mesmos critérios das perguntas de par");
  assert.deepEqual(passageQuestions.pair_score?.criteria, (sent.body.questions.pair_score as { criteria: unknown }).criteria);

  const ids1 = idsOf(r1);
  assert.equal(ids1[1], trackOf(T, second.candidates["2"] as Cand).track_id, "a escolha do Jev (candidata 2) valeu");
  assert.notEqual(ids1[1], trackOf(T, second.candidates["1"] as Cand).track_id);
  assert.equal(printSide(third.current as Side), printOf(trackOf(T, second.candidates["2"] as Cand)), "e é a faixa atual do passo seguinte");
  assert.notDeepEqual(ids1, greedyIds, "ordem diferente da cadeia das regras");
  assert.notDeepEqual(ids1, idsOf(beamT));
  assert.deepEqual([...ids1].sort(), T.map((t) => t.track_id).sort(), "todas as faixas, sem repetir");
  assert.deepEqual(r1.order.map((p) => p.position), [1, 2, 3, 4, 5, 6]);
  assert.equal(r1.transitions.length, 5);
  const info1 = jevInfo(r1);
  assert.equal(typeof info1.latency_ms, "number");
  assert.deepEqual({ ...info1, latency_ms: 0 }, { used: true, chosen: 5, fallback: 0, calls: 7, errors: 0, latency_ms: 0, rules_average_score: beamT.average_score });
  assert.equal(s1.length, 7, "5 escolhas (a última posição só tem uma faixa) e 2 passagens que nenhuma escolha levou");
  assert.equal(a1.size, 5, "as 5 passagens têm resposta");
  ids1.slice(0, -1).forEach((from, i) => assert.ok(a1.has(passKey(from, ids1[i + 1] as string)), `passagem ${i + 1} respondida`));
  assertRule8(s1, T);
  assert.deepEqual(idsOf((await runOrder(orderBrain((state) => [state.position === 2 ? 2 : 1, 0.9]))).result), ids1, "determinístico");

  // log: uma linha por chamada; as de escolha levam kind next_track, as de par seguem sem kind
  const rows1 = readFileSync(run1.logFile, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual(rows1.map((row) => row.kind), ["next_track", "next_track", "next_track", "next_track", "next_track", undefined, undefined]);
  assert.deepEqual(rows1[0]?.confidence, { next_track: 0.9 });
  assert.deepEqual(Object.keys(rows1[2]?.confidence as object), ["next_track", "transition_type", "pair_score"]);
  assert.match(String(rows1[0]?.state_sha256), /^[0-9a-f]{64}$/);
  assert.equal((rows1[0]?.answers as { next_track: { choice: string } }).next_track.choice, "1");
  assert.deepEqual(Object.keys(rows1[0]?.questions as object), ["next_track"]);
  assert.ok(rows1.every((row) => typeof row.latency_ms === "number" && row.model === "jev-1.13.0" && !("error" in row)));
  const text1 = readFileSync(run1.logFile, "utf8");
  for (const secret of ["chave-de-teste", ...T.flatMap((t) => [t.track_id, t.label as string])]) assert.ok(!text1.includes(secret), `"${secret}" no log da ordem`);

  // 2) confiança baixa = candidata 1: a ordem é a da cadeia gulosa e o passo conta como regras
  const run2 = await runOrder(orderBrain((state) => (state.position === 2 ? [2, 0.5] : [1, 0.9])));
  assert.deepEqual(idsOf(run2.result), greedyIds);
  const info2 = jevInfo(run2.result);
  assert.deepEqual([info2.chosen, info2.fallback, info2.errors, info2.calls], [4, 1, 0, 7]);
  assert.equal(info2.chosen + info2.fallback, 5, "chosen + fallback = passos com escolha");
  assert.equal(jevInfo((await runOrder(orderBrain((state) => (state.position === 2 ? [2, 0.7] : [1, 0.9])))).result).chosen, 5, "confiança igual ao limiar vale");

  // 3) o Jev não decide nenhum passo: vale o feixe das regras (a cadeia gulosa é mais fraca) e o Jev ainda decide as passagens dele
  const PB = pool(7, 1);
  const beamPB = buildSet(PB, optsT);
  const greedyPB = await runOrder(orderBrain(() => [1, 0.9]), PB);
  assert.notDeepEqual(idsOf(greedyPB.result), idsOf(beamPB), "fixture: a cadeia gulosa difere do feixe");
  assert.ok(greedyPB.result.average_score < beamPB.average_score, "e é mais fraca: por isso o feixe vale quando o Jev não decide");
  const run3 = await runOrder(orderBrain(() => [2, 0.3]), PB);
  assert.deepEqual(idsOf(run3.result), idsOf(beamPB));
  const info3 = jevInfo(run3.result);
  assert.deepEqual([info3.chosen, info3.fallback, info3.errors, run3.sent.filter(isChoice).length], [0, 6, 0, 6]);
  assert.equal(info3.calls, run3.sent.length);
  assert.equal(info3.rules_average_score, run3.result.average_score);
  const beamIds = idsOf(beamPB);
  beamIds.slice(0, -1).forEach((from, i) => assert.ok(run3.answers.has(passKey(from, beamIds[i + 1] as string)), `passagem ${i + 1} do feixe respondida`));
  assert.ok(run3.result.warnings.some((w) => /^O Jev não decidiu nenhum passo \(confiança abaixo de 0\.7 ou falha\)/.test(w)));

  // 4) rate limit (429) é erro: o passo vai para a candidata 1, conta em errors e a chamada seguinte continua
  const alwaysSecond = orderBrain(() => [2, 0.9]);
  const run4 = await runOrder((s, n) => (n === 2 ? { status: 429, headers: { "Retry-After": "7" } } : alwaysSecond(s, n)));
  const info4 = jevInfo(run4.result);
  assert.deepEqual([info4.chosen, info4.fallback, info4.errors, info4.calls, run4.sent.length], [4, 1, 1, 7, 7]);
  assert.ok(run4.result.warnings.some((w) => /^Jev: 1 de 7 chamada\(s\) falharam \(.*HTTP 429.*\); esses passos seguiram pelas regras\.$/.test(w)), run4.result.warnings.join(" | "));
  assert.equal(idsOf(run4.result)[1], trackOf(T, stateAt(run4.sent, 1).candidates["1"] as Cand).track_id, "o passo da chamada 2 ficou com a candidata 1");

  // 5) três erros seguidos: o resto segue pelas regras sem chamar, com aviso
  const run5 = await runOrder((s, n) => (n >= 2 && n <= 4 ? { status: 500, body: { detail: "fora do ar" } } : alwaysSecond(s, n)));
  const info5 = jevInfo(run5.result);
  assert.deepEqual([info5.chosen, info5.fallback, info5.errors, info5.calls, run5.sent.length], [1, 4, 3, 4, 4], "sem 5ª chamada");
  assert.ok(run5.result.warnings.some((w) => /^Jev parou após 3 falhas seguidas: o resto do set seguiu pelas regras, sem consultá-lo\.$/.test(w)));
  assert.ok(run5.result.warnings.some((w) => /^Jev: 3 de 4 chamada\(s\) falharam/.test(w)));
  assert.equal(run5.answers.size, 0, "as passagens não perguntadas ficam sem resposta");
  assert.equal(idsOf(run5.result)[0], trackOf(T, stateAt(run5.sent, 0).candidates["2"] as Cand).track_id, "a abertura veio do Jev (1ª chamada)");
  assert.equal(run5.result.order.length, 6);

  // 6) abertura e fechamento fixos: sem chamada para a posição fixa; o fechamento nunca é candidata antes da última
  const optsFixed: BuildOptions = { curve: "classic", startTrackId: at(0).track_id, endTrackId: at(5).track_id };
  const run6 = await runOrder(alwaysSecond, T, optsFixed);
  const ids6 = idsOf(run6.result);
  assert.deepEqual([ids6[0], ids6[5]], [at(0).track_id, at(5).track_id]);
  assert.equal(stateAt(run6.sent, 0).position, 2, "abertura fixa: a 1ª chamada já é a posição 2");
  assert.equal(printSide(stateAt(run6.sent, 0).current as Side), printOf(at(0)));
  assert.equal(Object.keys(stateAt(run6.sent, 0).candidates).length, 4, "4 candidatas: sem a abertura nem o fechamento");
  assert.ok(run6.sent.filter(isChoice).every((s) => !Object.values(nextOf(s).candidates).some((c) => printSide(c) === printOf(at(5)))));
  const info6 = jevInfo(run6.result);
  assert.deepEqual([info6.chosen + info6.fallback, info6.calls, run6.sent.length], [3, 6, 6], "3 posições com escolha; as passagens restantes saem em chamadas de par");
  assertRule8(run6.sent, T);

  // 7) seleção por quantidade (P10): N posições escolhidas entre as 12 faixas, com as mesmas anotações do feixe
  const P12 = pool(12, 5);
  assert.equal(new Set(P12.map(printOf)).size, 12, "fixture: BPM, tom e energia únicos");
  const optsSel: BuildOptions = { curve: "classic", maxTracks: 6, durations: new Map(P12.map((t) => [t.track_id, 240_000])) };
  const run7 = await runOrder(orderBrain(() => [1, 0.9]), P12, optsSel);
  assert.deepEqual([run7.result.order.length, run7.result.pool_size, run7.result.duration_ms], [6, 12, 6 * 240_000]);
  assert.ok(run7.result.warnings.includes("Selecionadas 6 de 12 faixas analisadas (~24 min)"), run7.result.warnings.join(" | "));
  const info7 = jevInfo(run7.result);
  assert.deepEqual([info7.chosen, info7.fallback, info7.calls, run7.sent.length], [6, 0, 7, 7]);
  assert.equal(new Set(idsOf(run7.result)).size, 6);
  assertRule8(run7.sent, P12);

  // 8) corte da duração (P13) antes da última chamada: só contam os passos que ficaram e nenhuma chamada de par sobra
  const durationByEnergy = new Map(P12.map((t) => [t.track_id, 90_000 * (t.energy as number)])); // a curva escolhe faixas mais longas que a média do pool
  const meanMs = [...durationByEnergy.values()].reduce((sum, ms) => sum + ms, 0) / 12;
  const wanted8 = Math.round((40 * 60_000) / meanMs);
  const run8 = await runOrder(orderBrain(() => [1, 0.9]), P12, { curve: "classic", targetDurationMs: 40 * 60_000, durations: durationByEnergy });
  const ids8 = idsOf(run8.result);
  assert.ok(ids8.length >= 2 && ids8.length < wanted8, `o cenário pede corte (ficou com ${ids8.length} de ${wanted8})`);
  assert.ok(run8.result.warnings.some((w) => /^Ajustado para \d+ min \(alvo 40\)$/.test(w)), run8.result.warnings.join(" | "));
  const info8 = jevInfo(run8.result);
  assert.deepEqual([info8.chosen + info8.fallback, info8.calls, run8.sent.length], [ids8.length, wanted8, wanted8], "N escolhas, nenhuma chamada de par: as passagens do prefixo já iam nas escolhas");
  ids8.slice(0, -1).forEach((from, i) => assert.ok(run8.answers.has(passKey(from, ids8[i + 1] as string)), `passagem ${i + 1} do prefixo respondida`));

  // 9) passagem malformada dentro da escolha não derruba o passo; só as chamadas de par levam resposta
  const run9 = await runOrder((s) =>
    isChoice(s)
      ? { body: { model: "jev-1.13.0", answers: { next_track: { type: "choice", choice: "1", confidence: 0.9 }, transition_type: { type: "choice", choice: "blend", confidence: 0.9 } } } }
      : brain(s),
  );
  const info9 = jevInfo(run9.result);
  assert.deepEqual([info9.chosen, info9.fallback, info9.errors, run9.answers.size], [5, 0, 0, 2]);

  // 10) a mesma fadiga do feixe: a 3ª faixa seguida com energia 9+ perde 0,18 na nota das regras que vai para o Jev
  const hot = (n: number, camelot: string, bpm: number, energy: number): TrackAnalysis => ({
    track_id: `hot${String(n).padStart(19, "0")}`,
    label: `H${n}`,
    bpm,
    camelot,
    energy,
    updated_at: "2026-01-01T00:00:00Z",
  });
  const FH = [hot(0, "8A", 124, 4), hot(1, "8A", 125, 9), hot(2, "9A", 125, 10), hot(3, "9A", 126, 9), hot(4, "10A", 126, 10), hot(5, "10A", 127, 9), hot(6, "7A", 123, 10)];
  const run10 = await runOrder(orderBrain(() => [1, 0.9]), FH);
  const ids10 = idsOf(run10.result);
  const energyAt = (i: number): number => FH.find((t) => t.track_id === ids10[i])?.energy ?? 0;
  assert.deepEqual([energyAt(0), energyAt(1) >= 9, energyAt(2) >= 9], [4, true, true], "abertura baixa e depois duas faixas seguidas com energia 9+");
  const score2 = (from: TrackAnalysis, to: TrackAnalysis, position: number): number =>
    scoreTransition(from, to, { curve: "classic", weights: normalizeWeights(), tFrom: (position - 1) / 6, tTo: position / 6 }).scores.total;
  const hundredth = (value: number): number => Math.round(value * 100) / 100;
  const noFatigue = stateAt(run10.sent, 2); // posição 3: a candidata seria a 2ª seguida
  for (const cand of Object.values(noFatigue.candidates)) {
    assert.equal(cand.rules_score, hundredth(score2(trackOf(FH, noFatigue.current as Side), trackOf(FH, cand), 2)), "2 seguidas: sem fadiga");
  }
  const fatigued = stateAt(run10.sent, 3); // posição 4: a candidata seria a 3ª seguida
  for (const cand of Object.values(fatigued.candidates)) {
    assert.equal(cand.rules_score, hundredth(Math.max(0, score2(trackOf(FH, fatigued.current as Side), trackOf(FH, cand), 3) - 0.18)), "3 seguidas: menos 0,18");
  }

  // 11) set longo (tamanho pulado = playlist inteira, 150 faixas): o Jev escolhe TODOS os passos, sem teto de chamadas, em tempo razoável
  const P150 = pool(150, 7);
  const steps150 = 149; // a 150ª posição só tem uma faixa: sem escolha
  const lowSteps = Array.from({ length: steps150 }, (_, i) => i + 1).filter((position) => position % 3 === 0).length; // 49
  const mixedBrain = orderBrain((state) => (state.position % 3 === 0 ? [2, 0.4] : state.position % 7 === 0 ? [2, 0.9] : [1, 0.9]));
  const started150 = Date.now();
  const run150 = await runOrder(mixedBrain, P150);
  const elapsed150 = Date.now() - started150;
  const info150 = jevInfo(run150.result);
  assert.deepEqual([info150.chosen, info150.fallback, info150.errors], [steps150 - lowSteps, lowSteps, 0], "múltiplos de 3 com confiança baixa viram regras; o resto é do Jev");
  assert.deepEqual([info150.calls, run150.sent.length], [151, 151], "N + 1 chamadas sem teto: 149 escolhas e as 2 passagens que nenhuma escolha levou");
  const ids150 = idsOf(run150.result);
  assert.equal(new Set(ids150).size, 150, "150 faixas, sem repetir");
  assert.equal(run150.answers.size, 149, "as 149 passagens têm resposta");
  assert.ok(run150.sent.filter(isChoice).slice(0, -3).every((s) => Object.keys(nextOf(s).candidates).length === 5), "5 candidatas em quase todas as escolhas");
  assert.deepEqual(
    run150.sent.filter(isChoice).slice(-3).map((s) => Object.keys(nextOf(s).candidates).length),
    [4, 3, 2],
    "no fim do pool as candidatas diminuem: 4, 3 e 2 (a última posição não tem escolha)",
  );
  assert.ok(elapsed150 < 30_000, `150 faixas com http falso levaram ${elapsed150} ms`);
  console.log(`[ok] jev, set longo: 150 faixas, ${info150.calls} chamadas com http falso em ${elapsed150} ms (chosen ${info150.chosen}, fallback ${info150.fallback})`);

  // o disjuntor também vale no set longo: 3 erros seguidos nas chamadas 10 a 12 e as outras 137 escolhas seguem pelas regras sem chamar
  const firstBrain = orderBrain(() => [1, 0.9]);
  const run150Down = await runOrder((s, n) => (n >= 10 && n <= 12 ? { status: 500, body: { detail: "fora do ar" } } : firstBrain(s, n)), P150);
  const down150 = jevInfo(run150Down.result);
  assert.deepEqual([run150Down.sent.length, down150.calls, down150.errors], [12, 12, 3], "sem 13ª chamada");
  assert.deepEqual([down150.chosen, down150.fallback], [9, steps150 - 9], "9 escolhas do Jev; as outras 140 pelas regras, as com falha e as sem chamada");
  assert.equal(new Set(idsOf(run150Down.result)).size, 150);
  assert.ok(run150Down.result.warnings.some((w) => /^Jev parou após 3 falhas seguidas/.test(w)));

  // askNext direto: formato da resposta, k = 2 a 5, abertura x passo seguinte e erros sem tocar a rede
  const step5: NextStep = { position: 1, total: 6, target_energy: 4, current: null, candidates: [0, 1, 5, 2, 4].map((i) => ({ track: at(i), rules_score: 0.5 })) };
  const nextBody = (choice: string, confidence?: number): Reply => ({
    body: { model: "jev-1.13.0", answers: { next_track: { type: "choice", choice, ...(confidence === undefined ? {} : { confidence }) } } },
  });
  const direct = (reply: Reply, step: NextStep = step5) => createJev({ apiKey: "k", http: fakeHttp(() => reply).http, logPath: join(dir, "direto.jsonl") }).askNext(step);
  const good = await direct(nextBody("3", 0.8));
  assert.ok(isNextAnswer(good));
  assert.deepEqual({ ...good, latency_ms: 0 }, { choice: 3, confidence: 0.8, pass: null, latency_ms: 0, model: "jev-1.13.0" });
  for (const bad of [nextBody("6", 0.9), nextBody("0", 0.9), nextBody("três", 0.9), nextBody("3"), { body: {} }]) {
    const result = await direct(bad);
    assert.ok(!isNextAnswer(result) && /fora do formato.*next_track/.test(result.error), JSON.stringify(result));
  }
  const two = fakeHttp(() => nextBody("2", 0.9));
  const twoStep: NextStep = { ...step5, current: at(0), candidates: step5.candidates.slice(0, 2) };
  await createJev({ apiKey: "k", http: two.http, logPath: join(dir, "direto.jsonl") }).askNext(twoStep);
  await createJev({ apiKey: "k", http: two.http, logPath: join(dir, "direto.jsonl") }).askNext(step5);
  assert.deepEqual(Object.keys((two.sent[0] as Sent).body.questions.next_track?.criteria as object), ["1", "2"], "k = 2: só as chaves enviadas valem");
  assert.notEqual((two.sent[0] as Sent).body.questions.next_track?.instructions, (two.sent[1] as Sent).body.questions.next_track?.instructions, "abertura e passo seguinte têm enunciados diferentes");
  assert.deepEqual(Object.keys(nextOf(two.sent[0] as Sent).candidates), ["1", "2"]);
  const noNet = fakeHttp(() => {
    throw new Error("não devia chamar a rede");
  });
  const jevNoNet = (apiKey: string) => createJev({ apiKey, http: noNet.http, logPath: join(dir, "direto.jsonl") });
  const refused = async (result: Promise<unknown>, error: RegExp): Promise<void> => {
    const r = (await result) as JevFailure;
    assert.ok("error" in r && error.test(r.error), JSON.stringify(r));
  };
  await refused(jevNoNet(" ").askNext(step5), /TYPESAFE_API_KEY/);
  await refused(jevNoNet("k").askNext({ ...step5, candidates: step5.candidates.slice(0, 1) }), /2 candidatas ou mais/);
  await refused(jevNoNet("k").askNext({ ...step5, candidates: [{ track: { ...at(0), camelot: "??" }, rules_score: 0.5 }, ...step5.candidates.slice(1)] }), /Tom inválido/);
  assert.equal(noNet.sent.length, 0, "nenhuma dessas chamadas toca a rede");
  assert.match(((await direct({ status: 500, body: { detail: "falha interna" } })) as JevFailure).error, /HTTP 500.*falha interna/);

  // passagens no resultado: attachPlans usa decideWithJev quando há resposta (alta ou baixa confiança); sem resposta, o plano das regras como hoje
  const key = (i: number): string => passKey((r1.transitions[i] as { from_id: string }).from_id, (r1.transitions[i] as { to_id: string }).to_id);
  const withPlans = (answers: Map<string, JevAnswer>): SetResult => {
    const copy = { ...r1, plans: undefined } as SetResult;
    attachPlans(copy, T, { answers, minConfidence: 0.7 });
    return copy;
  };
  const all = withPlans(a1);
  assert.equal(all.plans?.length, 5);
  assert.ok(all.plans?.every((plan) => (plan.source === "jev" || plan.source === "rules") && plan.jev), "toda passagem respondida passa por decideWithJev");
  const manual = withPlans(new Map<string, JevAnswer>([[key(0), verdict("filter", 0.5)], [key(1), verdict("echo_out", 0.95)]]));
  const [lowPlan, highPlan, plainPlan] = manual.plans as [NonNullable<SetResult["plans"]>[number], NonNullable<SetResult["plans"]>[number], NonNullable<SetResult["plans"]>[number]];
  assert.deepEqual([lowPlan.source, lowPlan.jev?.type], ["rules", "filter"], "confiança baixa: as regras decidem e o palpite fica registrado");
  assert.deepEqual([highPlan.source, highPlan.type, highPlan.length_bars], ["jev", "echo_out", 4]);
  assert.deepEqual([plainPlan.source, plainPlan.jev], [undefined, undefined], "sem resposta: o plano das regras, sem campos do Jev");
  const legacyPlans = { ...r1, plans: undefined } as SetResult;
  attachPlans(legacyPlans, T);
  assert.ok(legacyPlans.plans?.every((plan) => plan.source === undefined && plan.jev === undefined), "sem Jev (dj_evaluate_order) nada muda");

  // markdown: uma linha do Jev logo abaixo do título, só quando o Jev ordenou
  const lines1 = setToMarkdown(r1).split("\n");
  assert.match(lines1[0] as string, /^# Set proposto · 6 faixas · curva "classic" · nota média /);
  assert.match(lines1[1] as string, /^Jev: escolheu 5 de 5 passos \(0 pelas regras\) · só regras: nota \d(,\d+)?$/);
  assert.equal(lines1[2], "");
  const sample: SetResult = { ...r1, jev: { used: true, chosen: 7, fallback: 2, calls: 10, errors: 0, latency_ms: 3500, rules_average_score: 0.84 } };
  assert.equal(setToMarkdown(sample).split("\n")[1], "Jev: escolheu 7 de 9 passos (2 pelas regras) · só regras: nota 0,84");
  assert.ok(!/^Jev:/m.test(setToMarkdown({ ...r1, jev: { used: false, reason: "sem TYPESAFE_API_KEY" } })), "Jev não usado: sem linha");
  assert.ok(!/^Jev:/m.test(setToMarkdown(beamT)), "buildSet sozinho: sem linha");
  assert.equal(Object.keys(beamT).includes("jev"), false, "buildSet nunca ganha o campo jev");

  console.log(`[ok] jev: parse, regra 8, decisão com fallback, log, jev_compare (concordância ${compared.agreement.type_pct}%, correlação ${compared.agreement.score_correlation}), ping`);
  console.log("[ok] jev na ordem (P16): K candidatas, escolha com confiança, fallback, 3 erros, abertura e fechamento fixos, seleção, corte da duração, regra 8 em todo corpo, log kind next_track, planos e linha do markdown");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
