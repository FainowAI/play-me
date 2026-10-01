import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JEV_COMPARE_PAIRS, LIMITS } from "../constants.js";
import { formatCamelot, musicalName, parseKey } from "../services/camelot.js";
import { getContext } from "../services/context.js";
import { avoidRecent, buildReport, buildSet, normalizeWeights, scoreTransition } from "../services/dj-engine.js";
import { fail, render, setToMarkdown } from "../services/format.js";
import { compareTransitions, decideWithJev, jevFromEnv, type Comparison } from "../services/jev.js";
import { mixGuideStep, planTransition } from "../services/planner.js";
import { formatError, parseSpotifyId, resolvePlaylistId } from "../services/spotify-client.js";
import { type MixGuideStep, ResponseFormat, type SetResult, type TrackAnalysis } from "../types.js";

const responseFormat = z
  .nativeEnum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe("'markdown' para leitura humana ou 'json' para processamento");

const curveSchema = z
  .enum(["classic", "peak_time", "warm_up", "sunrise"])
  .default("classic")
  .describe(
    "Curva de energia: classic (warm up → construção → pico → clímax → encerramento), peak_time (começa quente e segura), warm_up (sobe devagar, sem pico), sunrise (sobe até o meio e desce longo)",
  );

const playlistArg = z.string().optional().describe("ID, link ou nome de uma playlist sua");

const weightsSchema = z
  .object({
    camelot: z.number().min(0).max(1).optional(),
    bpm: z.number().min(0).max(1).optional(),
    energy: z.number().min(0).max(1).optional(),
    style: z.number().min(0).max(1).optional(),
    progression: z.number().min(0).max(1).optional(),
  })
  .strict()
  .optional()
  .describe("Pesos da nota de transição. Padrão: camelot 0.35, bpm 0.25, energy 0.25, style 0.10, progression 0.05 (normalizados)");

const analysisEntry = z
  .object({
    track: z.string().min(1).describe("ID, URI ou link da faixa"),
    bpm: z.number().min(40).max(220).describe("BPM, ex.: 124"),
    key: z.string().min(1).describe("Tom em Camelot (8A) ou notação musical (Am, F#m, C)"),
    energy: z.number().int().min(1).max(10).optional().describe("Energia percebida de 1 a 10"),
    style: z.string().max(60).optional().describe("Estilo, ex.: 'melodic house', 'tech house', 'techno'"),
    vocal: z.boolean().optional(),
    label: z.string().max(120).optional().describe("Rótulo livre para leitura, ex.: 'Adored – J. Worra'"),
    notes: z.string().max(300).optional(),
    source: z.string().max(40).optional().describe("Origem do dado, ex.: 'spotify-mixar', 'rekordbox', 'ouvido'"),
  })
  .strict();

function loadAnalyses(trackIds: string[]): { found: TrackAnalysis[]; missing: string[] } {
  const { store } = getContext();
  const map = store.getMany(trackIds);
  const found: TrackAnalysis[] = [];
  const missing: string[] = [];
  for (const id of trackIds) {
    const entry = map.get(id);
    if (entry) found.push(entry);
    else missing.push(id);
  }
  return { found, missing };
}

/** `max`: itens lidos da playlist (150; a playlist inteira quando o set é selecionado por tamanho, P10). `durations`: duration_ms do Spotify. */
async function resolveTrackIds(
  playlist?: string,
  trackIds?: string[],
  max: number = LIMITS.maxTracksPerSet,
): Promise<{ ids: string[]; names: Map<string, string>; durations: Map<string, number | null> }> {
  const names = new Map<string, string>();
  const durations = new Map<string, number | null>();
  if (trackIds?.length) return { ids: trackIds.map((value) => parseSpotifyId(value, "track")), names, durations };
  if (!playlist) throw new Error("Informe `playlist` ou `track_ids`.");
  const { client } = getContext();
  const all = await client.getAllPlaylistItems(await resolvePlaylistId(client, playlist), max);
  const ids: string[] = [];
  for (const track of all.items) {
    if (!track.id || track.is_local) continue;
    ids.push(track.id);
    names.set(track.id, `${track.name} — ${track.artists.join(", ")}`);
    durations.set(track.id, track.duration_ms);
  }
  return { ids, names, durations };
}

