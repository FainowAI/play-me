/**
 * CONTRATO das peças do painel do set e das camadas (trilha painel, src/panel/*).
 * A shell (src/shell/*) monta estas peças: SetPanel na coluna de 400 px (ou gaveta < 1100 px);
 * TransitionWindow (janela lateral de 820 px), TrackDrawer (gaveta de 520 px) e SettingsWindow (janela de 760 px)
 * dentro do `Overlay` da shell, que já traz o <dialog>, o scrim e a animação de 200 ms. As peças renderizam só o conteúdo.
 */
import type { PanelTab, Theme } from "../state.ts";
import type { SetDetail, SetVersionDetail, Settings, Status } from "../types.ts";

export interface SetPanelProps {
  set: SetDetail;
  version: SetVersionDetail; // a vista (selectVersion): pode ser antiga, só leitura
  busy: boolean; // o agente está recalculando: ThinkingStatus "Recalculando" no cabeçalho
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  onVersion: (version: number | null) => void; // null = mais recente
  onOpenTransition: (position: number) => void; // passagem N → N+1
  onOpenTrack: (trackId: string) => void;
  onSend: (message: string) => void; // botões viram mensagem no composer (telas-mvp.md)
  onClose?: () => void; // presente só quando o painel é gaveta (< 1100 px)
}

export interface TransitionWindowProps {
  version: SetVersionDetail;
  position: number; // 1-based: plano `plans[position-1]`, faixas `order[position-1]` (A) e `order[position]` (B)
  onClose: () => void;
  onSend: (message: string) => void; // "Trocar B" → pede a troca da faixa position+1 no chat
  /** Sprint 4 (7.1.1): grava a nota 1–5 do plano; a shell relê o set depois (o plano volta com `feedback`). Lança ApiError. */
  onRate: (planId: string, rating: number) => Promise<void>;
}

export interface TrackDrawerProps {
  version: SetVersionDetail;
  trackId: string;
  onClose: () => void;
  onSend: (message: string) => void; // "Salvar correção" → mensagem pedindo dj_set_track_analysis (fonte "manual")
}

export interface SettingsWindowProps {
  status: Status | null;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  settings: Settings | null;
  onSave: (settings: Settings) => Promise<void>; // PUT /api/settings; lança ApiError com a mensagem
  onClose: () => void;
}
