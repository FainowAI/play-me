import { AnalysisStore } from "./analysis-store.js";
import { getConfig, type AppConfig } from "./config.js";
import { SpotifyClient } from "./spotify-client.js";

export interface AppContext {
  config: AppConfig;
  client: SpotifyClient;
  store: AnalysisStore;
}

let context: AppContext | null = null;

/** Inicialização preguiçosa: erro de configuração vira resposta de ferramenta, não queda do servidor. */
export function getContext(): AppContext {
  if (context) return context;
  const config = getConfig();
  context = { config, client: new SpotifyClient(config), store: new AnalysisStore(config.dataDir) };
  return context;
}
