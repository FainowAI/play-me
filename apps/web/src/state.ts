/**
 * Estado da apps/web: um reducer puro (sem React) e as funções que traduzem eventos do servidor em itens do chat.
 * CONTRATO entre as trilhas shell (src/shell: efeitos, fetch, SSE) e painel (src/panel: só lê `set`, `viewVersion`, `panel`).
 * Check runnable: src/tests/logic.test.ts.
 */
import { activityForTool, type Activity } from "./activity.ts";
import type { ApprovalStatus, Playlist, ServerEvent, SessionListItem, SetDetail, SetStatus, SetVersionDetail, Settings, Status, Turn } from "./types.ts";

export type Theme = "dark" | "light";
export type PanelTab = "ordem" | "transicoes" | "guia";
export type ToolStatus = "running" | "done" | "error" | "waiting";

/** Um item da coluna do chat, na ordem em que aconteceu. */
export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "text"; id: string; text: string } // bloco de texto do Play.Me (markdown simples)
  | { kind: "tool"; id: string; tool: string; detail: string; status: ToolStatus; activity: Activity; summary?: Record<string, number | boolean | null> } // summary: números das ferramentas de metadados (card de cobertura)
  | { kind: "approval"; id: string; set_id: string | null; playlist_name: string; track_count: number; track_ids: string[]; status: ApprovalStatus | "expired" }
  | { kind: "set"; id: string; set_id: string; version: number; status: SetStatus } // marcador: a tela mostra o card da passagem mais arriscada e os atalhos
  | { kind: "error"; id: string; text: string };

export type Overlay = { kind: "transition"; position: number } | { kind: "track"; trackId: string } | { kind: "settings" } | null;

export interface AppState {
  theme: Theme;
  status: Status | null;
  playlists: Playlist[];
  playlist: Playlist | null; // playlist em contexto no composer
  sessions: SessionListItem[];
  sessionId: string | null; // null = Início (nenhuma conversa aberta)
  items: ChatItem[];
  busy: boolean; // turno em andamento
  activity: Activity; // do orb: ferramenta rodando, "composing" enquanto o texto chega, "idle" parado
  set: SetDetail | null;
  viewVersion: number | null; // versão vista no painel; null = a mais recente
  panel: { open: boolean; tab: PanelTab }; // open só importa abaixo de 1100 px (gaveta)
  sidebarOpen: boolean; // só importa abaixo de 720 px (gaveta)
  overlay: Overlay;
  settings: Settings | null;
  lastCost: number | null; // custo do último turno, em dólares
}

export const initialState: AppState = {
  theme: "dark",
  status: null,
  playlists: [],
  playlist: null,
  sessions: [],
  sessionId: null,
  items: [],
  busy: false,
  activity: "idle",
  set: null,
  viewVersion: null,
  panel: { open: false, tab: "ordem" },
  sidebarOpen: false,
  overlay: null,
  settings: null,
  lastCost: null,
};

export type Action =
  | { type: "theme"; theme: Theme }
  | { type: "status"; status: Status }
  | { type: "playlists"; playlists: Playlist[] }
  | { type: "playlist"; playlist: Playlist | null }
  | { type: "sessions"; sessions: SessionListItem[] }
  | { type: "settings"; settings: Settings }
  | { type: "new_chat" } // volta ao Início
  | { type: "session_loaded"; sessionId: string; items: ChatItem[]; set: SetDetail | null }
  | { type: "send"; id: string; text: string } // mensagem do usuário: entra no chat e o turno começa
  | { type: "event"; event: ServerEvent } // evento SSE ao vivo
  | { type: "turn_failed"; text: string } // erro HTTP antes do primeiro evento
  | { type: "set_loaded"; set: SetDetail }
  | { type: "approval_decided"; approvalId: string; status: ApprovalStatus | "expired" }
  | { type: "view_version"; version: number | null }
  | { type: "panel"; open?: boolean; tab?: PanelTab }
  | { type: "sidebar"; open: boolean }
  | { type: "overlay"; overlay: Overlay };

let seq = 0;
export const nextId = (): string => `i${++seq}`;

const CREATE_TOOL = "spotify_create_playlist_from_order";

/** Aplica um evento do servidor aos itens do chat (usado ao vivo e na releitura de turnos). */
export function applyEvent(items: ChatItem[], event: ServerEvent): ChatItem[] {
  switch (event.type) {
    case "text":
      return [...items, { kind: "text", id: nextId(), text: event.text }];
    case "tool_start":
      return [...items, { kind: "tool", id: event.tool_use_id, tool: event.tool, detail: event.detail, status: "running", activity: activityForTool(event.tool) }];
    case "tool_end":
      return items.map((it) =>
        it.kind === "tool" && it.id === event.tool_use_id
          ? { ...it, status: event.is_error ? "error" : "done", detail: event.detail || it.detail, ...(event.summary ? { summary: event.summary } : {}) }
          : it,
      );
    case "approval": {
      // a ferramenta de criar playlist fica "aguardando você" enquanto a approval está pendente
      const status = event.status ?? "pending";
      const withTool = items.map((it) =>
        it.kind === "tool" && it.tool === CREATE_TOOL && it.status === "running" && status === "pending" ? { ...it, status: "waiting" as const } : it,
      );
      return [...withTool, { kind: "approval", id: event.approval_id, set_id: event.set_id, playlist_name: event.playlist_name, track_count: event.track_count, track_ids: event.track_ids, status }];
    }
    case "set":
      return [...items, { kind: "set", id: nextId(), set_id: event.set_id, version: event.version, status: event.status }];
    case "error":
      return [...items, { kind: "error", id: nextId(), text: event.message }];
    default:
      return items; // session, done
  }
}

