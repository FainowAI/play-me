import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AnalysisStore } from "../services/analysis-store.js";
import { RateLimitError, type HttpDeps } from "../services/metadata/http.js";
import { MetadataCache, lookupTracks } from "../services/metadata/lookup.js";
import { coverageBucket, mergeMetadata } from "../services/metadata/merge.js";
import { createReccoBeats, pitchToCamelot } from "../services/metadata/reccobeats.js";
import type { SpotifyTrackSummary, TrackAnalysis } from "../types.js";

const ID = "0000000000000000000001";
const r = (bpm: number | null, camelot: string | null = "8A", energy: number | null = null) => ({ bpm, camelot, energy });
const saved = (outcome: ReturnType<typeof mergeMetadata>) => {
  assert.equal(outcome.action, "save");
  return (outcome as Extract<typeof outcome, { action: "save" }>).entry;
};

// ---------- merge: origem do usuário nunca é sobrescrita ----------
for (const source of ["spotify-mixar", "rekordbox", "serato", "traktor", "ouvido", "manual", undefined]) {
  const existing: TrackAnalysis = { track_id: ID, bpm: 124, camelot: "8A", source, updated_at: "" };
  assert.equal(mergeMetadata(ID, existing, r(126)).action, "keep", `sobrescreveu ${source}`);
}
// entrada web anterior pode ser atualizada
const webEntry: TrackAnalysis = { track_id: ID, bpm: 120, camelot: "8A", source: "web", updated_at: "" };
assert.equal(mergeMetadata(ID, webEntry, r(124)).action, "save");

// ---------- merge: BPM ----------
let e = saved(mergeMetadata(ID, undefined, r(124.02)));
assert.equal(e.bpm, 124, "ReccoBeats sozinha: conferido, arredondado");
assert.equal(e.source, "web");
assert.ok(!e.notes?.includes("[A VALIDAR] BPM"));

// ---------- merge: tom sempre [A VALIDAR] ----------
e = saved(mergeMetadata(ID, undefined, r(124, "12A")));
assert.equal(e.camelot, "12A");
assert.match(e.notes ?? "", /\[A VALIDAR\] tom da web \(ReccoBeats\)/);
assert.deepEqual(mergeMetadata(ID, undefined, r(124, null)), { action: "pending", reason: "sem tom" });

// ---------- merge: sem BPM ----------
assert.deepEqual(mergeMetadata(ID, undefined, r(null)), { action: "pending", reason: "sem BPM em nenhuma fonte" });
assert.equal(mergeMetadata(ID, undefined, null).action, "pending");

// ---------- merge: energy só em notes ----------
e = saved(mergeMetadata(ID, undefined, r(124, "8A", 0.731)));
assert.match(e.notes ?? "", /energy 0\.73 \(ReccoBeats\)/);
assert.equal(e.energy, undefined, "energia continua estimativa do Claude");

// ---------- cobertura: bucket pelo BPM (tom da web é sempre a validar) ----------
assert.equal(coverageBucket(undefined), "pendente");
assert.equal(coverageBucket({ ...webEntry, source: "spotify-mixar" }), "mixar");
assert.equal(coverageBucket({ ...webEntry, notes: "[A VALIDAR] tom da web (ReccoBeats); confira no Mixar" }), "web");
assert.equal(coverageBucket({ ...webEntry, notes: "[A VALIDAR] BPM diverge: ReccoBeats 124, outra fonte 130" }), "a_validar", "entradas antigas");

