import {
  LIMITS,
  MAX_RETRIES_429,
  MAX_RETRY_AFTER_SECONDS,
  REQUEST_TIMEOUT_MS,
  SPOTIFY_API_BASE,
} from "../constants.js";
import type { PlaylistSummary, SpotifyTrackSummary } from "../types.js";
import { AuthRequiredError, getAccessToken } from "./auth.js";
import type { AppConfig } from "./config.js";

export class SpotifyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
  ) {
    super(message);
    this.name = "SpotifyApiError";
  }
}

type Query = Record<string, string | number | boolean | undefined>;

interface RequestOptions {
  query?: Query;
  body?: unknown;
}

interface SpotifyErrorBody {
  error?: { status?: number; message?: string; reason?: string } | string;
  error_description?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- IDs ----------

const BASE62_ID = /^[0-9A-Za-z]{22}$/;

/** Aceita ID puro, URI (spotify:playlist:ID) ou URL (open.spotify.com/playlist/ID?si=...). */
export function parseSpotifyId(input: string, kind: "playlist" | "track"): string {
  const value = input.trim();
  if (BASE62_ID.test(value)) return value;

  const uriMatch = value.match(new RegExp(`^spotify:${kind}:([0-9A-Za-z]{22})$`));
  if (uriMatch?.[1]) return uriMatch[1];

  try {
    const url = new URL(value);
    if (url.hostname.endsWith("spotify.com")) {
      const segments = url.pathname.split("/").filter(Boolean);
      const idx = segments.indexOf(kind);
      const candidate = idx >= 0 ? segments[idx + 1] : undefined;
      if (candidate && BASE62_ID.test(candidate)) return candidate;
    }
  } catch {
    // não é URL
  }
  throw new Error(
    `Identificador de ${kind} inválido: "${input}". Use o ID de 22 caracteres, a URI spotify:${kind}:ID ou o link do Spotify.`,
  );
}

export const trackUri = (id: string): string => `spotify:track:${id}`;

// ---------- Cliente ----------

export class SpotifyClient {
  constructor(private readonly config: AppConfig) {}

  async request<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, opts: RequestOptions = {}): Promise<T> {
    let authRetried = false;
    let attempt429 = 0;

    for (;;) {
      const token = await getAccessToken(this.config, authRetried);
      const url = new URL(`${SPOTIFY_API_BASE}${path}`);
      for (const [key, value] of Object.entries(opts.query ?? {})) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }

      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        const timedOut = error instanceof Error && error.name === "TimeoutError";
        throw new SpotifyApiError(
          timedOut ? "Tempo esgotado falando com o Spotify. Tente de novo." : "Falha de rede ao falar com o Spotify.",
          0,
        );
      }

      if (response.status === 401 && !authRetried) {
        authRetried = true; // força refresh do token e tenta uma vez
        continue;
      }

