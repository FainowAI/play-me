/**
 * Jev (TypeSafe, System One; D28): decisões rápidas e tipadas sobre o par A → B, sempre com fallback de regras.
 * API: POST /v1/systemone com fetch puro via HttpDeps (sem SDK), no padrão da ReccoBeats.
 * Regra 8: o state leva só números e rótulos do planejador (BPM, Camelot, energia, ΔBPM, relação harmônica);
 * nunca nome, artista ou ID do Spotify. Regra 9: qualquer falha vira { error } e o planejador de regras decide.
 */
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { JEV_DEFAULT_MIN_CONFIDENCE, JEV_MODEL, JEV_TIMEOUT_MS, JEV_URL } from "../constants.js";
import type { CamelotKey, JevInsight, TrackAnalysis, TransitionPlan, TransitionType } from "../types.js";
import { harmonicMatch, parseKey } from "./camelot.js";
import { labelOf, normalizeWeights, scoreTransition, type ScoreContext } from "./dj-engine.js";
import { RateLimitError, realHttp, type HttpDeps } from "./metadata/http.js";
import { planTransition, shapeOf, TYPE_NAME } from "./planner.js";

const TYPES: readonly TransitionType[] = ["blend", "bass_swap", "filter", "echo_out"];

/**
 * Perguntas do Jev. Critérios do tipo = regras da ADR 0005, sem os comprimentos: o tamanho sai do planejador.
 * `score` do Jev vem na escala dos ÍNDICES dos critérios (0 a 4 para 5 níveis; confirmado na chamada real de 30/09/2026),
 * então askTransition soma 1 para a escala 1–5. A `confidence` do score é separada da da choice.
 */
const QUESTIONS = {
  transition_type: {
    type: "choice",
    instructions: "Escolha o tipo de transição de DJ para sair da faixa A e entrar na faixa B, usando só os números do state.",
    criteria: {
      blend: "Mistura longa das duas faixas: harmonia segura (mesmo tom, adjacente ou relativa) e diferença de BPM de até 3.",
      bass_swap:
        "Troca de grave no meio da passagem: harmonia criativa com diferença de BPM de até 3, ou harmonia segura com diferença de até 6.",
      filter: "Passa-alta na saída de A: o resto dos casos, quando nem a troca de grave nem o corte rápido servem.",
      echo_out: "Corte rápido com eco na saída de A: diferença de BPM acima de 6 ou choque harmônico forte (nota harmônica até 0,18).",
    },
  },
  pair_score: {
    type: "score",
    instructions: "Dê a nota de encaixe de A em B para mixar, considerando BPM, Camelot e energia do state.",
    criteria: ["1 · choque, não mixar", "2 · ruim, só com corte", "3 · aceitável com cuidado", "4 · boa", "5 · encaixe perfeito"],
  },
};

/**
 * Ordem do set (P16): `next_track` é um `choice` entre as candidatas "1".."k" (k = 2 a JEV_ORDER.candidates) de state.candidates.
 * Os critérios são estáticos por chave; a abertura (sem faixa atual) tem outro enunciado.
 */
const NEXT_INSTRUCTIONS = {
  next: "Escolha qual candidata de state.candidates toca depois de state.current no set de DJ, usando só os números do state: energia perto de state.target_energy, harmonia segura (mesmo tom, adjacente ou relativa), diferença de BPM pequena e boa nota das regras (rules_score).",
  open: "Escolha qual candidata de state.candidates abre o set de DJ, usando só os números do state: energia perto de state.target_energy e BPM confortável para começar; rules_score é a nota das regras.",
};
const nextKeys = (count: number): string[] => Array.from({ length: count }, (_, i) => String(i + 1));
const nextQuestion = (count: number, opening: boolean) => ({
  type: "choice",
  instructions: opening ? NEXT_INSTRUCTIONS.open : NEXT_INSTRUCTIONS.next,
  criteria: Object.fromEntries(nextKeys(count).map((key) => [key, `Tocar a candidata ${key} de state.candidates.`])),
});

