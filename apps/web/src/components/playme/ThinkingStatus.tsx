import { ACTIVITY } from "../../activity.ts";
import { AgentOrb } from "./AgentOrb.tsx";
import { cx } from "./cx.ts";
import type { ThinkingStatusProps } from "./types.ts";

/**
 * Orb + verbo + progresso. 20 por padrão (cabeçalho do painel, como no canvas SetPanel.dc.html); o ChatItems passa `size={32}` no topo da resposta (Sprint 5).
 * Sidebar e pílulas usam o AgentOrb direto, em 20.
 * ponytail: ao sumir (o texto chega, o turno acaba) o status só desmonta; um fade de saída pediria ao pai manter o componente montado.
 */
export function ThinkingStatus({ activity, verb, detail, size = 20 }: ThinkingStatusProps) {
  const text = verb || ACTIVITY[activity].verb;
  return (
    <div className={cx("pm-thinking", size === 32 && "pm-thinking--lg")} role="status" aria-live="polite">
      <AgentOrb activity={activity} size={size} />
      {/* key: o verbo novo entra em fade (200 ms) quando a atividade muda */}
      <span key={text} className="pm-thinking__verb">
        {text}
      </span>
      {detail ? <span className="pm-thinking__detail">{detail}</span> : null}
    </div>
  );
}
