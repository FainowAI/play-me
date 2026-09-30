/**
 * CONTRATO da apps/web (Sprint 3, Fase C): espelha a API do apps/server (v2) e os tipos do MCP.
 * Não mudar sem avisar as trilhas: server (apps/server/src/types.ts), shell (src/shell), painel (src/panel).
 */

// ---------- set, versões e planos (apps/server + MCP) ----------

/** Estados do set (D27). enviado é final. */
export type SetStatus = "rascunho" | "aguardando_aprovacao" | "enviado";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ChatSession {
  id: string;
  agent_session_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface SetRow {
  id: string;
  chat_session_id: string;
  name: string; // ex.: "[DJ MIX] Eletro"
  curve: string; // classic | peak_time | warm_up | sunrise
  status: SetStatus;
  spotify_playlist_id: string | null;
  spotify_url: string | null;
  created_at: string;
  updated_at: string;
}

/** GET /api/sessions: sessão com o set atual (ou null). */
export interface SessionListItem extends ChatSession {
  set: Pick<SetRow, "id" | "name" | "status" | "spotify_url"> | null;
}

/** Faixa na ordem do set, como o dj_build_set devolve, mais a origem do dado (store do MCP). */
export interface SnapshotTrack {
  position: number; // 1-based
  track_id: string;
  label: string; // "Título — Artista, Artista" (travessão com espaços); sem travessão = só o título
  bpm: number;
  camelot: string; // "8A"
  energy: number | null; // 1..10; no MVP toda energia é estimativa (marque `estimated`)
  target_energy: number;
  section: string; // nome da seção da curva (inglês, do MCP)
  source: string | null; // "web" = ReccoBeats (BPM conferido, tom a validar); outro = Mixar/usuário; null = sem dado no store
  key_review: boolean; // tom [A VALIDAR]
}

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
  harmonic_relation: string; // ex.: "adjacente +1", "relativa", "mesmo tom"
  harmonic_type: HarmonicType;
  energy_from: number | null;
  energy_to: number | null;
  scores: { camelot: number; bpm: number; energy: number; style: number; progression: number; total: number };
  reason: string;
}

/** Resultado do dj_build_set / dj_evaluate_order guardado por versão (sem planos: estão em `plans`). */
export interface SetSnapshot {
  curve: string;
  average_score: number;
  order: SnapshotTrack[];
  transitions: TransitionReport[]; // índice i = passagem i+1 → i+2
  weak_transitions: number[]; // índices em `transitions`
  problem_tracks: { track_id: string; label: string; reasons: string[] }[];
  warnings: string[];
}

export type HarmonicType = "segura" | "criativa" | "arriscada";
export type TransitionType = "blend" | "bass_swap" | "filter" | "echo_out";

/** TransitionPlan do MCP (ADR 0005, planejador meta-1). */
export interface TransitionPlan {
  from: string;
  to: string;
  type: TransitionType;
  length_bars: 4 | 8 | 16 | 32;
  bass_swap_bar: number | null;
  tempo: { from_bpm: number; to_bpm: number; diff: number; mode: "normal" | "half_double"; strategy: "match_incoming" | "ramp" };
  harmonic: { from: string; to: string; relation: string; class: HarmonicType };
  energy_delta: number | null;
  confidence: number; // 0..1
  alerts: string[];
  reason: string;
  planner_version: string;
}

export interface PlanRow {
  id: string;
  set_version_id: string;
  position: number; // passagem N → N+1 (1-based)
  from_track: string;
  to_track: string;
  plan: TransitionPlan;
  planner_version: string;
  score: number | null; // nota total da passagem (0..1), do montador
  created_at: string;
}

/** Passagem do guia do Mix (export_mix_guide), calculada pelo servidor com o planejador do MCP. */
export interface MixGuideStep {
  position: string; // "14 → 15"
  from_label: string;
  to_label: string;
  preset: string; // só presets confirmados: Fade, Rise
  length_bars: number;
  volume: string;
  eq: string;
  effects: string;
  alerts: string[];
  text: string; // linha pronta para copiar
}

export interface SetVersionDetail {
  id: string;
  set_id: string;
  version: number; // 1, 2, 3…
  order: string[]; // IDs do Spotify
  note: string | null; // pedido que gerou a versão
  created_at: string;
  snapshot: SetSnapshot | null; // null só em versões antigas do banco (antes da Sprint 3)
  plans: PlanRow[]; // uma por passagem, ordenadas por position
  guide: MixGuideStep[]; // uma por plano, mesma ordem
}

/** GET /api/sets/:id */
export interface SetDetail {
  set: SetRow;
  versions: SetVersionDetail[]; // versão 1 primeiro
}

// ---------- chat ----------

/** Eventos SSE do POST /api/chat, na ordem em que acontecem. */
export type ServerEvent =
  | { type: "session"; session_id: string }
  | { type: "text"; text: string }
  | { type: "tool_start"; tool: string; tool_use_id: string; detail: string }
  | {
      type: "tool_end";
      tool: string;
      tool_use_id: string;
      is_error: boolean;
      detail: string; // resumo do resultado em uma linha ("21 faixas · curva classic"); erro: primeira linha da mensagem
      /** Números do resultado, só nas ferramentas de metadados: metadata_coverage → { total, mixar, web, a_validar, pendente }; metadata_lookup → { total, saved, pending, dry_run }. */
      summary?: Record<string, number | boolean | null>;
    }
  | { type: "set"; set_id: string; version: number; status: SetStatus }
  | {
      type: "approval";
      approval_id: string;
      set_id: string | null;
      playlist_name: string;
      track_count: number;
      track_ids: string[];
      /** Só na releitura (GET /api/sessions/:id): estado atual da approval. Ausente = pending, ao vivo. */
      status?: ApprovalStatus;
    }
  | { type: "done"; cost_usd: number | null }
  | { type: "error"; message: string };

/** Um turno gravado: a mensagem do usuário e os eventos emitidos (sem "session" e "done"). */
export interface Turn {
  id: string;
  user_message: string;
  events: ServerEvent[];
  cost_usd: number | null;
  created_at: string;
}

/** GET /api/sessions/:id */
export interface SessionDetail {
  session: ChatSession;
  turns: Turn[];
  set: SetRow | null;
  versions: SetVersionDetail[];
}

// ---------- status, playlists e configurações ----------

/** GET /api/status: nunca traz chave nem token, só se existem. */
export interface Status {
  model: string; // ex.: claude-haiku-4-5
  anthropic: boolean; // chave presente
  spotify: { connected: boolean }; // tokens do MCP presentes em ~/.spotify-dj-mcp
  reccobeats: true; // sem chave, sempre disponível
  jev: boolean; // TYPESAFE_API_KEY presente (acesso validado só na Sprint 4, D28)
}

/** GET /api/playlists: playlists do usuário no Spotify (cache de 5 min no servidor). */
export interface Playlist {
  id: string;
  name: string;
  total: number | null; // faixas
  url: string | null;
}

/** Pesos da nota do par, em porcentagem inteira; somam 100. */
export interface Weights {
  camelot: number;
  bpm: number;
  energy: number;
  style: number;
  progression: number;
}
export const DEFAULT_WEIGHTS: Weights = { camelot: 35, bpm: 25, energy: 25, style: 10, progression: 5 };

/** GET/PUT /api/settings */
export interface Settings {
  weights: Weights;
}

export interface ApiError {
  error: string;
}
