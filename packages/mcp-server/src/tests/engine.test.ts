import assert from "node:assert/strict";
import { formatCamelot, harmonicMatch, parseKey } from "../services/camelot.js";
import { bpmDistance, buildSet, targetEnergy } from "../services/dj-engine.js";
import { setToMarkdown } from "../services/format.js";
import type { TrackAnalysis } from "../types.js";

// ---------- Camelot ----------
const k = (value: string) => {
  const key = parseKey(value);
  assert.ok(key, `falhou ao ler ${value}`);
  return key;
};
assert.equal(formatCamelot(k("Am")), "8A");
assert.equal(formatCamelot(k("F#m")), "11A");
assert.equal(formatCamelot(k("Ebm")), "2A");
assert.equal(formatCamelot(k("Db major")), "3B");
assert.equal(formatCamelot(k("Bb")), "6B");
assert.equal(formatCamelot(k("B")), "1B");
assert.equal(formatCamelot(k("12b")), "12B");
assert.equal(parseKey("H#"), null);

assert.equal(harmonicMatch(k("8A"), k("8A")).type, "segura");
assert.equal(harmonicMatch(k("8A"), k("9A")).type, "segura");
assert.equal(harmonicMatch(k("12A"), k("1A")).relation, "adjacente +1"); // volta da roda
assert.equal(harmonicMatch(k("8A"), k("8B")).relation, "relativa");
assert.equal(harmonicMatch(k("2A"), k("1B")).relation, "diagonal");
assert.equal(harmonicMatch(k("8A"), k("2A")).relation, "trítono (choque forte)");
assert.equal(harmonicMatch(k("7B"), k("4B")).type, "arriscada");

// ---------- BPM ----------
assert.deepEqual(bpmDistance(87, 174), { diff: 0, mode: "half_double" });
assert.equal(bpmDistance(124, 128).diff, 4);

// ---------- Curva ----------
assert.ok(targetEnergy("classic", 0) < targetEnergy("classic", 0.8));
assert.ok(targetEnergy("classic", 1) < targetEnergy("classic", 0.8));

// ---------- Set real: playlist Eletro (prints do Mixar; energia e estilo estimados) ----------
let seq = 0;
const id = (): string => `test${String(seq++).padStart(18, "0")}`;
const t = (label: string, bpm: number, camelot: string, energy: number, style: string): TrackAnalysis => ({
  track_id: id(),
  label,
  bpm,
  camelot,
  energy,
  style,
  updated_at: new Date().toISOString(),
});

const eletro: TrackAnalysis[] = [
  t("Adored – J. Worra", 126, "9A", 6, "tech house"),
  t("The Sun Can't Compare – Space Motion", 124, "12B", 6, "melodic house"),
  t("Fool's Paradise – Mees Salomé", 124, "8B", 5, "melodic house"),
  t("Lonesome – Charlotte de Witte", 124, "5A", 6, "techno"),
  t("Like I Like It – Mau P", 128, "4B", 7, "tech house"),
  t("Moon Rocks – Enrico Sangiuliano", 125, "2A", 9, "techno"),
  t("Deceiver VIP – Chris Lake", 124, "2A", 8, "tech house"),
  t("All By Myself – Mita Gami", 124, "6A", 5, "melodic house"),
  t("Talkin' Too Much – Ribguga", 128, "3B", 7, "tech house"),
  t("Voice of Rem – Rem Siman", 124, "9A", 5, "melodic house"),
  t("Cruisin' – Jeff Sorkowitz", 133, "8B", 8, "tech house"),
  t("Nothing Wrong – OMRI.", 124, "7A", 5, "melodic house"),
  t("Let It Go (VC Remix)", 124, "7B", 5, "melodic house"),
  t("Paranoia – JUNTARO", 130, "12A", 10, "techno"),
  t("Freak – GENESI, MEDUZA", 128, "1B", 9, "tech house"),
  t("Level One – Boris Brejcha", 125, "4A", 7, "techno"),
  t("You Were Right – RÜFÜS DU SOL", 122, "4B", 4, "melodic house"),
  t("fractured light – kalm", 125, "4A", 6, "melodic techno"),
  t("Ghost Dance – Brunello", 125, "5A", 6, "melodic house"),
  t("Science Fiction – Brunello", 127, "10B", 6, "melodic house"),
  t("Don't This – Fairtone", 122, "7B", 4, "melodic house"),
  t("Bald Ponytail – Kaufmann", 130, "4B", 8, "tech house"),
];

const started = Date.now();
const result = buildSet(eletro, { curve: "classic" });
const elapsed = Date.now() - started;

assert.equal(result.order.length, eletro.length, "todas as faixas entram no set");
assert.equal(new Set(result.order.map((p) => p.track_id)).size, eletro.length, "sem duplicatas");
assert.equal(result.transitions.length, eletro.length - 1);
assert.ok(result.average_score > 0.6, `nota média baixa: ${result.average_score}`);

const first = result.order[0];
assert.ok(first && (first.energy ?? 10) <= 5, "abertura deve ser de baixa energia");

// Fixando abertura e fechamento
const pinned = buildSet(eletro, {
  curve: "classic",
  startTrackId: eletro[20]?.track_id,
  endTrackId: eletro[16]?.track_id,
});
assert.equal(pinned.order[0]?.label, "Don't This – Fairtone");
assert.equal(pinned.order[pinned.order.length - 1]?.label, "You Were Right – RÜFÜS DU SOL");

console.log(setToMarkdown(result));
console.log(`\n[ok] ${eletro.length} faixas em ${elapsed} ms · nota média ${result.average_score} · fixado: ${pinned.average_score}`);
