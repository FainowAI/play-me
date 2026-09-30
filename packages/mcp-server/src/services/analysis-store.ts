import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TrackAnalysis } from "../types.js";
import { formatCamelot, parseKey } from "./camelot.js";

/**
 * Guarda só o que o usuário informou (BPM, tom, energia, estilo, rótulo livre).
 * Metadados do Spotify (nome, artista, capa) não são persistidos: cada leitura
 * vem direto da API, em linha com a regra de não cachear conteúdo do Spotify.
 *
 * P12: a leitura (`get`/`getMany`) devolve cópias; sem energia do usuário, a energia vem do `energy` da
 * ReccoBeats guardado nas notas, marcada em `energy_estimated`. O cache e o arquivo nunca recebem o derivado.
 */
export class AnalysisStore {
  private readonly path: string;
  private cache: Map<string, TrackAnalysis> | null = null;

  constructor(dataDir: string) {
    this.path = join(dataDir, "analysis.json");
  }

  private load(): Map<string, TrackAnalysis> {
    if (this.cache) return this.cache;
    const map = new Map<string, TrackAnalysis>();
    if (existsSync(this.path)) {
      try {
        const parsed = JSON.parse(readFileSync(this.path, "utf8")) as { tracks?: TrackAnalysis[] };
        for (const entry of parsed.tracks ?? []) {
          if (entry && typeof entry.track_id === "string") map.set(entry.track_id, entry);
        }
      } catch {
        throw new Error(`Arquivo de análises corrompido em ${this.path}. Corrija ou apague o arquivo.`);
      }
    }
    this.cache = map;
    return map;
  }

  private persist(): void {
    const map = this.load();
    const tmp = `${this.path}.tmp`;
    const payload = { version: 1, tracks: [...map.values()].sort((a, b) => a.track_id.localeCompare(b.track_id)) };
    writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
    renameSync(tmp, this.path);
  }

  get(trackId: string): TrackAnalysis | undefined {
    return withEstimate(this.load().get(trackId));
  }

  getMany(trackIds: string[]): Map<string, TrackAnalysis> {
    const map = this.load();
    const out = new Map<string, TrackAnalysis>();
    for (const id of trackIds) {
      const entry = withEstimate(map.get(id));
      if (entry) out.set(id, entry);
    }
    return out;
  }

  count(): number {
    return this.load().size;
  }

  /** Upsert: campos omitidos preservam o valor anterior. */
  upsert(entries: Omit<TrackAnalysis, "updated_at">[]): TrackAnalysis[] {
    const map = this.load();
    const saved: TrackAnalysis[] = [];
    const now = new Date().toISOString();
    for (const given of entries) {
      // ponytail: entrada vinda de um get() traz energia derivada; descarta a estimativa em vez de gravá-la
      const { energy_estimated, ...rest } = given;
      const entry = energy_estimated ? { ...rest, energy: undefined } : rest;
      const key = parseKey(entry.camelot);
      if (!key) throw new Error(`Tom inválido para ${entry.track_id}: "${entry.camelot}". Use Camelot (8A) ou notação musical (Am, F#m, C).`);
      const previous = map.get(entry.track_id);
      const merged: TrackAnalysis = {
        ...previous,
        ...stripUndefined(entry),
        track_id: entry.track_id,
        bpm: entry.bpm,
        camelot: formatCamelot(key),
        updated_at: now,
      };
      map.set(entry.track_id, merged);
      saved.push(merged);
    }
    this.persist();
    return saved;
  }

  remove(trackIds: string[]): number {
    const map = this.load();
    let removed = 0;
    for (const id of trackIds) if (map.delete(id)) removed += 1;
    if (removed) this.persist();
    return removed;
  }
}

/** `energy 0.62 (ReccoBeats)`, como o merge.ts escreve; exige o número para não casar com "tom da web (ReccoBeats)". */
const RECCO_ENERGY = /\benergy (\d+(?:\.\d+)?) \(ReccoBeats\)/;

/** P12: energia 1–10 = clamp(round(1 + x × 9)) a partir do `energy` 0–1 da ReccoBeats; só quando não há energia do usuário. */
function withEstimate(entry: TrackAnalysis | undefined): TrackAnalysis | undefined {
  if (!entry || entry.energy !== undefined) return entry;
  const x = entry.notes?.match(RECCO_ENERGY)?.[1];
  if (x === undefined) return entry;
  return { ...entry, energy: Math.min(10, Math.max(1, Math.round(1 + Number(x) * 9))), energy_estimated: true };
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
