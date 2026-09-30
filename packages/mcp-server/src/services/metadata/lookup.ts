/**
 * Orquestra a Fase M: ReccoBeats em lote (única fonte web), com cache; decide pelo merge
 * e, só quando dry_run = false, grava no store.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SpotifyTrackSummary, TrackAnalysis } from "../../types.js";
import type { AnalysisStore } from "../analysis-store.js";
import { RateLimitError } from "./http.js";
import { mergeMetadata, type MergeOutcome } from "./merge.js";
import type { ReccoBeatsResult } from "./reccobeats.js";

type Provider = "reccobeats";
type CacheValue = ReccoBeatsResult | null; // null = a fonte não achou a faixa

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
  reccobeats: (trackIds: string[]) => Promise<Map<string, ReccoBeatsResult>>;
}

export interface LookupRow {
  track_id: string;
  label: string;
  existing: Pick<TrackAnalysis, "bpm" | "camelot" | "source" | "notes"> | null;
  reccobeats: ReccoBeatsResult | null;
  outcome: MergeOutcome;
}

export interface LookupReport {
  dry_run: boolean;
  rows: LookupRow[];
  saved: number;
  stopped: string | null; // motivo quando o lote foi interrompido (limite de requisições)
}

export async function lookupTracks(tracks: SpotifyTrackSummary[], dryRun: boolean, deps: LookupDeps): Promise<LookupReport> {
  const rows: LookupRow[] = [];

  const missing = tracks.flatMap((t) => (t.id && !deps.cache.has(t.id, "reccobeats") ? [t.id] : []));
  try {
    const found = missing.length ? await deps.reccobeats(missing) : new Map<string, ReccoBeatsResult>();
    for (const id of missing) deps.cache.set(id, "reccobeats", found.get(id) ?? null);
  } catch (error) {
    if (!(error instanceof RateLimitError)) throw error;
    return { dry_run: dryRun, rows, saved: 0, stopped: error.message };
  }

  for (const track of tracks) {
    if (!track.id) continue;
    const id = track.id;
    const recco = deps.cache.get<ReccoBeatsResult | null>(id, "reccobeats") ?? null;
    const existing = deps.store.get(id);
    rows.push({
      track_id: id,
      label: `${track.name} — ${track.artists.join(", ")}`,
      existing: existing
        ? { bpm: existing.bpm, camelot: existing.camelot, source: existing.source, notes: existing.notes }
        : null,
      reccobeats: recco,
      outcome: mergeMetadata(id, existing, recco),
    });
  }

  const toSave = rows.flatMap((row) => (row.outcome.action === "save" ? [row.outcome.entry] : []));
  // upsert([]) regrava o arquivo: só chama quando há o que salvar
  if (!dryRun && toSave.length) deps.store.upsert(toSave);
  return { dry_run: dryRun, rows, saved: dryRun ? 0 : toSave.length, stopped: null };
}
