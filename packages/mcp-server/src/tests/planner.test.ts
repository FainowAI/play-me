import assert from "node:assert/strict";
import { mixGuideStep, planTransition } from "../services/planner.js";
import type { TrackAnalysis } from "../types.js";

const t = (id: string, camelot: string, bpm: number, extra: Partial<TrackAnalysis> = {}): TrackAnalysis => ({
  track_id: id,
  bpm,
  camelot,
  updated_at: "2026-01-01T00:00:00Z",
  ...extra,
});

// A → B = tipo/comprimento/compasso do grave
const cases: [string, TrackAnalysis, TrackAnalysis, string, number, number | null][] = [
  ["7B 122 → 7A 124", t("a", "7B", 122), t("b", "7A", 124), "blend", 16, 9],
  ["5A 125 → 5A 124", t("a", "5A", 125), t("b", "5A", 124), "blend", 32, 17],
  ["1B 128 → 12A 130", t("a", "1B", 128), t("b", "12A", 130), "bass_swap", 8, 5],
  ["12A 130 → 12B 124", t("a", "12A", 130), t("b", "12B", 124), "bass_swap", 8, 5],
  ["8A → 2A trítono", t("a", "8A", 124), t("b", "2A", 124), "echo_out", 4, null],
  ["8A → 1A semitom abaixo", t("a", "8A", 124), t("b", "1A", 124), "filter", 8, null],
  ["124 → 133 BPM", t("a", "8A", 124), t("b", "8A", 133), "echo_out", 4, null],
];
for (const [name, a, b, type, bars, bar] of cases) {
  const plan = planTransition(a, b);
  assert.equal(plan.type, type, name);
  assert.equal(plan.length_bars, bars, name);
  assert.equal(plan.bass_swap_bar, bar, name);
  assert.equal(plan.alerts.at(-1), "vocal e grave: sem dado (plano por metadados)", name);
}

// rampa + alerta de ΔBPM
const ramp = planTransition(t("a", "12A", 130), t("b", "12B", 124));
assert.equal(ramp.tempo.strategy, "ramp");
assert.ok(ramp.alerts.includes("ΔBPM acima de 5"));
assert.ok(ramp.alerts.includes("rampa de tempo: ajuste o BPM ao longo da transição"));
assert.equal(planTransition(t("a", "5A", 125), t("b", "5A", 124)).tempo.strategy, "match_incoming");

// tom a validar: -0.2 na confiança, alerta, tipo intacto
const base = planTransition(t("a", "7B", 122), t("b", "7A", 124));
const val = planTransition(t("a", "7B", 122, { notes: "[A VALIDAR] tom" }), t("b", "7A", 124, { notes: "[A VALIDAR] tom" }));
assert.equal(val.type, base.type);
assert.equal(val.confidence, Math.round((base.confidence - 0.2) * 100) / 100);
assert.ok(val.alerts.includes("confirme o tom no Mixar (A e B)"));
assert.ok(planTransition(t("a", "7B", 122), t("b", "7A", 124, { notes: "[A VALIDAR] tom" })).alerts.includes("confirme o tom no Mixar (B)"));

// half/double conta diff 0
const hd = planTransition(t("a", "8A", 87), t("b", "8A", 174));
assert.equal(hd.tempo.diff, 0);
assert.equal(hd.tempo.mode, "half_double");
assert.equal(hd.type, "blend");

// tom inválido
assert.throws(() => planTransition(t("a", "8A", 124, { label: "Faixa X" }), t("b", "??", 124)), /Tom inválido/);

// guia do Mix
const rise = mixGuideStep(planTransition(t("a", "7B", 122, { energy: 5 }), t("b", "7A", 124, { energy: 7 })), "1 → 2", "A", "B");
assert.equal(rise.preset, "Rise");
assert.ok(rise.eq.includes("compasso 9"));
assert.ok(!rise.alerts.some((alert) => alert.startsWith("vocal e grave")));
const fade = mixGuideStep(planTransition(t("a", "8A", 124, { energy: 5 }), t("b", "2A", 124, { energy: 8 })), "2 → 3", "A", "B");
assert.equal(fade.preset, "Fade");
assert.ok(fade.effects.includes("passa-alta rápido"));
for (const step of [rise, fade]) {
  assert.ok(/preset (Fade|Rise),/.test(step.text));
  assert.ok(step.text.startsWith(`${step.position} · A → B: preset `));
}

console.log("[ok] planner: 5 regras, rampa, tom a validar, half/double, guia do Mix");
