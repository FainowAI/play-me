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

/**
 * Faixa na ordem do set (SetPosition do MCP) mais a origem do dado no store do MCP.
 * `energy_estimated` é opcional aqui: o MCP o devolve sempre, mas versões gravadas antes da Sprint 4 não o têm (daí o Omit).
 */
export interface SnapshotTrack extends Omit<SetPosition, "energy_estimated"> {
  source: string | null; // "web" = ReccoBeats (BPM conferido, tom a validar); outro = Mixar/usuário; null = sem dado no store
  key_review: boolean; // tom [A VALIDAR]
  energy_estimated?: boolean; // Sprint 4 (P12): energia derivada do energy da ReccoBeats (0–1 → 1–10), não a do Mixar
}

/** Resultado do dj_build_set / dj_evaluate_order guardado por versão (sem planos: estão em transition_plans). */
export interface SetSnapshot {
  curve: string;
  average_score: number;
  pool_size?: number; // Sprint 4 (P10): faixas analisadas consideradas na seleção
  duration_ms?: number | null; // Sprint 4 (P10): duração somada da ordem; null se o Spotify não informou alguma faixa
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
  feedback: TransitionFeedback | null; // Sprint 4 (7.1.1): última nota dada pelo DJ (listPlans sempre preenche)
}

/** Nota 1–5 dada na Transição expandida (tabela transition_feedback); espelha apps/web/src/types.ts. */
export interface TransitionFeedback {
  rating: number; // 1..5
  notes: string | null;
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


// Sprint 6: perguntas do agente ao DJ antes de montar (ferramenta ask_dj → evento `questions` → POST /api/questions/:id)
export type QuestionsStatus = "pending" | "answered" | "skipped" | "expired";
export interface QuestionOption {
  label: string;
  description?: string;
  recommended?: boolean; // a interface põe essa opção primeiro e acrescenta " (Recomendado)"
}
export interface Question {
  id: string; // ^[a-z_]{1,24}$ (ex.: "tamanho", "curva")
  text: string;
  header?: string;
  options: QuestionOption[]; // 2 a 4
  allow_other: boolean; // linha "Outra opção" com texto livre
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
  | {
      type: "questions"; // Sprint 6: o agente pergunta ao DJ (ask_dj); o turno espera a resposta
      questions_id: string;
      title: string | null;
      questions: Question[];
      /** Ausente ao vivo (pendente). No turno gravado e na releitura: estado final e as respostas (label da opção ou texto livre; null = pulada). */
      status?: QuestionsStatus;
      answers?: Record<string, string | null>;
    }
  | { type: "thinking_delta"; text: string } // Sprint 5: pensamento ao vivo (não gravado no turno)
  | { type: "text_delta"; text: string } // Sprint 5: texto da resposta ao vivo (não gravado)
  | { type: "thinking"; text: string } // Sprint 5: bloco de pensamento completo (gravado no turno)
  | { type: "done"; cost_usd: number | null }
  | { type: "error"; message: string };

/** Um turno gravado: a mensagem do usuário e os eventos emitidos (sem "session", "done" e os deltas). */
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
  /** Sprint 5: key = TYPESAFE_API_KEY presente; connected = ping real (null enquanto não respondeu); model = ex.: jev-1.13.0. */
  jev: { key: boolean; connected: boolean | null; model: string | null };
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
