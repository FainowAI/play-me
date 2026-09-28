import { DEFAULT_WEIGHTS, WEAK_TRANSITION_SCORE } from "../constants.js";
import type {
  BridgeSuggestion,
  CurvePreset,
  SetPosition,
  SetResult,
  TrackAnalysis,
  TransitionReport,
  Weights,
} from "../types.js";
import { bridgeKeys, formatCamelot, harmonicMatch, keyPath, parseKey } from "./camelot.js";

// ---------- Curvas de energia ----------

/** Pontos de controle (t de 0 a 1, energia alvo de 1 a 10), interpolados linearmente. */
const CURVES: Record<CurvePreset, [number, number][]> = {
  // warm up → construção → pico → clímax → encerramento
  classic: [
    [0, 4],
    [0.2, 5.5],
    [0.45, 7],
    [0.65, 8.5],
    [0.8, 9.5],
    [0.9, 7.5],
    [1, 5],
  ],
  // já começa quente e segura a pressão até perto do fim
  peak_time: [
    [0, 6.5],
    [0.3, 8],
    [0.6, 9],
    [0.85, 9.5],
    [1, 8],
  ],
  // abertura de noite: cresce devagar e não chega ao pico
  warm_up: [
    [0, 3.5],
    [0.5, 5.5],
    [1, 7],
  ],
  // sobe até o meio e desce longo, para after ou fim de festa
  sunrise: [
    [0, 5],
    [0.4, 8],
    [0.55, 8.5],
    [1, 4],
  ],
};

export function targetEnergy(curve: CurvePreset, t: number): number {
  const points = CURVES[curve];
  const clamped = Math.min(1, Math.max(0, t));
  for (let i = 1; i < points.length; i += 1) {
    const [t1, e1] = points[i] as [number, number];
    const [t0, e0] = points[i - 1] as [number, number];
    if (clamped <= t1) {
      const span = t1 - t0 || 1;
      return e0 + ((clamped - t0) / span) * (e1 - e0);
    }
  }
  return (points[points.length - 1] as [number, number])[1];
}

export function sectionFor(curve: CurvePreset, t: number): string {
  if (curve === "warm_up") return t < 0.35 ? "abertura" : t < 0.8 ? "construção" : "crescimento";
  if (curve === "sunrise") return t < 0.2 ? "abertura" : t < 0.4 ? "crescimento" : t < 0.6 ? "pico" : "encerramento";
  if (curve === "peak_time") return t < 0.25 ? "abertura" : t < 0.55 ? "crescimento" : t < 0.9 ? "pico" : "encerramento";
  if (t < 0.2) return "abertura";
  if (t < 0.45) return "construção";
  if (t < 0.65) return "crescimento";
  if (t < 0.75) return "pico";
  if (t < 0.87) return "clímax";
  return "encerramento";
}

// ---------- Notas parciais ----------

/** Diferença efetiva de BPM, considerando half/double time (ex.: 87 ↔ 174). */
export function bpmDistance(a: number, b: number): { diff: number; mode: "normal" | "half_double" } {
  const normal = Math.abs(a - b);
  const halfDouble = Math.min(Math.abs(a * 2 - b), Math.abs(a - b * 2));
  return halfDouble + 0.5 < normal ? { diff: halfDouble, mode: "half_double" } : { diff: normal, mode: "normal" };
}

export function bpmScore(diff: number): number {
  if (diff <= 2) return 1 - 0.03 * diff; // excelente
  if (diff <= 5) return 0.9 - 0.08 * (diff - 2); // aceitável
  if (diff <= 8) return 0.5 - 0.07 * (diff - 5); // precisa de motivo
  return 0.1;
}

function energyTransitionScore(delta: number, desired: number): number {
  return Math.max(0, 1 - 0.22 * Math.abs(delta - desired));
}

function styleScore(a?: string, b?: string): number {
  if (!a || !b) return 0.6; // neutro quando o estilo não foi informado
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  if (na === nb) return 1;
  const tokensA = new Set(na.split(/[\s/,&-]+/).filter(Boolean));
  const shares = nb.split(/[\s/,&-]+/).some((token) => tokensA.has(token));
  return shares ? 0.65 : 0.35;
}

function progressionScore(energy: number | undefined, target: number): number {
  if (energy === undefined) return 0.6;
  return Math.max(0, 1 - Math.abs(energy - target) / 6);
}

// ---------- Avaliação de uma transição ----------

export interface ScoreContext {
  curve: CurvePreset;
  weights: Weights;
  tFrom: number;
  tTo: number;
}

