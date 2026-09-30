/**
 * Coluna do chat (Analisando/SetProposto/Aprovacao/Enviado.dc.html): cabeçalho de 56 px, lista rolável com a coluna de
 * 720 px centrada e o composer no rodapé. O Início ocupa a mesma <main> (Home.tsx).
 */
import { useEffect, useRef } from "react";
import { Button, Composer } from "../components/playme/index.ts";
import { pendingApproval, selectVersion } from "../state.ts";
import { ChatItems } from "./ChatItems.tsx";
import { COMPOSER_ID, Home } from "./Home.tsx";
import type { App } from "./useApp.ts";

const NEAR_BOTTOM = 80; // px: mais perto do fim que isto = "acompanhando" a conversa

export function ChatColumn({ app }: { app: App }) {
  const { state } = app;
  const version = selectVersion(state);
  const set = state.set?.set;
  const latest = state.set?.versions.at(-1);
  const pending = pendingApproval(state) !== null;

  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true); // false quando o usuário subiu para reler: itens novos não o puxam para o fim
  const lastSession = useRef(state.sessionId);
  const wasBusy = useRef(state.busy);

  // itens novos: rola para o fim (se está acompanhando). ponytail: rolagem instantânea; o smooth brigaria com o onScroll
  // que mede "perto do fim" e faria o auto-scroll parar no meio da animação.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (lastSession.current !== state.sessionId || state.items[state.items.length - 1]?.kind === "user") following.current = true;
    lastSession.current = state.sessionId;
    if (following.current) el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, [state.items, state.sessionId]);

  // a lista também cresce depois do render (o set chega e o card monta, a fonte carrega): observa a coluna em vez de adivinhar
  useEffect(() => {
    const el = scroller.current;
    const col = el?.firstElementChild;
    if (!el || !col) return;
    const ro = new ResizeObserver(() => {
      if (following.current) el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
    });
    ro.observe(col);
    return () => ro.disconnect();
  }, [app.home]); // o rolador só existe fora do Início

  // o composer desabilita durante o turno e perde o foco: ao terminar, devolve (sem tirar de quem foi para outro controle)
  useEffect(() => {
    const active = document.activeElement;
    if (wasBusy.current && !state.busy && (!active || active === document.body || active.id === COMPOSER_ID)) document.getElementById(COMPOSER_ID)?.focus();
    wasBusy.current = state.busy;
  }, [state.busy]);

  const placeholder = pending
    ? "Aprove ou revise a ordem acima para continuar"
    : state.busy
      ? "Peça ajustes enquanto a análise roda"
      : set?.status === "enviado"
        ? "Conte como ficou na pista"
        : set
          ? 'Peça um ajuste: "mais energia no meio", "troca a faixa 7"'
          : "Peça um set, uma transição ou uma análise…";
  const context = set?.status === "enviado" ? set.name : set && latest ? `${set.name} · set V${latest.version}` : app.sessionTitle;

  return (
    <main className="chat">
      <header className="chat__head" data-home={app.home || undefined}>
        {app.compact && <Button variant="ghost" size="sm" icon="list" label="Abrir menu" onClick={() => app.openSidebar()} />}
        {!app.home && (
          <>
            <h1 className="body-strong chat__title">{app.title}</h1>
            {version && <span className="chat__chip mono">V{version.version}</span>}
            <span className="chat__grow" />
            {app.narrow && (
              <Button variant="outline" size="sm" icon="list" disabled={!version} onClick={() => app.openPanel()}>
                Painel do set
              </Button>
            )}
          </>
        )}
      </header>
      {app.home ? (
        <Home app={app} />
      ) : (
        <>
          <div
            ref={scroller}
            className="chat__scroll"
            role="log"
            aria-label="Conversa"
            onScroll={(e) => {
              const el = e.currentTarget;
              following.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
            }}
          >
            <div className="chat__col">
              <ChatItems app={app} />
            </div>
          </div>
          <div className="chat__foot">
            <div className="chat__composer">
              <Composer
                id={COMPOSER_ID}
                value={app.draft}
                onChange={app.setDraft}
                onSubmit={(text) => {
                  if (app.send(text)) app.setDraft(""); // recusado (turno em andamento): o texto fica no composer
                }}
                context={context}
                placeholder={placeholder}
                disabled={state.busy || pending}
              />
            </div>
          </div>
        </>
      )}
    </main>
  );
}
