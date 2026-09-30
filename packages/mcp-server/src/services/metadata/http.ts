export class RateLimitError extends Error {
  constructor(provider: string, detail: string) {
    super(`Limite de requisições do ${provider} atingido (${detail}). Lote interrompido; tente de novo mais tarde.`);
    this.name = "RateLimitError";
  }
}

export interface HttpDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export const realHttp: HttpDeps = {
  fetch: (...args) => fetch(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};
