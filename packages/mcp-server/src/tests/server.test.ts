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
    "metadata_coverage",
    "metadata_lookup",
    "spotify_auth_status",
    "spotify_create_playlist_from_order",
    "spotify_get_playlist_tracks",
    "spotify_list_my_playlists",
    "spotify_search_tracks",
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

  const evaluated = await call("dj_evaluate_order", { track_ids: ids });
  assert.match(text(evaluated), /Set proposto/);

  const removed = await call("dj_delete_track_analysis", { tracks: [ids[3]] });
  assert.match(text(removed), /1 análise/);

  console.log("\n[ok] teste de ponta a ponta via stdio passou");
} finally {
  await client.close();
  rmSync(dataDir, { recursive: true, force: true });
}
