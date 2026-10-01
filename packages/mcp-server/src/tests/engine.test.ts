import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { formatCamelot, harmonicMatch, parseKey } from "../services/camelot.js";
import { ECHO_ONLY_PENALTY } from "../constants.js";
import { avoidRecent, bpmDistance, buildReport, buildSet, echoOnly, normalizeWeights, scoreTransition, targetEnergy } from "../services/dj-engine.js";
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

// ---------- Regressão P10: sem duration_minutes/max_tracks o resultado é idêntico ao do motor anterior ----------
// Valores capturados com o buildSet de antes do P10 (sha256 dos ids da ordem, 16 hex, e nota média).
const orderHash = (r: { order: { track_id: string }[] }): string =>
  createHash("sha256").update(r.order.map((p) => p.track_id).join(",")).digest("hex").slice(0, 16);
const LEGACY_KEYS = "curve,weights,average_score,order,transitions,weak_transitions,problem_tracks,bridges,warnings";

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}
const STYLES = ["tech house", "melodic house", "techno", "melodic techno", "house"];
/** Pool sintético determinístico (nunca música comercial): BPM 118–132, 24 tons, energia 1–10. */
function pool(size: number, seed: number): TrackAnalysis[] {
  const rnd = lcg(seed);
  return Array.from({ length: size }, (_, i) => ({
    track_id: `syn${String(i).padStart(19, "0")}`,
    label: `S${String(i).padStart(3, "0")}`,
    bpm: 118 + Math.floor(rnd() * 15),
    camelot: `${1 + Math.floor(rnd() * 12)}${rnd() < 0.5 ? "A" : "B"}`,
    energy: 1 + Math.floor(rnd() * 10),
    style: STYLES[Math.floor(rnd() * STYLES.length)],
    updated_at: "2026-01-01T00:00:00.000Z",
  }));
}

assert.deepEqual(
  result.order.map((p) => p.label),
  [
    "Don't This – Fairtone",
    "Let It Go (VC Remix)",
    "Fool's Paradise – Mees Salomé",
    "Voice of Rem – Rem Siman",
    "Nothing Wrong – OMRI.",
    "All By Myself – Mita Gami",
    "Ghost Dance – Brunello",
    "fractured light – kalm",
    "Lonesome – Charlotte de Witte",
    "Level One – Boris Brejcha",
    "Like I Like It – Mau P",
    "Bald Ponytail – Kaufmann",
    "Talkin' Too Much – Ribguga",
    "Deceiver VIP – Chris Lake",
    "Moon Rocks – Enrico Sangiuliano",
    "Paranoia – JUNTARO",
    "Freak – GENESI, MEDUZA",
    "Cruisin' – Jeff Sorkowitz",
    "Adored – J. Worra",
    "Science Fiction – Brunello",
    "The Sun Can't Compare – Space Motion",
    "You Were Right – RÜFÜS DU SOL",
  ],
  "Eletro sem parâmetros: mesma ordem de antes",
);
const legacyCases: [string, ReturnType<typeof buildSet>, string, number][] = [
  ["Eletro 22", result, "c29cd617af6737fb", 0.83],
  ["pool 100 classic (n > 90: abertura segue em 6 candidatos)", buildSet(pool(100, 7), { curve: "classic" }), "a5e484fcc6ffe91d", 0.8],
  ["pool 100 peak_time", buildSet(pool(100, 7), { curve: "peak_time" }), "c2d928d06472cff8", 0.81],
  [
    "pool 40 com abertura e fechamento fixos",
    buildSet(pool(40, 3), { curve: "warm_up", startTrackId: pool(40, 3)[5]?.track_id, endTrackId: pool(40, 3)[9]?.track_id }),
    "52b71d030f12aec7",
    0.75,
  ],
  ["pool 60 sunrise, feixe 20", buildSet(pool(60, 11), { curve: "sunrise", beamWidth: 20 }), "feb4b22ac5f9add8", 0.77],
];
for (const [name, r, hash, average] of legacyCases) {
  assert.equal(orderHash(r), hash, `${name}: ordem mudou`);
  assert.equal(r.average_score, average, `${name}: nota média mudou`);
  assert.equal(Object.keys(r).join(","), LEGACY_KEYS, `${name}: sem parâmetros o resultado não ganha campos`);
}
// Durações sozinhas não ligam a seleção: só max_tracks ou targetDurationMs
const idleDurations = buildSet(eletro, { curve: "classic", durations: new Map(eletro.map((x) => [x.track_id, 300_000])) });
assert.equal(orderHash(idleDurations), orderHash(result));
assert.equal(idleDurations.pool_size, undefined);

