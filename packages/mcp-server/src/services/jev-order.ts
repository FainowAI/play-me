/**
 * P16 (Sprint 6): o Jev escolhe a ordem do set passo a passo. Em cada posição as regras oferecem as K melhores candidatas
 * (mesma nota e fadiga do feixe de dj-engine.ts) e o Jev escolhe uma; confiança abaixo do limiar, erro ou Jev parado = candidata 1.
 * O feixe das regras (buildSet) roda antes: valida as opções, é a referência (`rules_average_score`) e vale como resultado quando
 * o Jev não decide nenhum passo (as passagens dessa ordem ele ainda decide). O tipo e a nota de cada passagem vão junto da escolha
 * seguinte: N + 1 chamadas por set (até 2N - 1 quando o feixe vale e as passagens dele são perguntadas à parte).
 * Regra 8: o Jev recebe só números e rótulos do planejador (o state é montado em jev.ts), nunca ID, título ou artista.
 */
import { JEV_ORDER } from "../constants.js";
import type { JevSetInfo, SetResult, TrackAnalysis } from "../types.js";
import {
  annotateSelection,
  buildReport,
  normalizeWeights,
  scoreTransition,
  setSize,
  startFit,
  targetEnergy,
  trimToTarget,
  type BuildOptions,
} from "./dj-engine.js";
import { isJevAnswer, isNextAnswer, type Jev, type JevAnswer, type NextStep } from "./jev.js";
import { planTransition } from "./planner.js";

/** Chave de uma passagem (de A para B) nas respostas do Jev. */
export const passKey = (fromId: string, toId: string): string => `${fromId}>${toId}`;

export interface JevOrdered {
  result: SetResult;
  /** Resposta do Jev por passagem (passKey), de confiança alta ou baixa: quem monta os planos decide com decideWithJev. */
  answers: Map<string, JevAnswer>;
}

interface Candidate {
  index: number; // posição em `tracks`
  score: number; // nota das regras da passagem (menos a fadiga) ou startFit na abertura
}

const round = (value: number, digits = 2): number => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * `rules` é o resultado de buildSet(tracks, options) com as mesmas `options`. Devolve o set ordenado com o Jev (ou o próprio `rules`
 * quando ele não decidiu nenhum passo) e as respostas das passagens. Nunca lança por causa do Jev: erro de chamada vira a candidata 1.
 * ponytail: refaz o N, a nota e a fadiga do feixe em vez de extraí-los de buildSet; a fadiga repete as constantes dele (3+ faixas com energia 9+).
 * O fallback por passo é a candidata 1 (gulosa), mais fraca que o feixe: por isso o feixe vale sozinho quando `chosen` é 0.
 */
