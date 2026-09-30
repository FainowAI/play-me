/**
 * Decide o que salvar a partir da ReccoBeats (única fonte web). Funções puras.
 * Regras (D29):
 *  - Entrada com source diferente de "web" (Mixar, manual etc.) nunca é sobrescrita.
 *  - BPM da ReccoBeats é conferido (source "web", sem [A VALIDAR]), arredondado.
 *  - Tom da web é sempre [A VALIDAR]; o Mixar segue como verdade do tom.
 * Nunca inventa: sem BPM ou sem tom, a faixa vira pendência (D03).
 */
import type { TrackAnalysis } from "../../types.js";
import { formatCamelot, parseKey } from "../camelot.js";
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

export function mergeMetadata(
  trackId: string,
  existing: TrackAnalysis | undefined,
  recco: ReccoBeatsResult | null,
): MergeOutcome {
  if (isProtected(existing)) {
    return { action: "keep", reason: `já tem dado de ${existing?.source ?? "usuário"}` };
  }
  if (recco?.bpm == null) return { action: "pending", reason: "sem BPM em nenhuma fonte" };
  const key = parseKey(recco.camelot ?? "");
  if (!key) return { action: "pending", reason: "sem tom" };

  const notes = ["[A VALIDAR] tom da web (ReccoBeats); confira no Mixar"];
  if (recco.energy != null) notes.push(`energy ${recco.energy.toFixed(2)} (ReccoBeats), apoio à energia`);
  return {
    action: "save",
    entry: {
      track_id: trackId,
      bpm: Math.round(recco.bpm),
      camelot: formatCamelot(key),
      notes: notes.join("; "),
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
