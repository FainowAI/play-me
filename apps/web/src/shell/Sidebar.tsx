/** Sidebar.dc.html: marca, "Novo set", sets (as sessões), playlists do Spotify, conexões e Configurações. */
import { AgentOrb, Button } from "../components/playme/index.ts";
import type { SetStatus, Status } from "../types.ts";
import { count } from "./text.ts";
import type { App } from "./useApp.ts";

// contract.md: "rascunho · aguardando · enviado" (o brief dizia "aguardando aprovação", que espremia o título da sessão a poucos caracteres)
const TAG: Record<SetStatus, string> = { rascunho: "rascunho", aguardando_aprovacao: "aguardando", enviado: "enviado" };

interface Conn {
  name: string;
  tone: "ok" | "warn"; // ok = bolinha cheia; warn = só o contorno
  value: string;
  mono?: boolean;
}

/** Sem resposta do servidor (status nulo) o valor é "—": dado faltando é dito, não inventado. */
function connections(status: Status | null): Conn[] {
  if (!status) return ["Spotify", "ReccoBeats", "Jev", "Claude"].map((name): Conn => ({ name, tone: "warn", value: "—" }));
  return [
    { name: "Spotify", tone: status.spotify.connected ? "ok" : "warn", value: status.spotify.connected ? "conectado" : "não conectado" },
    { name: "ReccoBeats", tone: "ok", value: "sem chave" }, // BPM e tom pelo ID do Spotify, sem chave (D24, D29)
    { name: "Jev", tone: "warn", value: status.jev ? "chave no .env · regras" : "sem chave · regras" }, // acesso só é validado na Sprint 4 (D28)
    status.anthropic ? { name: "Claude", tone: "ok", value: status.model, mono: true } : { name: "Claude", tone: "warn", value: "sem chave" },
  ];
}

export function Sidebar({ app }: { app: App }) {
  const { state } = app;
  return (
    <nav className="sb" aria-label="Sets e playlists">
      <span className="sb__brand" role="img" aria-label="Play.Me">
        Play<span>.</span>Me
      </span>
      <Button variant="outline" icon="plus" onClick={() => app.newChat()}>
        Novo set
      </Button>

      <div className="sb__scroll">
        <section className="sb__group" aria-labelledby="sb-sets">
          <h2 id="sb-sets" className="label sb__label">
            Sets
          </h2>
          {state.sessions.length === 0 ? (
            <p className="sb__empty">Nenhum set ainda</p>
          ) : (
            <ul>
              {state.sessions.map((s) => {
                const active = s.id === state.sessionId;
                const status = (active ? state.set?.set.status : undefined) ?? s.set?.status; // na sessão aberta o estado do set é o mais novo
                return (
                  <li key={s.id}>
                    <button type="button" className="sb__row" aria-current={active ? "true" : undefined} title={s.title} onClick={() => void app.openSession(s.id)}>
                      <span className="sb__name">{s.title}</span>
                      {active && state.busy ? <AgentOrb activity={state.activity} size={20} /> : status ? <span className="sb__tag">{TAG[status]}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="sb__group" aria-labelledby="sb-playlists">
          <h2 id="sb-playlists" className="label sb__label">
            Playlists do Spotify
          </h2>
          {state.playlists.length === 0 ? (
            <p className="sb__empty">{state.status?.spotify.connected ? "Nenhuma playlist" : "Spotify não conectado"}</p>
          ) : (
            <ul>
              {state.playlists.map((p) => (
                <li key={p.id}>
                  <button type="button" className="sb__row" aria-current={state.playlist?.id === p.id ? "true" : undefined} onClick={() => app.selectPlaylist(p)}>
                    <span className="sb__name">{p.name}</span>
                    <span className="sb__count">{count(p.total)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="sb__status">
        {connections(state.status).map((c) => (
          <div key={c.name} className="sb__conn">
            <span className="sb__dot" data-tone={c.tone} aria-hidden="true" />
            <span className="sb__conn-name">{c.name}</span>
            <span className={c.mono ? "sb__conn-val mono" : "sb__conn-val"}>{c.value}</span>
          </div>
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={() => app.openSettings()}>
        Configurações
      </Button>
    </nav>
  );
}
