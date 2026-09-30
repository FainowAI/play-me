/**
 * ReccoBeats (https://reccobeats.com/docs): GET /v1/audio-features?ids=<IDs do Spotify>, sem chave.
 * Devolve tempo, key/mode (classe de altura do Spotify) e energy. Até 40 IDs por chamada.
 * Só consulta por ID: o endpoint de análise de arquivo recebe áudio e fica fora (D04).
 */
import { formatCamelot, parseKey } from "../camelot.js";
import { RateLimitError, realHttp, type HttpDeps } from "./http.js";

export const RECCOBEATS_BASE = "https://api.reccobeats.com";
export const RECCOBEATS_BATCH = 40;
const BATCH_PAUSE_MS = 1_000; // ponytail: limite não publicado; 1 s entre lotes, 429 interrompe

export interface ReccoBeatsResult {
  bpm: number | null;
  camelot: string | null;
  energy: number | null; // 0..1
}

interface RawFeatures {
  href?: string;
  tempo?: number;
  key?: number; // 0 = C … 11 = B, -1 = sem tom
  mode?: number; // 1 = maior, 0 = menor
  energy?: number;
}

const PITCH = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Classe de altura + modo (formato Spotify) → Camelot. */
export function pitchToCamelot(key: number | undefined, mode: number | undefined): string | null {
  const root = key === undefined ? undefined : PITCH[key];
  if (!root || (mode !== 0 && mode !== 1)) return null;
  const parsed = parseKey(mode === 1 ? root : `${root}m`);
  return parsed ? formatCamelot(parsed) : null;
}

const spotifyId = (href: string | undefined): string | null => href?.match(/\/track\/([0-9A-Za-z]{22})/)?.[1] ?? null;

export function createReccoBeats(http: HttpDeps = realHttp) {
  return async function lookup(trackIds: string[]): Promise<Map<string, ReccoBeatsResult>> {
    const out = new Map<string, ReccoBeatsResult>();
    for (let i = 0; i < trackIds.length; i += RECCOBEATS_BATCH) {
      if (i > 0) await http.sleep(BATCH_PAUSE_MS);
      const ids = trackIds.slice(i, i + RECCOBEATS_BATCH).join(",");
      const response = await http.fetch(`${RECCOBEATS_BASE}/v1/audio-features?ids=${ids}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 429) throw new RateLimitError("ReccoBeats", `HTTP 429, Retry-After ${response.headers.get("Retry-After") ?? "?"}`);
      if (!response.ok) throw new Error(`ReccoBeats respondeu HTTP ${response.status}.`);
      const body = (await response.json()) as { content?: RawFeatures[] };
      for (const raw of body.content ?? []) {
        const id = spotifyId(raw.href);
        if (!id) continue;
        out.set(id, {
          bpm: typeof raw.tempo === "number" && raw.tempo > 0 ? raw.tempo : null,
          camelot: pitchToCamelot(raw.key, raw.mode),
          energy: typeof raw.energy === "number" ? raw.energy : null,
        });
      }
    }
    return out;
  };
}
