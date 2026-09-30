// Check da lógica pura do painel (Node sem build): `node --no-warnings src/panel/logic.test.ts`, a partir de apps/web.
import assert from "node:assert/strict";
import { DEFAULT_WEIGHTS, type SetSnapshot, type SnapshotTrack, type TransitionReport, type Weights } from "../types.ts";
import { WEIGHT_KEYS, arcCaption, arcPoints, correctionMessage, metaLine, parseCorrection, redistribute } from "./logic.ts";

const track = (position: number, energy: number | null, target = 5): SnapshotTrack => ({
  position,
  track_id: `t${position}`,
  label: `T${position}`,
  bpm: 124,
  camelot: "8A",
  energy,
  target_energy: target,
  section: "peak",
  source: null,
  key_review: false,
});

// legenda: o set Eletro do canvas (pico na 14; 12, 13 e 14 seguidas com E9+)
const eletro = [4, 5, 5, 6, 6, 6, 7, 7, 8, 7, 8, 9, 9, 10, 6, 6, 6, 5, 5, 5, 4].map((e, i) => track(i + 1, e));
assert.equal(arcCaption(eletro), "Pico na faixa 14. Atenção: 12, 13 e 14 seguidas com E9 ou mais, sem respiro.");
assert.equal(arcCaption([9, 9, 7].map((e, i) => track(i + 1, e))), "Pico na faixa 1."); // só 2 seguidas
assert.equal(arcCaption([9, 9, null, 9, 9].map((e, i) => track(i + 1, e, 9))), "Pico na faixa 1."); // sem energia quebra a sequência
assert.equal(arcCaption([1, 2, 3].map((p) => track(p, null, 9))), "Pico na faixa 1."); // o alvo não gera aviso
assert.equal(arcCaption([9, 9, 9, 9, 3, 9, 9, 9].map((e, i) => track(i + 1, e))), "Pico na faixa 1. Atenção: 1, 2, 3 e 4 seguidas com E9 ou mais, sem respiro.");
assert.equal(arcCaption([]), "");

// pontos do arco: a energia vence o alvo; sem energia, vale o alvo da curva
assert.deepEqual(arcPoints([track(1, null, 7.3), track(2, 8, 3)]), [{ energy: 7.3 }, { energy: 8 }]);

// linha do cabeçalho: versão do gate de envio (sem transições) não mostra a nota média, que é da ordem anterior
const snap = (transitions: number): SetSnapshot => ({ curve: "classic", average_score: 0.84, order: eletro, transitions: Array.from({ length: transitions }, () => ({}) as TransitionReport), weak_transitions: [], problem_tracks: [], warnings: [] });
assert.equal(metaLine(snap(20)), "21 faixas · nota média 0,84 · curva classic");
assert.equal(metaLine(snap(0)), "21 faixas · curva classic");
// duração (Sprint 4): logo depois das faixas, arredondada ao minuto; null (o Spotify não informou alguma) ou ausente não mostra nada
assert.equal(metaLine({ ...snap(20), duration_ms: 5_460_000 }), "21 faixas · 91 min · nota média 0,84 · curva classic");
assert.equal(metaLine({ ...snap(0), duration_ms: 5_460_000 }), "21 faixas · 91 min · curva classic");
assert.equal(metaLine({ ...snap(20), duration_ms: 5_369_999 }), "21 faixas · 89 min · nota média 0,84 · curva classic"); // 89,4999
assert.equal(metaLine({ ...snap(20), duration_ms: 5_370_000 }), "21 faixas · 90 min · nota média 0,84 · curva classic"); // 89,5 sobe
assert.equal(metaLine({ ...snap(20), duration_ms: null }), "21 faixas · nota média 0,84 · curva classic");

// pesos: sempre inteiros, ≥ 0, somando 100, com o peso movido exatamente no valor pedido
const starts: Weights[] = [
  DEFAULT_WEIGHTS,
  { camelot: 100, bpm: 0, energy: 0, style: 0, progression: 0 },
  { camelot: 0, bpm: 1, energy: 1, style: 1, progression: 1 },
  { camelot: 20, bpm: 20, energy: 20, style: 20, progression: 20 },
];
for (const w of starts)
  for (const k of WEIGHT_KEYS)
    for (let v = 0; v <= 100; v++) {
      const r = redistribute(w, k, v);
      const vals = WEIGHT_KEYS.map((x) => r[x]);
      assert.equal(vals.reduce((s, n) => s + n, 0), 100, `${JSON.stringify(w)} ${k}=${v}`);
      assert.ok(vals.every((n) => Number.isInteger(n) && n >= 0), `${JSON.stringify(w)} ${k}=${v}`);
      assert.equal(r[k], v);
    }
assert.deepEqual(redistribute(DEFAULT_WEIGHTS, "camelot", 50), { camelot: 50, bpm: 19, energy: 19, style: 8, progression: 4 }); // 25:25:10:5 na proporção
assert.deepEqual(redistribute(starts[1] as Weights, "camelot", 60), { camelot: 60, bpm: 10, energy: 10, style: 10, progression: 10 }); // outros zerados: partes iguais
assert.equal(redistribute(DEFAULT_WEIGHTS, "bpm", 140).bpm, 100); // clamp

// correção manual
assert.deepEqual(parseCorrection({ bpm: "125", key: "2a", energy: "9" }), { ok: true, value: { bpm: 125, key: "2A", energy: 9 } });
assert.deepEqual(parseCorrection({ bpm: "124,5", key: " 12b ", energy: "" }), { ok: true, value: { bpm: 124.5, key: "12B", energy: null } });
const bad = parseCorrection({ bpm: "30", key: "13A", energy: "11" });
assert.ok(!bad.ok && Object.keys(bad.errors).sort().join() === "bpm,energy,key");
for (const input of [
  { bpm: "", key: "8A", energy: "" },
  { bpm: "abc", key: "8A", energy: "" },
  { bpm: "125", key: "0A", energy: "" },
  { bpm: "125", key: "8C", energy: "" },
  { bpm: "125", key: "8A", energy: "7.5" },
  { bpm: "125", key: "8A", energy: "0" },
])
  assert.equal(parseCorrection(input).ok, false, JSON.stringify(input));
assert.equal(correctionMessage("Moon Rocks", "abc123", { bpm: 125, key: "2A", energy: 9 }), "Corrige a faixa de id abc123: BPM 125, tom 2A, energia 9. Grave com fonte manual.");
assert.equal(correctionMessage("Moon Rocks", "abc123", { bpm: 124.5, key: "2A", energy: null }), "Corrige a faixa de id abc123: BPM 124.5, tom 2A. Grave com fonte manual.");

console.log("panel logic ok");
