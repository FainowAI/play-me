/**
 * Contrato do apps/server (Sprint 2, Fase C; API v2 na Sprint 3). Tipos compartilhados pelas trilhas
 * banco (repo.ts), agente (agent.ts) e HTTP (server.ts). Não mudar sem avisar as três.
 * Os shapes da API v2 espelham apps/web/src/types.ts: mudou lá, muda aqui.
 * Regras de negócio: docs/eap_play-me_fainow.md, seção "Regras de negócio consolidadas" (3 e 4).
 */
import type { SetPosition, TransitionReport } from "spotify-dj-mcp-server/dist/types.js";

/** Estados do set (D27). enviado é final: ajuste depois disso vira set novo em rascunho. */
export type SetStatus = "rascunho" | "aguardando_aprovacao" | "enviado";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ChatSession {
  id: string;
  agent_session_id: string | null; // session_id do Agent SDK, para `resume`
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

/** Faixa na ordem do set (SetPosition do MCP) mais a origem do dado no store do MCP. */
export interface SnapshotTrack extends SetPosition {
  source: string | null; // "web" = ReccoBeats (BPM conferido, tom a validar); outro = Mixar/usuário; null = sem dado no store
  key_review: boolean; // tom [A VALIDAR]
}

/** Resultado do dj_build_set / dj_evaluate_order guardado por versão (sem planos: estão em transition_plans). */
export interface SetSnapshot {
  curve: string;
  average_score: number;
  order: SnapshotTrack[];
  transitions: TransitionReport[]; // índice i = passagem i+1 → i+2
  weak_transitions: number[]; // índices em `transitions`
  problem_tracks: { track_id: string; label: string; reasons: string[] }[];
  warnings: string[];
}

export interface SetVersion {
  id: string;
  set_id: string;
  version: number; // 1, 2, 3…
  order: string[]; // IDs do Spotify na ordem (nome e artista só no snapshot)
  note: string | null; // o pedido que gerou a versão
  created_at: string;
  snapshot: SetSnapshot | null; // null em versões antigas do banco (antes da Sprint 3)
}

export interface PlanInput {
  position: number; // passagem N → N+1 (1-based)
  from_track: string;
  to_track: string;
  plan: unknown; // TransitionPlan do MCP, guardado como JSON
  planner_version: string;
  score: number | null;
}

export interface PlanRow extends PlanInput {
  id: string;
  set_version_id: string;
  created_at: string;
}

export interface Approval {
  id: string;
  chat_session_id: string;
  set_id: string | null;
  action: string; // nome da ferramenta, ex.: "spotify_create_playlist_from_order"
  payload: unknown; // input da ferramenta
  status: ApprovalStatus;
  decided_at: string | null;
  created_at: string;
}

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

/** GET/PUT /api/settings */
export interface Settings {
  weights: Weights;
}
