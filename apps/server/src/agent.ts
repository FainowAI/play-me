/**
 * Agente: Claude Agent SDK + MCP spotify-dj, com o gate de aprovação.
 * CONTRATO: runChat é usada pela trilha HTTP; a implementação é da trilha agente.
 */
import { query, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { AnalysisStore } from "spotify-dj-mcp-server/dist/services/analysis-store.js";
import { sectionFor, targetEnergy } from "spotify-dj-mcp-server/dist/services/dj-engine.js";
import type { CurvePreset, SetPosition, TrackAnalysis } from "spotify-dj-mcp-server/dist/types.js";
import type { ApprovalWaiter } from "./approvals.js";
import type { Repo } from "./repo.js";
import type { SettingsStore } from "./settings.js";
import type { PlanInput, ServerEvent, SetSnapshot, SnapshotTrack, Weights } from "./types.js";

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
  /** Pasta do store do MCP (analysis.json). O servidor só lê: nunca escreve nele. */
  storeDir: string;
  /** Pesos da nota do par escolhidos na tela de Configurações. */
  settings: Pick<SettingsStore, "get">;
  /** Nome da playlist pelo id (cache de playlists do Spotify); undefined enquanto a lista não foi lida. */
  playlistName: (id: string) => string | undefined;
  /** ponytail: só os testes trocam o SDK por um falso. */
  query?: typeof query;
}

const MCP_PREFIX = "mcp__spotify-dj__";
const CREATE_TOOL = `${MCP_PREFIX}spotify_create_playlist_from_order`;

const SYSTEM_PROMPT = `Você é o assistente de DJ do Play.Me. Responda sempre em português.
Use as ferramentas do spotify-dj para ler playlists, consultar BPM e tom, montar e avaliar sets.
Nunca invente BPM nem tom: use só o que as ferramentas devolvem. Quando o tom estiver "a confirmar no Mixar", avise o usuário.
Mostre o plano de transições e o guia do Mix quando fizer sentido.
Nunca crie playlist no Spotify por conta própria: só chame a ferramenta de criar playlist quando o usuário pedir o envio. O envio passa por um botão de aprovação na tela; se o usuário não aprovar, o set continua como rascunho.
Não use emojis. Use os termos das ferramentas sem trocar: a nota da passagem (0 a 1, do montador) é diferente da confiança do plano de transição.
Você só tem as ferramentas do spotify-dj: não existe Bash, PowerShell, leitura de arquivos nem outra ferramenta. Nunca tente ler ou rodar nada. Se um resultado de ferramenta vier grande ou resumido, use o que já chegou e siga; nunca repita a mesma chamada para "ler o arquivo".`;

/** Linha extra do system prompt com os pesos do usuário (porcentagem inteira, em fração com ponto). */
const weightsLine = (w: Weights): string => {
  const f = (n: number): string => (n / 100).toFixed(2);
  return `Pesos da nota do par escolhidos pelo usuário (frações que somam 1): camelot ${f(w.camelot)}, bpm ${f(w.bpm)}, energy ${f(w.energy)}, style ${f(w.style)}, progression ${f(w.progression)}. Passe-os no parâmetro weights de dj_build_set e dj_evaluate_order.`;
};

/** `tools: []` já desliga as nativas; a lista é cinto e suspensório. */
const NATIVE_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch", "Agent", "Task", "NotebookEdit", "TodoWrite", "Skill", "AskUserQuestion"];

