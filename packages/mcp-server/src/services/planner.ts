/**
 * Planejador de transições por metadados (Fase P, D30). Funções puras.
 * CONTRATO: estas assinaturas são usadas por dj-tools.ts.
 */
import { PLANNER_VERSION } from "../constants.js";
import type { MixGuideStep, TrackAnalysis, TransitionPlan, TransitionType } from "../types.js";
import { formatCamelot, harmonicMatch, parseKey } from "./camelot.js";
import { bpmDistance, echoOnly, labelOf } from "./dj-engine.js";
import type { MixPreset } from "./mix-presets.js";

const TYPE_NAME: Record<TransitionType, string> = {
  blend: "blend",
  bass_swap: "bass swap",
  filter: "filtro passa-alta",
  echo_out: "echo out",
};
const NO_DATA_ALERT = "vocal e grave: sem dado (plano por metadados)";

const toValidate = (t: TrackAnalysis): boolean => t.notes?.includes("[A VALIDAR] tom") ?? false;

export function planTransition(a: TrackAnalysis, b: TrackAnalysis): TransitionPlan {
  const keyA = parseKey(a.camelot);
  const keyB = parseKey(b.camelot);
  if (!keyA || !keyB) throw new Error(`Tom inválido em ${labelOf(keyA ? b : a)}.`);
  const h = harmonicMatch(keyA, keyB);
  const { diff, mode } = bpmDistance(a.bpm, b.bpm);

  let type: TransitionType;
  let length: TransitionPlan["length_bars"];
  let bar: number | null = null;
  if (echoOnly(h.score, diff)) [type, length] = ["echo_out", 4];
  else if (h.type === "segura" && diff <= 1) [type, length, bar] = ["blend", 32, 17];
  else if (h.type === "segura" && diff <= 3) [type, length, bar] = ["blend", 16, 9];
  else if ((h.type === "criativa" && diff <= 3) || (h.type === "segura" && diff <= 6)) [type, length, bar] = ["bass_swap", 8, 5];
  else [type, length] = ["filter", 8];

  const ratio = diff / Math.min(a.bpm, b.bpm);
  const strategy = ratio >= 0.03 && ratio <= 0.08 ? "ramp" : "match_incoming";
  const energyDelta = a.energy !== undefined && b.energy !== undefined ? b.energy - a.energy : null;

  const va = toValidate(a);
  const vb = toValidate(b);
  let confidence = h.score - (diff > 3 ? 0.1 : 0) - (va || vb ? 0.2 : 0);
  confidence = Math.round(Math.max(0.05, confidence) * 100) / 100;

  const alerts: string[] = [];
  if (va || vb) alerts.push(`confirme o tom no Mixar (${va && vb ? "A e B" : va ? "A" : "B"})`);
  if (diff > 5) alerts.push("ΔBPM acima de 5");
  if (strategy === "ramp") alerts.push("rampa de tempo: ajuste o BPM ao longo da transição");
  alerts.push(NO_DATA_ALERT);

  const reason =
    `Harmonia ${h.type} (${h.relation}) e ${diff} BPM de diferença: ${TYPE_NAME[type]} de ${length} compassos` +
    (bar ? `, grave troca no compasso ${bar}.` : ".");

  return {
    from: a.track_id,
    to: b.track_id,
    type,
    length_bars: length,
    bass_swap_bar: bar,
    tempo: { from_bpm: a.bpm, to_bpm: b.bpm, diff, mode, strategy },
    harmonic: { from: formatCamelot(keyA), to: formatCamelot(keyB), relation: h.relation, class: h.type },
    energy_delta: energyDelta,
    confidence,
    alerts,
    reason,
    planner_version: PLANNER_VERSION,
  };
}

export function mixGuideStep(plan: TransitionPlan, position: string, fromLabel: string, toLabel: string): MixGuideStep {
  const preset: MixPreset =
    (plan.energy_delta ?? 0) >= 2 && (plan.type === "blend" || plan.type === "bass_swap") ? "Rise" : "Fade";
  const bars = plan.length_bars;
  const volume = `Volume: transição de ${bars} compassos`;
  const eq =
    plan.type === "filter"
      ? "EQ: segure o grave de B baixo até A sair"
      : plan.type === "echo_out"
        ? "EQ: corte o grave de A antes de B entrar"
        : `EQ: tire o grave de A e entre com o grave de B no compasso ${plan.bass_swap_bar}`;
  const effects =
    plan.type === "filter"
      ? "Efeitos: passa-alta na saída de A"
      : plan.type === "echo_out"
        ? "Efeitos: passa-alta rápido na saída de A (o Mix não tem echo: faça um corte curto)"
        : "Efeitos: nenhum";
  const alerts = plan.alerts.filter((alert) => alert !== NO_DATA_ALERT);

  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
  const parts = [eq.replace("EQ: ", "")];
  if (plan.type !== "blend" && plan.type !== "bass_swap") parts.push(effects.replace("Efeitos: ", ""));
  const text =
    `${position} · ${fromLabel} → ${toLabel}: preset ${preset}, ${bars} compassos. ${parts.map(cap).join(". ")}.` +
    (alerts.length ? ` ${cap(alerts.join("; "))}.` : "");

  return { position, from_label: fromLabel, to_label: toLabel, preset, length_bars: bars, volume, eq, effects, alerts, text };
}
