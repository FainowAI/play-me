/**
 * Shell do Play.Me: sidebar | chat | painel do set e as camadas (gavetas e janela) por cima.
 * Acima de 1100 px o painel é a terceira coluna; abaixo vira gaveta, e abaixo de 720 px a sidebar também.
 * Estado, API e SSE ficam em shell/useApp.ts; aqui só se distribui.
 */
import { QuestionsWindow } from "./components/playme/index.ts";
import { SetPanel, SettingsWindow, TrackDrawer, TransitionWindow } from "./panel/index.ts";
import { ChatColumn } from "./shell/ChatColumn.tsx";
import { Overlay } from "./shell/Overlay.tsx";
import { Sidebar } from "./shell/Sidebar.tsx";
import { useApp } from "./shell/useApp.ts";
import { useRef } from "react";
import { pendingApproval, pendingQuestions, selectVersion, splitLabel } from "./state.ts";
import "./shell/shell.css";

export function App() {
  const app = useApp();
  const { state, narrow, compact } = app;
  const version = selectVersion(state);
  const hasPanel = state.set !== null && version !== null;
  const overlay = state.overlay;
  const track = overlay?.kind === "track" ? version?.snapshot?.order.find((t) => t.track_id === overlay.trackId) : undefined;
  // a última pergunta do ask_dj, pendente ou já respondida: a janela segue montada durante a saída animada depois do envio
  const asked = overlay?.kind === "questions" ? state.items.findLast((it) => it.kind === "questions") : undefined;
  // "Fechar"/"Cancelar" e as ações que fecham passam pela saída animada da camada (Overlay.closeRef); sem camada montada, fecha direto
  const overlayClose = useRef<(() => void) | null>(null);
  const panelClose = useRef<(() => void) | null>(null);
  const closeOverlay = () => (overlayClose.current ?? app.closeOverlay)();
  const closePanel = () => (panelClose.current ?? app.closePanel)();

  // os botões do painel e das camadas viram mensagem no composer; o que estiver por cima fecha para a conversa aparecer.
  // Com um turno em andamento o envio é recusado e a camada fica aberta: o que o usuário preencheu (correção da Faixa) não se perde.
  const say = (message: string) => {
    if (!app.send(message)) return;
    closeOverlay();
    closePanel();
  };

  const panel = (drawer: boolean) =>
    state.set && version ? (
      <SetPanel
        set={state.set}
        version={version}
        busy={state.busy && pendingApproval(state) === null && pendingQuestions(state) === null} // esperando o clique de aprovação ou as respostas do DJ não é recalcular
        tab={state.panel.tab}
        onTab={app.setTab}
        onVersion={app.viewVersion}
        onOpenTransition={(position) => app.openTransition(position)}
        onOpenTrack={app.openTrack}
        onSend={say}
        onClose={drawer ? closePanel : undefined}
      />
    ) : null;

  return (
    <div className="shell" data-sidebar={!compact || undefined} data-panel={(hasPanel && !narrow) || undefined}>
      {!compact && <Sidebar app={app} />}
      <ChatColumn app={app} />
      {hasPanel && !narrow && <div className="shell__panel">{panel(false)}</div>}

      {compact && state.sidebarOpen && (
        <Overlay open kind="drawer" side="left" width={264} label="Menu" onClose={app.closeSidebar}>
          <Sidebar app={app} />
        </Overlay>
      )}
      {hasPanel && narrow && state.panel.open && (
        <Overlay open kind="drawer" side="right" width={400} label="Painel do set" onClose={app.closePanel} closeRef={panelClose}>
          {panel(true)}
        </Overlay>
      )}
      {overlay?.kind === "transition" && version && (
        <Overlay open kind="drawer" side="right" width={820} padding="24px 32px" gap={20} label={`Transição ${overlay.position} para ${overlay.position + 1}`} onClose={app.closeOverlay} closeRef={overlayClose}>
          <TransitionWindow version={version} position={overlay.position} onClose={closeOverlay} onSend={say} onRate={app.rate} />
        </Overlay>
      )}
      {overlay?.kind === "track" && version && (
        <Overlay open kind="drawer" side="right" width={520} padding="24px 28px" gap={20} label={track ? `Faixa ${splitLabel(track.label).title}` : "Faixa"} onClose={app.closeOverlay} closeRef={overlayClose}>
          <TrackDrawer version={version} trackId={overlay.trackId} onClose={closeOverlay} onSend={say} />
        </Overlay>
      )}
      {overlay?.kind === "settings" && (
        <Overlay open kind="window" width={760} padding="28px 32px" gap={24} label="Configurações" onClose={app.closeOverlay} closeRef={overlayClose}>
          <SettingsWindow status={state.status} theme={state.theme} onTheme={app.setTheme} settings={state.settings} onSave={app.saveSettings} onClose={closeOverlay} />
        </Overlay>
      )}
      {asked?.kind === "questions" && (
        <Overlay open kind="window" width={640} padding="24px 28px" gap={16} label="Perguntas" onClose={app.closeOverlay} closeRef={overlayClose}>
          <QuestionsWindow
            key={asked.id}
            title={asked.title}
            questions={asked.questions}
            disabled={asked.status !== "pending"}
            onSubmit={(answers) => {
              void app.answer(asked.id, answers);
              closeOverlay();
            }}
          />
        </Overlay>
      )}
    </div>
  );
}
