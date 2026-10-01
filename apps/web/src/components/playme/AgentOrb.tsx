import { ThinkingOrb } from "thinking-orbs";
import { ACTIVITY, type Activity } from "../../activity.ts";
import { Crossfade } from "./Crossfade.tsx";
import { cx } from "./cx.ts";
import type { AgentOrbProps } from "./types.ts";

/** `speed` por atividade (contrato do Sprint 5): calmo parado, mais vivo ao enviar. O que não está aqui (matching, listening) fica no 1 da biblioteca. */
const SPEED: Partial<Record<Activity, number>> = { idle: 0.8, reading: 1.1, scoring: 1, planning: 1, composing: 0.9, shipping: 1.2, working: 1 };

/**
 * Orb de pensamento (DESIGN.md 4.1): tinta monocromática, sem `color`/`gravity`. `speed` por atividade; no 64 (Início) o ponto é um pouco maior e
 * mais denso e o anel fino de 88 px fica atrás (.pm-orb--ring). Mudar de atividade troca de orb em crossfade de 200 ms (Crossfade).
 * ponytail: tema (`data-theme`), pausa fora da tela/aba oculta e quadro estático com prefers-reduced-motion ficam com a biblioteca; nenhum matchMedia aqui.
 */
export function AgentOrb({ activity, size = 20, paused, label, className }: AgentOrbProps) {
  const large = size === 64;
  return (
    <Crossfade value={activity} className={cx("pm-orb", large && "pm-orb--ring", className)} style={{ width: size, height: size }}>
      {(a) => (
        <ThinkingOrb
          state={ACTIVITY[a].state}
          size={size}
          theme="auto"
          speed={SPEED[a]}
          dots={large ? 1.1 : undefined}
          dotSize={large ? 1.15 : undefined}
          paused={paused}
          aria-label={label ?? ACTIVITY[a].verb}
        />
      )}
    </Crossfade>
  );
}
