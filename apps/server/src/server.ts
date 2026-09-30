/** Servidor HTTP (node:http puro): SSE do chat, leitura de sessões/sets e decisão de approvals. */
import http from "node:http";
import type { ApprovalWaiter } from "./approvals.js";
import type { Repo } from "./repo.js";
import type { ServerEvent } from "./types.js";

export interface HttpDeps {
  repo: Repo;
  waiter: ApprovalWaiter;
  chat: (chatSessionId: string, message: string, emit: (e: ServerEvent) => void, signal: AbortSignal) => Promise<void>;
}

const ORIGINS = new Set(["http://127.0.0.1:5173", "http://localhost:5173"]);
const MAX_BODY = 64 * 1024;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "Corpo da requisição grande demais (máximo 64 KB).");
    chunks.push(chunk as Buffer);
  }
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // cai no erro abaixo
  }
  throw new HttpError(400, "JSON inválido.");
}

export function createHttpServer(deps: HttpDeps): http.Server {
  const { repo, waiter, chat } = deps;
  const busy = new Set<string>(); // sessões com turno de chat em andamento

  const setDetail = (id: string) => {
    const set = repo.getSet(id);
    if (!set) return undefined;
    const latest = repo.latestVersion(id);
    return { set, versions: repo.listVersions(id), plans: latest ? repo.listPlans(latest.id) : [] };
  };

  async function route(req: http.IncomingMessage, res: http.ServerResponse, json: (status: number, body: unknown) => void): Promise<void> {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const method = req.method ?? "GET";

    if (method === "GET" && path === "/api/sessions") return json(200, repo.listSessions());

    let m = /^\/api\/sessions\/([^/]+)$/.exec(path);
    if (m && method === "GET") {
      const id = decodeURIComponent(m[1] ?? "");
      const session = repo.getSession(id);
      if (!session) throw new HttpError(404, "Sessão não encontrada.");
      const set = repo.getCurrentSet(id);
      const detail = set ? setDetail(set.id) : undefined;
      return json(200, { session, set: set ?? null, versions: detail?.versions ?? [], plans: detail?.plans ?? [] });
    }

    m = /^\/api\/sets\/([^/]+)$/.exec(path);
    if (m && method === "GET") {
      const detail = setDetail(decodeURIComponent(m[1] ?? ""));
      if (!detail) throw new HttpError(404, "Set não encontrado.");
      return json(200, detail);
    }

    m = /^\/api\/approvals\/([^/]+)$/.exec(path);
    if (m && method === "POST") {
      const id = decodeURIComponent(m[1] ?? "");
      const { decision } = await readJson(req);
      if (decision !== "approved" && decision !== "rejected") throw new HttpError(400, 'decision deve ser "approved" ou "rejected".');
      const current = repo.getApproval(id);
      if (!current) throw new HttpError(404, "Aprovação não encontrada.");
      if (current.status !== "pending") throw new HttpError(409, "Aprovação já decidida.");
      if (!waiter.has(id)) {
        // ninguém esperando (restart ou conversa encerrada): expira e devolve o set a rascunho
        repo.decideApproval(id, "rejected");
        const set = current.set_id ? repo.getSet(current.set_id) : undefined;
        if (set?.status === "aguardando_aprovacao") repo.setStatus(set.id, "rascunho");
        throw new HttpError(409, "Esta aprovação expirou. Peça o envio de novo no chat.");
      }
      const approval = repo.decideApproval(id, decision);
      waiter.resolve(id, decision);
      return json(200, approval);
    }

    if (method === "POST" && path === "/api/chat") {
      const body = await readJson(req);
      const message = body.message;
      if (typeof message !== "string" || message.trim() === "" || message.length > 4000)
        throw new HttpError(400, "message é obrigatória (texto de 1 a 4000 caracteres).");
      let sessionId: string;
      if (body.session_id !== undefined && body.session_id !== null) {
        if (typeof body.session_id !== "string" || !repo.getSession(body.session_id)) throw new HttpError(404, "Sessão não encontrada.");
        sessionId = body.session_id;
      } else {
        sessionId = repo.createSession(message.slice(0, 60)).id;
      }
      if (busy.has(sessionId)) throw new HttpError(409, "Já há uma resposta em andamento nesta conversa.");
      busy.add(sessionId);
      // cliente que desconecta: cancela o turno (e a espera de aprovação, que vira rejeição)
      const abort = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) abort.abort();
      });
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" });
      const emit = (e: ServerEvent): void => {
        if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(e)}\n\n`);
      };
      emit({ type: "session", session_id: sessionId });
      try {
        await chat(sessionId, message, emit, abort.signal);
      } catch (err) {
        console.error("chat falhou:", err instanceof Error ? err.message : err);
        emit({ type: "error", message: "Erro inesperado no chat." });
      } finally {
        busy.delete(sessionId);
      }
      res.end();
      return;
    }

    throw new HttpError(404, "Rota não encontrada.");
  }

  return http.createServer((req, res) => {
    const deny = (status: number, error: string): void => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error }));
    };
    // DNS rebinding: só aceita o próprio host local
    const port = req.socket.localPort;
    const host = req.headers.host;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return deny(403, "Host não permitido.");
    // CSRF: origem de navegador só a do Vite; POST só com JSON (força preflight, que o CORS barra)
    const origin = req.headers.origin;
    if (origin && !ORIGINS.has(origin)) return deny(403, "Origem não permitida.");
    if (req.method === "POST" && !(req.headers["content-type"] ?? "").startsWith("application/json"))
      return deny(415, "Envie o corpo como application/json.");
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type" });
      res.end();
      return;
    }
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(body));
    };
    route(req, res, json).catch((err: unknown) => {
      if (res.headersSent) return void res.end();
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      json(500, { error: "Erro interno do servidor." });
    });
  });
}
