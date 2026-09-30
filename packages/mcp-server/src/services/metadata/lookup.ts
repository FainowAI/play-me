/**
 * Orquestra a Fase M: para cada faixa consulta GetSongBPM e Deezer (com cache),
 * decide pelo merge e, só quando dry_run = false, grava no store.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SpotifyTrackSummary, TrackAnalysis } from "../../types.js";
import type { AnalysisStore } from "../analysis-store.js";
import type { DeezerResult } from "./deezer.js";
import { RateLimitError, type GetSongBpmResult } from "./getsongbpm.js";
import { mergeMetadata, type MergeOutcome } from "./merge.js";

type Provider = "getsongbpm" | "deezer";
type CacheValue = GetSongBpmResult | DeezerResult | null; // null = a fonte não achou a faixa

/**
 * Cache em metadata-cache.json, chave "<spotify_id>:<provedor>". Guarda só números,
 * nunca nome, artista ou ISRC do Spotify.
 * ponytail: "não achou" também fica em cache; apague o arquivo se mudar a regra de casamento.
 */
export class MetadataCache {
  private readonly path: string;
  private data: Record<string, { value: CacheValue; fetched_at: string }> | null = null;

  constructor(dataDir: string) {
    this.path = join(dataDir, "metadata-cache.json");
  }

  private load(): Record<string, { value: CacheValue; fetched_at: string }> {
    if (!this.data) this.data = existsSync(this.path) ? JSON.parse(readFileSync(this.path, "utf8")) : {};
    return this.data!;
  }

  has(trackId: string, provider: Provider): boolean {
    return `${trackId}:${provider}` in this.load();
  }

  get<T extends CacheValue>(trackId: string, provider: Provider): T {
    return this.load()[`${trackId}:${provider}`]?.value as T;
  }

  set(trackId: string, provider: Provider, value: CacheValue): void {
    this.load()[`${trackId}:${provider}`] = { value, fetched_at: new Date().toISOString() };
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 1), "utf8");
    renameSync(tmp, this.path);
  }
}

export interface LookupDeps {
  store: AnalysisStore;
  cache: MetadataCache;
  getsongbpm: ((title: string, artists: string[]) => Promise<GetSongBpmResult | null>) | null; // null = sem chave
  deezer: (isrc: string) => Promise<DeezerResult | null>;
}

export interface LookupRow {
  track_id: string;
  label: string;
  existing: Pick<TrackAnalysis, "bpm" | "camelot" | "source" | "notes"> | null;
  getsongbpm: GetSongBpmResult | null;
  deezer: DeezerResult | null;
  outcome: MergeOutcome;
}

export interface LookupReport {
  dry_run: boolean;
  rows: LookupRow[];
  saved: number;
  stopped: string | null; // motivo quando o lote foi interrompido (limite de requisições)
}

async function cached<T extends CacheValue>(
  cache: MetadataCache,
  trackId: string,
  provider: Provider,
  fetcher: () => Promise<T>,
): Promise<T> {
  if (cache.has(trackId, provider)) return cache.get<T>(trackId, provider);
  const value = await fetcher();
  cache.set(trackId, provider, value);
  return value;
}

export async function lookupTracks(tracks: SpotifyTrackSummary[], dryRun: boolean, deps: LookupDeps): Promise<LookupReport> {
  const rows: LookupRow[] = [];
  let stopped: string | null = null;
  for (const track of tracks) {
    if (!track.id) continue;
    const id = track.id;
    try {
      const gsb = deps.getsongbpm
        ? await cached(deps.cache, id, "getsongbpm", () => deps.getsongbpm!(track.name, track.artists))
        : null;
      const dz = track.isrc ? await cached(deps.cache, id, "deezer", () => deps.deezer(track.isrc!)) : null;
      const existing = deps.store.get(id);
      rows.push({
        track_id: id,
        label: `${track.name} — ${track.artists.join(", ")}`,
        existing: existing
          ? { bpm: existing.bpm, camelot: existing.camelot, source: existing.source, notes: existing.notes }
          : null,
        getsongbpm: gsb,
        deezer: dz,
        outcome: mergeMetadata(id, existing, gsb, dz),
      });
    } catch (error) {
      if (error instanceof RateLimitError) {
        stopped = error.message;
        break;
      }
      throw error;
    }
  }

  const toSave = rows.flatMap((row) => (row.outcome.action === "save" ? [row.outcome.entry] : []));
  // upsert([]) regrava o arquivo: só chama quando há o que salvar
  if (!dryRun && toSave.length) deps.store.upsert(toSave);
  return { dry_run: dryRun, rows, saved: dryRun ? 0 : toSave.length, stopped };
}
