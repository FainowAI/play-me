import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LIMITS, SPOTIFY_SCOPES } from "../constants.js";
import { readTokens } from "../services/auth.js";
import { getContext } from "../services/context.js";
import { fail, formatDuration, render, trackLine } from "../services/format.js";
import { formatError, parseSpotifyId, trackUri } from "../services/spotify-client.js";
import { ResponseFormat } from "../types.js";

const responseFormat = z
  .nativeEnum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe("'markdown' para leitura humana ou 'json' para processamento");

export function registerSpotifyTools(server: McpServer): void {
  // ---------------------------------------------------------------- auth status
  server.registerTool(
    "spotify_auth_status",
    {
      title: "Status da autorização no Spotify",
      description: `Verifica se o servidor está autorizado no Spotify e qual conta está conectada.

Use antes de qualquer outra ferramenta quando houver erro de autorização. Não altera nada.

Retorna: conta conectada (id e nome), escopos concedidos e validade do token.
Se não houver autorização, orienta rodar \`npm run auth\` na pasta do servidor.`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const { config, client } = getContext();
        const tokens = readTokens(config);
        if (!tokens) {
          return fail("Não autorizado. Rode `npm run auth` na pasta do servidor, conclua o login no navegador e reinicie o cliente MCP.");
        }
        const me = await client.getCurrentUser();
        const granted = tokens.scope.split(" ").filter(Boolean);
        const missing = SPOTIFY_SCOPES.filter((scope) => !granted.includes(scope));
        const data = {
          authorized: true,
          user_id: me.id,
          display_name: me.display_name,
          scopes: granted,
          missing_scopes: missing,
          token_expires_at: new Date(tokens.expires_at).toISOString(),
        };
        const text = [
          `Conectado como ${me.display_name ?? me.id} (${me.id}).`,
          `Escopos: ${granted.join(", ") || "nenhum informado"}.`,
          missing.length ? `Faltando: ${missing.join(", ")}. Rode \`npm run auth\` de novo.` : "Escopos completos.",
        ].join("\n");
        return render(ResponseFormat.MARKDOWN, () => text, data);
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );

  // ---------------------------------------------------------------- list playlists
  server.registerTool(
    "spotify_list_my_playlists",
    {
      title: "Listar minhas playlists",
      description: `Lista playlists da conta conectada (próprias e seguidas), com paginação.

Args:
  - limit (1-50, padrão 20), offset (padrão 0)
  - response_format: 'markdown' | 'json'

Retorna: id, nome, dono, total de itens, pública/privada, link.
Observação: a API só entrega os itens de playlists próprias ou colaborativas. Playlists de terceiros aparecem aqui, mas spotify_get_playlist_tracks devolve 403 para elas.`,
      inputSchema: z
        .object({
          limit: z.number().int().min(1).max(LIMITS.pageMax).default(20).describe("Máximo de playlists por página"),
          offset: z.number().int().min(0).default(0).describe("Quantas pular (paginação)"),
          response_format: responseFormat,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ limit, offset, response_format }) => {
      try {
        const { client } = getContext();
        const [me, page] = await Promise.all([client.getCurrentUser(), client.listMyPlaylists(limit, offset)]);
        const hasMore = page.total > offset + page.items.length;
        const data = {
          total: page.total,
          count: page.items.length,
          offset,
          has_more: hasMore,
          ...(hasMore ? { next_offset: offset + page.items.length } : {}),
          playlists: page.items.map((playlist) => ({ ...playlist, owned_by_me: playlist.owner_id === me.id })),
        };
        return render(
          response_format,
          () =>
            [
              `# Playlists (${page.items.length} de ${page.total})`,
              ...data.playlists.map(
                (p) =>
                  `- ${p.name} · ${p.total_items ?? "?"} itens · ${p.owned_by_me ? "sua" : `de ${p.owner}`}${p.collaborative ? " · colaborativa" : ""} · id: ${p.id}`,
              ),
              hasMore ? `\nMais resultados: use offset=${offset + page.items.length}.` : "",
            ].join("\n"),
          data,
        );
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );

  // ---------------------------------------------------------------- playlist tracks
  server.registerTool(
    "spotify_get_playlist_tracks",
    {
      title: "Ler faixas de uma playlist",
      description: `Lê as faixas de uma playlist própria ou colaborativa, na ordem atual, e cruza com as análises salvas (BPM, Camelot, energia).

Args:
  - playlist (string): ID, URI (spotify:playlist:ID) ou link do Spotify
  - limit (1-50, padrão 50), offset (padrão 0)
  - response_format: 'markdown' | 'json'

Retorna por faixa: posição, id, uri, nome, artistas, duração e a análise salva (ou "sem análise").
Também lista quais faixas ainda não têm análise, para completar com dj_set_track_analysis.

Observações:
  - A Web API não fornece BPM, tom nem energia para apps novos. Esses dados vêm do usuário.
  - Arquivos locais não têm ID e não entram no set.
  - 403 indica playlist de terceiros, conta fora da allowlist do app ou dono sem Premium.`,
      inputSchema: z
        .object({
          playlist: z.string().min(1).describe("ID, URI ou link da playlist"),
          limit: z.number().int().min(1).max(LIMITS.pageMax).default(50),
          offset: z.number().int().min(0).default(0),
          response_format: responseFormat,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ playlist, limit, offset, response_format }) => {
      try {
        const { client, store } = getContext();
        const playlistId = parseSpotifyId(playlist, "playlist");
        const [meta, page] = await Promise.all([
          client.getPlaylistMeta(playlistId),
          client.getPlaylistItemsPage(playlistId, limit, offset),
        ]);
        const analyses = store.getMany(page.items.map((track) => track.id).filter((id): id is string => Boolean(id)));
        const tracks = page.items.map((track) => ({
          ...track,
          analysis: track.id ? (analyses.get(track.id) ?? null) : null,
        }));
        const missing = tracks.filter((track) => track.id && !track.analysis).map((track) => ({ id: track.id, name: track.name }));
        const hasMore = page.total > offset + page.items.length;
        const totalMs = page.items.reduce((acc, track) => acc + (track.duration_ms ?? 0), 0);
        const data = {
          playlist: meta,
          total: page.total,
          count: page.items.length,
          offset,
          has_more: hasMore,
          ...(hasMore ? { next_offset: offset + page.items.length } : {}),
          page_duration: formatDuration(totalMs),
          tracks,
          missing_analysis: missing,
        };
        return render(
          response_format,
          () =>
            [
              `# ${meta.name} · ${page.total} faixas${hasMore ? ` (mostrando ${offset + 1}–${offset + page.items.length})` : ""}`,
              `Duração desta página: ${formatDuration(totalMs)}`,
              "",
              ...page.items.map((track) => trackLine(track, track.id ? analyses.get(track.id) : undefined)),
              "",
              missing.length ? `Sem análise: ${missing.length} faixa(s). Complete com dj_set_track_analysis.` : "Todas as faixas desta página têm análise.",
              hasMore ? `Próxima página: offset=${offset + page.items.length}.` : "",
            ].join("\n"),
          data,
        );
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );

  // ---------------------------------------------------------------- search
  server.registerTool(
    "spotify_search_tracks",
    {
      title: "Buscar faixas no Spotify",
      description: `Busca faixas no catálogo do Spotify por texto (nome, artista, remix). Máximo de 10 resultados por chamada, limite da API desde fev/2026.

Use para: achar o ID de uma faixa citada pelo usuário, ou candidatas para preencher uma lacuna do set.
Não use para: descobrir BPM ou tom (a API não fornece); confirme no Mixar, Rekordbox ou equivalente.

Args:
  - query (string): texto de busca, aceita filtros da API como artist:"Chris Lake"
  - limit (1-10, padrão 5)`,
      inputSchema: z
        .object({
          query: z.string().min(2).max(200).describe("Texto de busca"),
          limit: z.number().int().min(1).max(LIMITS.searchMax).default(5),
          response_format: responseFormat,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ query, limit, response_format }) => {
      try {
        const { client, store } = getContext();
        const results = await client.searchTracks(query, limit);
        if (!results.length) return render(response_format, () => `Nenhuma faixa encontrada para "${query}".`, { query, results: [] });
        const analyses = store.getMany(results.map((track) => track.id).filter((id): id is string => Boolean(id)));
        const data = { query, results: results.map((track) => ({ ...track, analysis: track.id ? (analyses.get(track.id) ?? null) : null })) };
        return render(
          response_format,
          () => [`# Busca: ${query}`, ...results.map((track) => trackLine(track, track.id ? analyses.get(track.id) : undefined))].join("\n"),
          data,
        );
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );

  // ---------------------------------------------------------------- create playlist
  server.registerTool(
    "spotify_create_playlist_from_order",
    {
      title: "Criar playlist nova na ordem do set",
      description: `Cria uma playlist NOVA e privada na conta conectada e adiciona as faixas exatamente na ordem informada.

Nunca altera, reordena ou apaga playlists existentes: a original fica intacta.
Só execute depois que o usuário aprovar a ordem proposta.

Args:
  - track_ids (string[]): IDs, URIs ou links das faixas, na ordem final (1 a 500)
  - name (string, opcional): nome da nova playlist. Padrão: "[DJ MIX] <nome da playlist de origem>"
  - source_playlist (string, opcional): playlist de origem, usada para o nome padrão
  - description (string, opcional)

Retorna: id e link da playlist criada e quantas faixas foram adicionadas.`,
      inputSchema: z
        .object({
          track_ids: z.array(z.string().min(1)).min(1).max(500).describe("Faixas na ordem final"),
          name: z.string().min(1).max(100).optional(),
          source_playlist: z.string().optional(),
          description: z.string().max(300).optional(),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ track_ids, name, source_playlist, description }) => {
      try {
        const { client } = getContext();
        const ids = track_ids.map((value) => parseSpotifyId(value, "track"));
        let finalName = name;
        if (!finalName) {
          if (!source_playlist) return fail("Informe `name` ou `source_playlist` para nomear a playlist nova.");
          const meta = await client.getPlaylistMeta(parseSpotifyId(source_playlist, "playlist"));
          finalName = `[DJ MIX] ${meta.name}`;
        }
        const created = await client.createPlaylist(
          finalName,
          description ?? "Ordem de set montada por BPM, Camelot e curva de energia. A playlist original não foi alterada.",
        );
        await client.addItems(created.id, ids.map(trackUri));
        const data = { playlist_id: created.id, url: created.url, name: finalName, tracks_added: ids.length, public: false };
        return render(
          ResponseFormat.MARKDOWN,
          () => `Playlist "${finalName}" criada com ${ids.length} faixas, privada.\n${created.url ?? `id: ${created.id}`}`,
          data,
        );
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );
}
