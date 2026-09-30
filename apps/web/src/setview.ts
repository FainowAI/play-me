/**
 * Leituras puras do set para a tela (sem React): rótulos em português, tons dos status, props dos cards,
 * seções da curva e tons compatíveis. CONTRATO usado pela shell (card da passagem no chat) e pelo painel.
 * Check runnable: src/tests/logic.test.ts.
 */
import { splitLabel } from "./state.ts";
import type { HarmonicType, PlanRow, SetSnapshot, SetVersionDetail, SnapshotTrack, TransitionType } from "./types.ts";
import type { Tone, TransitionCardProps } from "./components/playme/types.ts";

export const TYPE_LABEL: Record<TransitionType, string> = { blend: "Blend", bass_swap: "Bass swap", filter: "Filtro", echo_out: "Echo out" };

/** Tom do StatusTag pela classe harmônica (DESIGN.md §2: ok segura · info criativa · warn arriscada). */
export const HARMONIC_TONE: Record<HarmonicType, Tone> = { segura: "ok", criativa: "info", arriscada: "warn" };

const HARMONIC_LABEL: Record<HarmonicType, string> = { segura: "Segura", criativa: "Criativa", arriscada: "Arriscada" };

/** Nome da seção da curva (o MCP devolve em inglês). Desconhecida: capitaliza e troca _ por espaço. */
export function sectionLabel(section: string): string {
  const known: Record<string, string> = {
    intro: "Abertura",
    opening: "Abertura",
    warm_up: "Aquecimento",
    build: "Construção",
    rise: "Crescimento",
    climb: "Crescimento",
    peak: "Pico",
    peak_time: "Pico",
    climax: "Clímax",
    plateau: "Platô",
    release: "Respiro",
    cool_down: "Encerramento",
    outro: "Encerramento",
    closing: "Encerramento",
    sunrise: "Amanhecer",
  };
  const s = section.trim().toLowerCase();
  return known[s] ?? (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, " ");
}

/** Faixas da versão agrupadas por seção, na ordem do set. */
export function groupBySection(tracks: SnapshotTrack[]): { name: string; tracks: SnapshotTrack[] }[] {
  const groups: { name: string; tracks: SnapshotTrack[] }[] = [];
  for (const t of tracks) {
    const name = sectionLabel(t.section);
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.tracks.push(t);
    else groups.push({ name, tracks: [t] });
  }
  return groups;
}

/** Sinal e número: "+2", "−6", "±0". */
export function signed(n: number): string {
  return (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(n);
}

/** "Segura · relativa · −6 BPM" a partir do plano. */
export function relationLabel(plan: PlanRow["plan"]): { tone: Tone; label: string } {
  const diff = plan.tempo.to_bpm - plan.tempo.from_bpm;
  const parts = [HARMONIC_LABEL[plan.harmonic.class], plan.harmonic.relation];
  if (Math.abs(diff) >= 1) parts.push(`${signed(Math.round(diff))} BPM`);
  const tone: Tone = plan.alerts.length > 0 && plan.harmonic.class === "segura" ? "warn" : HARMONIC_TONE[plan.harmonic.class];
  return { tone, label: parts.join(" · ") };
}

/** Props do TransitionCard da passagem `position` (1-based), ou null sem snapshot/plano. */
export function transitionCard(version: SetVersionDetail, position: number): Omit<TransitionCardProps, "onClick"> | null {
  const plan = version.plans.find((p) => p.position === position);
  const a = version.snapshot?.order[position - 1];
  const b = version.snapshot?.order[position];
  if (!plan || !a || !b) return null;
  return {
    index: `${position} → ${position + 1}`,
    trackA: { title: splitLabel(a.label).title, bpm: a.bpm, camelot: a.camelot },
    trackB: { title: splitLabel(b.label).title, bpm: b.bpm, camelot: b.camelot },
    relation: relationLabel(plan.plan),
    deltaBpm: Math.round(plan.plan.tempo.to_bpm - plan.plan.tempo.from_bpm),
    deltaEnergy: plan.plan.energy_delta,
    type: TYPE_LABEL[plan.plan.type] ?? plan.plan.type,
    lengthBars: plan.plan.length_bars,
    reason: plan.plan.reason,
  };
}

/** Passagem mais arriscada da versão: a primeira de weak_transitions ou a de menor nota. */
export function weakestPosition(version: SetVersionDetail): number | null {
  const weak = version.snapshot?.weak_transitions[0];
  if (weak !== undefined) return weak + 1;
  const scored = version.plans.filter((p) => p.score !== null);
  if (scored.length === 0) return version.plans[0]?.position ?? null;
  return scored.reduce((min, p) => ((p.score ?? 1) < (min.score ?? 1) ? p : min)).position;
}

/** Tons compatíveis na roda Camelot: mesmo número na outra letra e ±1 na mesma letra. */
export function compatibleKeys(camelot: string): string[] {
  const m = /^(\d{1,2})([AB])$/i.exec(camelot.trim());
  if (!m) return [];
  const n = Number(m[1]);
  const letter = (m[2] ?? "A").toUpperCase();
  if (n < 1 || n > 12) return [];
  const wrap = (k: number) => ((k + 11) % 12) + 1;
  return [`${wrap(n - 1)}${letter}`, `${wrap(n + 1)}${letter}`, `${n}${letter === "A" ? "B" : "A"}`];
}

/**
 * problem_tracks do MCP mistura faixas que ficaram FORA do set com faixas que entraram com aviso (ex.: energia não informada).
 * Separa pelos ids da ordem: só as ausentes são "fora do set"; as outras são "com aviso".
 */
export function splitProblems(version: SetVersionDetail): { out: SetSnapshot["problem_tracks"]; warned: SetSnapshot["problem_tracks"] } {
  const inSet = new Set(version.order);
  const problems = version.snapshot?.problem_tracks ?? [];
  return { out: problems.filter((p) => !inSet.has(p.track_id)), warned: problems.filter((p) => inSet.has(p.track_id)) };
}

/** Nota 0..1 em texto com vírgula: 0,84. */
export function score(n: number): string {
  return n.toFixed(2).replace(".", ",");
}
