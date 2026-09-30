import { ACTIVITY } from "../../activity.ts";
import { AgentOrb } from "./AgentOrb.tsx";
import type { ThinkingStatusProps } from "./types.ts";

export function ThinkingStatus({ activity, verb, detail, size = 20 }: ThinkingStatusProps) {
  return (
    <div className="pm-thinking" role="status" aria-live="polite">
      <AgentOrb activity={activity} size={size} />
      <span className="pm-thinking__verb">{verb || ACTIVITY[activity].verb}</span>
      {detail ? <span className="pm-thinking__detail">{detail}</span> : null}
    </div>
  );
}
