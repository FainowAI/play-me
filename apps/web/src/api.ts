/**
 * Cliente da API do apps/server (127.0.0.1:8787). Só JSON e SSE; nenhuma chave passa por aqui.
 * CONTRATO: usado pela trilha shell (src/shell) e pelo painel (src/panel).
 */
import type { ApprovalStatus, Playlist, ServerEvent, SessionDetail, SessionListItem, SetDetail, Settings, Status, TransitionFeedback } from "./types.ts";

export const API_BASE = "http://127.0.0.1:8787";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_BASE + path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const msg = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : `Erro ${res.status}.`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const api = {
  status: () => request<Status>("GET", "/api/status"),
  playlists: () => request<{ items: Playlist[] }>("GET", "/api/playlists"),
  sessions: () => request<SessionListItem[]>("GET", "/api/sessions"),
  session: (id: string) => request<SessionDetail>("GET", `/api/sessions/${encodeURIComponent(id)}`),
  set: (id: string) => request<SetDetail>("GET", `/api/sets/${encodeURIComponent(id)}`),
  decide: (approvalId: string, decision: Exclude<ApprovalStatus, "pending">) =>
    request<{ id: string; status: ApprovalStatus }>("POST", `/api/approvals/${encodeURIComponent(approvalId)}`, { decision }),
  /** Sprint 6: respostas do modal de perguntas (ask_dj); null = pulada. 404 e 409: já respondida, expirada ou o servidor reiniciou. */
  answer: (questionsId: string, answers: Record<string, string | null>) =>
    request<{ status: "answered" | "skipped" }>("POST", `/api/questions/${encodeURIComponent(questionsId)}`, { answers }),
  settings: () => request<Settings>("GET", "/api/settings"),
  /** Sprint 4 (7.1.1): nota 1–5 de uma passagem; devolve a nota gravada. */
  rate: (planId: string, rating: number, notes?: string) =>
    request<TransitionFeedback>("POST", `/api/plans/${encodeURIComponent(planId)}/feedback`, { rating, ...(notes ? { notes } : {}) }),
  saveSettings: (settings: Settings) => request<Settings>("PUT", "/api/settings", settings),
};

/** Separa os eventos completos ("data: {...}\n\n") de um buffer SSE; devolve o resto ainda incompleto. */
export function parseSseChunk(buffer: string): { events: ServerEvent[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: ServerEvent[] = [];
  for (const part of parts) {
    const data = part
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data) continue;
    try {
      events.push(JSON.parse(data) as ServerEvent);
    } catch {
      events.push({ type: "error", message: "Evento inválido do servidor." });
    }
  }
  return { events, rest };
}

/**
 * POST /api/chat com streaming. Chama onEvent para cada evento na ordem; resolve quando o servidor fecha.
 * Erros HTTP (409 "já há uma resposta em andamento", 404 sessão) viram ApiError antes do primeiro evento.
 */
export async function streamChat(
  body: { session_id: string | null; message: string },
  onEvent: (event: ServerEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const data: unknown = await res.json().catch(() => undefined);
    const msg = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : `Erro ${res.status}.`;
    throw new ApiError(res.status, msg);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const parsed = parseSseChunk(buffer);
    buffer = parsed.rest;
    for (const event of parsed.events) onEvent(event);
  }
  const tail = parseSseChunk(buffer + "\n\n");
  for (const event of tail.events) onEvent(event);
}