/** A passagem anterior vai na mesma chamada (state.passage, o state de askTransition): mesmos critérios, enunciado que aponta para ela. */
const PASSAGE_QUESTIONS = {
  transition_type: {
    ...QUESTIONS.transition_type,
    instructions: "Escolha o tipo de transição de DJ para sair da faixa A e entrar na faixa B, usando só os números de state.passage.",
  },
  pair_score: {
    ...QUESTIONS.pair_score,
    instructions: "Dê a nota de encaixe de A em B para mixar, considerando BPM, Camelot e energia de state.passage.",
  },
};

/** Teste de conexão (Sprint 5, Q1): a pergunta mais barata possível; só importa o Jev responder, não o que ele responde. */
const PING_QUESTIONS = { ping: { type: "noul", instructions: "O state é um teste de conexão?" } };
const PING_TIMEOUT_MS = 5_000;

export interface JevAnswer extends JevInsight {
  latency_ms: number;
  model: string;
}
export interface JevFailure {
  error: string;
  backoff?: true; // 429/529: quem chama em lote deve parar
}
export type JevResult = JevAnswer | JevFailure;

export const isJevAnswer = (result: JevResult): result is JevAnswer => !("error" in result);

export type PingResult = { ok: true; model: string; latency_ms: number } | { ok: false; error: string };

/** Um passo da ordem (P16): as candidatas já filtradas pelas regras (a das regras primeiro) e a faixa atual; `previous` leva a passagem anterior na mesma chamada. */
export interface NextStep {
  position: number; // 1-based
  total: number;
  target_energy: number;
  current: TrackAnalysis | null; // null na abertura
  candidates: { track: TrackAnalysis; rules_score: number }[]; // 2 a JEV_ORDER.candidates
  previous?: TrackAnalysis; // faixa anterior à atual: a passagem previous → current vai junto
}
export interface NextAnswer {
  choice: number; // 1..k, índice em `candidates` + 1
  confidence: number;
  pass: JevResult | null; // resposta da passagem anterior (null se não foi perguntada); falha aqui não invalida a escolha
  latency_ms: number;
  model: string;
}
export type NextResult = NextAnswer | JevFailure;

export const isNextAnswer = (result: NextResult): result is NextAnswer => !("error" in result);

export interface Jev {
  minConfidence: number;
  available(): boolean;
  askTransition(a: TrackAnalysis, b: TrackAnalysis, rules: TransitionPlan): Promise<JevResult>;
  /** P16: qual das candidatas toca agora; o log da chamada leva `kind: "next_track"`. Nunca lança. */
  askNext(step: NextStep): Promise<NextResult>;
  ping(): Promise<PingResult>;
}

export interface JevOptions {
  apiKey?: string;
  minConfidence?: number;
  http?: HttpDeps;
  logPath: string;
}

interface RawAnswer {
  choice?: string;
  score?: number;
  confidence?: number;
}
interface RawBody {
  model?: string;
  answers?: { transition_type?: RawAnswer; pair_score?: RawAnswer; next_track?: RawAnswer };
  usage?: { input_tokens?: number; output_tokens?: number };
}

const round = (value: number, digits = 2): number => Math.round(value * 10 ** digits) / 10 ** digits;

const sideOf = (track: TrackAnalysis, key: CamelotKey) => ({
  bpm: track.bpm,
  camelot_number: key.number,
  camelot_letter: key.letter,
  energy: track.energy ?? null,
});

/** Regra 8: só números e rótulos do planejador. Nunca o TransitionPlan inteiro (from/to são IDs do Spotify). */
function stateOf(a: TrackAnalysis, b: TrackAnalysis, rules: TransitionPlan) {
  const keyA = parseKey(a.camelot);
  const keyB = parseKey(b.camelot);
  if (!keyA || !keyB) return null;
  return {
    from: sideOf(a, keyA),
    to: sideOf(b, keyB),
    harmonic: { relation: rules.harmonic.relation, class: rules.harmonic.class, score: harmonicMatch(keyA, keyB).score },
    bpm_diff: rules.tempo.diff,
    bpm_mode: rules.tempo.mode,
    energy_delta: rules.energy_delta,
  };
}

