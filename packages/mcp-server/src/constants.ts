export const SERVER_NAME = "spotify-dj-mcp-server";
export const SERVER_VERSION = "1.0.0";

export const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
export const SPOTIFY_ACCOUNTS_BASE = "https://accounts.spotify.com";

/**
 * Escopos mínimos. Leitura de playlists próprias/colaborativas e escrita apenas
 * em playlists privadas — o servidor só cria playlists novas e privadas.
 */
export const SPOTIFY_SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
] as const;

/** Limites impostos pela Web API (revisão de fevereiro de 2026). */
export const LIMITS = {
  pageMax: 50, // GET /me/playlists e GET /playlists/{id}/items
  searchMax: 10, // GET /search (reduzido de 50 para 10)
  itemsPerWrite: 100, // POST /playlists/{id}/items
  maxTracksPerSet: 150,
  maxAnalysisBatch: 200,
} as const;

export const CHARACTER_LIMIT = 25_000;
export const REQUEST_TIMEOUT_MS = 20_000;
export const MAX_RETRIES_429 = 3;
export const MAX_RETRY_AFTER_SECONDS = 30;
export const TOKEN_SKEW_SECONDS = 60;
export const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

/** Pesos do sistema de avaliação de transição (somam 1). */
export const DEFAULT_WEIGHTS = {
  camelot: 0.35,
  bpm: 0.25,
  energy: 0.25,
  style: 0.1,
  progression: 0.05,
} as const;

/** Faixas de classificação de uma transição pela nota harmônica. */
export const HARMONIC_THRESHOLDS = {
  safe: 0.85,
  creative: 0.55,
} as const;

/** Planejador por metadados (Fase P, D30). */
export const PLANNER_VERSION = "meta-1" as const;
/** Par que só aceita echo out perde este valor na nota total da transição. */
export const ECHO_ONLY_PENALTY = 0.1;
/** Echo out obrigatório: diferença de BPM acima disto, ou nota harmônica até ECHO_MAX_HARMONIC (trítono/choque). */
export const ECHO_MIN_BPM_DIFF = 6;
export const ECHO_MAX_HARMONIC = 0.18;

/** Nota geral abaixo da qual a transição entra no relatório de pontos fracos. */
export const WEAK_TRANSITION_SCORE = 0.62;
