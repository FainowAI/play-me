import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AnalysisStore } from "../services/analysis-store.js";
import { lookupDeezer } from "../services/metadata/deezer.js";
import { RateLimitError, cleanTitle, createGetSongBpm, normalize, type HttpDeps } from "../services/metadata/getsongbpm.js";
import { MetadataCache, lookupTracks } from "../services/metadata/lookup.js";
import { coverageBucket, mergeMetadata } from "../services/metadata/merge.js";
import type { SpotifyTrackSummary, TrackAnalysis } from "../types.js";

const ID = "0000000000000000000001";
const g = (bpm: number | null, key: string | null = "Am", danceability: number | null = null) => ({ bpm, key, danceability });
const dz = (bpm: number | null) => ({ bpm });
const saved = (outcome: ReturnType<typeof mergeMetadata>) => {
  assert.equal(outcome.action, "save");
  return (outcome as Extract<typeof outcome, { action: "save" }>).entry;
};

// ---------- merge (a): origem do usuário nunca é sobrescrita ----------
for (const source of ["spotify-mixar", "rekordbox", "serato", "traktor", "ouvido", "manual", undefined]) {
  const existing: TrackAnalysis = { track_id: ID, bpm: 124, camelot: "8A", source, updated_at: "" };
  assert.equal(mergeMetadata(ID, existing, g(126), dz(126)).action, "keep", `sobrescreveu ${source}`);
}
// entrada web anterior pode ser atualizada
const webEntry: TrackAnalysis = { track_id: ID, bpm: 120, camelot: "8A", source: "web", updated_at: "" };
assert.equal(mergeMetadata(ID, webEntry, g(124), dz(124)).action, "save");

// ---------- merge (b): BPM ----------
let e = saved(mergeMetadata(ID, undefined, g(124), dz(125)));
assert.equal(e.bpm, 125); // média de 124 e 125 arredondada
assert.equal(e.source, "web");
assert.ok(!e.notes?.includes("[A VALIDAR]"));
e = saved(mergeMetadata(ID, undefined, g(128), dz(64)));
assert.equal(e.bpm, 128, "metade/dobro concorda na escala do GetSongBPM");
e = saved(mergeMetadata(ID, undefined, g(87), dz(174)));
assert.equal(e.bpm, 87);
e = saved(mergeMetadata(ID, undefined, g(124), null));
assert.match(e.notes ?? "", /\[A VALIDAR\] BPM de fonte única \(GetSongBPM\)/);
e = saved(mergeMetadata(ID, undefined, g(null), dz(122)));
assert.equal(e.bpm, 122);
assert.match(e.notes ?? "", /\[A VALIDAR\] BPM de fonte única \(Deezer\)/);
e = saved(mergeMetadata(ID, undefined, g(124), dz(130)));
assert.equal(e.bpm, 124);
assert.match(e.notes ?? "", /\[A VALIDAR\] BPM diverge: GetSongBPM 124, Deezer 130/);

// ---------- merge (c): tom ----------
e = saved(mergeMetadata(ID, undefined, g(124, "C♯m"), dz(124)));
assert.equal(e.camelot, "12A");
assert.match(e.notes ?? "", /tom de fonte única \(GetSongBPM\)/);
assert.equal(saved(mergeMetadata(ID, undefined, g(124, "B♭"), null)).camelot, "6B");
assert.deepEqual(mergeMetadata(ID, undefined, g(124, null), dz(124)), { action: "pending", reason: "sem tom" });
assert.equal(mergeMetadata(ID, undefined, null, dz(124)).action, "pending", "Deezer sozinho não tem tom");

// ---------- merge (d): sem BPM ----------
assert.deepEqual(mergeMetadata(ID, undefined, g(null), dz(null)), { action: "pending", reason: "sem BPM em nenhuma fonte" });
assert.equal(mergeMetadata(ID, undefined, null, null).action, "pending");

// ---------- merge (e): danceability em notes ----------
e = saved(mergeMetadata(ID, undefined, g(124, "Am", 71), dz(124)));
assert.match(e.notes ?? "", /danceability 71\/100/);
assert.equal(e.energy, undefined, "energia continua estimativa do Claude");

// ---------- cobertura ----------
assert.equal(coverageBucket(undefined), "pendente");
assert.equal(coverageBucket({ ...webEntry, source: "spotify-mixar" }), "mixar");
assert.equal(coverageBucket(webEntry), "web");
assert.equal(coverageBucket({ ...webEntry, notes: "[A VALIDAR] BPM de fonte única (Deezer)" }), "a_validar");

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

