/** Ponto de entrada do servidor local. */
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ApprovalWaiter } from "./approvals.js";
import { runChat, type ChatDeps } from "./agent.js";
import { openRepo } from "./repo.js";
import { createHttpServer } from "./server.js";
import { SettingsStore } from "./settings.js";
import { createSpotify } from "./spotify.js";
import type { Status } from "./types.js";

// dist/main.js → apps/server/dist → raiz = três níveis acima do arquivo
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const envFile = path.join(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY?.trim()) fail("ANTHROPIC_API_KEY não definida. Coloque-a no .env da raiz do repositório.");

const mcpServerPath = path.join(root, "packages/mcp-server/dist/index.js");
if (!existsSync(mcpServerPath)) fail(`MCP server não encontrado em ${mcpServerPath}. Rode npm run build.`);

const dataDir = path.resolve(root, process.env.PLAYME_DATA_DIR || "data");
mkdirSync(dataDir, { recursive: true });
const repo = openRepo(path.join(dataDir, "playme.sqlite"));
const waiter = new ApprovalWaiter();

const mcpEnv: Record<string, string> = {};
for (const k of ["SPOTIFY_CLIENT_ID", "SPOTIFY_REDIRECT_URI", "SPOTIFY_DJ_DATA_DIR"]) {
  const v = process.env[k];
  if (v) mcpEnv[k] = v;
}
const spotify = createSpotify();
const settings = new SettingsStore(path.join(dataDir, "settings.json"));
// mesma pasta que o MCP usa para analysis.json e tokens.json (config.ts do MCP)
const storeDir = (process.env.SPOTIFY_DJ_DATA_DIR ?? "").trim() || path.join(homedir(), ".spotify-dj-mcp");
const model = process.env.PLAYME_MODEL || "claude-haiku-4-5";
const chatDeps: ChatDeps = {
  repo, waiter, mcpServerPath, mcpEnv, model, maxBudgetUsd: Number(process.env.PLAYME_MAX_BUDGET_USD) || 0.5,
  storeDir, settings, playlistName: spotify.nameOf,
};
// só se existem: a chave nunca sai daqui
const status = (): Status => ({ model, anthropic: true, spotify: { connected: spotify.connected() }, reccobeats: true, jev: !!process.env.TYPESAFE_API_KEY?.trim() });

const server = createHttpServer({ repo, waiter, status, playlists: spotify.playlists, settings, chat: (id, msg, emit, signal) => runChat(chatDeps, id, msg, emit, signal) });
const port = Number(process.env.PLAYME_SERVER_PORT || 8787);
server.listen(port, "127.0.0.1", () => console.log(`Play.Me server em http://127.0.0.1:${port}`));

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close(() => {
      repo.close();
      process.exit(0);
    });
    server.closeAllConnections();
  });
}
