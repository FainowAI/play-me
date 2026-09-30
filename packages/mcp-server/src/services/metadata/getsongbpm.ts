/**
 * GetSongBPM (https://getsongbpm.com/api, base https://api.getsong.co).
 * Busca por título + artista; devolve só números (BPM, tom, danceability).
 * Limite: 3.000 req/h (estourar bloqueia a chave por 1 h) → no máximo 1 req a cada 1,5 s.
 */

export const GETSONGBPM_BASE = "https://api.getsong.co";
export const GETSONGBPM_INTERVAL_MS = 1_500;

export interface GetSongBpmResult {
  bpm: number | null;
  key: string | null; // key_of como veio, ex.: "Em", "C♯m"
  danceability: number | null; // 0..100
}

export class RateLimitError extends Error {
  constructor(provider: string, detail: string) {
    super(`Limite de requisições do ${provider} atingido (${detail}). Lote interrompido; tente de novo mais tarde.`);
    this.name = "RateLimitError";
  }
}

export interface HttpDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export const realHttp: HttpDeps = {
  fetch: (...args) => fetch(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

interface RawSong {
  title?: string;
  tempo?: string | number | null;
  key_of?: string | null;
  danceability?: number | string | null;
  artist?: { name?: string } | null;
}

/** Faixa de mesmo nome sem remix/versão diferente: "Original Mix", "Extended Mix", "Radio Edit", "Remastered" são ruído. */
const NOISE = /\s*(?:[-–]\s*|\()\s*(?:original mix|extended mix|extended|radio edit|remaster(?:ed)?(?: \d{4})?)\s*\)?\s*$/i;

const FEAT = /\s*[(\[]\s*(?:feat\.?|ft\.?|featuring)\s[^)\]]*[)\]]/i;

export function cleanTitle(title: string): string {
  let out = title.trim();
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(NOISE, "").replace(FEAT, "").trim();
  }
  return out;
}

const MIN_CONTAINS = 4;

export const normalize = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // acentos (marcas combinantes após NFD)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const toNumber = (value: unknown): number | null => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Escolhe o resultado cujo título (limpo) e artista batem com a faixa.
 * Nenhum bate → null: pegar o primeiro resultado seria inventar dado (D03).
 */
export function pickMatch(songs: RawSong[], title: string, artists: string[]): RawSong | null {
  const wantTitle = normalize(cleanTitle(title));
  const wantArtists = artists.map(normalize).filter(Boolean);
  return (
    songs.find((song) => {
      const gotTitle = normalize(cleanTitle(song.title ?? ""));
      const gotArtist = normalize(song.artist?.name ?? "");
      if (!gotTitle || !gotArtist || gotTitle !== wantTitle) return false;
      // contém só vale com 4+ letras: "p" não pode casar com "maup" (D03)
      const contains = (long: string, short: string) => short.length >= MIN_CONTAINS && long.includes(short);
      return wantArtists.some((a) => a === gotArtist || contains(a, gotArtist) || contains(gotArtist, a));
    }) ?? null
  );
}

export function createGetSongBpm(apiKey: string, http: HttpDeps = realHttp, intervalMs = GETSONGBPM_INTERVAL_MS) {
  let last = -Infinity;

  async function search(type: "both" | "song", lookup: string): Promise<RawSong[]> {
    const wait = last + intervalMs - http.now();
    if (wait > 0) await http.sleep(wait);
    last = http.now();

    const url = new URL("/search/", GETSONGBPM_BASE);
    url.searchParams.set("type", type);
    url.searchParams.set("lookup", lookup);
    url.searchParams.set("limit", "30");
    const response = await http.fetch(url, { headers: { "X-API-KEY": apiKey }, signal: AbortSignal.timeout(20_000) });
    if (response.status === 429) throw new RateLimitError("GetSongBPM", "HTTP 429");
    if (!response.ok) throw new Error(`GetSongBPM respondeu HTTP ${response.status}.`);
    const body = (await response.json()) as { search?: RawSong[] | { error?: string } };
    return Array.isArray(body.search) ? body.search : [];
  }

  return async function lookup(title: string, artists: string[]): Promise<GetSongBpmResult | null> {
    const clean = cleanTitle(title);
    // Artista com nome diferente na base ("RÜFÜS" x "RÜFÜS DU SOL") zera a busca "both":
    // cai para busca só pelo título e deixa o pickMatch conferir o artista.
    const song =
      pickMatch(await search("both", `song:${clean} artist:${artists[0] ?? ""}`), title, artists) ??
      pickMatch(await search("song", clean), title, artists);
    if (!song) return null;
    return {
      bpm: toNumber(song.tempo),
      key: song.key_of?.trim() || null,
      danceability: toNumber(song.danceability),
    };
  };
}
