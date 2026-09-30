import assert from "node:assert/strict";
import { formatCamelot, harmonicMatch, parseKey } from "../services/camelot.js";
import { ECHO_ONLY_PENALTY } from "../constants.js";
import { bpmDistance, buildSet, echoOnly, scoreTransition, targetEnergy } from "../services/dj-engine.js";
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

// ---------- Penalidade echo-only ----------
{
  const mk = (camelot: string): TrackAnalysis => ({
    track_id: "echo".padEnd(22, "0"),
    bpm: 124,
    camelot,
    energy: 6,
    style: "techno",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
  const weights = { camelot: 0.35, bpm: 0.25, energy: 0.25, style: 0.1, progression: 0.05 };
  const ctx = { curve: "classic" as const, weights, tFrom: 0.4, tTo: 0.43 };
  const tritone = scoreTransition(mk("8A"), mk("2A"), ctx);
  assert.ok(echoOnly(tritone.scores.camelot, 0));
  assert.match(tritone.reason, /echo out/);
  const raw =
    weights.camelot * tritone.scores.camelot +
    weights.bpm * tritone.scores.bpm +
    weights.energy * tritone.scores.energy +
    weights.style * tritone.scores.style +
    weights.progression * tritone.scores.progression;
  assert.ok(Math.abs(raw - ECHO_ONLY_PENALTY - tritone.scores.total) < 0.02, "total = bruto - penalidade (tolerância de arredondamento)");
  const safe = scoreTransition(mk("8A"), mk("9A"), ctx);
  assert.doesNotMatch(safe.reason, /echo out/);
}

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

// Aviso de tom a confirmar (tom vindo da web)
assert.ok(!result.warnings.some((w) => w.includes("tom a confirmar")), "sem notas de tom da web: nenhum aviso");
const webTone = eletro.map((track, i) =>
  i === 0 || i === 1 ? { ...track, notes: "[A VALIDAR] tom da web (ReccoBeats); confira no Mixar" } : track,
);
const webResult = buildSet(webTone, { curve: "classic" });
const toneWarnings = webResult.warnings.filter((w) => w.includes("tom a confirmar"));
assert.equal(toneWarnings.length, 1, "um único aviso de tom a confirmar");
assert.ok(toneWarnings[0]?.startsWith("2 faixa(s) com tom a confirmar no Mixar:"));
assert.ok(toneWarnings[0]?.includes("Adored – J. Worra") && toneWarnings[0]?.includes("The Sun Can't Compare – Space Motion"));

console.log(setToMarkdown(result));
console.log(`\n[ok] ${eletro.length} faixas em ${elapsed} ms · nota média ${result.average_score} · fixado: ${pinned.average_score}`);
