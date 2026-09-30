/**
 * API pública do Deezer: GET /track/isrc:<ISRC> → bpm (0 = sem dado). Sem chave.
 * O campo `preview` é ignorado: nenhuma chamada baixa ou toca áudio (D04).
 */
import { RateLimitError, realHttp, type HttpDeps } from "./getsongbpm.js";

export const DEEZER_BASE = "https://api.deezer.com";

export interface DeezerResult {
  bpm: number | null;
}

const ISRC = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i;

export async function lookupDeezer(isrc: string, http: HttpDeps = realHttp): Promise<DeezerResult | null> {
  if (!ISRC.test(isrc)) return null;
  const response = await http.fetch(`${DEEZER_BASE}/track/isrc:${isrc.toUpperCase()}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 429) throw new RateLimitError("Deezer", "HTTP 429");
  if (!response.ok) throw new Error(`Deezer respondeu HTTP ${response.status}.`);

  const body = (await response.json()) as { bpm?: number; error?: { code?: number; message?: string } };
  if (body.error) {
    if (body.error.code === 4) throw new RateLimitError("Deezer", body.error.message ?? "quota");
    return null; // 800 = sem dado para esse ISRC
  }
  return { bpm: typeof body.bpm === "number" && body.bpm > 0 ? body.bpm : null };
}
