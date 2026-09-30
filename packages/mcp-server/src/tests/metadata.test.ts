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

console.log("[ok] metadados: merge, ReccoBeats simulada, lookup");
