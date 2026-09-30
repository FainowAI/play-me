import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getContext } from "../services/context.js";
import { fail, render } from "../services/format.js";
import { createGetSongBpm } from "../services/metadata/getsongbpm.js";
import { MetadataCache, lookupTracks, type LookupRow } from "../services/metadata/lookup.js";
import { coverageBucket, type CoverageBucket } from "../services/metadata/merge.js";
import { createReccoBeats } from "../services/metadata/reccobeats.js";
import { formatError, parseSpotifyId } from "../services/spotify-client.js";
import { ResponseFormat, type SpotifyTrackSummary } from "../types.js";

const PLAYLIST_MAX = 1_000;

const responseFormat = z
  .nativeEnum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe("'markdown' para leitura humana ou 'json' para processamento");

// Estado do processo: o intervalo de 1,5 s do GetSongBPM vale entre chamadas de ferramenta.
let gsb: ReturnType<typeof createGetSongBpm> | null = null;
let cache: MetadataCache | null = null;

function deps() {
  const { config, store } = getContext();
  cache ??= new MetadataCache(config.dataDir);
  const key = (process.env.GETSONGBPM_API_KEY ?? "").trim();
  if (key && !gsb) gsb = createGetSongBpm(key);
  return { store, cache, getsongbpm: key ? gsb : null, reccobeats: createReccoBeats() };
}

async function readTracks(playlist: string | undefined, trackIds: string[] | undefined, limit: number): Promise<SpotifyTrackSummary[]> {
  const { client } = getContext();
  if (trackIds?.length) {
    const out: SpotifyTrackSummary[] = [];
    for (const value of trackIds.slice(0, limit)) out.push(await client.getTrack(parseSpotifyId(value, "track")));
    return out;
  }
  if (!playlist) throw new Error("Informe `playlist` ou `track_ids`.");
  const all = await client.getAllPlaylistItems(parseSpotifyId(playlist, "playlist"), limit);
  return all.items.filter((track) => track.id && !track.is_local);
}

const fmtBpm = (bpm: number | null | undefined): string => (bpm == null ? "—" : String(bpm));

function rowLine(row: LookupRow, dryRun: boolean): string {
  const r = row.reccobeats ? `ReccoBeats ${fmtBpm(row.reccobeats.bpm)} BPM, ${row.reccobeats.camelot ?? "sem tom"}` : "ReccoBeats: não achou";
  const g = row.getsongbpm ? ` · GetSongBPM ${fmtBpm(row.getsongbpm.bpm)} BPM, ${row.getsongbpm.key ?? "sem tom"}` : "";
  const e = row.existing ? ` · salvo: ${row.existing.bpm} BPM ${row.existing.camelot} (${row.existing.source ?? "usuário"})` : "";
  const o = row.outcome;
  const result =
    o.action === "save"
      ? `→ ${dryRun ? "salvaria" : "salvou"} ${o.entry.bpm} BPM ${o.entry.camelot}${o.entry.notes ? ` (${o.entry.notes})` : ""}`
      : o.action === "keep"
        ? `→ mantém (${o.reason})`
        : `→ pendente (${o.reason})`;
  return `- ${row.label}: ${r}${g}${e} ${result}`;
}

export function registerMetadataTools(server: McpServer): void {
  server.registerTool(
    "metadata_lookup",
    {
      title: "Buscar BPM e tom na web (ReccoBeats + GetSongBPM)",
      description: `Busca BPM e tom de faixas na ReccoBeats (pelo ID do Spotify, em lote) e, só para as que ela não cobre, no GetSongBPM (título + artista). Mostra, por faixa, o que cada fonte trouxe e o que seria salvo.

Regras: entrada do Mixar/manual nunca é sobrescrita; BPM da ReccoBeats é salvo como conferido; BPM só do GetSongBPM ou divergente vira "[A VALIDAR]"; tom da web é sempre "[A VALIDAR]" (confira no Mixar); sem BPM ou sem tom a faixa fica pendente (nada é inventado). Nenhum áudio é baixado.

Args:
  - playlist: ID/link da playlist, ou track_ids: lista de IDs/links
  - limit: máximo de faixas (padrão 50). A ReccoBeats responde em lotes de 40; cada faixa que ela não cobre custa até 2 buscas no GetSongBPM (1 a cada 1,5 s)
  - dry_run: padrão true (só mostra). Só grava no armazenamento com dry_run=false.`,
      inputSchema: z
        .object({
          playlist: z.string().min(1).optional(),
          track_ids: z.array(z.string().min(1)).min(1).max(200).optional(),
          limit: z.number().int().min(1).max(PLAYLIST_MAX).default(50),
          dry_run: z.boolean().default(true),
          response_format: responseFormat,
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ playlist, track_ids, limit, dry_run, response_format }) => {
      try {
        const d = deps();
        const tracks = await readTracks(playlist, track_ids, limit);
        const report = await lookupTracks(tracks, dry_run, d);
        const count = (action: string) => report.rows.filter((row) => row.outcome.action === action).length;
        return render(
          response_format,
          () =>
            [
              `${dry_run ? "Simulação (dry run): nada foi gravado." : `${report.saved} faixa(s) gravada(s).`} ${report.rows.length} faixa(s) consultada(s): ${count("save")} com dado novo, ${count("keep")} mantida(s), ${count("pending")} pendente(s).`,
              ...(d.getsongbpm ? [] : ["Aviso: GETSONGBPM_API_KEY não definida; faixas fora da ReccoBeats ficam pendentes."]),
              ...(report.stopped ? [`Interrompido: ${report.stopped}`] : []),
              "",
              ...report.rows.map((row) => rowLine(row, dry_run)),
            ].join("\n"),
          { ...report },
        );
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );

  server.registerTool(
    "metadata_coverage",
    {
      title: "Cobertura de BPM e tom de uma playlist",
      description: `Conta, para uma playlist, de onde vêm BPM e tom salvos: mixar (Mixar ou outra fonte do usuário), web (BPM conferido pela ReccoBeats; tom da web sempre a validar), [A VALIDAR] (BPM divergente ou só do GetSongBPM) e pendente (sem dado). Lista as pendências. Só leitura.

Args:
  - playlist: ID ou link da playlist`,
      inputSchema: z.object({ playlist: z.string().min(1), response_format: responseFormat }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ playlist, response_format }) => {
      try {
        const { store } = getContext();
        const tracks = await readTracks(playlist, undefined, PLAYLIST_MAX);
        const saved = store.getMany(tracks.map((track) => track.id!));
        const counts: Record<CoverageBucket, number> = { mixar: 0, web: 0, a_validar: 0, pendente: 0 };
        const pending: { track_id: string; label: string }[] = [];
        for (const track of tracks) {
          const bucket = coverageBucket(saved.get(track.id!));
          counts[bucket] += 1;
          if (bucket === "pendente") pending.push({ track_id: track.id!, label: `${track.name} — ${track.artists.join(", ")}` });
        }
        return render(
          response_format,
          () =>
            [
              `${tracks.length} faixa(s): mixar ${counts.mixar} · web ${counts.web} · [A VALIDAR] ${counts.a_validar} · pendente ${counts.pendente}`,
              ...(pending.length ? ["", "## Pendências", ...pending.map((p) => `- ${p.label} · id: ${p.track_id}`)] : []),
            ].join("\n"),
          { total: tracks.length, counts, pending },
        );
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );
}
