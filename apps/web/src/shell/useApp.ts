/**
 * Estado e efeitos da shell: o reducer de src/state.ts + fetch/SSE de src/api.ts.
 * App.tsx só distribui o objeto `app` que este hook devolve.
 */
import { useEffect, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { API_BASE, ApiError, api, streamChat } from "../api.ts";
import { initialState, itemsFromTurns, nextId, reducer, type AppState, type PanelTab, type Theme } from "../state.ts";
import type { Playlist, ServerEvent, SetStatus, Settings } from "../types.ts";
import { withViewTransition } from "./motion.ts";

const media = (query: string) => ({
  subscribe: (notify: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener("change", notify);
    return () => mq.removeEventListener("change", notify);
  },
  get: () => window.matchMedia(query).matches,
});
const NARROW = media("(width < 1100px)"); // o painel do set vira gaveta
const COMPACT = media("(width < 720px)"); // a sidebar vira gaveta

const THEME_KEY = "playme.theme";
function storedTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    // ponytail: localStorage pode lançar (modo privado, dados bloqueados); segue o tema padrão
  }
  return initialState.theme;
}

const errorText = (e: unknown): string => (e instanceof ApiError ? e.message : `Sem resposta do servidor em ${API_BASE}. Ele está rodando?`);

export function useApp() {
  // o tema sai do localStorage já no estado inicial: sem flash e sem efeito de leitura disputando com o de escrita
  const [state, dispatch] = useReducer(reducer, initialState, (s): AppState => ({ ...s, theme: storedTheme() }));
  const [draft, setDraft] = useState("");
  const narrow = useSyncExternalStore(NARROW.subscribe, NARROW.get);
  const compact = useSyncExternalStore(COMPACT.subscribe, COMPACT.get);
  const turn = useRef<AbortController | null>(null); // turno em andamento; um por vez (o servidor responde 409 ao segundo)
  const setReq = useRef(0); // "o último vence" nas leituras do set
  const sessionReq = useRef(0); // idem nas leituras de sessão

  const refreshSessions = () => {
    api
      .sessions()
      .then((sessions) => dispatch({ type: "sessions", sessions }))
      .catch(() => undefined); // ponytail: lista velha é melhor que erro no chat
  };

  // aborta o turno: o servidor trata a desconexão como cancelamento (e como rejeição, se havia aprovação pendente)
  const abortTurn = () => {
    turn.current?.abort();
    turn.current = null;
  };

  useEffect(() => {
    api.status().then((status) => dispatch({ type: "status", status })).catch(() => undefined);
    api.playlists().then((r) => dispatch({ type: "playlists", playlists: r.items })).catch(() => dispatch({ type: "playlists", playlists: [] })); // 503: Spotify não conectado
    refreshSessions();
    api.settings().then((settings) => dispatch({ type: "settings", settings })).catch(() => undefined);
    // recarregar a página não perde a conversa: o id vive no hash (#s=<id>)
    const fromHash = new URLSearchParams(location.hash.slice(1)).get("s");
    if (fromHash) void openSession(fromHash);
    return () => turn.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    history.replaceState(null, "", state.sessionId ? `#s=${encodeURIComponent(state.sessionId)}` : location.pathname);
  }, [state.sessionId]);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = state.theme;
  }, [state.theme]);

  const home = state.sessionId === null && state.items.length === 0; // nenhuma conversa aberta
  const sessionTitle = state.sessions.find((s) => s.id === state.sessionId)?.title;
  const title = state.set?.set.name ?? sessionTitle ?? "Nova conversa"; // cabeçalho do chat e título da aba

  useEffect(() => {
    document.title = home ? "Play.Me" : `Play.Me · ${title}`;
  }, [home, title]);

  // ponytail: gaveta aberta e janela alargada: zera o estado, senão ela reabre sozinha ao estreitar de novo
  useEffect(() => {
    if (!narrow && state.panel.open) dispatch({ type: "panel", open: false });
  }, [narrow, state.panel.open]);
  useEffect(() => {
    if (!compact && state.sidebarOpen) dispatch({ type: "sidebar", open: false });
  }, [compact, state.sidebarOpen]);

  // aviso que não encerra o turno: com o stream vivo, só `text` preserva o busy (turn_failed e error o limpam e o composer
  // reabriria com o stream aberto). Sem turno vivo um `text` ligaria o busy sem ninguém para desligar: vira erro terminal.
  const notice = (text: string) => dispatch(turn.current ? { type: "event", event: { type: "text", text } } : { type: "turn_failed", text });

  /** Evento `set` → lê o set completo e troca a versão com View Transition (as linhas do painel se reordenam). */
  const loadSet = async (setId: string, status: SetStatus) => {
    const n = ++setReq.current;
    try {
      const set = await api.set(setId);
      if (n !== setReq.current) return; // chegou uma leitura mais nova, ou o chat mudou: esta perdeu
      withViewTransition(() => {
        if (n !== setReq.current) return;
        flushSync(() => {
          dispatch({ type: "set_loaded", set });
          if (status === "enviado") dispatch({ type: "panel", tab: "guia" });
        });
      });
    } catch (e) {
      if (n === setReq.current) notice(e instanceof ApiError ? e.message : "Não consegui carregar o set.");
    }
  };

  /** Lê o stream de um turno já iniciado pelo `send`; não deixa o composer travado se ele cai. */
  const stream = async (ac: AbortController, message: string) => {
    let ended = false; // chegou done ou error
    const onEvent = (event: ServerEvent) => {
      if (ac.signal.aborted) return; // o usuário saiu do chat: eventos tardios não entram no chat novo
      if (event.type === "done" || event.type === "error") ended = true;
      dispatch({ type: "event", event });
      if (event.type === "session") {
        if (state.sessionId === null) refreshSessions(); // conversa nova: a linha da sidebar (com o orb) já existe
      } else if (event.type === "set") {
        void loadSet(event.set_id, event.status);
      }
    };
    try {
      await streamChat({ session_id: state.sessionId, message }, onEvent, ac.signal);
      if (!ended && !ac.signal.aborted) dispatch({ type: "turn_failed", text: "A resposta foi interrompida." });
    } catch (e) {
      if (!ac.signal.aborted) dispatch({ type: "turn_failed", text: errorText(e) }); // 409, 404 ou queda de rede: não deixa o composer travado
    } finally {
      if (turn.current === ac) turn.current = null;
      if (!ac.signal.aborted) refreshSessions();
    }
  };

  /**
   * Envia a mensagem e devolve true. Vazia, ou com um turno em andamento, devolve false sem fazer nada: quem chama só
   * limpa o rascunho ou fecha a camada no true (senão o texto digitado ou o formulário da Faixa se perderia).
   */
  const send = (text: string): boolean => {
    const message = text.trim();
    if (!message || turn.current) return false;
    const ac = new AbortController();
    turn.current = ac;
    dispatch({ type: "send", id: nextId(), text: message });
    void stream(ac, message);
    return true;
  };

  /**
   * Clique na aprovação. 409 = já decidida ou expirada: a approval vira "expirada" e a mensagem do servidor entra no chat.
   * Não aborta o stream: "já decidida" pode chegar com o turno aprovado ainda criando a playlist, e desconectar o cancelaria.
   */
  const decide = async (approvalId: string, decision: "approved" | "rejected") => {
    try {
      const r = await api.decide(approvalId, decision);
      dispatch({ type: "approval_decided", approvalId, status: r.status });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        dispatch({ type: "approval_decided", approvalId, status: "expired" });
        dispatch({ type: "turn_failed", text: e.message });
      } else {
        notice(errorText(e)); // rede caiu: o gate segue pendente e o turno vivo, o clique pode ser repetido
      }
    }
  };

  const newChat = () => {
    abortTurn();
    setReq.current++;
    sessionReq.current++;
    dispatch({ type: "new_chat" });
    dispatch({ type: "sidebar", open: false });
  };

  const openSession = async (id: string) => {
    if (id === state.sessionId) {
      dispatch({ type: "sidebar", open: false });
      return;
    }
    abortTurn();
    setReq.current++;
    const n = ++sessionReq.current;
    try {
      const d = await api.session(id);
      if (n !== sessionReq.current) return;
      dispatch({ type: "session_loaded", sessionId: id, items: itemsFromTurns(d.turns), set: d.set && d.versions.length > 0 ? { set: d.set, versions: d.versions } : null });
      dispatch({ type: "sidebar", open: false });
    } catch (e) {
      if (n === sessionReq.current) dispatch({ type: "turn_failed", text: errorText(e) });
    }
  };

  const setTheme = (theme: Theme) => {
    dispatch({ type: "theme", theme });
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ponytail: sem persistência, o tema vale só nesta sessão
    }
  };

  // `version`: o card do chat pertence a uma versão; o painel passa a mostrá-la para a Transição abrir a passagem certa
  const openPanel = (tab?: PanelTab, version?: number) => {
    if (version !== undefined) dispatch({ type: "view_version", version });
    dispatch({ type: "panel", open: true, tab });
  };
  const openTransition = (position: number, version?: number) => {
    if (version !== undefined) dispatch({ type: "view_version", version });
    dispatch({ type: "overlay", overlay: { kind: "transition", position } });
  };

  return {
    state,
    draft,
    setDraft,
    home,
    title,
    sessionTitle,
    narrow, // < 1100 px: painel do set em gaveta
    compact, // < 720 px: sidebar em gaveta
    send,
    approve: (approvalId: string) => decide(approvalId, "approved"),
    reject: (approvalId: string) => decide(approvalId, "rejected"),
    newChat,
    openSession,
    selectPlaylist: (playlist: Playlist) => {
      dispatch({ type: "playlist", playlist });
      dispatch({ type: "sidebar", open: false });
    },
    setTheme,
    saveSettings: async (settings: Settings) => {
      dispatch({ type: "settings", settings: await api.saveSettings(settings) }); // lança ApiError: a janela mostra a mensagem
    },
    openSidebar: () => dispatch({ type: "sidebar", open: true }),
    closeSidebar: () => dispatch({ type: "sidebar", open: false }),
    openPanel,
    closePanel: () => dispatch({ type: "panel", open: false }),
    setTab: (tab: PanelTab) => dispatch({ type: "panel", tab }),
    viewVersion: (version: number | null) => dispatch({ type: "view_version", version }),
    openTransition,
    openTrack: (trackId: string) => dispatch({ type: "overlay", overlay: { kind: "track", trackId } }),
    openSettings: () => {
      dispatch({ type: "sidebar", open: false }); // vindo da gaveta da sidebar, ela não fica aberta por baixo
      dispatch({ type: "overlay", overlay: { kind: "settings" } });
    },
    closeOverlay: () => dispatch({ type: "overlay", overlay: null }),
  };
}

export type App = ReturnType<typeof useApp>;