export function labelOf(track: TrackAnalysis): string {
  return track.label ?? track.track_id;
}

export function scoreTransition(from: TrackAnalysis, to: TrackAnalysis, ctx: ScoreContext): TransitionReport {
  const keyFrom = parseKey(from.camelot);
  const keyTo = parseKey(to.camelot);
  if (!keyFrom || !keyTo) throw new Error(`Tom inválido em ${labelOf(keyFrom ? to : from)}.`);

  const harmonic = harmonicMatch(keyFrom, keyTo);
  const bpm = bpmDistance(from.bpm, to.bpm);
  const bpmS = bpmScore(bpm.diff);

  const desiredDelta = targetEnergy(ctx.curve, ctx.tTo) - targetEnergy(ctx.curve, ctx.tFrom);
  const hasEnergy = from.energy !== undefined && to.energy !== undefined;
  const energyDelta = hasEnergy ? (to.energy as number) - (from.energy as number) : 0;
  const energyS = hasEnergy ? energyTransitionScore(energyDelta, desiredDelta) : 0.6;
  const styleS = styleScore(from.style, to.style);
  const progressionS = progressionScore(to.energy, targetEnergy(ctx.curve, ctx.tTo));

  const w = ctx.weights;
  const total =
    w.camelot * harmonic.score + w.bpm * bpmS + w.energy * energyS + w.style * styleS + w.progression * progressionS;

  return {
    from_id: from.track_id,
    to_id: to.track_id,
    from_label: labelOf(from),
    to_label: labelOf(to),
    bpm_from: from.bpm,
    bpm_to: to.bpm,
    bpm_diff: round(to.bpm - from.bpm, 1),
    bpm_mode: bpm.mode,
    camelot_from: formatCamelot(keyFrom),
    camelot_to: formatCamelot(keyTo),
    harmonic_relation: harmonic.relation,
    harmonic_type: harmonic.type,
    energy_from: from.energy ?? null,
    energy_to: to.energy ?? null,
    scores: {
      camelot: round(harmonic.score),
      bpm: round(bpmS),
      energy: round(energyS),
      style: round(styleS),
      progression: round(progressionS),
      total: round(total),
    },
    reason: explain(harmonic.relation, harmonic.type, bpm.diff, bpm.mode, energyDelta, hasEnergy, desiredDelta),
  };
}

function explain(
  relation: string,
  type: string,
  bpmDiff: number,
  bpmMode: "normal" | "half_double",
  energyDelta: number,
  hasEnergy: boolean,
  desired: number,
): string {
  const parts: string[] = [];
  parts.push(`${relation} (${type})`);
  if (bpmMode === "half_double") parts.push("BPM em half/double time");
  else if (bpmDiff <= 2) parts.push("BPM praticamente igual");
  else if (bpmDiff <= 5) parts.push(`${round(bpmDiff, 1)} BPM de ajuste, aceitável`);
  else parts.push(`salto de ${round(bpmDiff, 1)} BPM: fazer no breakdown ou com loop`);

  if (!hasEnergy) parts.push("energia não informada");
  else if (energyDelta > 0) parts.push(`energia sobe ${energyDelta}`);
  else if (energyDelta < 0) parts.push(`energia cai ${Math.abs(energyDelta)}${desired < -0.3 ? ", alinhado ao fechamento" : ""}`);
  else parts.push("energia estável");
  return parts.join("; ");
}

// ---------- Montagem do set (beam search) ----------

export interface BuildOptions {
  curve: CurvePreset;
  weights?: Partial<Weights>;
  startTrackId?: string;
  endTrackId?: string;
  beamWidth?: number;
}

interface Beam {
  order: number[];
  used: Set<number>;
  sum: number; // soma das notas das transições + penalidades
  highRun: number; // quantas faixas seguidas com energia >= 9
}

export function normalizeWeights(partial?: Partial<Weights>): Weights {
  const merged: Weights = { ...DEFAULT_WEIGHTS, ...partial };
  const total = merged.camelot + merged.bpm + merged.energy + merged.style + merged.progression;
  if (total <= 0) return { ...DEFAULT_WEIGHTS };
  return {
    camelot: merged.camelot / total,
    bpm: merged.bpm / total,
    energy: merged.energy / total,
    style: merged.style / total,
    progression: merged.progression / total,
  };
}

/**
 * Busca em feixe: mantém as `beamWidth` melhores sequências parciais a cada passo.
 * Isso evita a escolha gulosa (melhor Camelot agora, beco sem saída depois) e
 * avalia cada faixa pelo que ela deixa possível adiante.
 */
