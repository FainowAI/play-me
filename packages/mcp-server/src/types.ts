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
}
