#!/usr/bin/env node
/**
 * spotify-dj-mcp-server
 *
 * Lê playlists do Spotify, guarda BPM/tom/energia informados pelo usuário,
 * monta sets com lógica de DJ e cria a playlist [DJ MIX] sem tocar na original.
 * Transporte stdio: roda local, como subprocesso do cliente MCP.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { loadDotEnvIfPresent } from "./services/config.js";
import { registerDjTools } from "./tools/dj-tools.js";
import { registerMetadataTools } from "./tools/metadata-tools.js";
import { registerSpotifyTools } from "./tools/spotify-tools.js";

export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerSpotifyTools(server);
  registerDjTools(server);
  registerMetadataTools(server);
  return server;
}

async function main(): Promise<void> {
  loadDotEnvIfPresent();
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout é o canal do protocolo: logs vão para stderr
  console.error(`${SERVER_NAME} ${SERVER_VERSION} rodando via stdio`);
}

main().catch((error: unknown) => {
  console.error("Falha ao iniciar o servidor:", error instanceof Error ? error.message : error);
  process.exit(1);
});
