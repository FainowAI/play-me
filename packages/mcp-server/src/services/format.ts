import { CHARACTER_LIMIT } from "../constants.js";
import type { JevSetInfo, SetPosition, SetResult, SpotifyTrackSummary, TrackAnalysis } from "../types.js";
import { ResponseFormat } from "../types.js";

export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export function ok(text: string, structured?: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: truncate(text) }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

export function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function render(format: ResponseFormat, markdown: () => string, data: Record<string, unknown>): ToolResult {
  return ok(format === ResponseFormat.JSON ? JSON.stringify(data, null, 2) : markdown(), data);
}

export function truncate(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return (
    text.slice(0, CHARACTER_LIMIT) +
    "\n\n[Resposta truncada no limite de caracteres. Use paginação (limit/offset) ou response_format='json' com menos itens.]"
  );
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "--:--";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function trackLine(track: SpotifyTrackSummary, analysis?: TrackAnalysis): string {
  const artists = track.artists.join(", ") || "artista desconhecido";
  const data = analysis
    ? ` · ${analysis.bpm} BPM · ${analysis.camelot}${analysis.energy !== undefined ? ` · E${analysis.energy}${analysis.energy_estimated ? "*" : ""}` : ""}`
    : " · sem análise";
  const local = track.is_local ? " · arquivo local (fora do alcance da API)" : "";
  return `${track.position + 1}. ${track.name} — ${artists} (${formatDuration(track.duration_ms)})${data}${local} · id: ${track.id ?? "n/a"}`;
}

const TYPE_PT = { blend: "blend", bass_swap: "troca de grave", filter: "filtro", echo_out: "echo out" } as const;

/** "*" marca energia estimada (P12: derivada do energy da ReccoBeats), não informada pelo Mixar ou pelo usuário. */
const star = (position?: SetPosition): string => (position?.energy_estimated ? "*" : "");

/** P16: "Jev: escolheu X de Y passos (Z pelas regras) · só regras: nota 0,84"; Y = passos com escolha, a nota das regras com vírgula (texto do contrato). */
function jevLine(jev: Extract<JevSetInfo, { used: true }>): string {
  const rulesScore = String(jev.rules_average_score).replace(".", ",");
  return `Jev: escolheu ${jev.chosen} de ${jev.chosen + jev.fallback} passos (${jev.fallback} pelas regras) · só regras: nota ${rulesScore}`;
}

export function setToMarkdown(result: SetResult): string {
  const lines: string[] = [];
  const minutes = typeof result.duration_ms === "number" ? ` · ${Math.round(result.duration_ms / 60_000)} min` : "";
  lines.push(`# Set proposto · ${result.order.length} faixas${minutes} · curva "${result.curve}" · nota média ${result.average_score}`);
  if (result.jev?.used) lines.push(jevLine(result.jev)); // sem Jev (sem chave, use_jev: false) o texto segue como antes
  lines.push("");

  let currentSection = "";
  result.order.forEach((position, index) => {
    if (position.section !== currentSection) {
      currentSection = position.section;
      lines.push(`## ${currentSection.toUpperCase()}`);
    }
    if (index > 0) {
      const t = result.transitions[index - 1];
      if (t) {
        const bpmDelta = t.bpm_diff > 0 ? `+${t.bpm_diff}` : `${t.bpm_diff}`;
        const energy =
          t.energy_from !== null && t.energy_to !== null
            ? ` · E${t.energy_from}${star(result.order[index - 1])}→E${t.energy_to}${star(position)}`
            : "";
        lines.push(
          `  ↳ ${t.camelot_from}→${t.camelot_to} ${t.harmonic_relation} (${t.harmonic_type}) · ${bpmDelta} BPM${energy} · nota ${t.scores.total}`,
        );
      }
    }
    const energy = position.energy !== null ? ` · E${position.energy}${star(position)} (alvo ${position.target_energy})` : "";
    lines.push(`${position.position}. ${position.label} · ${position.bpm} BPM · ${position.camelot}${energy}`);
  });
  if (result.order.some((position) => position.energy_estimated)) {
    lines.push("", "* energia estimada: energy da ReccoBeats (0–1) convertido para 1–10");
  }

  if (result.plans?.length) {
    lines.push("", "## Plano das passagens");
    result.plans.forEach((plan, index) => {
      lines.push(`${index + 1} → ${index + 2} · ${TYPE_PT[plan.type]} · ${plan.length_bars} c. · confiança ${plan.confidence}`);
      for (const alert of plan.alerts) if (!alert.startsWith("vocal e grave: sem dado")) lines.push(`  - ${alert}`);
    });
  }
  if (result.weak_transitions.length) {
    lines.push("", "## Pontos fracos");
    for (const index of result.weak_transitions) {
      const t = result.transitions[index];
      if (t) lines.push(`- ${t.from_label} → ${t.to_label}: ${t.reason} (nota ${t.scores.total})`);
    }
  }
  if (result.problem_tracks.length) {
    lines.push("", "## Faixas que atrapalham a fluidez");
    for (const problem of result.problem_tracks) lines.push(`- ${problem.label}: ${problem.reasons.join("; ")}`);
  }
  if (result.bridges.length) {
    lines.push("", "## Lacunas: perfil da faixa-ponte");
    for (const bridge of result.bridges) {
      const keys = bridge.camelot_options.length ? `tom ${bridge.camelot_options.join(" ou ")}` : "sem tom único";
      const energy = bridge.energy_target !== null ? ` · energia ~${bridge.energy_target}` : "";
      lines.push(`- Entre ${bridge.between[0]} e ${bridge.between[1]}: ${keys} · ~${bridge.bpm_target} BPM${energy}. ${bridge.why}`);
    }
  }
  if (result.warnings.length) {
    lines.push("", "## Avisos");
    for (const warning of result.warnings) lines.push(`- ${warning}`);
  }
  return lines.join("\n");
}