// ---------- clientes com fetch simulado ----------
const calls: string[] = [];
const sleeps: number[] = [];
let clock = 0;
const fakeHttp = (respond: (url: string) => { status?: number; body: unknown }): HttpDeps => ({
  fetch: (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const { status = 200, body } = respond(url);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch,
  sleep: async (ms) => {
    sleeps.push(ms);
    clock += ms;
  },
  now: () => clock,
});

// ReccoBeats: classe de altura → Camelot, lote de 40, só /v1/audio-features
assert.equal(pitchToCamelot(0, 1), "8B"); // C
assert.equal(pitchToCamelot(9, 0), "8A"); // Am
assert.equal(pitchToCamelot(1, 0), "12A"); // C#m
assert.equal(pitchToCamelot(5, 0), "4A"); // Fm
assert.equal(pitchToCamelot(-1, 1), null, "-1 = sem tom");
assert.equal(pitchToCamelot(3, undefined), null);
calls.length = 0;
sleeps.length = 0;
const idN = (n: number) => String(n).padStart(22, "0");
const ids = Array.from({ length: 45 }, (_, i) => idN(i));
const recco = createReccoBeats(
  fakeHttp((url) => ({
    body: {
      content: new URL(url).searchParams.get("ids")!.split(",").slice(0, 2).map((id) => ({
        href: `https://open.spotify.com/track/${id}`, tempo: 124.02, key: 9, mode: 0, energy: 0.8,
      })),
    },
  })),
);
const got = await recco(ids);
assert.equal(calls.length, 2, "45 IDs → 2 lotes (40 + 5)");
assert.equal(new URL(calls[0]!).searchParams.get("ids")!.split(",").length, 40);
assert.deepEqual(sleeps, [1_000], "pausa entre lotes");
assert.ok(calls.every((url) => url.startsWith("https://api.reccobeats.com/v1/audio-features?ids=")), "nunca chama análise de arquivo");
assert.deepEqual(got.get(idN(0)), { bpm: 124.02, camelot: "8A", energy: 0.8 });
assert.equal(got.has(idN(2)), false, "faixa fora da base não aparece");
await assert.rejects(createReccoBeats(fakeHttp(() => ({ status: 429, body: {} })))([ID]), RateLimitError);

// ---------- lookup: dry run não toca o store; limite interrompe o lote ----------
const dir = mkdtempSync(join(tmpdir(), "dj-meta-test-"));
try {
  const store = new AnalysisStore(dir);
  store.upsert([{ track_id: ID, bpm: 124, camelot: "8A", source: "spotify-mixar" }]);
  const before = readFileSync(join(dir, "analysis.json"), "utf8");
  const track = (id: string, name: string): SpotifyTrackSummary => ({
    position: 0, id, uri: null, name, artists: ["Mau P"], duration_ms: null, isrc: "GBDUW0000059", is_local: false, type: "track",
  });
  const tracks = [track(ID, "Paranoia"), track("0000000000000000000002", "Paranoia")];
  const cache = new MetadataCache(dir);
  const deps = {
    store,
    cache,
    reccobeats: async (idsIn: string[]) => new Map(idsIn.map((id) => [id, r(128, "11A")] as const)),
  };
  const dry = await lookupTracks(tracks, true, deps);
  assert.deepEqual(dry.rows.map((r) => r.outcome.action), ["keep", "save"]);
  assert.equal(readFileSync(join(dir, "analysis.json"), "utf8"), before, "dry run não grava");
  const cacheText = readFileSync(join(dir, "metadata-cache.json"), "utf8");
  assert.ok(!cacheText.includes("Paranoia") && !cacheText.includes("Mau P") && !cacheText.includes("GBDUW"), "cache sem nome, artista ou ISRC");

  const wet = await lookupTracks(tracks, false, deps);
  assert.equal(wet.saved, 1);
  assert.equal(store.get(ID)?.source, "spotify-mixar", "Mixar intacto");
  assert.equal(store.get("0000000000000000000002")?.camelot, "11A");

  const limited = await lookupTracks([track("0000000000000000000003", "X"), track("0000000000000000000004", "Y")], true, {
    ...deps,
    reccobeats: async () => {
      throw new RateLimitError("ReccoBeats", "HTTP 429");
    },
  });
  assert.equal(limited.rows.length, 0);
  assert.match(limited.stopped ?? "", /ReccoBeats/);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// ---------- P12: energia estimada na leitura do store (nunca persistida) ----------
{
  const energyDir = mkdtempSync(join(tmpdir(), "dj-energy-test-"));
  try {
    const store = new AnalysisStore(energyDir);
    const file = join(energyDir, "analysis.json");
    const id = (n: number) => String(n).padStart(22, "0");
    const webNote = (x: string) => `[A VALIDAR] tom da web (ReccoBeats); confira no Mixar; energy ${x} (ReccoBeats), apoio à energia`;
    store.upsert([
      { track_id: id(1), bpm: 124, camelot: "8A", source: "web", notes: webNote("0.55") },
      { track_id: id(2), bpm: 124, camelot: "8A", source: "spotify-mixar", energy: 8, notes: webNote("0.10") },
      { track_id: id(3), bpm: 124, camelot: "8A", source: "web", notes: webNote("0.00") },
      { track_id: id(4), bpm: 124, camelot: "8A", source: "web", notes: webNote("1.00") },
      { track_id: id(5), bpm: 124, camelot: "8A", source: "web", notes: "[A VALIDAR] tom da web (ReccoBeats); confira no Mixar" },
      { track_id: id(6), bpm: 124, camelot: "8A", source: "web", notes: webNote("0.62") },
    ]);

    // web sem energia + notas com `energy x (ReccoBeats)` → clamp(round(1 + x × 9), 1, 10), marcada como estimativa
    assert.deepEqual([store.get(id(1))?.energy, store.get(id(1))?.energy_estimated], [6, true], "0.55 → 6");
    assert.equal(store.getMany([id(1)]).get(id(1))?.energy, 6, "getMany deriva igual ao get");
    assert.equal(store.get(id(3))?.energy, 1, "0.00 → 1");
    assert.equal(store.get(id(4))?.energy, 10, "1.00 → 10");
    assert.equal(store.get(id(6))?.energy, 7, "0.62 → round(6.58) = 7");
    // Mixar (ou qualquer energia do usuário) fica intacta e sem marca
    assert.deepEqual([store.get(id(2))?.energy, store.get(id(2))?.energy_estimated], [8, undefined]);
    // a nota "tom da web (ReccoBeats)" não é energia: sem número, sem estimativa
    assert.deepEqual([store.get(id(5))?.energy, store.get(id(5))?.energy_estimated], [undefined, undefined]);
    assert.equal(store.get(id(99)), undefined);

    // o derivado nunca chega ao arquivo nem ao cache
    const onDisk = (n: number) => (JSON.parse(readFileSync(file, "utf8")) as { tracks: TrackAnalysis[] }).tracks.find((x) => x.track_id === id(n));
    const assertClean = (when: string) => {
      const text = readFileSync(file, "utf8");
      assert.ok(!text.includes("energy_estimated"), `${when}: energy_estimated no arquivo`);
      for (const n of [1, 3, 4, 5, 6]) assert.equal(onDisk(n)?.energy, undefined, `${when}: energia derivada gravada em ${n}`);
      assert.equal(onDisk(2)?.energy, 8, `${when}: energia do Mixar preservada`);
    };
    assertClean("após o upsert");

    // upsert de uma entrada derivada (saída de get) não grava a energia nem a marca
    store.upsert([store.get(id(1)) as TrackAnalysis]);
    assertClean("após upsert de entrada derivada");
    assert.equal(store.get(id(1))?.energy, 6, "a estimativa continua saindo das notas");

    // upsert de outra faixa regrava o arquivo inteiro: as estimativas dos demais não podem vazar
    store.upsert([{ track_id: id(7), bpm: 126, camelot: "9A", source: "web", notes: webNote("0.80") }]);
    assertClean("após upsert de outra faixa");
    assert.equal(store.get(id(7))?.energy, 8, "0.80 → round(8.2) = 8");

    // o usuário informa a energia: passa a valer e deixa de ser estimativa
    store.upsert([{ track_id: id(1), bpm: 124, camelot: "8A", energy: 4 }]);
    assert.deepEqual([store.get(id(1))?.energy, store.get(id(1))?.energy_estimated], [4, undefined]);
    assert.equal(onDisk(1)?.energy, 4);

    // a leitura devolve cópia: alterar o resultado não contamina o cache
    const copy = store.get(id(3)) as TrackAnalysis;
    copy.energy = 9;
    assert.equal(store.get(id(3))?.energy, 1);
  } finally {
    rmSync(energyDir, { recursive: true, force: true });
  }
}

console.log("[ok] metadados: merge, ReccoBeats simulada, lookup, energia estimada (P12)");