assert.equal(normalize("RÜFÜS DU SOL"), "rufusdusol");
assert.equal(normalize("Level 5 (feat. 06f)"), "level5feat06f", "dígitos e letras ficam");
assert.equal(cleanTitle("Paranoia - Extended Mix"), "Paranoia");
assert.equal(cleanTitle("Freak (Original Mix)"), "Freak");
assert.equal(cleanTitle("Like I Like It (feat Kele Le Roc)"), "Like I Like It");
assert.equal(cleanTitle("Freak - Fisher Remix"), "Freak - Fisher Remix", "remix é outra faixa");

// GetSongBPM: casa título + artista, tempo em string, respeita 1,5 s
const gsbBody = {
  search: [
    { title: "Paranoia (Remix)", tempo: "140", key_of: "Dm", artist: { name: "Outro" } },
    { title: "Paranoia", tempo: "128", key_of: "F♯m", danceability: 80, artist: { name: "Mau P" } },
  ],
};
const gsb = createGetSongBpm("KEY", fakeHttp(() => ({ body: gsbBody })));
assert.deepEqual(await gsb("Paranoia - Extended Mix", ["Mau P"]), { bpm: 128, key: "F♯m", danceability: 80 });
assert.deepEqual(await gsb("Paranoia", ["Artista Errado"]), null, "sem casamento de artista → sem dado");
assert.deepEqual(sleeps, [1_500, 1_500], "cada requisição depois da primeira espera 1,5 s");
// fallback: "both" sem resultado → busca só pelo título, artista conferido no pickMatch
const fallback = createGetSongBpm(
  "KEY",
  fakeHttp((url) =>
    new URL(url).searchParams.get("type") === "both"
      ? { body: { search: { error: "no result" } } }
      : { body: { search: [{ title: "You Were Right", tempo: "122", key_of: "E", artist: { name: "RÜFÜS" } }] } },
  ),
);
const shortArtist = createGetSongBpm("KEY", fakeHttp(() => ({ body: { search: [{ title: "Paranoia", tempo: "90", key_of: "C", artist: { name: "P" } }] } })));
assert.equal(await shortArtist("Paranoia", ["Mau P"]), null, "artista curto não casa por substring");
assert.deepEqual(await fallback("You Were Right", ["RÜFÜS DU SOL"]), { bpm: 122, key: "E", danceability: null });
const gsbUrl = new URL(calls[0]!);
assert.equal(gsbUrl.origin + gsbUrl.pathname, "https://api.getsong.co/search/");
assert.equal(gsbUrl.searchParams.get("lookup"), "song:Paranoia artist:Mau P");
assert.equal(gsbUrl.searchParams.get("api_key"), null, "chave vai no header, não na URL");
assert.deepEqual(await createGetSongBpm("KEY", fakeHttp(() => ({ body: { search: { error: "no result" } } })))("X", ["Y"]), null);
await assert.rejects(createGetSongBpm("KEY", fakeHttp(() => ({ status: 429, body: {} })))("X", ["Y"]), RateLimitError);

// Deezer: só /track/isrc:, bpm 0 = sem dado, 800 = não achou, 4 = limite
calls.length = 0;
assert.deepEqual(await lookupDeezer("gbduw0000059", fakeHttp(() => ({ body: { bpm: 123.5, preview: "https://x/p.mp3" } }))), { bpm: 123.5 });
assert.deepEqual(await lookupDeezer("GBDUW0000059", fakeHttp(() => ({ body: { bpm: 0 } }))), { bpm: null });
assert.equal(await lookupDeezer("GBDUW0000059", fakeHttp(() => ({ body: { error: { code: 800 } } }))), null);
await assert.rejects(lookupDeezer("GBDUW0000059", fakeHttp(() => ({ body: { error: { code: 4, message: "Quota" } } }))), RateLimitError);
assert.equal(await lookupDeezer("nao-e-isrc", fakeHttp(() => ({ body: {} }))), null);
assert.ok(calls.length > 0 && calls.every((url) => url.startsWith("https://api.deezer.com/track/isrc:")), "Deezer só chama /track/isrc:");

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
    getsongbpm: async () => g(128, "F#m"),
    deezer: async () => dz(128),
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
    getsongbpm: async () => {
      throw new RateLimitError("GetSongBPM", "HTTP 429");
    },
  });
  assert.equal(limited.rows.length, 0);
  assert.match(limited.stopped ?? "", /GetSongBPM/);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("[ok] metadados: merge (a–e), clientes simulados e lookup");