export interface TurnCtx {
  repo: Repo;
  waiter: ApprovalWaiter;
  emit: (event: ServerEvent) => void;
  chatSessionId: string;
  /** Mensagem do usuário, gravada como nota da versão. */
  note: string;
  /** Pasta do store do MCP. Cada leitura abre um AnalysisStore novo: o MCP é outro processo e grava no arquivo. */
  storeDir: string;
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

/** Texto de um tool_result (string ou lista de blocos de texto). */
const textOf = (content: unknown): string =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((b) => (isObj(b) && typeof b.text === "string" ? b.text : "")).join("") : "";

/** Dado estruturado de um tool_result: tool_use_result (structuredContent) ou, se faltar, o texto quando for JSON. */
export function structuredOf(toolUseResult: unknown, block?: { content?: unknown }): unknown {
  if (isObj(toolUseResult)) return isObj(toolUseResult.structuredContent) ? toolUseResult.structuredContent : toolUseResult;
  try {
    return JSON.parse(textOf(block?.content));
  } catch {
    return undefined;
  }
}

/** Primeira linha (até 160 caracteres) da mensagem de erro de uma ferramenta. */
/** Caminhos da máquina não vão à tela nem ao banco. */
const redactPaths = (s: string): string =>
  s.replace(/[A-Za-z]:[\\/][^\s"')]+/g, "[caminho]").replace(/(^|\s)\/(?:Users|home|mnt|tmp)\/[^\s"')]+/g, "$1[caminho]");
const firstLine = (text: string): string => {
  const first = text.trim().split(/\r?\n/)[0] ?? "";
  return first.length > 160 ? `${first.slice(0, 159)}…` : first;
};

// ---------- detalhe das ferramentas: uma linha em pt-BR, do input no tool_start e do resultado no tool_end ----------

/** Nomes para o detalhe: playlist pelo cache de playlists, faixa pelo rótulo do store; sem nome, o próprio id. */
export interface Names {
  playlist: (id: string) => string;
  track: (id: string) => string;
}

type Rec = Record<string, unknown>;
type Summary = Record<string, number | boolean | null>;

const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const len = (v: unknown): number | undefined => (Array.isArray(v) ? v.length : undefined);
const at = (o: unknown, ...path: string[]): unknown => path.reduce<unknown>((v, k) => (isObj(v) ? v[k] : undefined), o);
const plural = (n: number | undefined, one: string, many: string): string | undefined => (n === undefined ? undefined : `${n} ${n === 1 ? one : many}`);
const line = (...parts: (string | undefined)[]): string => parts.filter(Boolean).join(" · ");
const nota = (v: unknown): string | undefined => (typeof v === "number" ? v.toFixed(2).replace(".", ",") : undefined);
const TYPE_LABEL: Record<string, string> = { blend: "Blend", bass_swap: "Bass swap", filter: "Filtro", echo_out: "Echo out" };
/** Só chave própria: o tool_start sai antes do gate, e um nome estranho ("constructor") não pode cair no protótipo da tabela. */
const own = <T>(table: Record<string, T>, key: string): T | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);

const playlistOf = (i: Rec, nm: Names): string | undefined => {
  const p = str(i.playlist);
  return p ? nm.playlist(trackIdOf(p)) : undefined;
};
const sourceOf = (i: Rec, nm: Names): string | undefined => playlistOf(i, nm) ?? plural(len(i.track_ids), "faixa", "faixas");
const pairOf = (i: Rec, nm: Names): string | undefined => {
  const a = str(i.from_track);
  const b = str(i.to_track);
  return a && b ? `${nm.track(trackIdOf(a))} → ${nm.track(trackIdOf(b))}` : undefined;
};
const curveOf = (o: Rec): string | undefined => {
  const c = str(o.curve);
  return c ? `curva ${c}` : undefined;
};

const START: Record<string, (i: Rec, nm: Names) => string | undefined> = {
  spotify_get_playlist_tracks: playlistOf,
  spotify_search_tracks: (i) => str(i.query),
  spotify_create_playlist_from_order: (i) => line(plural(len(i.track_ids), "faixa", "faixas"), "privada"),
  dj_set_track_analysis: (i) => plural(len(i.tracks), "faixa", "faixas"),
  dj_score_transition: pairOf,
  dj_build_set: (i, nm) => line(sourceOf(i, nm), curveOf(i)),
  dj_evaluate_order: (i, nm) => line(sourceOf(i, nm), curveOf(i)),
  transition_plan: pairOf,
  export_mix_guide: sourceOf,
  metadata_lookup: (i, nm) => line(sourceOf(i, nm), i.dry_run === false ? "gravar" : "dry run"),
  metadata_coverage: playlistOf,
};

const END: Record<string, (r: Rec) => string | undefined> = {
  spotify_list_my_playlists: (r) => plural(num(r.total), "playlist", "playlists"),
  spotify_get_playlist_tracks: (r) => plural(num(r.total), "faixa", "faixas"),
  spotify_search_tracks: (r) => plural(len(r.results), "faixa", "faixas"),
  spotify_create_playlist_from_order: (r) => line(plural(num(r.tracks_added), "faixa", "faixas"), r.public === false ? "privada" : undefined),
  dj_set_track_analysis: (r) => plural(len(r.saved), "faixa salva", "faixas salvas"),
  dj_score_transition: (r) => {
    const total = nota(at(r, "transition", "scores", "total"));
    return total && `nota ${total}`;
  },
  dj_build_set: (r) => line(plural(len(r.order), "faixa", "faixas"), curveOf(r)),
  dj_evaluate_order: (r) => {
    const media = nota(r.average_score);
    return media && `nota média ${media}`;
  },
  transition_plan: (r) => {
    const bars = num(at(r, "plan", "length_bars"));
    return line(own(TYPE_LABEL, String(at(r, "plan", "type"))), bars === undefined ? undefined : `${bars} c.`);
  },
  export_mix_guide: (r) => plural(len(r.steps), "passagem", "passagens"),
};

/** Detalhe de uma chamada (e, nas ferramentas de metadados, os números): `start` lê o input; `end`, o resultado estruturado. */
export function summarize(tool: string, data: unknown, phase: "start" | "end", names: Names): { detail: string; summary?: Summary } {
  const d: Rec = isObj(data) ? data : {};
  if (phase === "start") return { detail: own(START, tool)?.(d, names) ?? "" };
  if (tool === "metadata_coverage") {
    const total = num(d.total);
    const c = isObj(d.counts) ? d.counts : undefined;
    if (total !== undefined && c) {
      const summary = { total, mixar: num(c.mixar) ?? 0, web: num(c.web) ?? 0, a_validar: num(c.a_validar) ?? 0, pendente: num(c.pendente) ?? 0 };
      return { detail: `Mixar ${summary.mixar} · web ${summary.web} · a validar ${summary.a_validar} · pendentes ${summary.pendente}`, summary };
    }
  } else if (tool === "metadata_lookup" && Array.isArray(d.rows)) {
    const pending = d.rows.filter((row) => at(row, "outcome", "action") === "pending").length;
    const summary = { total: d.rows.length, saved: num(d.saved) ?? 0, pending, dry_run: d.dry_run === true };
    const gravadas = summary.dry_run ? "dry run" : plural(summary.saved, "gravada", "gravadas");
    return { detail: line(plural(summary.total, "faixa", "faixas"), plural(pending, "pendente", "pendentes"), gravadas, d.stopped ? "interrompido" : undefined), summary };
  }
  return { detail: own(END, tool)?.(d) ?? "" };
}

function emitSet(ctx: TurnCtx, setId: string): void {
  const set = ctx.repo.getSet(setId);
  const version = ctx.repo.latestVersion(setId);
  if (set && version) ctx.emit({ type: "set", set_id: set.id, version: version.version, status: set.status });
}

/** SetSnapshot do resultado estruturado de dj_build_set / dj_evaluate_order, com a origem de cada faixa no store do MCP. */
function snapshotOf(data: unknown, curve: string, storeDir: string): SetSnapshot | null {
  if (!isObj(data) || !Array.isArray(data.order)) return null;
  const positions = data.order.filter((o): o is SetPosition => isObj(o) && typeof o.track_id === "string");
  let entries = new Map<string, TrackAnalysis>();
  try {
    entries = new AnalysisStore(storeDir).getMany(positions.map((p) => p.track_id));
  } catch {
    // store ilegível: a versão é gravada sem a origem das faixas
  }
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    curve,
    average_score: typeof data.average_score === "number" ? data.average_score : 0,
    order: positions.map((p) => {
      const entry = entries.get(p.track_id);
      return { ...p, source: entry ? (entry.source ?? "usuário") : null, key_review: !!entry?.notes?.includes("[A VALIDAR] tom") };
    }),
    transitions: list(data.transitions),
    weak_transitions: list(data.weak_transitions),
    problem_tracks: list(data.problem_tracks),
    warnings: list(data.warnings),
  };
}

/**
 * Snapshot da versão anterior na ordem nova (envio de uma ordem que o agente não avaliou). Posição, seção e
 * energia-alvo são da vaga e são recalculadas; ordem igual devolve o snapshot como está; id que o snapshot
 * anterior não tem, null.
 * ponytail: passagens não recalculadas (transitions e weak_transitions vazias; average_score segue o da ordem
 * anterior); recalcular pede o buildReport do MCP com as análises do store.
 */
export function reorderSnapshot(prev: SetSnapshot | null, order: string[]): SetSnapshot | null {
  if (!prev) return null;
  if (prev.order.map((t) => t.track_id).join() === order.join()) return prev;
  const byId = new Map(prev.order.map((t) => [t.track_id, t]));
  const tracks = order.map((id) => byId.get(id));
  if (!tracks.every((t): t is SnapshotTrack => t !== undefined)) return null;
  const curve = prev.curve as CurvePreset;
  return {
    ...prev,
    order: tracks.map((t, i) => {
      const slot = tracks.length <= 1 ? 0 : i / (tracks.length - 1);
      return { ...t, position: i + 1, section: sectionFor(curve, slot), target_energy: Math.round(targetEnergy(curve, slot) * 10) / 10 };
    }),
    transitions: [],
    weak_transitions: [],
  };
}

/** Grava a proposta (versão + snapshot + planos) e avisa a tela. */
export function recordFromResult(ctx: TurnCtx, data: unknown): void {
  const proposal = extractProposal(data);
  if (!proposal) return;
  const name = ctx.repo.getSession(ctx.chatSessionId)?.title ?? "Set";
  const snapshot = snapshotOf(data, proposal.curve, ctx.storeDir);
  const { set, version } = ctx.repo.recordProposal(ctx.chatSessionId, name, proposal.curve, proposal.order, ctx.note, snapshot);
  ctx.repo.savePlans(version.id, proposal.plans);
  emitSet(ctx, set.id);
}

/** Gate do canUseTool: leitura do spotify-dj passa; criar playlist exige clique de aprovação; o resto é negado. */
export async function gate(ctx: TurnCtx, toolName: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<PermissionResult> {
  if (toolName !== CREATE_TOOL) {
    // escrita destrutiva no store local não passa pelo chat (texto de faixa/playlist vira mensagem com papel de usuário)
    if (toolName === `${MCP_PREFIX}dj_delete_track_analysis`) return { behavior: "deny", message: "Apagar análise do store não passa pelo chat do Play.Me; use o Claude Desktop ou a CLI do MCP." };
    return toolName.startsWith(MCP_PREFIX) ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: "Ferramenta não disponível no Play.Me." };
  }
  const { repo, chatSessionId } = ctx;
  const current = repo.getCurrentSet(chatSessionId);
  const order = Array.isArray(input.track_ids) ? input.track_ids.filter((v): v is string => typeof v === "string").map(trackIdOf) : [];
  const playlistName = typeof input.name === "string" ? input.name : (current?.name ?? "[DJ MIX]");
  const setName = current?.name ?? repo.getSession(chatSessionId)?.title ?? playlistName;
  const prev = current ? (repo.latestVersion(current.id)?.snapshot ?? null) : null;
  const snapshot = reorderSnapshot(prev, order);
  // D36: com snapshot conhecido, IDs fora do set atual não chegam ao clique (o usuário não tem como conferir IDs)
  if (prev && !snapshot) {
    return { behavior: "deny", message: "Os track_ids não são os do set atual. Use exatamente os IDs de ordered_track_ids do último dj_build_set ou dj_evaluate_order, sem inventar nem abreviar." };
  }
  const { set } = repo.recordProposal(chatSessionId, setName, current?.curve ?? "classic", order, ctx.note, snapshot);
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
  // o turno gravado leva todos os eventos, menos session e done; o custo vem do done
  const events: ServerEvent[] = [];
  let cost: number | null = null;
  const record = (event: ServerEvent): void => {
    if (event.type === "done") cost = event.cost_usd;
    else if (event.type !== "session") events.push(event);
    emit(event);
  };
  try {
    const ctx: TurnCtx = { repo: deps.repo, waiter: deps.waiter, emit: record, chatSessionId, note: userMessage, storeDir: deps.storeDir };
    const resume = deps.repo.getSession(chatSessionId)?.agent_session_id;
    const tools = new Map<string, string>(); // tool_use_id -> nome sem prefixo
    const names: Names = {
      playlist: (id) => deps.playlistName(id) ?? id,
      track: (id) => {
        try {
          return new AnalysisStore(deps.storeDir).get(id)?.label ?? id;
        } catch {
          return id; // o detalhe é só enfeite: store ilegível não derruba o turno
        }
      },
    };
    const abortController = new AbortController();
    // desconectar depois do clique de aprovação não cancela a criação já liberada (o resultado fica gravado no set)
    signal?.addEventListener("abort", () => { if (!ctx.approvedSetId) abortController.abort(); }, { once: true });
    const q = (deps.query ?? query)({
      prompt: userMessage,
      options: {
        model: deps.model,
        systemPrompt: `${SYSTEM_PROMPT}\n${weightsLine(deps.settings.get().weights)}`,
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
          if (block.type === "text") record({ type: "text", text: block.text });
          else if (block.type === "tool_use") {
            const tool = block.name.replace(MCP_PREFIX, "");
            tools.set(block.id, tool);
            record({ type: "tool_start", tool, tool_use_id: block.id, detail: summarize(tool, block.input, "start", names).detail });
          }
        }
      } else if (msg.type === "user" && Array.isArray(msg.message.content)) {
        for (const block of msg.message.content) {
          if (block.type !== "tool_result") continue;
          const tool = tools.get(block.tool_use_id) ?? "";
          const isError = block.is_error === true;
          const data = structuredOf(msg.tool_use_result, block);
          const end = isError ? { detail: redactPaths(firstLine(textOf(block.content))) } : summarize(tool, data, "end", names);
          record({ type: "tool_end", tool, tool_use_id: block.tool_use_id, is_error: isError, ...end });
          if (tool === "spotify_create_playlist_from_order") finishCreate(ctx, data, isError);
          else if (!isError && (tool === "dj_build_set" || tool === "dj_evaluate_order")) recordFromResult(ctx, data);
        }
      } else if (msg.type === "result") {
        if (msg.subtype === "success") record({ type: "done", cost_usd: msg.total_cost_usd ?? null });
        else record({ type: "error", message: "O agente terminou com erro. Tente de novo." });
        return;
      }
    }
    record({ type: "error", message: "O agente encerrou sem resposta." });
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    console.error("agente falhou:", raw.replace(/sk-[A-Za-z0-9_-]+/g, "[chave]"));
    record({ type: "error", message: signal?.aborted ? "Conversa encerrada." : "Falha no agente. Veja o log do servidor." });
  } finally {
    // o turno é gravado em qualquer saída (sucesso, erro ou abort); runChat nunca lança
    try {
      deps.repo.addTurn(chatSessionId, userMessage, events, cost);
    } catch (error) {
      console.error("turno não gravado:", error instanceof Error ? error.message : error);
    }
  }
}