export function buildSet(tracks: TrackAnalysis[], options: BuildOptions): SetResult {
  if (tracks.length < 2) throw new Error("São necessárias pelo menos 2 faixas com análise para montar um set.");
  const weights = normalizeWeights(options.weights);
  const n = tracks.length;
  const beamWidth = options.beamWidth ?? (n > 90 ? 12 : n > 50 ? 24 : 48);
  const tAt = (index: number): number => (n === 1 ? 0 : index / (n - 1));

  const indexOf = (id?: string): number | undefined => {
    if (!id) return undefined;
    const idx = tracks.findIndex((track) => track.track_id === id);
    if (idx < 0) throw new Error(`Faixa ${id} não está entre as faixas analisadas do set.`);
    return idx;
  };
  const startIdx = indexOf(options.startTrackId);
  const endIdx = indexOf(options.endTrackId);
  if (startIdx !== undefined && startIdx === endIdx) throw new Error("Faixa de abertura e de fechamento não podem ser a mesma.");

  // Cache das notas por par (posição influencia só energia/progressão, então recalculamos esses termos)
  const scoreAt = (a: number, b: number, position: number): number =>
    scoreTransition(tracks[a] as TrackAnalysis, tracks[b] as TrackAnalysis, {
      curve: options.curve,
      weights,
      tFrom: tAt(position - 1),
      tTo: tAt(position),
    }).scores.total;

  const startCandidates =
    startIdx !== undefined
      ? [startIdx]
      : tracks
          .map((track, idx) => ({ idx, fit: startFit(track, targetEnergy(options.curve, 0)) }))
          .filter(({ idx }) => idx !== endIdx)
          .sort((a, b) => b.fit - a.fit)
          .slice(0, Math.min(6, n))
          .map(({ idx }) => idx);

  let beams: Beam[] = startCandidates.map((idx) => ({
    order: [idx],
    used: new Set([idx]),
    sum: startFit(tracks[idx] as TrackAnalysis, targetEnergy(options.curve, 0)) * 0.5,
    highRun: (tracks[idx]?.energy ?? 0) >= 9 ? 1 : 0,
  }));

  for (let position = 1; position < n; position += 1) {
    const isLast = position === n - 1;
    const next: Beam[] = [];
    for (const beam of beams) {
      const last = beam.order[beam.order.length - 1] as number;
      for (let candidate = 0; candidate < n; candidate += 1) {
        if (beam.used.has(candidate)) continue;
        if (endIdx !== undefined && candidate === endIdx && !isLast) continue;
        if (endIdx !== undefined && isLast && candidate !== endIdx) continue;

        const energy = tracks[candidate]?.energy ?? 0;
        const highRun = energy >= 9 ? beam.highRun + 1 : 0;
        // Tensão e alívio: três pedradas seguidas cansam a pista
        const fatigue = highRun >= 3 ? 0.18 * (highRun - 2) : 0;
        const used = new Set(beam.used);
        used.add(candidate);
        next.push({
          order: [...beam.order, candidate],
          used,
          sum: beam.sum + scoreAt(last, candidate, position) - fatigue,
          highRun,
        });
      }
    }
    next.sort((a, b) => b.sum - a.sum);
    beams = dedupe(next).slice(0, beamWidth);
  }

  const best = beams[0];
  if (!best) throw new Error("Não foi possível montar o set com as restrições informadas.");
  return buildReport(best.order.map((idx) => tracks[idx] as TrackAnalysis), options.curve, weights);
}

