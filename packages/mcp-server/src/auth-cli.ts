#!/usr/bin/env node
/**
 * Autorização única: `npm run auth`.
 * Abre o login do Spotify, recebe o callback em 127.0.0.1 e salva os tokens
 * em <dataDir>/tokens.json. Fluxo Authorization Code com PKCE: não usa Client Secret.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { AUTH_TIMEOUT_MS } from "./constants.js";
import {
  buildAuthorizeUrl,
  createCodeChallenge,
  createCodeVerifier,
  createState,
  exchangeCodeForTokens,
  writeTokens,
} from "./services/auth.js";
import { getConfig, loadDotEnvIfPresent } from "./services/config.js";

function openBrowser(url: string): void {
  const platform = process.platform;
  const [command, args] =
    platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]] // evita o parser do cmd, que quebra URLs com &
      : platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command, args as string[], { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // sem navegador disponível: o link impresso no terminal resolve
  }
}

const page = (title: string, body: string): string =>
  `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font-family:system-ui;background:#080a0e;color:#e0e2e8;display:grid;place-items:center;height:100vh;margin:0">` +
  `<div style="max-width:32rem;text-align:center"><h1 style="font-weight:400">${title}</h1><p>${body}</p></div></body></html>`;

async function main(): Promise<void> {
  loadDotEnvIfPresent();
  const config = getConfig();
  const redirect = new URL(config.redirectUri);
  const verifier = createCodeVerifier();
  const state = createState();
  const authorizeUrl = buildAuthorizeUrl(config, createCodeChallenge(verifier), state);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Tempo esgotado (5 min) esperando o login no Spotify."));
    }, AUTH_TIMEOUT_MS);

    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", config.redirectUri);
      if (url.pathname !== redirect.pathname) {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");

      const finish = (status: number, title: string, body: string, err?: Error): void => {
        res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }).end(page(title, body));
        clearTimeout(timer);
        server.close();
        if (err) reject(err);
        else resolve();
      };

      if (returnedState !== state) return finish(400, "Falha na autorização", "State inválido.", new Error("State inválido no callback (possível CSRF)."));
      if (error) return finish(400, "Autorização negada", `O Spotify respondeu: ${error}.`, new Error(`Autorização negada: ${error}`));
      if (!code) return finish(400, "Falha na autorização", "Código ausente.", new Error("Callback sem código."));

      try {
        const tokens = await exchangeCodeForTokens(config, code, verifier);
        writeTokens(config, tokens);
        finish(200, "Pronto.", "Autorização concluída. Pode fechar esta aba e voltar ao terminal.");
      } catch (exchangeError) {
        finish(500, "Falha na troca do código", "Veja o terminal.", exchangeError as Error);
      }
    });

    server.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Não consegui abrir ${redirect.host}: ${err.message}. A porta está livre?`));
    });

    // Escuta só no loopback, nunca em 0.0.0.0
    server.listen(Number(redirect.port || 80), redirect.hostname.replace(/^\[|\]$/g, ""), () => {
      console.log("Abrindo o login do Spotify no navegador.");
      console.log("Se não abrir, copie este link:\n");
      console.log(authorizeUrl, "\n");
      openBrowser(authorizeUrl);
    });
  });

  console.log(`Tokens salvos em ${config.dataDir}. Reinicie o cliente MCP para usar o servidor.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
