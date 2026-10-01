/**
 * Estado da apps/web: um reducer puro (sem React) e as funções que traduzem eventos do servidor em itens do chat.
 * CONTRATO entre as trilhas shell (src/shell: efeitos, fetch, SSE) e painel (src/panel: só lê `set`, `viewVersion`, `panel`).
 * Check runnable: src/tests/logic.test.ts.
 */
import { activityForTool, type Activity } from "./activity.ts";
import type { ApprovalStatus, Playlist, Question, QuestionOption, QuestionsStatus, ServerEvent, SessionListItem, SetDetail, SetStatus, SetVersionDetail, Settings, Status, Turn } from "./types.ts";

export type Theme = "dark" | "light";
export type PanelTab = "ordem" | "transicoes" | "guia";
export type ToolStatus = "running" | "done" | "error" | "waiting";

/** Um item da coluna do chat, na ordem em que aconteceu. */
export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "text"; id: string; text: string } // bloco de texto do Play.Me (markdown simples)
  | { kind: "tool"; id: string; tool: string; detail: string; status: ToolStatus; activity: Activity; summary?: Record<string, number | boolean | null> } // summary: números das ferramentas de metadados (card de cobertura)
  | { kind: "approval"; id: string; set_id: string | null; playlist_name: string; track_count: number; track_ids: string[]; status: ApprovalStatus | "expired" }
  | { kind: "questions"; id: string; title: string | null; questions: Question[]; status: QuestionsStatus; answers: Record<string, string | null> | null } // Sprint 6: perguntas do ask_dj (id = questions_id); answers null = sem resposta ainda
  | { kind: "set"; id: string; set_id: string; version: number; status: SetStatus } // marcador: a tela mostra o card da passagem mais arriscada e os atalhos
  | { kind: "error"; id: string; text: string }
  | { kind: "thinking"; id: string; text: string; live: boolean } // Sprint 5: raciocínio do agente (live = ainda chegando)
  | { kind: "draft"; id: string; text: string }; // Sprint 5: texto da resposta ainda em streaming

export type Overlay = { kind: "transition"; position: number } | { kind: "track"; trackId: string } | { kind: "settings" } | { kind: "questions" } | null;

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
  | { type: "questions_done"; questionsId: string; status: QuestionsStatus; answers: Record<string, string | null> | null } // resposta do DJ (otimista); "pending" desfaz (erro de rede)
  | { type: "view_version"; version: number | null }
  | { type: "panel"; open?: boolean; tab?: PanelTab }
  | { type: "sidebar"; open: boolean }
  | { type: "overlay"; overlay: Overlay };

let seq = 0;
export const nextId = (): string => `i${++seq}`;

const CREATE_TOOL = "spotify_create_playlist_from_order";
const ASK_TOOL = "ask_dj"; // casa pelo sufixo: o servidor pode ou não cortar o prefixo mcp__playme__

/** Aplica um evento do servidor aos itens do chat (usado ao vivo e na releitura de turnos). */
export function applyEvent(items: ChatItem[], event: ServerEvent): ChatItem[] {
  switch (event.type) {
    case "text":
      return [...withoutDraft(items), { kind: "text", id: nextId(), text: event.text }];
    case "thinking_delta": {
      const last = items[items.length - 1];
      if (last?.kind === "thinking" && last.live) return [...items.slice(0, -1), { ...last, text: last.text + event.text }];
      return [...items, { kind: "thinking", id: nextId(), text: event.text, live: true }];
    }
    case "thinking": {
      const idx = items.findLastIndex((it) => it.kind === "thinking" && it.live);
      if (idx >= 0) return items.map((it, i) => (i === idx && it.kind === "thinking" ? { ...it, text: event.text, live: false } : it));
      return [...items, { kind: "thinking", id: nextId(), text: event.text, live: false }];
    }
    case "text_delta": {
      const last = items[items.length - 1];
      if (last?.kind === "draft") return [...items.slice(0, -1), { ...last, text: last.text + event.text }];
      return [...settleThinking(items), { kind: "draft", id: nextId(), text: event.text }];
    }
    case "tool_start":
      return [...settle(items), { kind: "tool", id: event.tool_use_id, tool: event.tool, detail: event.detail, status: "running", activity: activityForTool(event.tool) }];
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
    case "questions": {
      // ao vivo vem sem status (pendente); na releitura, o estado final e as respostas. A pílula do ask_dj fica "aguardando você" enquanto espera, como a da criação com o gate
      const status = event.status ?? "pending";
      const withTool = items.map((it) => (it.kind === "tool" && it.tool.endsWith(ASK_TOOL) && it.status === "running" && status === "pending" ? { ...it, status: "waiting" as const } : it));
      return [...withTool, { kind: "questions", id: event.questions_id, title: event.title, questions: event.questions, status, answers: event.answers ?? null }];
    }
    case "set":
      return [...items, { kind: "set", id: nextId(), set_id: event.set_id, version: event.version, status: event.status }];
    case "error":
      return [...expirePending(settle(items)), { kind: "error", id: nextId(), text: event.message }];
    case "done":
      return expirePending(settle(items));
    default:
      return items; // session
  }
}

