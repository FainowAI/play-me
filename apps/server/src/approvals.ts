/**
 * Espera em memória pela decisão de uma approval. O agente chama wait() dentro do canUseTool;
 * o endpoint POST /api/approvals/:id grava a decisão no repo e chama resolve().
 * ponytail: só em memória; um restart do servidor derruba esperas pendentes (a approval fica "pending" no banco).
 */
export type Decision = "approved" | "rejected";

export class ApprovalWaiter {
  private readonly waiting = new Map<string, (decision: Decision) => void>();

  wait(approvalId: string, signal?: AbortSignal): Promise<Decision> {
    return new Promise((resolve) => {
      const done = (decision: Decision): void => {
        this.waiting.delete(approvalId);
        resolve(decision);
      };
      this.waiting.set(approvalId, done);
      signal?.addEventListener("abort", () => done("rejected"), { once: true });
    });
  }

  /** Há um turno de chat esperando esta approval? (false depois de restart ou de o cliente desconectar.) */
  has(approvalId: string): boolean {
    return this.waiting.has(approvalId);
  }

  /** true se havia alguém esperando essa approval. */
  resolve(approvalId: string, decision: Decision): boolean {
    const done = this.waiting.get(approvalId);
    if (!done) return false;
    done(decision);
    return true;
  }
}