/** Rótulo vindo da API quando o usuário não definiu um. */
const withLabels = (found: TrackAnalysis[], names: Map<string, string>): TrackAnalysis[] =>
  found.map((entry) => (entry.label ? entry : { ...entry, label: names.get(entry.track_id) ?? entry.track_id }));

/** Nomes pelo id; `cap` evita despejar ~120 nomes no resultado quando a playlist inteira é lida (P10, P11). */
const listNames = (ids: string[], names: Map<string, string>, cap = Infinity): string =>
  ids.slice(0, cap).map((id) => names.get(id) ?? id).join("; ") + (ids.length > cap ? ` e mais ${ids.length - cap}` : "");

/** Preenche result.plans (um por passagem); se o planejador falhar, avisa e segue sem planos. */
function attachPlans(result: SetResult, tracks: TrackAnalysis[]): void {
  const byId = new Map(tracks.map((track) => [track.track_id, track]));
  try {
    result.plans = result.transitions.map((t) =>
      planTransition(byId.get(t.from_id) as TrackAnalysis, byId.get(t.to_id) as TrackAnalysis),
    );
  } catch (error) {
    result.warnings.push(`Plano das passagens indisponível: ${formatError(error)}`);
  }
}

function compareToMarkdown(comparison: Comparison, minConfidence: number): string {
  const { agreement: a } = comparison;
  const pct = (value: number | null): string => (value === null ? "n/d" : `${value}%`);
  return [
    `# Jev × regras · ${comparison.pairs.length} par(es) respondido(s) em ${comparison.calls} chamada(s) · modelo ${comparison.model}`,
    `Mesmo tipo: ${pct(a.type_pct)} de ${a.answered} · só com confiança ≥ ${minConfidence}: ${pct(a.confident_pct)} de ${a.confident} · correlação das notas: ${a.score_correlation ?? "n/d"}`,
    "",
    ...comparison.pairs.map(
      (pair, index) =>
        `${index + 1}. ${pair.from_label} → ${pair.to_label}: regras ${pair.rules_type} · Jev ${pair.jev_type} (${pair.jev_type_confidence}) · nota das regras ${pair.rules_score} · nota do Jev ${pair.jev_score}/5 (${pair.jev_score_confidence}) · ${pair.agree ? "concorda" : "discorda"}`,
    ),
    ...(comparison.errors.length ? ["", "## Erros", ...comparison.errors.map((error) => `- ${error}`)] : []),
  ].join("\n");
}

