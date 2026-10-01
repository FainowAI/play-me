/**
 * CONTRATO dos componentes do design system Play.Me portados para TSX (D31).
 * Fonte: design/ds/components/index.d.ts + bundle.js. Diferenças deliberadas (para a app funcionar):
 * TrackRow/TransitionCard ganham onClick (abrir gaveta/janela) e TrackRow um style (view-transition-name);
 * Composer é controlado (value/onChange) e onSubmit recebe o texto; ApprovalGate aceita disabled.
 */
import type { CSSProperties, ReactNode } from "react";
import type { Activity } from "../../activity.ts";
import type { Question } from "../../types.ts";

export type Tone = "ok" | "info" | "warn" | "danger" | "neutral";
export type SectionType = "intro" | "groove" | "build" | "drop" | "break" | "outro";
export interface Section {
  type: SectionType;
  bars: number;
  vocal?: boolean;
}
export interface TrackRef {
  title: string;
  bpm: number;
  camelot: string; // Camelot "8A"; inválido/vazio mostra "—"
}
export type IconName = "play" | "check" | "arrow" | "send" | "plus" | "alert" | "tool" | "list" | "wave" | "close";

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export interface ButtonProps {
  variant?: "primary" | "signal" | "outline" | "ghost";
  size?: "md" | "sm";
  icon?: IconName;
  /** aria-label (botão só com ícone ou rótulo curto demais). */
  label?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  title?: string;
  className?: string;
  onClick?: () => void;
  children?: ReactNode;
}

export interface KeyBadgeProps {
  camelot: string | null;
  size?: "md" | "lg";
}

export interface EnergyMeterProps {
  value: number; // 1..10
  estimated?: boolean; // "*" depois do número
  showNumber?: boolean;
}

export interface StatusTagProps {
  tone?: Tone;
  children: ReactNode;
}

export interface TrackRowProps {
  index: number;
  title: string;
  artist: string;
  bpm: number | null;
  camelot: string | null;
  energy?: number | null;
  estimated?: boolean;
  state?: "default" | "selected" | "playing" | "pending";
  onClick?: () => void; // abre a gaveta da faixa
  style?: CSSProperties; // viewTransitionName por faixa (reordenar em 400 ms)
}

export interface PhraseBarProps {
  sections: Section[];
  deck?: "a" | "b";
  label?: string;
  exitAt?: number;
  entryAt?: number;
}

export interface TransitionCardProps {
  index?: string; // "14 → 15"
  trackA: TrackRef;
  trackB: TrackRef;
  relation: { tone: Tone; label: string };
  deltaBpm: number;
  deltaEnergy: number | null; // null = sem energia numa das pontas ("—")
  type: string; // rótulo em português: Blend, Bass swap, Filtro, Echo out
  lengthBars: 4 | 8 | 16 | 32;
  exitAt?: number;
  entryAt?: number;
  aSections?: Section[];
  bSections?: Section[];
  reason?: string;
  onClick?: () => void; // abre a Transição expandida
}

export interface SetArcProps {
  points: { energy: number }[]; // 1..10 (faixa sem energia: use target_energy)
  current?: number; // índice da faixa em foco
  caption?: string;
}

export interface CamelotWheelProps {
  active?: string;
  compatible?: string[];
  size?: number; // px; default 240
}

export interface ChatMessageProps {
  role?: "user" | "assistant";
  children: ReactNode;
}

export interface ToolCallProps {
  name: string; // nome da ferramenta sem prefixo, em mono
  activity?: Activity; // default activityForTool(name)
  detail?: string;
  status?: "running" | "done" | "error" | "waiting";
}

export interface ComposerProps {
  id?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  /** Enter envia (Shift+Enter quebra linha); texto vazio não envia. */
  onSubmit: (text: string) => void;
  context?: string; // pílula "Eletro · 557 faixas"; vazio = "Nenhuma playlist"
  disabled?: boolean; // turno em andamento
  autoFocus?: boolean;
}

export interface ApprovalGateProps {
  playlistName: string;
  trackCount: number;
  duration?: string;
  tracks?: string[]; // títulos na ordem do set: a lista mostra os 5 primeiros e "e mais N"
  onApprove?: () => void;
  onReview?: () => void; // "Revisar ordem" = rejeitar: o set volta a rascunho
  disabled?: boolean; // clique já enviado
}

/** Sprint 6: conteúdo da janela de perguntas do agente (ask_dj); a shell a põe dentro do Overlay (kind "window"), que dá o padding. */
export interface QuestionsWindowProps {
  title: string | null; // título geral do pedido (eyebrow); cada pergunta pode trazer ainda o header
  questions: Question[];
  /** Chamado uma vez, na última pergunta: uma resposta por pergunta (label da opção, texto de "Outra opção" ou null = pulada). */
  onSubmit: (answers: Record<string, string | null>) => void;
  disabled?: boolean; // envio em andamento
}

export interface AgentOrbProps {
  activity: Activity;
  size?: 64 | 32 | 20; // OrbSize do thinking-orbs (64 e 20 afinados; 32 interpolado): passe direto
  paused?: boolean;
  label?: string; // aria-label; default = verbo da atividade
  className?: string;
}

export interface ThinkingStatusProps {
  activity: Activity;
  verb?: string; // default = verbo da atividade (ACTIVITY[activity].verb)
  detail?: string; // progresso real, em mono: "ReccoBeats · 312/557"
  size?: 20 | 32;
}