// ---------- P10: seleção por quantidade ----------
const big = pool(30, 5);
const durations = new Map(big.map((x, i) => [x.track_id, 240_000 + ((i * 7919) % 120_001)]));
const sumOf = (ids: string[]): number => ids.reduce((sum, trackId) => sum + (durations.get(trackId) as number), 0);
const picked = buildSet(big, { curve: "classic", maxTracks: 8, durations });
const pickedIds = picked.order.map((p) => p.track_id);
assert.equal(picked.order.length, 8);
assert.equal(picked.transitions.length, 7);
assert.equal(picked.pool_size, 30);
assert.equal(new Set(pickedIds).size, 8, "sem repetição");
assert.equal(picked.duration_ms, sumOf(pickedIds), "duração = soma das durações da ordem");
assert.ok(picked.warnings.some((w) => /^Selecionadas 8 de 30 faixas analisadas \(~\d+ min\)$/.test(w)), picked.warnings.join(" | "));
assert.ok(picked.problem_tracks.every((p) => pickedIds.includes(p.track_id)), "faixas não escolhidas não entram em problem_tracks");
// a curva vale para as 8 posições: abertura baixa, pico na segunda metade, desvio pequeno do alvo
const energies = picked.order.map((p) => p.energy as number);
const deviation = picked.order.reduce((sum, p) => sum + Math.abs((p.energy as number) - p.target_energy), 0) / picked.order.length;
assert.ok((energies[0] as number) <= 5, `abertura com energia ${energies[0]}`);
assert.ok(energies.indexOf(Math.max(...energies)) >= 4, "o pico fica na segunda metade");
assert.ok(deviation <= 1.5, `desvio médio do alvo ${deviation.toFixed(2)}`);
assert.ok(
  picked.average_score > buildSet(big.slice(0, 8), { curve: "classic" }).average_score,
  "escolher entre 30 bate ordenar as 8 primeiras",
);
assert.deepEqual(buildSet(big, { curve: "classic", maxTracks: 8, durations }).order.map((p) => p.track_id), pickedIds, "determinístico");

// aviso sem minutos quando falta a duração de alguma faixa da ordem; duration_ms nulo
const gap = new Map<string, number | null>(durations).set(pickedIds[3] as string, null);
const gapped = buildSet(big, { curve: "classic", maxTracks: 8, durations: gap });
assert.equal(gapped.duration_ms, null);
assert.ok(gapped.warnings.includes("Selecionadas 8 de 30 faixas analisadas"));
assert.equal(buildSet(big, { curve: "classic", maxTracks: 8 }).duration_ms, null, "sem durações conhecidas");

// abertura e fechamento fixos valem dentro da seleção (N < n)
const startId = big[4]?.track_id as string;
const endId = big[11]?.track_id as string;
const fixed = buildSet(big, { curve: "classic", maxTracks: 8, startTrackId: startId, endTrackId: endId });
assert.equal(fixed.order.length, 8);
assert.equal(fixed.order[0]?.track_id, startId);
assert.equal(fixed.order[7]?.track_id, endId);

// pedido maior que o pool: entram todas, com aviso
const everything = buildSet(big, { curve: "classic", maxTracks: 40, durations });
assert.equal(everything.order.length, 30);
assert.ok(everything.warnings.some((w) => w.includes("Pedido de ~40 faixas excede o máximo de 30")));

// ---------- P10: seleção por duração ----------
const target = 90 * 60_000;
const meanMs = [...durations.values()].reduce((sum, ms) => sum + ms, 0) / durations.size;
const byDuration = buildSet(big, { curve: "classic", targetDurationMs: target, durations });
const expectedN = Math.round(target / meanMs);
assert.equal(byDuration.order.length, expectedN, "N = alvo / média das durações do pool");
assert.equal(byDuration.duration_ms, sumOf(byDuration.order.map((p) => p.track_id)));
assert.ok(Math.abs((byDuration.duration_ms as number) - target) / target < 0.2, `duração ${byDuration.duration_ms} longe do alvo`);
assert.ok(byDuration.warnings.some((w) => new RegExp(`^Selecionadas ${expectedN} de 30 faixas analisadas \\(~\\d+ min\\)$`).test(w)));
assert.equal(buildSet(big, { curve: "classic", targetDurationMs: 60_000, durations }).order.length, 2, "mínimo de 2 faixas");
assert.throws(() => buildSet(big, { curve: "classic", targetDurationMs: target }), /Sem a duração das faixas/);
// faixa sem duração fica fora da média e ainda pode ser escolhida
const partial = new Map<string, number | null>(durations).set(big[0]?.track_id as string, null);
const partialMean = [...partial.values()].filter((ms): ms is number => ms !== null).reduce((sum, ms) => sum + ms, 0) / 29;
assert.equal(buildSet(big, { curve: "classic", targetDurationMs: target, durations: partial }).order.length, Math.round(target / partialMean));