export async function buildSetWithJev(tracks: TrackAnalysis[], options: BuildOptions, rules: SetResult, jev: Jev): Promise<JevOrdered> {
  const n = tracks.length;
  const byId = new Map(tracks.map((track) => [track.track_id, track] as const));
  const weights = normalizeWeights(options.weights);
  const selecting = options.maxTracks !== undefined || options.targetDurationMs !== undefined;
  const size = selecting ? setSize(tracks, options) : { count: n, wanted: n };
  const count = size.count;
  const tAt = (index: number): number => (count === 1 ? 0 : index / (count - 1));
  const indexOf = (id?: string): number | undefined => (id === undefined ? undefined : tracks.findIndex((track) => track.track_id === id));
  const startIdx = indexOf(options.startTrackId); // buildSet já validou: os ids existem e são diferentes
  const endIdx = indexOf(options.endTrackId);

  const order: number[] = [];
  const used = new Set<number>();
  let highRun = 0; // faixas seguidas com energia >= 9 (a fadiga do feixe)

  /** As K melhores faixas não usadas para a posição (abertura fixa e fechamento fixo respeitados); ordem estável, desempate pelo índice. */
  const candidatesAt = (position: number): Candidate[] => {
    if (position === 0 && startIdx !== undefined) return [{ index: startIdx, score: 1 }];
    if (position === count - 1 && endIdx !== undefined) return [{ index: endIdx, score: 1 }];
    const last = order.length ? (tracks[order[order.length - 1] as number] as TrackAnalysis) : undefined;
    const scored: Candidate[] = [];
    tracks.forEach((track, index) => {
      if (used.has(index) || index === endIdx) return;
      if (!last) {
        scored.push({ index, score: startFit(track, targetEnergy(options.curve, 0)) });
        return;
      }
      const run = (track.energy ?? 0) >= 9 ? highRun + 1 : 0;
      const fatigue = run >= 3 ? 0.18 * (run - 2) : 0;
      const total = scoreTransition(last, track, { curve: options.curve, weights, tFrom: tAt(position - 1), tTo: tAt(position) }).scores.total;
      scored.push({ index, score: total - fatigue });
    });
    return scored.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, JEV_ORDER.candidates);
  };

  const answers = new Map<string, JevAnswer>();
  const asked = new Set<string>(); // passagens já levadas numa chamada (com ou sem sucesso): nunca repetidas
  const outcomes: (boolean | null)[] = []; // por posição: true = o Jev decidiu, false = as regras, null = sem escolha (uma candidata só)
  let calls = 0;
  let errors = 0;
  let streak = 0;
  let spent = 0;
  let lastError = "";
  const open = (): boolean => streak < JEV_ORDER.maxErrors;
  const tally = (started: number, error?: string): void => {
    calls += 1;
    spent += Date.now() - started;
    if (error === undefined) {
      streak = 0;
      return;
    }
    errors += 1;
    streak += 1;
    lastError = error;
  };

  for (let position = 0; position < count; position += 1) {
    const candidates = candidatesAt(position);
    let picked = candidates[0] as Candidate;
    let decided: boolean | null = null;
    if (candidates.length > 1) {
      decided = false;
      if (open()) {
        const current = order.length ? (tracks[order[order.length - 1] as number] as TrackAnalysis) : null;
        const previous = order.length > 1 ? (tracks[order[order.length - 2] as number] as TrackAnalysis) : undefined;
        const step: NextStep = {
          position: position + 1,
          total: count,
          target_energy: round(targetEnergy(options.curve, tAt(position)), 1),
          current,
          candidates: candidates.map((c) => ({ track: tracks[c.index] as TrackAnalysis, rules_score: round(Math.max(0, c.score)) })),
          ...(previous ? { previous } : {}),
        };
        const started = Date.now();
        const answer = await jev.askNext(step);
        tally(started, isNextAnswer(answer) ? undefined : answer.error);
        const key = previous && current ? passKey(previous.track_id, current.track_id) : undefined;
        if (key) asked.add(key);
        if (isNextAnswer(answer)) {
          if (key && answer.pass && isJevAnswer(answer.pass)) answers.set(key, answer.pass);
          if (answer.confidence >= jev.minConfidence) {
            picked = candidates[answer.choice - 1] as Candidate;
            decided = true;
          }
        }
      }
    }
    outcomes.push(decided);
    order.push(picked.index);
    used.add(picked.index);
    highRun = (tracks[picked.index]?.energy ?? 0) >= 9 ? highRun + 1 : 0;
  }

  let ordered = order.map((index) => tracks[index] as TrackAnalysis);
  // P13 antes da última chamada (mesma condição do buildSet): o corte tira a cauda, e a passagem que vira a última já foi perguntada junto de uma escolha
  if (options.targetDurationMs !== undefined && options.maxTracks === undefined && endIdx === undefined) {
    ordered = trimToTarget(ordered, options.targetDurationMs, options.durations);
  }
  // só contam os passos da ordem que ficou (depois do corte); posição sem escolha não é passo
  const kept = outcomes.slice(0, ordered.length);
  const chosen = kept.filter((outcome) => outcome === true).length;
  const fallback = kept.filter((outcome) => outcome === false).length;

  // as passagens que nenhuma escolha levou (posição sem escolha, a última, Jev parado e depois recuperado): uma chamada de par cada.
  // Sem passo decidido pelo Jev o set é o do feixe, e são as passagens dele que valem.
  const finalOrder = chosen > 0 ? ordered : rules.order.map((position) => byId.get(position.track_id) as TrackAnalysis);
  for (let i = 0; i + 1 < finalOrder.length && open(); i += 1) {
    const a = finalOrder[i] as TrackAnalysis;
    const b = finalOrder[i + 1] as TrackAnalysis;
    const key = passKey(a.track_id, b.track_id);
    if (asked.has(key)) continue;
    asked.add(key);
    const started = Date.now();
    const answer = await jev.askTransition(a, b, planTransition(a, b));
    tally(started, isJevAnswer(answer) ? undefined : answer.error);
    if (isJevAnswer(answer)) answers.set(key, answer);
  }

  const info: JevSetInfo = { used: true, chosen, fallback, calls, errors, latency_ms: spent, rules_average_score: rules.average_score };

  let result = rules;
  if (chosen > 0) {
    result = buildReport(ordered, options.curve, weights);
    if (selecting) annotateSelection(result, ordered, n, size, options.durations, options.targetDurationMs);
  }
  result.jev = info;
  if (chosen === 0) {
    result.warnings.push(`O Jev não decidiu nenhum passo (confiança abaixo de ${jev.minConfidence} ou falha): valem a ordem e as notas das regras.`);
  }
  if (errors > 0) {
    result.warnings.push(`Jev: ${errors} de ${calls} chamada(s) falharam (${lastError.replace(/\.$/, "")}); esses passos seguiram pelas regras.`);
  }
  if (!open()) result.warnings.push(`Jev parou após ${JEV_ORDER.maxErrors} falhas seguidas: o resto do set seguiu pelas regras, sem consultá-lo.`);
  return { result, answers };
}