const keyOf = (track: TrackAnalysis): CamelotKey => {
  const key = parseKey(track.camelot);
  if (!key) throw new Error("Tom inválido");
  return key;
};

/** stateOf da passagem a → b com o plano das regras; tom inválido lança (askNext captura e devolve { error }). */
function passState(a: TrackAnalysis, b: TrackAnalysis) {
  const state = stateOf(a, b, planTransition(a, b));
  if (!state) throw new Error("Tom inválido");
  return state;
}

/**
 * Regra 8 também na ordem: números e rótulos do planejador, nunca ID, título ou artista. As candidatas vão numeradas por chave
 * ("1".."k"), as mesmas do `choice`; na abertura (sem faixa atual) a relação com a faixa atual fica null. `passage` = state de askTransition.
 */
function nextStateOf({ position, total, target_energy, current, candidates, previous }: NextStep) {
  return {
    position,
    total,
    target_energy,
    current: current ? sideOf(current, keyOf(current)) : null,
    candidates: Object.fromEntries(
      candidates.map(({ track, rules_score }, i) => {
        const relation = current ? passState(current, track) : null;
        return [
          String(i + 1),
          {
            ...sideOf(track, keyOf(track)),
            harmonic: relation?.harmonic ?? null,
            bpm_diff: relation?.bpm_diff ?? null,
            bpm_mode: relation?.bpm_mode ?? null,
            energy_delta: relation?.energy_delta ?? null,
            rules_score,
          },
        ];
      }),
    ),
    ...(previous && current ? { passage: passState(previous, current) } : {}),
  };
}

function parseAnswer(body: RawBody, latency: number): JevResult {
  const t = body.answers?.transition_type;
  const s = body.answers?.pair_score;
  const type = TYPES.find((value) => value === t?.choice);
  if (!type || typeof t?.confidence !== "number" || typeof s?.score !== "number" || typeof s.confidence !== "number") {
    return { error: "Resposta do Jev fora do formato esperado (transition_type e pair_score)." };
  }
  return {
    type,
    type_confidence: t.confidence,
    score: round(Math.min(5, Math.max(1, s.score + 1))),
    score_confidence: s.confidence,
    latency_ms: latency,
    model: body.model ?? JEV_MODEL,
  };
}

/** A escolha vale por si: a passagem anterior (se perguntada) é lida à parte e uma resposta ruim dela não invalida o passo. */
function parseNext(body: RawBody, latency: number, count: number, withPass: boolean): NextResult {
  const answer = body.answers?.next_track;
  const index = nextKeys(count).indexOf(String(answer?.choice));
  if (index < 0 || typeof answer?.confidence !== "number") return { error: "Resposta do Jev fora do formato esperado (next_track)." };
  return {
    choice: index + 1,
    confidence: answer.confidence,
    pass: withPass ? parseAnswer(body, latency) : null,
    latency_ms: latency,
    model: body.model ?? JEV_MODEL,
  };
}

/** POST /v1/systemone. Toda falha vira Error em português (429/529: RateLimitError); quem chama decide o que fazer. */
async function postJev(http: HttpDeps, key: string, body: unknown, timeoutMs: number): Promise<RawBody> {
  let response: Response;
  try {
    response = await http.fetch(JEV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new Error(timedOut ? `O Jev não respondeu em ${timeoutMs / 1000} s.` : "Falha de rede ao falar com o Jev.");
  }
  if (response.status === 429 || response.status === 529) {
    throw new RateLimitError("Jev", `HTTP ${response.status}, Retry-After ${response.headers.get("Retry-After") ?? "?"}`);
  }
  if (response.status === 401) throw new Error("O Jev recusou a chave (HTTP 401): confira TYPESAFE_API_KEY.");
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(`O Jev respondeu HTTP ${response.status}${detail ? `: ${detail}` : ""}.`);
  }
  return (await response.json().catch(() => ({}))) as RawBody;
}

