import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeWeights, scoreTransition } from "../services/dj-engine.js";
import {
  agreementOf,
  compareTransitions,
  createJev,
  decideWithJev,
  isJevAnswer,
  jevFromEnv,
  minConfidenceFromEnv,
  pearson,
  ping,
  type ComparedPair,
  type JevAnswer,
  type JevFailure,
  type JevResult,
} from "../services/jev.js";
import type { HttpDeps } from "../services/metadata/http.js";
import { planTransition } from "../services/planner.js";
import type { TrackAnalysis, TransitionType } from "../types.js";

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

  console.log(`[ok] jev: parse, regra 8, decisão com fallback, log, jev_compare (concordância ${compared.agreement.type_pct}%, correlação ${compared.agreement.score_correlation}), ping`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
