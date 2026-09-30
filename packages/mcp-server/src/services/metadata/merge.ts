/**
 * Decide o que salvar a partir da ReccoBeats (principal) e do GetSongBPM (reserva). Funções puras.
 * Regras (D24, ADR 0004):
 *  - BPM da ReccoBeats é conferido (bateu com o Mixar em 11 de 11); diverge do GetSongBPM → [A VALIDAR].
 *  - BPM só do GetSongBPM → [A VALIDAR] (fonte única, não validada).
 *  - Tom da web é sempre [A VALIDAR]; o Mixar segue como verdade do tom.
 * Nunca inventa: sem BPM ou sem tom, a faixa vira pendência (D03).
 */
import type { TrackAnalysis } from "../../types.js";
import { formatCamelot, parseKey } from "../camelot.js";
import type { GetSongBpmResult } from "./getsongbpm.js";
import type { ReccoBeatsResult } from "./reccobeats.js";

export const WEB_SOURCE = "web";
const BPM_FLAG = "[A VALIDAR] BPM";

export type MergeOutcome =
  | { action: "keep"; reason: string }
  | { action: "pending"; reason: string }
  | { action: "save"; entry: Omit<TrackAnalysis, "updated_at"> };

/**
 * Mixar, rekordbox, serato, traktor, ouvido e manual nunca são sobrescritos.
 * ponytail: protege qualquer origem que não seja "web" (inclui entradas sem source, que vieram do usuário).
 */
export const isProtected = (entry: TrackAnalysis | undefined): boolean =>
  entry !== undefined && entry.source !== WEB_SOURCE;

/** Mesmo BPM a ±1, ou metade/dobro a ±1. */
export function bpmAgree(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1 || Math.abs(a - 2 * b) <= 1 || Math.abs(2 * a - b) <= 1;
}

export function mergeBpm(recco: number | null, gsb: number | null): { bpm: number; note?: string } | null {
  if (recco !== null) {
    if (gsb !== null && !bpmAgree(recco, gsb)) {
      return { bpm: Math.round(recco), note: `${BPM_FLAG} diverge: ReccoBeats ${recco}, GetSongBPM ${gsb}` };
    }
    return { bpm: Math.round(recco) };
  }
  if (gsb !== null) return { bpm: Math.round(gsb), note: `${BPM_FLAG} de fonte única (GetSongBPM)` };
  return null;
}

export function mergeMetadata(
  trackId: string,
  existing: TrackAnalysis | undefined,
  recco: ReccoBeatsResult | null,
  gsb: GetSongBpmResult | null,
): MergeOutcome {
  if (isProtected(existing)) {
    return { action: "keep", reason: `já tem dado de ${existing?.source ?? "usuário"}` };
  }
  const bpm = mergeBpm(recco?.bpm ?? null, gsb?.bpm ?? null);
  if (!bpm) return { action: "pending", reason: "sem BPM em nenhuma fonte" };

  const keySource = recco?.camelot ? "ReccoBeats" : "GetSongBPM";
  const key = parseKey(recco?.camelot ?? gsb?.key ?? "");
  if (!key) return { action: "pending", reason: gsb?.key ? `tom não reconhecido: "${gsb.key}"` : "sem tom" };

  const notes = [bpm.note, `[A VALIDAR] tom da web (${keySource}); confira no Mixar`];
  if (recco?.energy != null) notes.push(`energy ${recco.energy.toFixed(2)} (ReccoBeats), apoio à energia`);
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

/** Origem de uma entrada do store. "web" = BPM conferido (o tom da web é sempre [A VALIDAR]). */
export function coverageBucket(entry: TrackAnalysis | undefined): CoverageBucket {
  if (!entry) return "pendente";
  if (entry.source !== WEB_SOURCE) return "mixar";
  return entry.notes?.includes(BPM_FLAG) ? "a_validar" : "web";
}
