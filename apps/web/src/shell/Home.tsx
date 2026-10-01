/** Main.dc.html (Início): orb em repouso, "Pista cheia.", composer com a playlist em contexto, três pedidos prontos e o aviso do Jev. */
import { AgentOrb, Button, Composer, StatusTag } from "../components/playme/index.ts";
import { jevState, playlistContext } from "./text.ts";
import type { App } from "./useApp.ts";

export const COMPOSER_ID = "composer";

const ASKS = ["Warm up até peak time", "Sunrise com energia caindo", "Só faixas entre 124 e 126 BPM"];

export function Home({ app }: { app: App }) {
  const { state } = app;
  const playlist = state.playlist;
  const jev = state.status ? jevState(state.status.jev) : null; // null: o servidor não respondeu
  const connected = jev?.tone === "ok";
  return (
    <div className="home">
      <div className="home__inner">
        <div className="home__hero">
          <AgentOrb activity="idle" size={64} />
          <h1 className="display">Pista cheia.</h1>
          <p className="body home__sub">Escolha uma playlist e diga o clima do set.</p>
        </div>
        <div className="home__ask">
          <Composer
            id={COMPOSER_ID}
            autoFocus={!app.compact}
            value={app.draft}
            onChange={app.setDraft}
            onSubmit={(text) => {
              if (app.send(text)) app.setDraft(""); // recusado (turno em andamento): o texto fica no composer
            }}
            context={playlist ? playlistContext(playlist) : undefined}
            placeholder={`Monte um set${playlist ? ` da ${playlist.name}` : ""}, 1h30, warm up até peak time`}
          />
          <div className="home__chips">
            {ASKS.map((label) => (
              <Button key={label} variant="outline" size="sm" onClick={() => void app.ask(label)}>
                {label}
              </Button>
            ))}
          </div>
        </div>
        <div className="home__jev">
          <StatusTag tone={jev?.tone ?? "warn"}>{jev === null ? "Jev · sem dado" : connected ? "Jev conectado" : `Jev · ${jev.value}`}</StatusTag>
          <span className="home__jev-text">
            {connected ? "Decide o tipo de transição quando a confiança passa de 0,7; senão, valem as regras." : "Sem o Jev, as transições usam o planejador de regras."}
          </span>
          <Button variant="ghost" size="sm" onClick={() => app.openSettings()}>
            Configurar
          </Button>
        </div>
      </div>
    </div>
  );
}
