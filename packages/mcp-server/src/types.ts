export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

/** Tokens OAuth persistidos localmente (arquivo com permissão 0600). */
export interface StoredTokens {
  access_token: string;
  refresh_token: string;
  /** epoch em milissegundos */
  expires_at: number;
  scope: string;
}

export type CamelotLetter = "A" | "B";

export interface CamelotKey {
  number: number; // 1..12
  letter: CamelotLetter; // A = menor, B = maior
}

/**
 * Análise de uma faixa. Vem do usuário (Mixar do Spotify, Rekordbox, Serato,
 * ouvido), porque a Web API não entrega BPM, tom nem energia para apps novos.
 */
export interface TrackAnalysis {
  track_id: string;
  bpm: number;
  camelot: string; // normalizado, ex.: "8A"
  energy?: number; // 1..10
  energy_estimated?: boolean; // P12: energia derivada do `energy` da ReccoBeats na leitura; nunca persistida
  style?: string; // ex.: "melodic house", "tech house", "techno"
  vocal?: boolean;
  label?: string; // rótulo livre digitado pelo usuário, ex.: "Adored – J. Worra"
  notes?: string;
  source?: string; // ex.: "spotify-mixar", "rekordbox", "manual"
  updated_at: string; // ISO
}

/** Faixa como devolvida pela Web API, reduzida ao necessário. */
export interface SpotifyTrackSummary {
  position: number;
  id: string | null;
  uri: string | null;
  name: string;
  artists: string[];
  duration_ms: number | null;
  isrc: string | null; // external_ids.isrc; nunca persistido
  is_local: boolean;
  type: string;
}

export interface PlaylistSummary {
  id: string;
  name: string;
  owner: string;
  owner_id: string;
  total_items: number | null;
  public: boolean | null;
  collaborative: boolean;
  url: string | null;
}

export type CurvePreset = "classic" | "peak_time" | "warm_up" | "sunrise";

export interface Weights {
  camelot: number;
  bpm: number;
  energy: number;
  style: number;
  progression: number;
}

export type HarmonicType = "segura" | "criativa" | "arriscada";

export interface TransitionReport {
  from_id: string;
  to_id: string;
  from_label: string;
  to_label: string;
  bpm_from: number;
  bpm_to: number;
  bpm_diff: number;
  bpm_mode: "normal" | "half_double";
  camelot_from: string;
  camelot_to: string;
  harmonic_relation: string;
  harmonic_type: HarmonicType;
  energy_from: number | null;
  energy_to: number | null;
  scores: {
    camelot: number;
    bpm: number;
    energy: number;
    style: number;
    progression: number;
    total: number;
  };
  reason: string;
}

export interface SetPosition {
  position: number; // 1-based
  track_id: string;
  label: string;
  bpm: number;
  camelot: string;
  energy: number | null;
  energy_estimated: boolean; // true só quando derivada da ReccoBeats (P12); a do Mixar/usuário é false
  target_energy: number;
  section: string;
}

export interface BridgeSuggestion {
  between: [string, string];
  camelot_options: string[];
  bpm_target: number;
  energy_target: number | null;
  why: string;
}

export interface SetResult {
  curve: CurvePreset;
  weights: Weights;
  average_score: number;
  order: SetPosition[];
  transitions: TransitionReport[];
  weak_transitions: number[]; // índices em `transitions`
  problem_tracks: { track_id: string; label: string; reasons: string[] }[];
  bridges: BridgeSuggestion[];
  warnings: string[];
  plans?: TransitionPlan[]; // um por passagem, na ordem de `transitions` (preenchido pelas ferramentas)
  // P10: só quando o set foi pedido por duration_minutes/max_tracks (sem eles o resultado não traz estes campos)
  pool_size?: number; // faixas analisadas consideradas na seleção
  duration_ms?: number | null; // soma das durações da ordem; null se alguma faltar
}

// ---------- Fase P: planejador por metadados (D30) ----------

export type TransitionType = "blend" | "bass_swap" | "filter" | "echo_out";

/** O que o Jev respondeu sobre o par (7.2): tipo, nota 1–5 e a confiança de cada resposta. */
export interface JevInsight {
  type: TransitionType;
  type_confidence: number; // 0..1
  score: number; // 1..5
  score_confidence: number; // 0..1
}

/** Plano de transição sem estrutura por compasso: só BPM, tom e energia. */
export interface TransitionPlan {
  from: string; // track_id de A (sai)
  to: string; // track_id de B (entra)
  type: TransitionType;
  length_bars: 4 | 8 | 16 | 32;
  bass_swap_bar: number | null; // compasso relativo (1-based) em que o grave troca; null = sem troca
  tempo: {
    from_bpm: number;
    to_bpm: number;
    diff: number; // de bpmDistance (já considera metade/dobro)
    mode: "normal" | "half_double";
    strategy: "match_incoming" | "ramp";
  };
  harmonic: { from: string; to: string; relation: string; class: HarmonicType };
  energy_delta: number | null; // energia de B − energia de A; null sem energia nas duas
  confidence: number; // 0..1, duas casas
  alerts: string[];
  reason: string; // português, uma frase
  planner_version: "meta-1";
  source?: "rules" | "jev"; // quem decidiu o tipo; só em transition_plan com use_jev
  jev?: JevInsight | null; // resposta do Jev (mesmo quando as regras venceram); null = sem resposta
}

/** Uma passagem do guia para o Mix do app do Spotify (sem API: o usuário aplica à mão). */
export interface MixGuideStep {
  position: string; // ex.: "14 → 15"
  from_label: string;
  to_label: string;
  preset: string; // só presets confirmados em mix-presets.ts
  length_bars: number;
  volume: string; // controle Volume do Mix
  eq: string; // controle EQ do Mix (grave, médio, agudo)
  effects: string; // controle Efeitos do Mix (passa-baixa, passa-alta)
  alerts: string[];
  text: string; // linha pronta para o guia
}
