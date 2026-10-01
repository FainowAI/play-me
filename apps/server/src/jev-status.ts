/**
 * Estado do Jev para o /api/status: a chave existe (env) e a API responde (ping do MCP, services/jev.ts).
 * O ping roda no start do servidor e de novo, no máximo a cada 30 min, quando o status é pedido; nenhuma rota espera por ele.
 */
import type { Status } from "./types.js";

const TTL_MS = 30 * 60 * 1000;

/** O que o status precisa do Jev do MCP: se há chave e o ping mínimo (uma pergunta barata, com timeout). */
export interface JevProbe {
  available(): boolean;
  ping(): Promise<{ ok: true; model: string } | { ok: false; error: string }>;
}

export interface JevStatus {
  /** Valor de agora. Sem resposta ainda, ou com a última há mais de 30 min, dispara um ping sem esperar por ele. */
  get(): Status["jev"];
  /** Faz o ping agora (um só em andamento por vez); nunca rejeita. */
  refresh(): Promise<void>;
}

export function createJevStatus(jev: JevProbe, now: () => number = Date.now): JevStatus {
  const key = jev.available();
  // sem chave não há o que perguntar; com chave, null até o primeiro ping responder
  let state: Status["jev"] = { key, connected: key ? null : false, model: null };
  let answeredAt: number | undefined;
  let inflight: Promise<void> | undefined;

  // o detalhe do erro fica no log do servidor: para o cliente, só `connected: false`
  async function ping(): Promise<void> {
    try {
      const result = await jev.ping();
      state = { key, connected: result.ok, model: result.ok ? result.model : null };
      if (!result.ok) console.error("jev: sem resposta:", result.error);
    } catch (error) {
      state = { key, connected: false, model: null };
      console.error("jev: ping falhou:", error instanceof Error ? error.message : error);
    }
    // ponytail: a falha também espera os 30 min; um retry mais curto só se a queda transitória no start incomodar
    answeredAt = now();
  }

  const refresh = (): Promise<void> => {
    if (!key) return Promise.resolve();
    inflight ??= ping().finally(() => {
      inflight = undefined;
    });
    return inflight;
  };

  return {
    refresh,
    get() {
      if (key && !inflight && (answeredAt === undefined || now() - answeredAt > TTL_MS)) void refresh();
      return state;
    },
  };
}