export function registerDjTools(server: McpServer): void {
  // ---------------------------------------------------------------- set analysis
  server.registerTool(
    "dj_set_track_analysis",
    {
      title: "Salvar BPM, tom e energia de faixas",
      description: `Salva ou atualiza a análise de uma ou mais faixas no armazenamento local do servidor.

Necessário porque a Web API do Spotify não fornece BPM, tom nem energia para apps novos. Os dados vêm do usuário: modo Mixar do app do Spotify, Rekordbox, Serato, Traktor ou ouvido.

Args:
  - tracks: lista (1 a 200) com track, bpm, key (Camelot "8A" ou musical "Am"), e opcionalmente energy (1-10), style, vocal, label, notes, source

Campos omitidos preservam o valor salvo antes. Não invente valores: se o usuário não informou a energia, deixe em branco.
Retorna as análises salvas, com o tom normalizado para Camelot.`,
      inputSchema: z.object({ tracks: z.array(analysisEntry).min(1).max(LIMITS.maxAnalysisBatch) }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ tracks }) => {
      try {
        const { store } = getContext();
        const saved = store.upsert(
          tracks.map((entry) => ({
            track_id: parseSpotifyId(entry.track, "track"),
            bpm: entry.bpm,
            camelot: entry.key,
            energy: entry.energy,
            style: entry.style,
            vocal: entry.vocal,
            label: entry.label,
            notes: entry.notes,
            source: entry.source,
          })),
        );
        return render(
          ResponseFormat.MARKDOWN,
          () =>
            [
              `${saved.length} análise(s) salva(s). Total no armazenamento: ${store.count()}.`,
              ...saved.map(
                (entry) =>
                  `- ${entry.label ?? entry.track_id} · ${entry.bpm} BPM · ${entry.camelot}${entry.energy !== undefined ? ` · E${entry.energy}` : ""}${entry.style ? ` · ${entry.style}` : ""}`,
              ),
            ].join("\n"),
          { saved, total_stored: store.count() },
        );
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );

  // ---------------------------------------------------------------- remove analysis
  server.registerTool(
    "dj_delete_track_analysis",
    {
      title: "Apagar análises salvas",
      description: `Remove análises salvas localmente (não mexe em nada no Spotify).

Args:
  - tracks (string[]): IDs, URIs ou links das faixas`,
      inputSchema: z.object({ tracks: z.array(z.string().min(1)).min(1).max(LIMITS.maxAnalysisBatch) }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ tracks }) => {
      try {
        const { store } = getContext();
        const removed = store.remove(tracks.map((value) => parseSpotifyId(value, "track")));
        return render(ResponseFormat.MARKDOWN, () => `${removed} análise(s) removida(s).`, { removed });
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );

  // ---------------------------------------------------------------- score one transition
  server.registerTool(
    "dj_score_transition",
    {
      title: "Avaliar uma transição",
      description: `Avalia a passagem da faixa A para a faixa B com o sistema de notas do set.

Pesos padrão: 35% Camelot, 25% BPM, 25% energia, 10% estilo/groove, 5% progressão.
Classifica a transição harmônica em segura (mesmo tom, ±1, relativa), criativa (diagonal, +2, semitom) ou arriscada (choque).
Considera half/double time no BPM.

Args:
  - from_track, to_track: IDs das faixas (precisam ter análise salva)
  - position (0-1, padrão 0.5): em que ponto do set a passagem acontece, para a curva de energia
  - curve: curva de energia`,
      inputSchema: z
        .object({
          from_track: z.string().min(1),
          to_track: z.string().min(1),
          position: z.number().min(0).max(1).default(0.5),
          curve: curveSchema,
          weights: weightsSchema,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ from_track, to_track, position, curve, weights }) => {
      try {
        const ids = [parseSpotifyId(from_track, "track"), parseSpotifyId(to_track, "track")];
        const { found, missing } = loadAnalyses(ids);
        if (missing.length) return fail(`Sem análise salva para: ${missing.join(", ")}. Use dj_set_track_analysis antes.`);
        const report = scoreTransition(found[0] as TrackAnalysis, found[1] as TrackAnalysis, {
          curve,
          weights: normalizeWeights(weights),
          tFrom: Math.max(0, position - 0.03),
          tTo: position,
        });
        return render(
          ResponseFormat.MARKDOWN,
          () =>
            [
              `${report.from_label} → ${report.to_label}`,
              `BPM ${report.bpm_from} → ${report.bpm_to} · Camelot ${report.camelot_from} → ${report.camelot_to} · ${report.harmonic_relation} (${report.harmonic_type})`,
              `Energia ${report.energy_from ?? "?"} → ${report.energy_to ?? "?"}`,
              `Notas: camelot ${report.scores.camelot} · bpm ${report.scores.bpm} · energia ${report.scores.energy} · estilo ${report.scores.style} · progressão ${report.scores.progression} · total ${report.scores.total}`,
              `Motivo: ${report.reason}`,
            ].join("\n"),
          { transition: report },
        );
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );

  // ---------------------------------------------------------------- build set
  server.registerTool(
    "dj_build_set",
    {
      title: "Montar set com lógica de DJ",
      description: `Calcula a melhor ordem para um conjunto de faixas combinando harmonia (Camelot), BPM, curva de energia, estilo e progressão.

Usa busca em feixe (beam search): avalia várias sequências em paralelo e pensa faixas à frente, em vez de escolher só a melhor transição imediata. Penaliza três ou mais faixas seguidas com energia 9+ para criar tensão e alívio.

Args:
  - playlist (string, opcional): ID, URI, link ou nome de uma playlist sua. Sem duration_minutes/max_tracks lê até 150 faixas e ordena todas; com um deles lê a playlist inteira (até 600 itens) e seleciona as melhores para o tamanho pedido
  - track_ids (string[], opcional): alternativa a playlist
  - duration_minutes (10-600, opcional): tamanho do set em minutos (ex.: 90 para "1h30"). Seleciona, pela curva de energia, as faixas que mais se aproximam desse tempo, com a duração real do Spotify (por isso exige playlist). Se a soma passar do alvo + meia faixa, as últimas faixas saem e o aviso diz "Ajustado para X min (alvo Y)" (não corta com end_track). Exclusivo com max_tracks
  - max_tracks (2-150, opcional): quantidade de faixas. Seleciona as melhores para a curva. Exclusivo com duration_minutes
  - curve: classic | peak_time | warm_up | sunrise
  - start_track / end_track (opcional): fixa abertura e fechamento
  - exclude (string[], opcional): faixas a deixar fora
  - avoid (string[], opcional): faixas a evitar quando der, ex.: as dos últimos sets. Só com duration_minutes/max_tracks; saem do pool se sobrar pelo menos metade das faixas analisadas (mín. 10), senão ficam e o aviso diz
  - weights (opcional), beam_width (opcional, 4-96)
  - response_format

Retorna: ordem com seção (abertura, construção, crescimento, pico, clímax, encerramento), cada transição com relação harmônica, tipo (segura/criativa/arriscada), diferença de BPM, energia e motivo, pontos fracos, faixas que atrapalham, perfil de faixa-ponte para cada lacuna (Camelot, BPM e energia alvo) e avisos. Com duration_minutes ou max_tracks traz também pool_size (faixas analisadas consideradas), avoided (faixas de avoid deixadas fora) e duration_ms (duração somada do set; null se o Spotify não informou alguma). Energia marcada com * (energy_estimated) é estimativa da ReccoBeats, não dado do Mixar.

Faixas sem análise ficam de fora e são listadas no aviso. Não cria nem altera playlists: mostre a ordem ao usuário antes de usar spotify_create_playlist_from_order.`,
      inputSchema: z
        .object({
          playlist: playlistArg,
          track_ids: z.array(z.string().min(1)).max(LIMITS.maxTracksPerSet).optional(),
          curve: curveSchema,
          start_track: z.string().optional(),
          end_track: z.string().optional(),
          exclude: z.array(z.string().min(1)).max(LIMITS.maxTracksPerSet).optional(),
          avoid: z
            .array(z.string().min(1))
            .max(LIMITS.maxPlaylistRead)
            .optional()
            .describe("Faixas a evitar quando der (ex.: as dos últimos sets). Só com duration_minutes/max_tracks; saem do pool se sobrar pelo menos metade das analisadas (mín. 10)"),
          weights: weightsSchema,
          beam_width: z.number().int().min(4).max(96).optional(),
          duration_minutes: z
            .number()
            .int()
            .min(10)
            .max(600)
            .optional()
            .describe("Tamanho do set em minutos (ex.: 90 para '1h30'). Seleciona as melhores faixas para esse tempo. Exclusivo com max_tracks"),
          max_tracks: z
            .number()
            .int()
            .min(2)
            .max(LIMITS.maxTracksPerSet)
            .optional()
            .describe("Quantidade de faixas do set. Seleciona as melhores para a curva. Exclusivo com duration_minutes"),
          response_format: responseFormat,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ playlist, track_ids, curve, start_track, end_track, exclude, avoid, weights, beam_width, duration_minutes, max_tracks, response_format }) => {
      try {
        if (duration_minutes !== undefined && max_tracks !== undefined) return fail("Informe duration_minutes ou max_tracks, não os dois.");
        const selecting = duration_minutes !== undefined || max_tracks !== undefined;
        // Sem tamanho pedido: até 150 itens, ordena todos (como antes). Com ele: a playlist inteira, e o feixe escolhe (P10)
        const { ids, names, durations } = await resolveTrackIds(
          playlist,
          track_ids,
          selecting ? LIMITS.maxPlaylistRead : LIMITS.maxTracksPerSet,
        );
        const cap = selecting ? 10 : Infinity;
        const excluded = new Set((exclude ?? []).map((value) => parseSpotifyId(value, "track")));
        const pool = [...new Set(ids)].filter((id) => !excluded.has(id));
        const analyses = loadAnalyses(pool);
        // P17: faixas de sets recentes saem do pool só se sobrar metade dele (avoidRecent); sem tamanho pedido o set é a playlist inteira e nada sai
        const soft = selecting && avoid?.length ? avoidRecent(analyses.found, new Set(avoid.map((value) => parseSpotifyId(value, "track")))) : { tracks: analyses.found, avoided: 0 };
        const { missing } = analyses;
        const found = soft.tracks;
        if (found.length < 2) {
          return fail(
            `Só ${found.length} faixa(s) com análise. Salve BPM e tom com dj_set_track_analysis. Sem análise: ${listNames(missing, names, cap)}`,
          );
        }
        const tracks = withLabels(found, names);
        const result = buildSet(tracks, {
          curve,
          weights,
          startTrackId: start_track ? parseSpotifyId(start_track, "track") : undefined,
          endTrackId: end_track ? parseSpotifyId(end_track, "track") : undefined,
          beamWidth: beam_width,
          maxTracks: max_tracks,
          targetDurationMs: duration_minutes === undefined ? undefined : duration_minutes * 60_000,
          durations,
        });
        if (missing.length) {
          result.warnings.unshift(`${missing.length} faixa(s) sem análise ficaram fora do set: ${listNames(missing, names, cap)}.`);
        }
        if (soft.avoided > 0) result.warnings.push(`${soft.avoided} faixa(s) de sets recentes ficaram fora (avoid).`);
        else if (selecting && avoid?.length) result.warnings.push("As faixas de avoid ficaram no pool: sem elas sobraria menos de metade das analisadas (ou menos de 10).");
        // P12: só quem não tem nem a estimativa da ReccoBeats; olha o set escolhido, não o pool inteiro
        if (result.order.some((position) => position.energy === null)) {
          result.warnings.push("Há faixas sem energia informada: a curva usa nota neutra para elas.");
        }
        attachPlans(result, tracks);
        const data = { ...result, avoided: soft.avoided, ordered_track_ids: result.order.map((position) => position.track_id) };
        return render(response_format, () => setToMarkdown(result), data as unknown as Record<string, unknown>);
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );

  // ---------------------------------------------------------------- evaluate manual order
  server.registerTool(
    "dj_evaluate_order",
    {
      title: "Avaliar uma ordem já definida",
      description: `Gera o mesmo relatório de dj_build_set para uma ordem fixa, sem reordenar.

Use para: diagnosticar a ordem atual de uma playlist, conferir uma ordem ajustada à mão pelo usuário, ou comparar duas versões do set.

Args:
  - playlist (string, opcional): avalia a ordem atual da playlist (ID, link ou nome de uma playlist sua)
  - track_ids (string[], opcional): avalia esta ordem
  - curve, weights, response_format`,
      inputSchema: z
        .object({
          playlist: playlistArg,
          track_ids: z.array(z.string().min(1)).max(LIMITS.maxTracksPerSet).optional(),
          curve: curveSchema,
          weights: weightsSchema,
          response_format: responseFormat,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ playlist, track_ids, curve, weights, response_format }) => {
      try {
        const { ids, names } = await resolveTrackIds(playlist, track_ids);
        const { found, missing } = loadAnalyses(ids);
        if (found.length < 2) return fail("São necessárias pelo menos 2 faixas com análise salva.");
        const tracks = withLabels(found, names);
        const result = buildReport(tracks, curve, normalizeWeights(weights));
        if (missing.length) {
          result.warnings.unshift(`${missing.length} faixa(s) sem análise foram puladas na avaliação: ${missing.map((id) => names.get(id) ?? id).join("; ")}.`);
        }
        attachPlans(result, tracks);
        return render(response_format, () => setToMarkdown(result), result as unknown as Record<string, unknown>);
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );

  // ---------------------------------------------------------------- transition plan
  server.registerTool(
    "transition_plan",
    {
      title: "Plano de transição entre duas faixas",
      description: `Sugere como passar da faixa A para a faixa B: tipo (blend, troca de grave, filtro ou echo out), comprimento em compassos, troca de grave, estratégia de tempo, harmonia, variação de energia, confiança e alertas.

O plano é feito por metadados (BPM, tom e energia salvos), sem estrutura por compasso da faixa. O Spotify não tem API para transições: aplique à mão no Mix do app do Spotify.

Args:
  - from_track, to_track: IDs, URIs ou links (precisam ter análise salva)
  - use_jev (boolean, padrão false): consulta o Jev (TypeSafe), que escolhe o tipo quando a confiança é ≥ JEV_MIN_CONFIDENCE (padrão 0,7). Sem chave, com erro ou com confiança baixa, as regras decidem e o plano avisa. O Jev recebe só números. É uma chamada de API paga: só use quando o usuário pedir o Jev
  - response_format`,
      inputSchema: z
        .object({
          from_track: z.string().min(1),
          to_track: z.string().min(1),
          use_jev: z.boolean().default(false).describe("Consulta o Jev para escolher o tipo; sem chave, erro ou confiança baixa, as regras decidem"),
          response_format: responseFormat,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ from_track, to_track, use_jev, response_format }) => {
      try {
        const ids = [parseSpotifyId(from_track, "track"), parseSpotifyId(to_track, "track")];
        const { found, missing } = loadAnalyses(ids);
        if (missing.length) return fail(`Sem análise salva para: ${missing.join(", ")}. Use dj_set_track_analysis antes.`);
        const [a, b] = found as [TrackAnalysis, TrackAnalysis];
        const rules = planTransition(a, b);
        const jev = use_jev ? jevFromEnv(getContext().config.dataDir) : undefined;
        const plan = jev ? decideWithJev(rules, await jev.askTransition(a, b, rules), jev.minConfidence) : rules;
        return render(
          response_format,
          () =>
            [
              `${a.label ?? a.track_id} → ${b.label ?? b.track_id}`,
              `Tipo: ${plan.type} · ${plan.length_bars} compassos · troca de grave: ${plan.bass_swap_bar === null ? "sem troca" : `compasso ${plan.bass_swap_bar}`}`,
              `Tempo: ${plan.tempo.from_bpm} → ${plan.tempo.to_bpm} BPM (dif. ${plan.tempo.diff}, ${plan.tempo.mode}) · estratégia ${plan.tempo.strategy}`,
              `Harmonia: ${plan.harmonic.from} → ${plan.harmonic.to} · ${plan.harmonic.relation} (${plan.harmonic.class})`,
              `ΔEnergia: ${plan.energy_delta ?? "?"} · confiança ${plan.confidence}`,
              ...(plan.source
                ? [
                    `Decisão: ${plan.source === "jev" ? "Jev" : "regras"}${
                      plan.jev
                        ? ` · Jev: ${plan.jev.type} (confiança ${plan.jev.type_confidence}), nota ${plan.jev.score}/5 (confiança ${plan.jev.score_confidence})`
                        : ""
                    }`,
                  ]
                : []),
              ...(plan.alerts.length ? ["Alertas:", ...plan.alerts.map((alert) => `- ${alert}`)] : []),
              `Motivo: ${plan.reason}`,
            ].join("\n"),
          { plan },
        );
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );

  // ---------------------------------------------------------------- jev compare
  server.registerTool(
    "jev_compare",
    {
      title: "Comparar o Jev com o planejador de regras",
      description: `Pergunta ao Jev (TypeSafe) o tipo de transição e a nota de pares consecutivos de faixas analisadas e compara com o planejador de regras.

Devolve, por par, o tipo das regras e o do Jev (com a confiança), a nota das regras (0-1) e a do Jev (1-5), e o resumo da concordância: type_pct (% de pares com o mesmo tipo), confident_pct (% de concordância só entre as respostas com confiança ≥ JEV_MIN_CONFIDENCE, padrão 0,7) e score_correlation (Pearson entre as duas notas).

O Jev recebe só números (BPM, Camelot, energia, ΔBPM): nunca nome, artista nem ID do Spotify. Cada chamada entra em jev-calls.jsonl na pasta de dados. É uma chamada de API paga por par, em sequência: para no limite de requisições (429/529) ou após 3 falhas seguidas e devolve o que já tem. Só use quando o usuário pedir a comparação.

Args:
  - playlist (string, opcional): usa os pares consecutivos da ordem da playlist (ID, link ou nome de uma playlist sua)
  - track_ids (string[], opcional): alternativa a playlist
  - pairs (1-40, padrão 20): quantos pares consecutivos comparar
  - response_format

Sem TYPESAFE_API_KEY a ferramenta falha com um aviso claro. Faixas sem análise salva são puladas.`,
      inputSchema: z
        .object({
          playlist: playlistArg,
          track_ids: z.array(z.string().min(1)).max(LIMITS.maxTracksPerSet).optional(),
          pairs: z.number().int().min(1).max(JEV_COMPARE_PAIRS.max).default(JEV_COMPARE_PAIRS.default),
          response_format: responseFormat,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ playlist, track_ids, pairs, response_format }) => {
      try {
        const jev = jevFromEnv(getContext().config.dataDir);
        if (!jev.available()) {
          return fail("Sem chave do Jev: defina TYPESAFE_API_KEY no .env do backend e reinicie o servidor MCP. O jev_compare só compara o Jev com as regras.");
        }
        const { ids, names } = await resolveTrackIds(playlist, track_ids);
        const { found } = loadAnalyses([...new Set(ids)]);
        if (found.length < 2) return fail("São necessárias pelo menos 2 faixas com análise salva.");
        const tracks = withLabels(found, names);
        const consecutive = tracks.slice(0, pairs).flatMap((a, index): [TrackAnalysis, TrackAnalysis][] => {
          const b = tracks[index + 1];
          return b ? [[a, b]] : [];
        });
        const comparison = await compareTransitions(consecutive, jev);
        return render(response_format, () => compareToMarkdown(comparison, jev.minConfidence), { ...comparison });
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );

  // ---------------------------------------------------------------- mix guide
  server.registerTool(
    "export_mix_guide",
    {
      title: "Guia do Mix para o app do Spotify",
      description: `Gera, na ordem dada e sem reordenar, um guia passagem por passagem para aplicar no Mix do app do Spotify (volume, EQ e efeitos).

O plano é feito por metadados (BPM, tom e energia), sem estrutura por compasso. O Spotify não tem API para transições: o usuário aplica à mão.

Args:
  - playlist (string, opcional): usa a ordem atual da playlist (ID, link ou nome de uma playlist sua)
  - track_ids (string[], opcional): usa esta ordem
  - response_format

Faixas sem análise salva são puladas e listadas no topo.`,
      inputSchema: z
        .object({
          playlist: playlistArg,
          track_ids: z.array(z.string().min(1)).max(LIMITS.maxTracksPerSet).optional(),
          response_format: responseFormat,
        })
        .strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ playlist, track_ids, response_format }) => {
      try {
        const { ids, names } = await resolveTrackIds(playlist, track_ids);
        const { found, missing } = loadAnalyses(ids);
        if (found.length < 2) return fail("São necessárias pelo menos 2 faixas com análise salva.");
        const byId = new Map(found.map((entry) => [entry.track_id, entry]));
        const labelOf = (a: TrackAnalysis): string => a.label ?? names.get(a.track_id) ?? a.track_id;
        const steps: MixGuideStep[] = [];
        for (let i = 1; i < ids.length; i += 1) {
          const a = byId.get(ids[i - 1] as string);
          const b = byId.get(ids[i] as string);
          if (!a || !b) continue; // par com faixa sem análise é pulado
          steps.push(mixGuideStep(planTransition(a, b), `${i} → ${i + 1}`, labelOf(a), labelOf(b)));
        }
        const warning = missing.length
          ? `${missing.length} faixa(s) sem análise: os pares com elas foram pulados: ${missing.map((id) => names.get(id) ?? id).join("; ")}.`
          : undefined;
        return render(
          response_format,
          () =>
            [
              `# Guia do Mix · ${steps.length} passagens`,
              ...(warning ? ["", warning] : []),
              "",
              "Aplique no Mix do app do Spotify, passagem por passagem. O Spotify não tem API para transições.",
              "",
              ...steps.map((step) => step.text),
            ].join("\n"),
          { steps, ...(warning ? { warnings: [warning] } : {}) },
        );
      } catch (error) {
        return fail(formatError(error));
      }
    },
  );

  // ---------------------------------------------------------------- key converter
  server.registerTool(
    "dj_convert_key",
    {
      title: "Converter tom para Camelot",
      description: `Converte tom musical em código Camelot e vice-versa (ex.: "F#m" → 11A, "8B" → C).

Args:
  - key (string): "Am", "F#m", "Eb", "Db major", "8A", "12b"`,
      inputSchema: z.object({ key: z.string().min(1).max(20) }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ key }) => {
      const parsed = parseKey(key);
      if (!parsed) return fail(`Tom não reconhecido: "${key}". Exemplos válidos: 8A, 12B, Am, F#m, Eb, Db major.`);
      const data = { input: key, camelot: formatCamelot(parsed), musical: musicalName(parsed) };
      return render(ResponseFormat.MARKDOWN, () => `${key} = ${data.camelot} (${data.musical})`, data);
    },
  );
}