      if (response.status === 429) {
        const body = (await response.json().catch(() => ({}))) as SpotifyErrorBody;
        const reason = typeof body.error === "object" ? body.error?.reason : undefined;
        if (reason === "QUOTA_EXCEEDED") {
          throw new SpotifyApiError(
            "Cota do modo de desenvolvimento esgotada (QUOTA_EXCEEDED). Não adianta repetir agora: espere a cota renovar.",
            429,
            reason,
          );
        }
        if (attempt429 >= MAX_RETRIES_429) {
          throw new SpotifyApiError("Limite de requisições do Spotify atingido. Aguarde alguns segundos e tente de novo.", 429);
        }
        const retryAfter = Number(response.headers.get("Retry-After") ?? "1");
        const waitSeconds = Math.min(
          MAX_RETRY_AFTER_SECONDS,
          Math.max(1, Number.isFinite(retryAfter) ? retryAfter : 1) * 2 ** attempt429,
        );
        attempt429 += 1;
        await sleep(waitSeconds * 1000);
        continue;
      }

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as SpotifyErrorBody;
        const apiMessage =
          typeof body.error === "object" ? body.error?.message : (body.error_description ?? body.error);
        throw new SpotifyApiError(describeStatus(response.status, apiMessage), response.status);
      }

      if (response.status === 204) return undefined as T;
      const text = await response.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
  }

  // ----- Endpoints usados pelo servidor -----

  async getCurrentUser(): Promise<{ id: string; display_name: string | null }> {
    const me = await this.request<{ id: string; display_name?: string | null }>("GET", "/me");
    return { id: me.id, display_name: me.display_name ?? null };
  }

  async listMyPlaylists(limit: number, offset: number): Promise<{ total: number; items: PlaylistSummary[] }> {
    const page = await this.request<RawPaging<RawSimplifiedPlaylist>>("GET", "/me/playlists", {
      query: { limit: Math.min(limit, LIMITS.pageMax), offset },
    });
    return { total: page.total, items: page.items.filter(Boolean).map(toPlaylistSummary) };
  }

  async getPlaylistMeta(playlistId: string): Promise<PlaylistSummary> {
    // Sem filtro `fields`: os nomes mudaram em fev/2026 (tracks -> items) e o parser aceita os dois formatos.
    const raw = await this.request<RawSimplifiedPlaylist>("GET", `/playlists/${playlistId}`);
    return toPlaylistSummary(raw);
  }

  async getPlaylistItemsPage(
    playlistId: string,
    limit: number,
    offset: number,
  ): Promise<{ total: number; items: SpotifyTrackSummary[] }> {
    const page = await this.request<RawPaging<RawPlaylistItem>>("GET", `/playlists/${playlistId}/items`, {
      query: { limit: Math.min(limit, LIMITS.pageMax), offset, additional_types: "track" },
    });
    return {
      total: page.total,
      items: page.items.map((entry, index) => toTrackSummary(entry, offset + index)),
    };
  }

  /** Lê a playlist inteira paginando de 50 em 50, até `max` itens. */
  async getAllPlaylistItems(playlistId: string, max: number): Promise<{ total: number; items: SpotifyTrackSummary[] }> {
    const items: SpotifyTrackSummary[] = [];
    let offset = 0;
    let total = 0;
    do {
      const page = await this.getPlaylistItemsPage(playlistId, LIMITS.pageMax, offset);
      total = page.total;
      items.push(...page.items);
      offset += page.items.length;
      if (page.items.length === 0) break;
    } while (offset < total && items.length < max);
    return { total, items: items.slice(0, max) };
  }

  async createPlaylist(name: string, description: string): Promise<{ id: string; url: string | null }> {
    const created = await this.request<{ id: string; external_urls?: { spotify?: string } }>("POST", "/me/playlists", {
      body: { name, description, public: false },
    });
    return { id: created.id, url: created.external_urls?.spotify ?? null };
  }

  async addItems(playlistId: string, uris: string[]): Promise<void> {
    for (let i = 0; i < uris.length; i += LIMITS.itemsPerWrite) {
      await this.request("POST", `/playlists/${playlistId}/items`, {
        body: { uris: uris.slice(i, i + LIMITS.itemsPerWrite) },
      });
    }
  }

  async getTrack(trackId: string): Promise<SpotifyTrackSummary> {
    return trackToSummary(await this.request<RawTrack>("GET", `/tracks/${trackId}`), 0, false);
  }

  async searchTracks(query: string, limit: number): Promise<SpotifyTrackSummary[]> {
    const result = await this.request<{ tracks?: RawPaging<RawTrack> }>("GET", "/search", {
      query: { q: query, type: "track", limit: Math.min(limit, LIMITS.searchMax) },
    });
    return (result.tracks?.items ?? []).filter(Boolean).map((track, index) => trackToSummary(track, index, false));
  }
}

// ---------- Playlist pelo nome (P14) ----------

const PLAYLIST_NAME_SCAN = 200; // playlists lidas para achar uma pelo nome: o mesmo teto do servidor do painel

/** Sem acento, sem caixa e sem espaços nas pontas: " Eletrônica" = "eletronica". */
const plain = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** As playlists com este nome (igualdade, não trecho: "Eletro" não casa "[DJ MIX] Eletro"), uma por id (o Spotify pode repetir). */
export function playlistsNamed(name: string, playlists: PlaylistSummary[]): PlaylistSummary[] {
  const wanted = plain(name);
  return [...new Map(playlists.filter((p) => plain(p.name) === wanted).map((p) => [p.id, p])).values()];
}

/**
 * ID a partir de ID, URI, link ou NOME de uma playlist do usuário (as primeiras 200, como o servidor do painel).
 * Sem achar, ou com duas de mesmo nome, o erro diz o que fazer. Toda ferramenta que lê uma playlist passa por aqui.
 * ponytail: nome de exatamente 22 letras/dígitos vale como ID; sem cache, são de 1 a 4 chamadas por pedido.
 */
