import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SPOTIFY_ACCOUNTS_BASE, SPOTIFY_SCOPES, TOKEN_SKEW_SECONDS, REQUEST_TIMEOUT_MS } from "../constants.js";
import type { StoredTokens } from "../types.js";
import type { AppConfig } from "./config.js";

export class AuthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthRequiredError";
  }
}

const RE_AUTH_HINT =
  "Rode `npm run auth` na pasta do servidor para autorizar de novo e reinicie o cliente MCP.";

// ---------- PKCE ----------

function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function createCodeVerifier(): string {
  // 64 bytes -> 86 caracteres base64url, dentro do intervalo 43..128 da RFC 7636
  return base64url(randomBytes(64));
}

export function createCodeChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

export function createState(): string {
  return base64url(randomBytes(24));
}

export function buildAuthorizeUrl(config: AppConfig, challenge: string, state: string): string {
  const url = new URL(`${SPOTIFY_ACCOUNTS_BASE}/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    scope: SPOTIFY_SCOPES.join(" "),
    code_challenge_method: "S256",
    code_challenge: challenge,
    redirect_uri: config.redirectUri,
    state,
  }).toString();
  return url.toString();
}

// ---------- Token store ----------

function tokenPath(config: AppConfig): string {
  return join(config.dataDir, "tokens.json");
}

export function readTokens(config: AppConfig): StoredTokens | null {
  const path = tokenPath(config);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<StoredTokens>;
    if (
      typeof parsed.access_token === "string" &&
      typeof parsed.refresh_token === "string" &&
      typeof parsed.expires_at === "number"
    ) {
      return {
        access_token: parsed.access_token,
        refresh_token: parsed.refresh_token,
        expires_at: parsed.expires_at,
        scope: typeof parsed.scope === "string" ? parsed.scope : "",
      };
    }
  } catch {
    // arquivo corrompido: tratado como ausente
  }
  return null;
}

export function writeTokens(config: AppConfig, tokens: StoredTokens): void {
  const path = tokenPath(config);
  writeFileSync(path, JSON.stringify(tokens, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows ignora permissões POSIX
  }
}

export function clearTokens(config: AppConfig): void {
  const path = tokenPath(config);
  if (existsSync(path)) rmSync(path);
}

// ---------- Token endpoint ----------

interface TokenResponse {
  access_token: string;
  token_type: string;
  scope?: string;
  expires_in: number;
  refresh_token?: string;
}

interface TokenErrorResponse {
  error?: string;
  error_description?: string;
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(`${SPOTIFY_ACCOUNTS_BASE}/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => ({}))) as TokenResponse & TokenErrorResponse;
  if (!response.ok || !payload.access_token) {
    const detail = payload.error_description ?? payload.error ?? `HTTP ${response.status}`;
    if (payload.error === "invalid_grant") {
      throw new AuthRequiredError(`Autorização expirada ou revogada (${detail}). ${RE_AUTH_HINT}`);
    }
    throw new Error(`Falha no endpoint de token do Spotify: ${detail}`);
  }
  return payload;
}

export async function exchangeCodeForTokens(
  config: AppConfig,
  code: string,
  verifier: string,
): Promise<StoredTokens> {
  const payload = await postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      code_verifier: verifier,
    }),
  );
  if (!payload.refresh_token) {
    throw new Error("O Spotify não devolveu refresh_token na troca do código.");
  }
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_at: Date.now() + payload.expires_in * 1000,
    scope: payload.scope ?? "",
  };
}

async function refreshTokens(config: AppConfig, current: StoredTokens): Promise<StoredTokens> {
  const payload = await postToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: current.refresh_token,
      client_id: config.clientId,
    }),
  );
  return {
    access_token: payload.access_token,
    // A resposta pode não trazer refresh_token novo: nesse caso o atual continua valendo.
    refresh_token: payload.refresh_token ?? current.refresh_token,
    expires_at: Date.now() + payload.expires_in * 1000,
    scope: payload.scope ?? current.scope,
  };
}

// ---------- Access token com refresh single-flight ----------

let inFlightRefresh: Promise<StoredTokens> | null = null;

export async function getAccessToken(config: AppConfig, forceRefresh = false): Promise<string> {
  const tokens = readTokens(config);
  if (!tokens) {
    throw new AuthRequiredError(`Nenhuma autorização encontrada. ${RE_AUTH_HINT}`);
  }
  const stillValid = tokens.expires_at - TOKEN_SKEW_SECONDS * 1000 > Date.now();
  if (stillValid && !forceRefresh) return tokens.access_token;

  if (!inFlightRefresh) {
    inFlightRefresh = refreshTokens(config, tokens)
      .then((next) => {
        writeTokens(config, next);
        return next;
      })
      .finally(() => {
        inFlightRefresh = null;
      });
  }
  const refreshed = await inFlightRefresh;
  return refreshed.access_token;
}
