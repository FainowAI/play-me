/**
 * Decide o que salvar a partir do GetSongBPM e do Deezer. Funções puras.
 * Nunca inventa: sem BPM ou sem tom, a faixa vira pendência (D03).
 */
import type { TrackAnalysis } from "../../types.js";
import { formatCamelot, parseKey } from "../camelot.js";
import type { DeezerResult } from "./deezer.js";
import type { GetSongBpmResult } from "./getsongbpm.js";

export const WEB_SOURCE = "web";

export type MergeOutcome =
  | { action: "keep"; reason: string }
  | { action: "pending"; reason: string }
  | { action: "save"; entry: Omit<TrackAnalysis, "updated_at"> };

/**
 * Regra (a): Mixar, rekordbox, serato, traktor, ouvido e manual nunca são sobrescritos.
 * ponytail: protege qualquer origem que não seja "web" (inclui entradas sem source, que vieram do usuário).
 */
export const isProtected = (entry: TrackAnalysis | undefined): boolean =>
  entry !== undefined && entry.source !== WEB_SOURCE;

/** Mesmo BPM a ±1, ou metade/dobro a ±1. */
export function bpmAgree(a: number, b: number): "same" | "half_double" | null {
  if (Math.abs(a - b) <= 1) return "same";
  if (Math.abs(a - 2 * b) <= 1 || Math.abs(2 * a - b) <= 1) return "half_double";
  return null;
}

export function mergeBpm(
  gsb: number | null,
  deezer: number | null,
): { bpm: number; note?: string } | null {
  if (gsb !== null && deezer !== null) {
    const agree = bpmAgree(gsb, deezer);
    if (agree === "same") return { bpm: Math.round((gsb + deezer) / 2) };
    // metade/dobro: traz o Deezer para a escala do GetSongBPM antes da média
    if (agree === "half_double") return { bpm: Math.round((gsb + (deezer > gsb ? deezer / 2 : deezer * 2)) / 2) };
    return { bpm: Math.round(gsb), note: `[A VALIDAR] BPM diverge: GetSongBPM ${gsb}, Deezer ${deezer}` };
  }
  if (gsb !== null) return { bpm: Math.round(gsb), note: "[A VALIDAR] BPM de fonte única (GetSongBPM)" };
  if (deezer !== null) return { bpm: Math.round(deezer), note: "[A VALIDAR] BPM de fonte única (Deezer)" };
  return null;
}

export function mergeMetadata(
  trackId: string,
  existing: TrackAnalysis | undefined,
  gsb: GetSongBpmResult | null,
  deezer: DeezerResult | null,
): MergeOutcome {
  if (isProtected(existing)) {
    return { action: "keep", reason: `já tem dado de ${existing?.source ?? "usuário"}` };
  }
  const bpm = mergeBpm(gsb?.bpm ?? null, deezer?.bpm ?? null);
  if (!bpm) return { action: "pending", reason: "sem BPM em nenhuma fonte" };
  const key = gsb?.key ? parseKey(gsb.key) : null;
  if (!key) return { action: "pending", reason: gsb?.key ? `tom não reconhecido: "${gsb.key}"` : "sem tom" };

  const notes = [bpm.note, "tom de fonte única (GetSongBPM)"];
  if (gsb?.danceability != null) notes.push(`danceability ${gsb.danceability}/100 (GetSongBPM), apoio à energia`);
  return {
    action: "save",
    entry: {
      track_id: trackId,
      bpm: bpm.bpm,
      camelot: formatCamelot(key),
      notes: notes.filter(Boolean).join("; "),
      source: WEB_SOURCE,
    },
  };
}

export type CoverageBucket = "mixar" | "web" | "a_validar" | "pendente";

/** Origem de uma entrada do store para a cobertura. */
export function coverageBucket(entry: TrackAnalysis | undefined): CoverageBucket {
  if (!entry) return "pendente";
  if (entry.source !== WEB_SOURCE) return "mixar";
  return entry.notes?.includes("[A VALIDAR]") ? "a_validar" : "web";
}
