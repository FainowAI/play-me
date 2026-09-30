/**
 * Agente: Claude Agent SDK + MCP spotify-dj, com o gate de aprovação.
 * CONTRATO: runChat é usada pela trilha HTTP; a implementação é da trilha agente.
 */
import { query, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { ApprovalWaiter } from "./approvals.js";
import type { Repo } from "./repo.js";
import type { PlanInput, ServerEvent } from "./types.js";

export interface ChatDeps {
  repo: Repo;
  waiter: ApprovalWaiter;
  /** Caminho absoluto de packages/mcp-server/dist/index.js. */
  mcpServerPath: string;
  /** Variáveis repassadas ao MCP (SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI, SPOTIFY_DJ_DATA_DIR…). */
  mcpEnv: Record<string, string>;
  model: string;
  /** Teto de gasto por turno de chat, em dólares. */
  maxBudgetUsd: number;
}

const MCP_PREFIX = "mcp__spotify-dj__";
const CREATE_TOOL = `${MCP_PREFIX}spotify_create_playlist_from_order`;

const SYSTEM_PROMPT = `Você é o assistente de DJ do Play.Me. Responda sempre em português.
Use as ferramentas do spotify-dj para ler playlists, consultar BPM e tom, montar e avaliar sets.
Nunca invente BPM nem tom: use só o que as ferramentas devolvem. Quando o tom estiver "a confirmar no Mixar", avise o usuário.
Mostre o plano de transições e o guia do Mix quando fizer sentido.
Nunca crie playlist no Spotify por conta própria: só chame a ferramenta de criar playlist quando o usuário pedir o envio. O envio passa por um botão de aprovação na tela; se o usuário não aprovar, o set continua como rascunho.
Não use emojis. Use os termos das ferramentas sem trocar: a nota da passagem (0 a 1, do montador) é diferente da confiança do plano de transição.`;

/** `tools: []` já desliga as nativas; a lista é cinto e suspensório. */
const NATIVE_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch", "Agent", "Task", "NotebookEdit", "TodoWrite", "Skill", "AskUserQuestion"];

export interface TurnCtx {
  repo: Repo;
  waiter: ApprovalWaiter;
  emit: (event: ServerEvent) => void;
  chatSessionId: string;
  /** Mensagem do usuário, gravada como nota da versão. */
  note: string;
  /** Set da approval aprovada neste turno: é nele que o resultado do envio é gravado. */
  approvedSetId?: string;
}

export interface Proposal {
  curve: string;
  order: string[];
  plans: PlanInput[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** ID puro de uma faixa a partir de ID, URI (spotify:track:ID) ou link. */
export function trackIdOf(value: string): string {
  return (value.split("?")[0] ?? value).split(/[:/]/).pop() ?? value;
}

/** Extrai a proposta de set do resultado estruturado de dj_build_set / dj_evaluate_order. */
export function extractProposal(data: unknown): Proposal | null {
  if (!isObj(data)) return null;
  const ids = Array.isArray(data.ordered_track_ids)
    ? data.ordered_track_ids
    : Array.isArray(data.order)
      ? data.order.map((o) => (isObj(o) ? o.track_id : undefined))
      : [];
  const order = ids.filter((id): id is string => typeof id === "string");
  if (order.length === 0) return null;
  const transitions = Array.isArray(data.transitions) ? data.transitions : [];
  const plans: PlanInput[] = [];
  if (Array.isArray(data.plans)) {
    data.plans.forEach((plan, i) => {
      if (!isObj(plan) || typeof plan.from !== "string" || typeof plan.to !== "string") return;
      const t = transitions[i];
      const total = isObj(t) && isObj(t.scores) && typeof t.scores.total === "number" ? t.scores.total : null;
      plans.push({
        position: i + 1,
        from_track: plan.from,
        to_track: plan.to,
        plan,
        planner_version: typeof plan.planner_version === "string" ? plan.planner_version : "meta-1",
        score: total,
      });
    });
  }
  return { curve: typeof data.curve === "string" ? data.curve : "classic", order, plans };
}

/** Id e link da playlist criada (saída de spotify_create_playlist_from_order). */
export function extractCreated(data: unknown): { playlist_id: string; url: string | null } | null {
  if (!isObj(data) || typeof data.playlist_id !== "string") return null;
  return { playlist_id: data.playlist_id, url: typeof data.url === "string" ? data.url : null };
}

/** Dado estruturado de um tool_result: tool_use_result (structuredContent) ou, se faltar, o texto quando for JSON. */
export function structuredOf(toolUseResult: unknown, block?: { content?: unknown }): unknown {
  if (isObj(toolUseResult)) return isObj(toolUseResult.structuredContent) ? toolUseResult.structuredContent : toolUseResult;
  const c = block?.content;
  const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (isObj(b) && typeof b.text === "string" ? b.text : "")).join("") : "";
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function emitSet(ctx: TurnCtx, setId: string): void {
  const set = ctx.repo.getSet(setId);
  const version = ctx.repo.latestVersion(setId);
  if (set && version) ctx.emit({ type: "set", set_id: set.id, version: version.version, status: set.status });
}

/** Grava a proposta (versão + planos) e avisa a tela. */
export function recordFromResult(ctx: TurnCtx, data: unknown): void {
  const proposal = extractProposal(data);
  if (!proposal) return;
  const name = ctx.repo.getSession(ctx.chatSessionId)?.title ?? "Set";
  const { set, version } = ctx.repo.recordProposal(ctx.chatSessionId, name, proposal.curve, proposal.order, ctx.note);
  ctx.repo.savePlans(version.id, proposal.plans);
  emitSet(ctx, set.id);
}

/** Gate do canUseTool: leitura do spotify-dj passa; criar playlist exige clique de aprovação; o resto é negado. */
export async function gate(ctx: TurnCtx, toolName: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<PermissionResult> {
  if (toolName !== CREATE_TOOL) {
    return toolName.startsWith(MCP_PREFIX) ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: "Ferramenta não disponível no Play.Me." };
  }
  const { repo, chatSessionId } = ctx;
  const current = repo.getCurrentSet(chatSessionId);
  const order = Array.isArray(input.track_ids) ? input.track_ids.filter((v): v is string => typeof v === "string").map(trackIdOf) : [];
  const playlistName = typeof input.name === "string" ? input.name : (current?.name ?? "[DJ MIX]");
  const setName = current?.name ?? repo.getSession(chatSessionId)?.title ?? playlistName;
  const { set } = repo.recordProposal(chatSessionId, setName, current?.curve ?? "classic", order, ctx.note);
  repo.setStatus(set.id, "aguardando_aprovacao");
  const approval = repo.createApproval(chatSessionId, set.id, "spotify_create_playlist_from_order", input);
  emitSet(ctx, set.id);
  ctx.emit({ type: "approval", approval_id: approval.id, set_id: set.id, playlist_name: playlistName, track_count: order.length, track_ids: order });
  const decision = await ctx.waiter.wait(approval.id, signal);
  if (decision === "approved") {
    ctx.approvedSetId = set.id;
    return { behavior: "allow", updatedInput: input };
  }
  // cliente desconectou: a approval ainda está pendente no banco
  if (repo.getApproval(approval.id)?.status === "pending") repo.decideApproval(approval.id, "rejected");
  if (repo.getSet(set.id)?.status === "aguardando_aprovacao") repo.setStatus(set.id, "rascunho");
  emitSet(ctx, set.id);
  return { behavior: "deny", message: "O usuário não aprovou o envio ao Spotify. O set voltou para rascunho." };
}

/** Depois do tool_result de criar playlist: enviado (com id/url) ou volta a rascunho. */
export function finishCreate(ctx: TurnCtx, data: unknown, isError: boolean): void {
  const set = ctx.approvedSetId ? ctx.repo.getSet(ctx.approvedSetId) : undefined;
  ctx.approvedSetId = undefined;
  if (!set || set.status !== "aguardando_aprovacao") return;
  const created = isError ? null : extractCreated(data);
  if (created) ctx.repo.setStatus(set.id, "enviado", { playlist_id: created.playlist_id, url: created.url });
  else ctx.repo.setStatus(set.id, "rascunho");
  emitSet(ctx, set.id);
}

/**
 * Roda um turno do chat numa sessão existente e emite os eventos na ordem.
 * Sempre termina com um evento "done" ou "error"; nunca lança para quem chamou.
 */
export async function runChat(deps: ChatDeps, chatSessionId: string, userMessage: string, emit: (event: ServerEvent) => void, signal?: AbortSignal): Promise<void> {
  try {
    const ctx: TurnCtx = { repo: deps.repo, waiter: deps.waiter, emit, chatSessionId, note: userMessage };
    const resume = deps.repo.getSession(chatSessionId)?.agent_session_id;
    const tools = new Map<string, string>(); // tool_use_id -> nome sem prefixo
    const abortController = new AbortController();
    signal?.addEventListener("abort", () => abortController.abort(), { once: true });
    const q = query({
      prompt: userMessage,
      options: {
        model: deps.model,
        systemPrompt: SYSTEM_PROMPT,
        mcpServers: { "spotify-dj": { type: "stdio", command: process.execPath, args: ["--no-warnings", deps.mcpServerPath], env: deps.mcpEnv } },
        settingSources: [],
        tools: [],
        disallowedTools: NATIVE_TOOLS,
        canUseTool: (name, input, opts) => gate(ctx, name, input, opts.signal),
        abortController,
        maxTurns: 20,
        maxBudgetUsd: deps.maxBudgetUsd,
        // ponytail: sem `env`, o SDK herda process.env (ANTHROPIC_API_KEY incluída)
        ...(resume ? { resume } : {}),
      },
    });
    for await (const msg of q) {
      if (msg.type === "system" && msg.subtype === "init") {
        deps.repo.setAgentSessionId(chatSessionId, msg.session_id);
      } else if (msg.type === "assistant") {
        for (const block of msg.message.content) {
          if (block.type === "text") emit({ type: "text", text: block.text });
          else if (block.type === "tool_use") {
            const tool = block.name.replace(MCP_PREFIX, "");
            tools.set(block.id, tool);
            emit({ type: "tool_start", tool, tool_use_id: block.id });
          }
        }
      } else if (msg.type === "user" && Array.isArray(msg.message.content)) {
        for (const block of msg.message.content) {
          if (block.type !== "tool_result") continue;
          const tool = tools.get(block.tool_use_id) ?? "";
          const isError = block.is_error === true;
          emit({ type: "tool_end", tool, tool_use_id: block.tool_use_id, is_error: isError });
          if (tool === "spotify_create_playlist_from_order") finishCreate(ctx, structuredOf(msg.tool_use_result, block), isError);
          else if (!isError && (tool === "dj_build_set" || tool === "dj_evaluate_order")) recordFromResult(ctx, structuredOf(msg.tool_use_result, block));
        }
      } else if (msg.type === "result") {
        if (msg.subtype === "success") emit({ type: "done", cost_usd: msg.total_cost_usd ?? null });
        else emit({ type: "error", message: "O agente terminou com erro. Tente de novo." });
        return;
      }
    }
    emit({ type: "error", message: "O agente encerrou sem resposta." });
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    console.error("agente falhou:", raw.replace(/sk-[A-Za-z0-9_-]+/g, "[chave]"));
    emit({ type: "error", message: signal?.aborted ? "Conversa encerrada." : "Falha no agente. Veja o log do servidor." });
  }
}
