/**
 * Esperas em memória pela decisão do DJ: a approval de envio (ApprovalWaiter) e as respostas do ask_dj (Waiter<Answers | null>).
 * O agente chama wait() dentro do canUseTool (approval) ou da ferramenta ask_dj (perguntas); a rota HTTP grava a decisão
 * (a approval, no repo) e chama resolve().
 * ponytail: só em memória; um restart do servidor derruba esperas pendentes (a approval fica "pending" no banco; a pergunta some com o turno).
 */
export type Decision = "approved" | "rejected";

/** Respostas do DJ ao ask_dj, por id de pergunta: o label da opção, o texto de "Outra opção" ou null (pulada). */
export type Answers = Record<string, string | null>;

/** Resposta sem texto (null, ausente ou só espaços) vale "pulada". */
export const cleanAnswer = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** "skipped" quando nenhuma pergunta tem texto de resposta; "answered" se ao menos uma tem. */
export const answersStatus = (answers: Answers): "answered" | "skipped" =>
  Object.values(answers).some((v) => cleanAnswer(v) !== null) ? "answered" : "skipped";

export class Waiter<T> {
  private readonly waiting = new Map<string, (value: T) => void>();

  /** `onAbort`: o valor que a espera recebe quando o turno é abortado (o cliente desconectou). */
  constructor(private readonly onAbort: T) {}

  wait(id: string, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve) => {
      const done = (value: T): void => {
        this.waiting.delete(id);
        resolve(value);
      };
      this.waiting.set(id, done);
      // sinal já abortado não dispara o evento de novo: sem este teste a espera nunca terminaria
      if (signal?.aborted) done(this.onAbort);
      else signal?.addEventListener("abort", () => done(this.onAbort), { once: true });
    });
  }

  /** Há um turno de chat esperando este id? (false depois de restart ou de o cliente desconectar.) */
  has(id: string): boolean {
    return this.waiting.has(id);
  }

  /** true se havia alguém esperando esse id. */
  resolve(id: string, value: T): boolean {
    const done = this.waiting.get(id);
    if (!done) return false;
    done(value);
    return true;
  }
}

/** Abort do turno = recusa: a approval nunca é concedida por desconexão. */
export class ApprovalWaiter extends Waiter<Decision> {
  constructor() {
    super("rejected");
  }
}