/** Fim de um bloco: rascunho vira texto e pensamento vivo vira final (o SDK sempre manda o bloco completo depois; se não mandar, nada se perde). */
function settle(items: ChatItem[]): ChatItem[] {
  return settleThinking(items).map((it) => (it.kind === "draft" ? { kind: "text", id: it.id, text: it.text } : it));
}
function settleThinking(items: ChatItem[]): ChatItem[] {
  return items.map((it) => (it.kind === "thinking" && it.live ? { ...it, live: false } : it));
}
function withoutDraft(items: ChatItem[]): ChatItem[] {
  return items.filter((it) => it.kind !== "draft");
}
/** O turno acabou sem resposta (done, error ou queda do stream): ninguém mais espera as perguntas pendentes. */
function expirePending(items: ChatItem[]): ChatItem[] {
  return items.map((it) => (it.kind === "questions" && it.status === "pending" ? { ...it, status: "expired" as const } : it));
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
  if (event.type === "approval" || event.type === "questions") return "idle"; // gate ou perguntas aguardando o DJ = breathing
  if (event.type === "thinking_delta" || event.type === "text_delta" || event.type === "thinking") return "composing";
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
      if (e.type === "questions" && (e.status ?? "pending") === "pending") next.overlay = { kind: "questions" }; // ao vivo a janela abre sozinha (por cima de qualquer gaveta); fechá-la não perde as perguntas: o chat reabre
      return next;
    }
    case "turn_failed":
      return { ...state, items: [...expirePending(state.items), { kind: "error", id: nextId(), text: action.text }], busy: false, activity: "idle" };
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
    case "questions_done":
      return {
        ...state,
        items: state.items.map((it) => (it.kind === "questions" && it.id === action.questionsId ? { ...it, status: action.status, answers: action.answers } : it)),
        // respondida: o agente volta a trabalhar; devolvida a pendente (erro de rede): volta a esperar o DJ
        activity: state.busy ? (action.status === "pending" ? "idle" : "composing") : state.activity,
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

/** Há um turno esperando as respostas do modal de perguntas? */
export function pendingQuestions(state: AppState): Extract<ChatItem, { kind: "questions" }> | null {
  const found = [...state.items].reverse().find((it) => it.kind === "questions" && it.status === "pending");
  return found && found.kind === "questions" ? found : null;
}

/** Opções na ordem da janela: a recomendada primeiro (ordem estável). O " (Recomendado)" é da UI; a resposta gravada é só o label. */
export function orderOptions(options: QuestionOption[]): QuestionOption[] {
  return [...options.filter((o) => o.recommended), ...options.filter((o) => !o.recommended)];
}

/** "tamanho 1 hora · curva pulada": o que ficou decidido, para a linha do chat. Rótulo = header ou id da pergunta. */
export function answersLine(item: Extract<ChatItem, { kind: "questions" }>): string {
  return item.questions.map((q) => `${(q.header ?? q.id).replace(/_/g, " ").toLowerCase()} ${item.answers?.[q.id] ?? "pulada"}`).join(" · ");
}

/** Título/artista a partir do rótulo "Título — Artista" do MCP. */
export function splitLabel(label: string): { title: string; artist: string } {
  const i = label.indexOf(" — ");
  return i < 0 ? { title: label, artist: "" } : { title: label.slice(0, i), artist: label.slice(i + 3) };
}
