import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AppConfig {
  clientId: string;
  redirectUri: string;
  dataDir: string;
}

const CLIENT_ID_PATTERN = /^[0-9a-f]{32}$/i;

/** Carrega `.env` do diretório atual quando existir (Node >= 20.12). */
export function loadDotEnvIfPresent(path = ".env"): void {
  if (existsSync(path) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(path);
  }
}

export function getConfig(): AppConfig {
  const clientId = (process.env.SPOTIFY_CLIENT_ID ?? "").trim();
  if (!clientId) {
    throw new Error(
      "SPOTIFY_CLIENT_ID não definido. Configure a variável de ambiente com o Client ID do app no dashboard do Spotify.",
    );
  }
  if (!CLIENT_ID_PATTERN.test(clientId)) {
    throw new Error("SPOTIFY_CLIENT_ID inválido: esperado um hexadecimal de 32 caracteres.");
  }

  const redirectUri = (process.env.SPOTIFY_REDIRECT_URI ?? "http://127.0.0.1:3000/callback").trim();
  const parsed = new URL(redirectUri);
  if (parsed.hostname === "localhost") {
    throw new Error(
      "O Spotify não aceita 'localhost' como redirect URI. Use http://127.0.0.1:<porta>/callback, igual ao cadastrado no dashboard.",
    );
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "[::1]") {
    throw new Error("Redirect URI precisa ser HTTPS, exceto loopback (127.0.0.1) em desenvolvimento local.");
  }

  const dataDir = (process.env.SPOTIFY_DJ_DATA_DIR ?? "").trim() || join(homedir(), ".spotify-dj-mcp");
  ensureDir(dataDir);

  return { clientId, redirectUri, dataDir };
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}