// ---------- P13: duração aproximada (o alvo de 90 min deu 103) ----------
// Duração que cresce com a energia: a curva escolhe faixas mais longas que a média do pool, e a soma passa do alvo.
const longMs = new Map<string, number | null>(big.map((x) => [x.track_id, 180_000 + 60_000 * (x.energy as number)]));
const longMean = [...longMs.values()].reduce<number>((sum, ms) => sum + (ms as number), 0) / longMs.size;
const longN = Math.round(target / longMean);
const sumLong = (ids: string[]): number => ids.reduce((sum, trackId) => sum + (longMs.get(trackId) as number), 0);
const limitOf = (ids: string[]): number => target + sumLong(ids) / ids.length / 2; // alvo + meia faixa (média da ordem)
const untrimmed = buildSet(big, { curve: "classic", maxTracks: longN, durations: longMs }); // por quantidade nunca corta
const untrimmedIds = untrimmed.order.map((p) => p.track_id);
assert.equal(untrimmed.order.length, longN);
assert.ok((untrimmed.duration_ms as number) > limitOf(untrimmedIds), "o cenário passa do alvo + meia faixa");
assert.ok(!untrimmed.warnings.some((w) => w.startsWith("Ajustado")), "max_tracks não tem corte nem aviso");

const trimmed = buildSet(big, { curve: "classic", targetDurationMs: target, durations: longMs });
const trimmedIds = trimmed.order.map((p) => p.track_id);
let keep = longN; // a regra escrita de outro jeito: tira a última enquanto a soma passar do limite, sem ficar abaixo de 2
while (keep > 2 && sumLong(untrimmedIds.slice(0, keep)) > limitOf(untrimmedIds)) keep -= 1;
assert.ok(keep < longN && keep > 2, `o cenário pede corte (ficaria com ${keep} de ${longN})`);
assert.deepEqual(trimmedIds, untrimmedIds.slice(0, keep), "só as últimas saem: a ordem é prefixo da do max_tracks");
assert.equal(trimmed.duration_ms, sumLong(trimmedIds));
assert.ok((trimmed.duration_ms as number) <= limitOf(untrimmedIds), "cabe em alvo + meia faixa");
assert.ok(sumLong(untrimmedIds.slice(0, keep + 1)) > limitOf(untrimmedIds), "corta o mínimo: com mais uma faixa ainda passaria");
const trimmedMin = Math.round((trimmed.duration_ms as number) / 60_000);
assert.ok(trimmed.warnings.includes(`Selecionadas ${keep} de 30 faixas analisadas (~${trimmedMin} min)`), trimmed.warnings.join(" | "));
assert.ok(trimmed.warnings.includes(`Ajustado para ${trimmedMin} min (alvo 90)`), trimmed.warnings.join(" | "));
assert.ok(!trimmed.warnings.some((w) => w.includes("excede o máximo")), "o corte não vira 'pedido acima do máximo'");
// o relatório é recalculado para a ordem cortada (curva, transições, pontos fracos e pontes)
const rebuilt = buildReport(trimmedIds.map((trackId) => big.find((x) => x.track_id === trackId) as TrackAnalysis), "classic", normalizeWeights());
for (const field of ["average_score", "order", "transitions", "weak_transitions", "problem_tracks", "bridges"] as const) {
  assert.deepEqual(trimmed[field], rebuilt[field], `relatório recalculado: ${field}`);
}
assert.equal(trimmed.transitions.length, keep - 1);

