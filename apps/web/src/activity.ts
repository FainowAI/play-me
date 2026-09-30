/**
 * Atividade do agente → estado do orb de pensamento (DESIGN.md 4.1, D20).
 * Fonte: design/ds/components/bundle.js (ACT e TOOL_ACT). Sem React aqui: o estado (src/state.ts) usa este mapa.
 */
export type Activity = "idle" | "reading" | "matching" | "listening" | "scoring" | "planning" | "composing" | "shipping" | "working";

/** Os nove estados do thinking-orbs. */
export type OrbState = "breathing" | "searching" | "connecting" | "listening" | "solving" | "weaving" | "composing" | "shaping" | "working";

export const ACTIVITY: Record<Activity, { state: OrbState; verb: string }> = {
  idle: { state: "breathing", verb: "Pronto" },
  reading: { state: "searching", verb: "Lendo a playlist" },
  matching: { state: "connecting", verb: "Casando com seus arquivos" },
  listening: { state: "listening", verb: "Analisando o áudio" },
  scoring: { state: "solving", verb: "Pontuando as passagens" },
  planning: { state: "weaving", verb: "Planejando a transição" },
  composing: { state: "composing", verb: "Montando o set" },
  shipping: { state: "shaping", verb: "Criando a playlist" },
  working: { state: "working", verb: "Trabalhando" },
};

const TOOL_ACT: [RegExp, Activity][] = [
  [/^spotify_(get_playlist|search|list)/, "reading"],
  [/^metadata_/, "reading"], // busca de BPM e tom (ReccoBeats)
  [/^library_match/, "matching"],
  [/^analysis_/, "listening"],
  [/^(dj_score_transition|dj_evaluate_order)/, "scoring"],
  [/^(transition_plan|transition_render)/, "planning"],
  [/^(dj_build_set|set_build)/, "composing"],
  [/^(spotify_create_playlist|export_)/, "shipping"],
];

/** Nome da ferramenta do MCP (sem o prefixo mcp__spotify-dj__) → atividade do orb. */
export function activityForTool(name: string): Activity {
  for (const [re, activity] of TOOL_ACT) if (re.test(name)) return activity;
  return "working";
}
