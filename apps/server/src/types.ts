/**
 * Contrato do apps/server (Sprint 2, Fase C). Tipos compartilhados pelas trilhas
 * banco (repo.ts), agente (agent.ts) e HTTP (server.ts). Não mudar sem avisar as três.
 * Regras de negócio: docs/eap_play-me_fainow.md, seção "Regras de negócio consolidadas" (3 e 4).
 */

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

export interface SetVersion {
  id: string;
  set_id: string;
  version: number; // 1, 2, 3…
  order: string[]; // IDs do Spotify na ordem (só IDs: nome/artista não são guardados)
  note: string | null; // o pedido que gerou a versão
  created_at: string;
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
  | { type: "tool_start"; tool: string; tool_use_id: string }
  | { type: "tool_end"; tool: string; tool_use_id: string; is_error: boolean }
  | { type: "set"; set_id: string; version: number; status: SetStatus }
  | { type: "approval"; approval_id: string; set_id: string | null; playlist_name: string; track_count: number; track_ids: string[] }
  | { type: "done"; cost_usd: number | null }
  | { type: "error"; message: string };