// sem corte: soma dentro de alvo + meia faixa, ordem de 2 faixas, fechamento fixo ou faixa sem duração
const flat = buildSet(big, { curve: "classic", targetDurationMs: target, durations: new Map(big.map((x) => [x.track_id, 300_000])) });
assert.equal(flat.order.length, 18, "18 × 5 min = alvo: nada a cortar");
assert.ok(!flat.warnings.some((w) => w.startsWith("Ajustado")));
// nunca abaixo de 2: a abertura fixa dura 50 min (alvo 20, N = 3) e o corte para em 2 faixas mesmo passando do limite
const tiny = pool(8, 4);
const tinyMs = new Map<string, number | null>(tiny.map((x, i) => [x.track_id, i === 0 ? 3_000_000 : 120_000]));
const floored = buildSet(tiny, { curve: "classic", targetDurationMs: 20 * 60_000, durations: tinyMs, startTrackId: tiny[0]?.track_id });
assert.equal(floored.order.length, 2, "nunca abaixo de 2");
assert.equal(floored.duration_ms, 3_000_000 + 120_000);
assert.ok(floored.warnings.includes("Ajustado para 52 min (alvo 20)"), floored.warnings.join(" | "));
const pinEnd = untrimmedIds[keep] as string; // uma das faixas que o corte tiraria
const pinnedEnd = buildSet(big, { curve: "classic", targetDurationMs: target, durations: longMs, endTrackId: pinEnd });
const pinnedIds = pinnedEnd.order.map((p) => p.track_id);
assert.ok((pinnedEnd.duration_ms as number) > limitOf(pinnedIds), "sem a trava o corte agiria");
assert.equal(pinnedEnd.order.length, longN, "com fechamento fixo não corta (tiraria a faixa pedida)");
assert.equal(pinnedIds.at(-1), pinEnd);
assert.ok(!pinnedEnd.warnings.some((w) => w.startsWith("Ajustado")));
const holeId = untrimmedIds[0] as string; // abertura fixa com a duração desconhecida: há N, mas não há soma
const holes = new Map(longMs).set(holeId, null);
const holeMean = [...holes.values()].filter((ms): ms is number => ms !== null).reduce((sum, ms) => sum + ms, 0) / (big.length - 1);
const holey = buildSet(big, { curve: "classic", targetDurationMs: target, durations: holes, startTrackId: holeId });
assert.equal(holey.duration_ms, null);
assert.equal(holey.order.length, Math.round(target / holeMean), "sem a duração de uma faixa da ordem não há corte");
assert.ok(!holey.warnings.some((w) => w.startsWith("Ajustado")));

// pool grande (n > 90): 12 candidatos de abertura, N posições e a curva continuam valendo
const huge = pool(120, 21);
const hugeSet = buildSet(huge, { curve: "peak_time", maxTracks: 15, durations: new Map(huge.map((x) => [x.track_id, 300_000])) });
assert.equal(hugeSet.order.length, 15);
assert.equal(hugeSet.pool_size, 120);
assert.equal(hugeSet.duration_ms, 15 * 300_000);
assert.ok(hugeSet.order.every((p, i, all) => all.findIndex((q) => q.track_id === p.track_id) === i), "sem repetição");

// ---------- P10: cabeçalho do markdown ----------
const pickedMd = setToMarkdown(picked);
assert.ok(
  pickedMd.startsWith(`# Set proposto · 8 faixas · ${Math.round((picked.duration_ms as number) / 60_000)} min · curva "classic"`),
  pickedMd.split("\n")[0],
);
assert.ok(setToMarkdown(result).startsWith('# Set proposto · 22 faixas · curva "classic"'), "sem duração, sem minutos");
assert.ok(!setToMarkdown(result).includes("energia estimada"), "sem estimativa, sem legenda");

// ---------- P12: energia estimada no relatório ----------
const flagged = pool(6, 2).map((x, i) => (i < 2 ? { ...x, energy_estimated: true } : x));
const flaggedSet = buildSet(flagged, { curve: "classic" });
for (const position of flaggedSet.order) {
  assert.equal(position.energy_estimated, flagged.find((x) => x.track_id === position.track_id)?.energy_estimated === true);
}
assert.equal(flaggedSet.order.filter((p) => p.energy_estimated).length, 2);
assert.ok(result.order.every((p) => p.energy_estimated === false), "energia do Mixar/usuário não é estimativa");
assert.equal(buildSet([{ ...eletro[0], energy: undefined } as TrackAnalysis, ...eletro.slice(1, 5)], { curve: "classic" }).order.filter((p) => p.energy === null).length, 1);
const flaggedMd = setToMarkdown(flaggedSet);
assert.match(flaggedMd, /E\d+\* \(alvo/);
assert.match(flaggedMd, /\* energia estimada: energy da ReccoBeats/);

// P17: avoidRecent só tira as faixas se sobrar metade do pool (e 10)
{
  const forty = pool(40, 7);
  const ten = new Set(forty.slice(0, 10).map((t) => t.track_id));
  assert.equal(avoidRecent(forty, ten).avoided, 10);
  assert.equal(avoidRecent(forty, ten).tracks.length, 30);
  const most = new Set(forty.slice(0, 25).map((t) => t.track_id));
  assert.deepEqual(avoidRecent(forty, most), { tracks: forty, avoided: 0 }); // sobrariam 15 < 20
  const twelve = pool(12, 7);
  assert.equal(avoidRecent(twelve, new Set(twelve.slice(0, 3).map((t) => t.track_id))).avoided, 0); // sobrariam 9 < 10
  assert.equal(avoidRecent(forty, new Set(["nope"])).avoided, 0);
}

console.log(setToMarkdown(result));
console.log(`\n[ok] ${eletro.length} faixas em ${elapsed} ms · nota média ${result.average_score} · fixado: ${pinned.average_score}`);
console.log("[ok] regressão sem parâmetros (5 cenários), seleção por quantidade e duração (P10), corte da duração (P13), energia estimada no relatório (P12), faixas de sets recentes (P17)");