export async function resolvePlaylistId(client: Pick<SpotifyClient, "listMyPlaylists">, input: string): Promise<string> {
  try {
    return parseSpotifyId(input, "playlist");
  } catch (error) {
    if (/^(https?:|spotify:)/i.test(input.trim())) throw error; // link ou URI quebrado: a mensagem do parse já diz o que fazer
  }
  const mine: PlaylistSummary[] = [];
  for (let offset = 0; offset < PLAYLIST_NAME_SCAN; offset += LIMITS.pageMax) {
    const page = await client.listMyPlaylists(LIMITS.pageMax, offset);
    mine.push(...page.items);
    if (offset + LIMITS.pageMax >= page.total) break;
  }
  const found = playlistsNamed(input, mine);
  if (found.length === 1) return (found[0] as PlaylistSummary).id;
  if (found.length === 0) {
    throw new Error(
      `Playlist "${input}" não encontrada entre as suas (li até ${PLAYLIST_NAME_SCAN}). Confira o nome com spotify_list_my_playlists ou passe o ID, a URI ou o link.`,
    );
  }
  throw new Error(
    `Mais de uma playlist se chama "${input}". Pergunte ao usuário qual ou passe o ID:\n${found
      .map((p) => `- ${p.name} · ${p.total_items ?? "?"} itens · id: ${p.id}`)
      .join("\n")}`,
  );
}

// ---------- Tipos crus da API e conversores ----------

interface RawPaging<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  next: string | null;
}

interface RawSimplifiedPlaylist {
  id: string;
  name: string;
  owner?: { id?: string; display_name?: string | null };
  public?: boolean | null;
  collaborative?: boolean;
  external_urls?: { spotify?: string };
  items?: { total?: number };
  tracks?: { total?: number }; // campo depreciado, ainda enviado na janela de transição
}

interface RawTrack {
  id?: string | null;
  uri?: string | null;
  name?: string;
  type?: string;
  duration_ms?: number;
  artists?: { name?: string }[];
  external_ids?: { isrc?: string };
}

interface RawPlaylistItem {
  is_local?: boolean;
  item?: RawTrack | null; // formato novo (fev/2026)
  track?: RawTrack | null; // formato depreciado
}

function toPlaylistSummary(raw: RawSimplifiedPlaylist): PlaylistSummary {
  return {
    id: raw.id,
    name: raw.name,
    owner: raw.owner?.display_name ?? raw.owner?.id ?? "desconhecido",
    owner_id: raw.owner?.id ?? "",
    total_items: raw.items?.total ?? raw.tracks?.total ?? null,
    public: raw.public ?? null,
    collaborative: Boolean(raw.collaborative),
    url: raw.external_urls?.spotify ?? null,
  };
}

function trackToSummary(track: RawTrack, position: number, isLocal: boolean): SpotifyTrackSummary {
  return {
    position,
    id: track.id ?? null,
    uri: track.uri ?? null,
    name: track.name ?? "(sem nome)",
    artists: (track.artists ?? []).map((artist) => artist.name ?? "").filter(Boolean),
    duration_ms: track.duration_ms ?? null,
    isrc: track.external_ids?.isrc ?? null,
    is_local: isLocal,
    type: track.type ?? "track",
  };
}

function toTrackSummary(entry: RawPlaylistItem, position: number): SpotifyTrackSummary {
  const track = entry.item ?? entry.track;
  if (!track) {
    return {
      position,
      id: null,
      uri: null,
      name: "(item indisponível)",
      artists: [],
      duration_ms: null,
      isrc: null,
      is_local: Boolean(entry.is_local),
      type: "unknown",
    };
  }
  return trackToSummary(track, position, Boolean(entry.is_local));
}

function describeStatus(status: number, apiMessage?: string): string {
  const detail = apiMessage ? ` Detalhe do Spotify: ${apiMessage}.` : "";
  switch (status) {
    case 400:
      return `Requisição inválida para o Spotify.${detail}`;
    case 403:
      return (
        "Sem permissão (403). Causas comuns: a playlist não é sua nem colaborativa (a API só lê itens de playlists próprias), " +
        `a conta não está na lista de usuários do app em Development mode, ou o dono do app está sem Premium.${detail}`
      );
    case 404:
      return `Recurso não encontrado (404). Confira o ID ou o link.${detail}`;
    case 500:
    case 502:
    case 503:
      return `O Spotify está instável (HTTP ${status}). Tente de novo em instantes.${detail}`;
    default:
      return `O Spotify respondeu HTTP ${status}.${detail}`;
  }
}

/** Converte qualquer erro em mensagem acionável para o agente. */
export function formatError(error: unknown): string {
  if (error instanceof AuthRequiredError) return `Erro de autorização: ${error.message}`;
  if (error instanceof SpotifyApiError) return `Erro: ${error.message}`;
  if (error instanceof Error) return `Erro: ${error.message}`;
  return `Erro inesperado: ${String(error)}`;
}