/** Reconstrói o chat a partir dos turnos gravados (GET /api/sessions/:id). */
export function itemsFromTurns(turns: Turn[]): ChatItem[] {
  let items: ChatItem[] = [];
  for (const turn of turns) {
    items = [...items, { kind: "user", id: turn.id, text: turn.user_message }];
    for (const event of turn.events) items = applyEvent(items, event);
  }
  return items;
}

/** Atividade do orb depois de um evento: a última ferramenta rodando, ou "composing" quando o texto chega. */
function activityAfter(items: ChatItem[], event: ServerEvent, busy: boolean): Activity {
  if (!busy) return "idle";
  if (event.type === "approval") return "idle"; // gate aguardando aprovação = breathing
  const running = [...items].reverse().find((it) => it.kind === "tool" && it.status === "running");
  if (running && running.kind === "tool") return running.activity;
  return "composing";
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "theme":
      return { ...state, theme: action.theme };
    case "status":
      return { ...state, status: action.status };
    case "playlists": {
      // ponytail: contexto inicial = a primeira playlist que não é um set já enviado ([DJ MIX] …)
      const first = action.playlists.find((p) => !p.name.startsWith("[DJ MIX]")) ?? action.playlists[0] ?? null;
      return { ...state, playlists: action.playlists, playlist: state.playlist ?? first };
    }
    case "playlist":
      return { ...state, playlist: action.playlist };
    case "sessions":
      return { ...state, sessions: action.sessions };
    case "settings":
      return { ...state, settings: action.settings };
    case "new_chat":
      return { ...state, sessionId: null, items: [], set: null, viewVersion: null, busy: false, activity: "idle", overlay: null, panel: { ...state.panel, open: false } };
    case "session_loaded":
      return { ...state, sessionId: action.sessionId, items: action.items, set: action.set, viewVersion: null, busy: false, activity: "idle", overlay: null };
    case "send":
      return { ...state, items: [...state.items, { kind: "user", id: action.id, text: action.text }], busy: true, activity: "composing" };
    case "event": {
      const e = action.event;
      if (e.type === "session") return { ...state, sessionId: e.session_id };
      const items = applyEvent(state.items, e);
      const busy = e.type !== "done" && e.type !== "error";
      const next: AppState = { ...state, items, busy, activity: activityAfter(items, e, busy) };
      if (e.type === "done") next.lastCost = e.cost_usd;
      if (e.type === "set") next.viewVersion = null; // versão nova: o painel volta para a mais recente
      return next;
    }
    case "turn_failed":
      return { ...state, items: [...state.items, { kind: "error", id: nextId(), text: action.text }], busy: false, activity: "idle" };
    case "set_loaded":
      return { ...state, set: action.set };
    case "approval_decided":
      return {
        ...state,
        items: state.items.map((it) => {
          if (it.kind === "approval" && it.id === action.approvalId) return { ...it, status: action.status };
          if (it.kind === "tool" && it.tool === CREATE_TOOL && it.status === "waiting" && action.status !== "approved")
            return { ...it, status: "error", detail: action.status === "rejected" ? "não aprovado" : "aprovação expirada" };
          return it;
        }),
        activity: state.busy && action.status === "approved" ? "shipping" : state.activity,
      };
    case "view_version":
      return { ...state, viewVersion: action.version };
    case "panel":
      return { ...state, panel: { open: action.open ?? state.panel.open, tab: action.tab ?? state.panel.tab } };
    case "sidebar":
      return { ...state, sidebarOpen: action.open };
    case "overlay":
      return { ...state, overlay: action.overlay };
  }
}

// ---------- seletores ----------

/** Versão mostrada no painel: a escolhida em `viewVersion` ou a mais recente. */
export function selectVersion(state: AppState): SetVersionDetail | null {
  const versions = state.set?.versions ?? [];
  if (versions.length === 0) return null;
  if (state.viewVersion !== null) return versions.find((v) => v.version === state.viewVersion) ?? versions[versions.length - 1] ?? null;
  return versions[versions.length - 1] ?? null;
}

/** Há um turno esperando o clique de aprovação? */
export function pendingApproval(state: AppState): Extract<ChatItem, { kind: "approval" }> | null {
  const found = [...state.items].reverse().find((it) => it.kind === "approval" && it.status === "pending");
  return found && found.kind === "approval" ? found : null;
}

/** Título/artista a partir do rótulo "Título — Artista" do MCP. */
export function splitLabel(label: string): { title: string; artist: string } {
  const i = label.indexOf(" — ");
  return i < 0 ? { title: label, artist: "" } : { title: label.slice(0, i), artist: label.slice(i + 3) };
}