/**
 * Teste de conexão do painel (Sprint 5, Q1): uma pergunta `noul` mínima, timeout de 5 s; HTTP 200 = conectado.
 * Não é decisão de DJ, então não entra no jev-calls.jsonl. Nunca lança. Sem `apiKey`, vale TYPESAFE_API_KEY do ambiente;
 * em teste, sempre injete o http (com chave no ambiente, o padrão bate na API real).
 */
export async function ping(http: HttpDeps = realHttp, apiKey: string | undefined = process.env.TYPESAFE_API_KEY): Promise<PingResult> {
  const key = apiKey?.trim() ?? "";
  if (key === "") return { ok: false, error: "sem chave" };
  const started = http.now();
  try {
    const body = await postJev(http, key, { state: { ping: true }, model: JEV_MODEL, questions: PING_QUESTIONS }, PING_TIMEOUT_MS);
    return { ok: true, model: body.model ?? JEV_MODEL, latency_ms: http.now() - started };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function createJev({ apiKey, minConfidence = JEV_DEFAULT_MIN_CONFIDENCE, http = realHttp, logPath }: JevOptions): Jev {
  const key = apiKey?.trim() ?? "";
  async function exchange<R>(
    state: unknown,
    questions: unknown,
    started: number,
    parse: (body: RawBody, latency: number) => R | JevFailure,
  ): Promise<{ body: RawBody | null; result: R | JevFailure }> {
    try {
      const body = await postJev(http, key, { state, model: JEV_MODEL, questions }, JEV_TIMEOUT_MS);
      return { body, result: parse(body, http.now() - started) };
    } catch (error) {
      if (error instanceof RateLimitError) return { body: null, result: { error: error.message, backoff: true } };
      return { body: null, result: { error: error instanceof Error ? error.message : String(error) } };
    }
  }

  /** Uma linha por chamada feita (calibração, D28); sem o state em claro, só o hash. Nunca grava a chave. */
  function log(row: Record<string, unknown>): void {
    try {
      appendFileSync(logPath, `${JSON.stringify(row)}\n`, { encoding: "utf8", mode: 0o600 });
    } catch {
      // ponytail: o log nunca derruba a decisão; sem ele a resposta segue valendo
    }
  }

  async function askTransition(a: TrackAnalysis, b: TrackAnalysis, rules: TransitionPlan): Promise<JevResult> {
    if (key === "") return { error: "Sem TYPESAFE_API_KEY: o Jev não foi consultado." };
    const state = stateOf(a, b, rules);
    if (!state) return { error: "Tom inválido: o Jev não foi consultado." };
    const started = http.now();
    const { body, result } = await exchange(state, QUESTIONS, started, parseAnswer);
    logCall({
      state,
      questions: QUESTIONS,
      body,
      confidence: isJevAnswer(result) ? { transition_type: result.type_confidence, pair_score: result.score_confidence } : null,
      error: isJevAnswer(result) ? undefined : result.error,
      started,
    });
    return result;
  }

  /** A linha do log de uma chamada; `kind` só nas chamadas da ordem (P16), as de par seguem sem ele. */
  function logCall(call: {
    kind?: string;
    state: unknown;
    questions: unknown;
    body: RawBody | null;
    confidence: Record<string, number> | null;
    error?: string;
    started: number;
  }): void {
    log({
      at: new Date(http.now()).toISOString(),
      ...(call.kind ? { kind: call.kind } : {}),
      state_sha256: createHash("sha256").update(JSON.stringify(call.state)).digest("hex"),
      questions: call.questions,
      answers: call.body?.answers ?? null,
      confidence: call.confidence,
      latency_ms: http.now() - call.started,
      model: call.body?.model ?? null,
      usage: call.body?.usage ?? null,
      ...(call.error === undefined ? {} : { error: call.error }),
    });
  }

  async function askNext(step: NextStep): Promise<NextResult> {
    if (key === "") return { error: "Sem TYPESAFE_API_KEY: o Jev não foi consultado." };
    const count = step.candidates.length;
    if (count < 2) return { error: "A escolha pede 2 candidatas ou mais: o Jev não foi consultado." };
    let state: ReturnType<typeof nextStateOf>;
    try {
      state = nextStateOf(step);
    } catch {
      return { error: "Tom inválido: o Jev não foi consultado." };
    }
    const withPass = step.previous !== undefined && step.current !== null;
    const questions = { next_track: nextQuestion(count, step.current === null), ...(withPass ? PASSAGE_QUESTIONS : {}) };
    const started = http.now();
    const { body, result } = await exchange(state, questions, started, (raw, latency) => parseNext(raw, latency, count, withPass));
    logCall({
      kind: "next_track",
      state,
      questions,
      body,
      confidence: isNextAnswer(result)
        ? {
            next_track: result.confidence,
            ...(result.pass && isJevAnswer(result.pass)
              ? { transition_type: result.pass.type_confidence, pair_score: result.pass.score_confidence }
              : {}),
          }
        : null,
      error: isNextAnswer(result) ? undefined : result.error,
      started,
    });
    return result;
  }

  return { minConfidence, available: () => key !== "", askTransition, askNext, ping: () => ping(http, key) };
}

/** JEV_MIN_CONFIDENCE válido é um número em (0, 1]; vazio ou fora disso vale o padrão (0,7). */
export function minConfidenceFromEnv(value: string | undefined): number {
  const parsed = Number(value);
  return parsed > 0 && parsed <= 1 ? parsed : JEV_DEFAULT_MIN_CONFIDENCE;
}

/** Jev com a chave e o limiar do ambiente; o log fica na pasta de dados do MCP. */
export function jevFromEnv(dataDir: string, http: HttpDeps = realHttp): Jev {
  return createJev({
    apiKey: process.env.TYPESAFE_API_KEY,
    minConfidence: minConfidenceFromEnv(process.env.JEV_MIN_CONFIDENCE),
    http,
    logPath: join(dataDir, "jev-calls.jsonl"),
  });
}

/**
 * Regra 9: o Jev decide o tipo só com confiança ≥ limiar; sem resposta ou com confiança baixa valem as regras.
 * Comprimento e troca de grave do tipo escolhido saem de shapeOf (ADR 0005), não do Jev.
 */
export function decideWithJev(rules: TransitionPlan, answer: JevResult, minConfidence: number): TransitionPlan {
  if (!isJevAnswer(answer)) {
    const why = answer.error.replace(/\.$/, "");
    return { ...rules, source: "rules", jev: null, alerts: [`Jev indisponível (${why}): as regras decidiram`, ...rules.alerts] };
  }
  const jev: JevInsight = {
    type: answer.type,
    type_confidence: answer.type_confidence,
    score: answer.score,
    score_confidence: answer.score_confidence,
  };
  if (jev.type_confidence < minConfidence) {
    const alert = `Jev sugeriu ${TYPE_NAME[jev.type]} com confiança ${jev.type_confidence} (abaixo de ${minConfidence}): as regras decidiram`;
    return { ...rules, source: "rules", jev, alerts: [alert, ...rules.alerts] };
  }
  const { length, bar } = shapeOf(jev.type, rules.harmonic.class === "segura" && rules.tempo.diff <= 1);
  const plan = `${TYPE_NAME[jev.type]} de ${length} compassos${bar ? `, grave troca no compasso ${bar}` : ""}`;
  const alerts =
    rules.type === "echo_out" && jev.type !== "echo_out"
      ? ["as regras só aceitavam echo out (ΔBPM alto ou choque harmônico): confira o tipo escolhido pelo Jev", ...rules.alerts]
      : rules.alerts;
  return {
    ...rules,
    type: jev.type,
    length_bars: length,
    bass_swap_bar: bar,
    alerts,
    source: "jev",
    jev,
    reason:
      jev.type === rules.type
        ? `Jev (confiança ${jev.type_confidence}) confirmou ${plan}.`
        : `Jev (confiança ${jev.type_confidence}) escolheu ${plan}; as regras sugeriam ${TYPE_NAME[rules.type]}.`,
  };
}

// ---------- jev_compare: o Jev contra o planejador de regras ----------

export interface ComparedPair {
  from_label: string;
  to_label: string;
  rules_type: TransitionType;
  jev_type: TransitionType;
  jev_type_confidence: number;
  rules_score: number; // 0..1, nota do par do motor de regras
  jev_score: number; // 1..5
  jev_score_confidence: number;
  agree: boolean;
}

export interface Comparison {
  pairs: ComparedPair[];
  agreement: {
    type_pct: number | null; // % dos pares respondidos em que o Jev escolheu o mesmo tipo das regras
    confident_pct: number | null; // o mesmo, só entre as respostas com confiança ≥ limiar
    score_correlation: number | null; // Pearson entre a nota das regras (0–1) e a do Jev (1–5)
    answered: number;
    confident: number;
  };
  model: string;
  calls: number;
  errors: string[];
}

// Contexto neutro da nota das regras: curva clássica no meio do set, como o padrão de dj_score_transition.
const NEUTRAL: ScoreContext = { curve: "classic", weights: normalizeWeights(), tFrom: 0.47, tTo: 0.5 };

/** Pearson entre duas séries; null com menos de 2 pontos ou sem variação em alguma das séries. */
export function pearson(x: number[], y: number[]): number | null {
  if (x.length < 2 || x.length !== y.length) return null;
  const mx = x.reduce((sum, value) => sum + value, 0) / x.length;
  const my = y.reduce((sum, value) => sum + value, 0) / y.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  x.forEach((value, i) => {
    const dx = value - mx;
    const dy = (y[i] as number) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  });
  return sxx === 0 || syy === 0 ? null : round(sxy / Math.sqrt(sxx * syy));
}

export function agreementOf(rows: ComparedPair[], minConfidence: number): Comparison["agreement"] {
  const pct = (list: ComparedPair[]): number | null =>
    list.length === 0 ? null : round((100 * list.filter((row) => row.agree).length) / list.length, 1);
  const confident = rows.filter((row) => row.jev_type_confidence >= minConfidence);
  return {
    type_pct: pct(rows),
    confident_pct: pct(confident),
    score_correlation: pearson(rows.map((row) => row.rules_score), rows.map((row) => row.jev_score)),
    answered: rows.length,
    confident: confident.length,
  };
}

/** Chamadas sequenciais, um par por vez. Para no 429/529 ou após 3 falhas seguidas e devolve o que já tem. */
export async function compareTransitions(pairs: [TrackAnalysis, TrackAnalysis][], jev: Jev): Promise<Comparison> {
  const rows: ComparedPair[] = [];
  const errors: string[] = [];
  let model = JEV_MODEL;
  let calls = 0;
  let streak = 0;
  for (const [a, b] of pairs) {
    const rules = planTransition(a, b);
    calls += 1;
    const answer = await jev.askTransition(a, b, rules);
    if (!isJevAnswer(answer)) {
      errors.push(`${labelOf(a)} → ${labelOf(b)}: ${answer.error}`);
      streak += 1;
      // ponytail: não repete chamadas pagas contra uma API fora do ar; 3 falhas seguidas ou 429/529 encerram o lote
      if (answer.backoff || streak >= 3) {
        errors.push(
          answer.backoff
            ? "Lote interrompido pelo limite ou sobrecarga do Jev: o resultado é parcial."
            : "Lote interrompido após 3 falhas seguidas do Jev: o resultado é parcial.",
        );
        break;
      }
      continue;
    }
    streak = 0;
    model = answer.model;
    rows.push({
      from_label: labelOf(a),
      to_label: labelOf(b),
      rules_type: rules.type,
      jev_type: answer.type,
      jev_type_confidence: answer.type_confidence,
      rules_score: scoreTransition(a, b, NEUTRAL).scores.total,
      jev_score: answer.score,
      jev_score_confidence: answer.score_confidence,
      agree: answer.type === rules.type,
    });
  }
  return { pairs: rows, agreement: agreementOf(rows, jev.minConfidence), model, calls, errors };
}