/** Remove feixes que terminam na mesma faixa com o mesmo conjunto usado (mantém o melhor). */
function dedupe(beams: Beam[]): Beam[] {
  const seen = new Set<string>();
  const out: Beam[] = [];
  for (const beam of beams) {
    const key = `${beam.order[beam.order.length - 1]}|${[...beam.used].sort((a, b) => a - b).join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(beam);
  }
  return out;
}

function startFit(track: TrackAnalysis, target: number): number {
  const energyFit = track.energy === undefined ? 0.5 : Math.max(0, 1 - Math.abs(track.energy - target) / 5);
  return energyFit;
}

// ---------- Relatório de um set (ordem calculada ou manual) ----------

export function buildReport(ordered: TrackAnalysis[], curve: CurvePreset, weights: Weights): SetResult {
  const n = ordered.length;
  const tAt = (index: number): number => (n <= 1 ? 0 : index / (n - 1));
  const warnings: string[] = [];

  const order: SetPosition[] = ordered.map((track, index) => ({
    position: index + 1,
    track_id: track.track_id,
    label: labelOf(track),
    bpm: track.bpm,
    camelot: track.camelot,
    energy: track.energy ?? null,
    target_energy: round(targetEnergy(curve, tAt(index)), 1),
    section: sectionFor(curve, tAt(index)),
  }));

  const transitions: TransitionReport[] = [];
  for (let i = 1; i < n; i += 1) {
    transitions.push(
      scoreTransition(ordered[i - 1] as TrackAnalysis, ordered[i] as TrackAnalysis, {
        curve,
        weights,
        tFrom: tAt(i - 1),
        tTo: tAt(i),
      }),
    );
  }

  const weak = transitions
    .map((transition, index) => ({ transition, index }))
    .filter(({ transition }) => transition.scores.total < WEAK_TRANSITION_SCORE || transition.harmonic_type === "arriscada")
    .map(({ index }) => index);

  // Faixas problemáticas
  const bpms = ordered.map((track) => track.bpm).sort((a, b) => a - b);
  const median = bpms[Math.floor(bpms.length / 2)] ?? 0;
  const problems = new Map<string, { track_id: string; label: string; reasons: string[] }>();
  const flag = (track: TrackAnalysis, reason: string): void => {
    const entry = problems.get(track.track_id) ?? { track_id: track.track_id, label: labelOf(track), reasons: [] };
    entry.reasons.push(reason);
    problems.set(track.track_id, entry);
  };
  ordered.forEach((track, index) => {
    if (Math.abs(track.bpm - median) > 6) flag(track, `BPM ${track.bpm} longe da mediana do set (${median})`);
    if (track.energy === undefined) flag(track, "energia não informada: a curva fica menos precisa");
    const inWeak = index > 0 && weak.includes(index - 1);
    const outWeak = index < n - 1 && weak.includes(index);
    if (inWeak && outWeak) flag(track, "entrada e saída fracas: a faixa não conversa com as vizinhas");
  });

  // Blocos de energia muito alta seguidos
  let run = 0;
  ordered.forEach((track, index) => {
    run = (track.energy ?? 0) >= 9 ? run + 1 : 0;
    if (run === 3) warnings.push(`Três faixas seguidas com energia 9+ a partir da posição ${index - 1}: avalie um respiro.`);
  });

  // Pontes para as lacunas
  const bridges: BridgeSuggestion[] = weak.map((index) => {
    const from = ordered[index] as TrackAnalysis;
    const to = ordered[index + 1] as TrackAnalysis;
    const keyFrom = parseKey(from.camelot);
    const keyTo = parseKey(to.camelot);
    let keys = keyFrom && keyTo ? bridgeKeys(keyFrom, keyTo, 0.85) : [];
    let why = "Uma faixa neste tom liga as duas com transições seguras.";
    if (keys.length === 0 && keyFrom && keyTo) {
      keys = bridgeKeys(keyFrom, keyTo, 0.7);
      why = "Nenhum tom liga as duas de forma segura; estas opções usam pelo menos uma transição diagonal.";
    }
    if (keys.length === 0 && keyFrom && keyTo) {
      const safe = keyPath(keyFrom, keyTo, 0.85);
      const creative = keyPath(keyFrom, keyTo, 0.7);
      const useSafe = safe.length > 0 && safe.length <= 2;
      const path = useSafe ? safe : creative;
      if (path.length > 0 && path.length <= 3) {
        why = `Uma faixa só não resolve. Caminho ${useSafe ? "seguro" : "com diagonais"} de ${path.length} faixas-ponte: ${path
          .map(formatCamelot)
          .join(" → ")}. Alternativa: mover uma das duas faixas de lugar.`;
      } else {
        why = "Os tons estão longe demais na roda para uma ponte curta. Melhor mover uma das duas faixas de lugar ou tirar do set.";
      }
    }
    const energyTarget =
      from.energy !== undefined && to.energy !== undefined ? round((from.energy + to.energy) / 2, 1) : null;
    return {
      between: [labelOf(from), labelOf(to)],
      camelot_options: keys.slice(0, 4).map(formatCamelot),
      bpm_target: round((from.bpm + to.bpm) / 2, 0),
      energy_target: energyTarget,
      why,
    };
  });

  const average =
    transitions.length > 0 ? transitions.reduce((acc, transition) => acc + transition.scores.total, 0) / transitions.length : 0;

  return {
    curve,
    weights,
    average_score: round(average),
    order,
    transitions,
    weak_transitions: weak,
    problem_tracks: [...problems.values()],
    bridges,
    warnings,
  };
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
