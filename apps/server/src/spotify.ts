/**
 * Spotify para o painel: estado da conexão e playlists do usuário, com os tokens e a config do MCP
 * (só leitura). Nenhum token sai daqui: o servidor só diz se existem.
 */
import { AuthRequiredError, readTokens } from "spotify-dj-mcp-server/dist/services/auth.js";
import { getConfig } from "spotify-dj-mcp-server/dist/services/config.js";
import { SpotifyClient } from "spotify-dj-mcp-server/dist/services/spotify-client.js";
import type { Playlist } from "./types.js";

const PAGE = 50; // máximo da API por página
const MAX = 200;
const TTL_MS = 5 * 60 * 1000;

export interface Spotify {
  connected(): boolean;
  /** Playlists do usuário (até 200), com cache de 5 min; AuthRequiredError quando não há conexão. */
  playlists(): Promise<Playlist[]>;
  /** Nome de uma playlist já carregada; undefined enquanto a lista não foi lida. */
  nameOf(id: string): string | undefined;
}

export function createSpotify(): Spotify {
  // ponytail: cache só em memória (some no restart); guarda a promessa para chamadas simultâneas dividirem a busca
  let cache: { at: number; items: Promise<Playlist[]> } | undefined;
  let names = new Map<string, string>();

  // getConfig lança sem SPOTIFY_CLIENT_ID (ou com redirect inválido): sem config não há conexão
  const connected = (): boolean => {
    try {
      return readTokens(getConfig()) !== null;
    } catch {
      return false;
    }
  };

  async function fetchAll(): Promise<Playlist[]> {
    if (!connected()) throw new AuthRequiredError("Spotify não conectado.");
    const client = new SpotifyClient(getConfig());
    const items: Playlist[] = [];
    for (let offset = 0; offset < MAX; offset += PAGE) {
      const page = await client.listMyPlaylists(PAGE, offset);
      items.push(...page.items.map((p) => ({ id: p.id, name: p.name, total: p.total_items, url: p.url })));
      if (offset + PAGE >= page.total) break;
    }
    // ponytail: o Spotify pode devolver a mesma playlist duas vezes (seguida em dobro); uma só por id
    const unique = [...new Map(items.map((p) => [p.id, p])).values()];
    names = new Map(unique.map((p) => [p.id, p.name]));
    return unique;
  }

  return {
    connected,
    playlists() {
      if (!cache || Date.now() - cache.at > TTL_MS) {
        const items = fetchAll();
        cache = { at: Date.now(), items };
        // falha não fica em cache: a próxima chamada tenta de novo
        items.catch(() => {
          if (cache?.items === items) cache = undefined;
        });
      }
      return cache.items;
    },
    nameOf: (id) => names.get(id),
  };
}
