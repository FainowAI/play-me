import { ThinkingOrb } from "thinking-orbs";
import { ACTIVITY } from "../../activity.ts";
import { cx } from "./cx.ts";
import type { AgentOrbProps } from "./types.ts";

/**
 * Orb de pensamento (DESIGN.md 4.1): tinta monocromática, sem `color`/`gravity`, `speed` padrão.
 * ponytail: tema (`data-theme`), pausa fora da tela e quadro estático com prefers-reduced-motion ficam com a biblioteca; nenhum matchMedia aqui.
 */
export function AgentOrb({ activity, size = 20, paused, label, className }: AgentOrbProps) {
  const { state, verb } = ACTIVITY[activity];
  return <ThinkingOrb state={state} size={size} theme="auto" paused={paused} aria-label={label ?? verb} className={cx("pm-orb", className)} />;
}
