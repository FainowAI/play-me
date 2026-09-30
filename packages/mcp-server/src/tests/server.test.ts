import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type TextResult = { content: { type: string; text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> };

const dataDir = mkdtempSync(join(tmpdir(), "dj-mcp-test-"));
const serverPath = fileURLToPath(new URL("../index.js", import.meta.url));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: {
    ...(process.env as Record<string, string>),
    SPOTIFY_CLIENT_ID: "af28a5cf9c9d415e89402d0c342e6022",
    SPOTIFY_REDIRECT_URI: "http://127.0.0.1:3000/callback",
    SPOTIFY_DJ_DATA_DIR: dataDir,
    // nenhuma chave real do Jev chega ao subprocesso: sem chamada paga e com o "sem chave" determinístico
    TYPESAFE_API_KEY: "",
    JEV_MIN_CONFIDENCE: "",
  },
  stderr: "pipe",
});
const client = new Client({ name: "test-client", version: "1.0.0" });

const call = async (name: string, args: Record<string, unknown> = {}): Promise<TextResult> =>
  (await client.callTool({ name, arguments: args })) as TextResult;
const text = (result: TextResult): string => result.content.map((c) => c.text).join("\n");

try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name).sort();
  console.log("Ferramentas:", names.join(", "));
  assert.deepEqual(names, [
    "dj_build_set",
    "dj_convert_key",
    "dj_delete_track_analysis",
    "dj_evaluate_order",
    "dj_score_transition",
    "dj_set_track_analysis",
    "export_mix_guide",
    "jev_compare",
    "metadata_coverage",
    "metadata_lookup",
    "spotify_auth_status",
    "spotify_create_playlist_from_order",
    "spotify_get_playlist_tracks",
    "spotify_list_my_playlists",
    "spotify_search_tracks",
    "transition_plan",
  ]);
  for (const tool of tools) {
    assert.ok(tool.description && tool.description.length > 40, `${tool.name} sem descrição`);
    assert.ok(tool.annotations, `${tool.name} sem annotations`);
  }

  // Sem tokens: erro acionável, servidor continua de pé
  const status = await call("spotify_auth_status");
  assert.equal(status.isError, true);
  assert.match(text(status), /npm run auth/);

  const create = await call("spotify_create_playlist_from_order", {
    track_ids: ["4iV5W9uYEdYUVa79Axb7Rh"],
    name: "[DJ MIX] Teste",
  });
  assert.equal(create.isError, true);
  assert.match(text(create), /npm run auth/);

  // Conversão de tom
  assert.match(text(await call("dj_convert_key", { key: "F#m" })), /11A/);
  assert.equal((await call("dj_convert_key", { key: "X9" })).isError, true);

  // Validação de ID
  const badId = await call("dj_set_track_analysis", { tracks: [{ track: "nao-e-id", bpm: 124, key: "8A" }] });
  assert.equal(badId.isError, true);
  assert.match(text(badId), /inválido/);

  // Salvar análises (IDs e links em formatos diferentes)
  const ids = ["0000000000000000000001", "0000000000000000000002", "0000000000000000000003", "0000000000000000000004"];
  const saved = await call("dj_set_track_analysis", {
    tracks: [
      { track: ids[0], bpm: 122, key: "7B", energy: 4, style: "melodic house", label: "Don't This – Fairtone", source: "spotify-mixar" },
      { track: `spotify:track:${ids[1]}`, bpm: 124, key: "Dm", energy: 5, style: "melodic house", label: "Nothing Wrong – OMRI." },
      { track: `https://open.spotify.com/track/${ids[2]}?si=abc`, bpm: 125, key: "5A", energy: 6, style: "melodic house", label: "Ghost Dance – Brunello" },
      { track: ids[3], bpm: 128, key: "4B", energy: 7, style: "tech house", label: "Like I Like It – Mau P" },
    ],
  });
  assert.notEqual(saved.isError, true);
  assert.match(text(saved), /7A/); // Dm normalizado para Camelot

  // Upsert parcial preserva campos
  await call("dj_set_track_analysis", { tracks: [{ track: ids[3], bpm: 128, key: "4B", notes: "drop forte" }] });

  const transition = await call("dj_score_transition", { from_track: ids[0], to_track: ids[1] });
  assert.match(text(transition), /relativa/);

  const set = await call("dj_build_set", { track_ids: [...ids].reverse(), curve: "classic", response_format: "json" });
  assert.notEqual(set.isError, true);
  const parsed = JSON.parse(text(set)) as { ordered_track_ids: string[]; order: { energy: number }[] };
  assert.equal(parsed.ordered_track_ids.length, 4);
  assert.equal(parsed.ordered_track_ids[0], ids[0], "abre com a faixa de menor energia");
  assert.equal(parsed.order[3]?.energy, 7, "energia preservada no upsert parcial");

  const missing = await call("dj_build_set", { track_ids: [ids[0], "0000000000000000000099"] });
  assert.equal(missing.isError, true);
  assert.match(text(missing), /sem análise/i);

  // Sem duration_minutes/max_tracks o resultado não ganha campos novos e o plano não consulta o Jev
  const legacy = JSON.parse(text(set)) as Record<string, unknown> & { plans: { source?: string; jev?: unknown }[] };
  assert.equal("pool_size" in legacy, false);
  assert.equal("duration_ms" in legacy, false);
  assert.ok(legacy.plans.every((plan) => plan.source === undefined && plan.jev === undefined), "dj_build_set não chama o Jev");

  // P10: seleção por quantidade (com track_ids não há duração do Spotify: duration_ms nulo)
  const picked = await call("dj_build_set", { track_ids: ids, curve: "classic", max_tracks: 3, response_format: "json" });
  assert.notEqual(picked.isError, true);
  const pickedData = JSON.parse(text(picked)) as { order: unknown[]; pool_size: number; duration_ms: number | null; warnings: string[] };
  assert.equal(pickedData.order.length, 3);
  assert.equal(pickedData.pool_size, 4);
  assert.equal(pickedData.duration_ms, null);
  assert.ok(pickedData.warnings.some((w) => w.startsWith("Selecionadas 3 de 4 faixas analisadas")));
  const both = await call("dj_build_set", { track_ids: ids, duration_minutes: 30, max_tracks: 3 });
  assert.equal(both.isError, true);
  assert.match(text(both), /duration_minutes ou max_tracks/);
  const noDurations = await call("dj_build_set", { track_ids: ids, duration_minutes: 30 });
  assert.equal(noDurations.isError, true);
  assert.match(text(noDurations), /playlist/);
  const rejected = async (name: string, args: Record<string, unknown>): Promise<boolean> => {
    try {
      return (await call(name, args)).isError === true;
    } catch {
      return true; // a validação do zod pode chegar como erro de protocolo
    }
  };
  assert.ok(await rejected("dj_build_set", { track_ids: ids, max_tracks: 1 }), "max_tracks abaixo de 2");
  assert.ok(await rejected("dj_build_set", { track_ids: ids, max_tracks: 2.5 }), "max_tracks inteiro");
  assert.ok(await rejected("dj_build_set", { track_ids: ids, duration_minutes: 5 }), "duration_minutes abaixo de 10");
  assert.ok(await rejected("dj_build_set", { track_ids: ids, duration_minutes: 601 }), "duration_minutes acima de 600");

  // P12: energia estimada (notas da ReccoBeats) vem marcada; a do Mixar e a do usuário não
  type Built = { order: { track_id: string; energy: number | null; energy_estimated: boolean }[]; warnings: string[] };
  const webId = "0000000000000000000005";
  const bareId = "0000000000000000000006";
  const saveWeb = await call("dj_set_track_analysis", {
    tracks: [
      { track: webId, bpm: 124, key: "8A", source: "web", notes: "[A VALIDAR] tom da web (ReccoBeats); confira no Mixar; energy 0.55 (ReccoBeats), apoio à energia" },
      { track: bareId, bpm: 125, key: "9A", source: "web", notes: "[A VALIDAR] tom da web (ReccoBeats); confira no Mixar" },
    ],
  });
  assert.notEqual(saveWeb.isError, true);
  const estimated = JSON.parse(text(await call("dj_build_set", { track_ids: [ids[0], ids[1], webId], response_format: "json" }))) as Built;
  const webPosition = estimated.order.find((p) => p.track_id === webId);
  assert.deepEqual([webPosition?.energy, webPosition?.energy_estimated], [6, true]);
  assert.ok(estimated.order.filter((p) => p.track_id !== webId).every((p) => p.energy_estimated === false), "Mixar/usuário: sem marca");
  assert.ok(!estimated.warnings.some((w) => w.includes("sem energia")), "com estimativa, sem aviso de faixa sem energia");
  assert.match(text(await call("dj_build_set", { track_ids: [ids[0], ids[1], webId] })), /E6\* \(alvo/, "o markdown marca a estimativa com *");
  const bare = JSON.parse(text(await call("dj_build_set", { track_ids: [ids[0], bareId], response_format: "json" }))) as Built;
  const barePosition = bare.order.find((p) => p.track_id === bareId);
  assert.deepEqual([barePosition?.energy, barePosition?.energy_estimated], [null, false]);
  assert.ok(bare.warnings.some((w) => w.includes("sem energia")), "sem energia nem estimativa, o aviso continua");

  // Jev (chave zerada neste teste): jev_compare falha com aviso claro; transition_plan cai nas regras (regra 9)
  const noJev = await call("jev_compare", { track_ids: ids });
  assert.equal(noJev.isError, true);
  assert.match(text(noJev), /TYPESAFE_API_KEY/);
  assert.ok(await rejected("jev_compare", { track_ids: ids, pairs: 41 }), "pairs acima de 40");
  type PlanJson = { plan: { type: string; length_bars: number; source?: string; jev?: unknown; alerts: string[] } };
  const rulesOnly = JSON.parse(text(await call("transition_plan", { from_track: ids[0], to_track: ids[1], response_format: "json" }))) as PlanJson;
  assert.equal(rulesOnly.plan.source, undefined, "sem use_jev o plano não ganha campos");
  const asked = await call("transition_plan", { from_track: ids[0], to_track: ids[1], use_jev: true, response_format: "json" });
  assert.notEqual(asked.isError, true, "sem chave o Jev não derruba o plano");
  const askedPlan = (JSON.parse(text(asked)) as PlanJson).plan;
  assert.deepEqual(
    [askedPlan.source, askedPlan.jev, askedPlan.type, askedPlan.length_bars],
    ["rules", null, rulesOnly.plan.type, rulesOnly.plan.length_bars],
  );
  assert.ok(askedPlan.alerts.some((alert) => alert.startsWith("Jev indisponível")));
  assert.match(text(await call("transition_plan", { from_track: ids[0], to_track: ids[1], use_jev: true })), /Decisão: regras/);
  assert.ok(await rejected("transition_plan", { from_track: ids[0], to_track: ids[1], use_jev: "sim" }), "use_jev é booleano");

  const evaluated = await call("dj_evaluate_order", { track_ids: ids });
  assert.match(text(evaluated), /Set proposto/);

  const removed = await call("dj_delete_track_analysis", { tracks: [ids[3]] });
  assert.match(text(removed), /1 análise/);

  console.log("\n[ok] teste de ponta a ponta via stdio passou");
} finally {
  await client.close();
  rmSync(dataDir, { recursive: true, force: true });
}
