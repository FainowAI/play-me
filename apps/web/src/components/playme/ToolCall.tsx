import { activityForTool } from "../../activity.ts";
import { AgentOrb } from "./AgentOrb.tsx";
import { Crossfade } from "./Crossfade.tsx";
import { cx } from "./cx.ts";
import { Icon } from "./Icon.tsx";
import type { IconName, ToolCallProps } from "./types.ts";

type Status = NonNullable<ToolCallProps["status"]>;
const LABEL: Record<Status, string> = { running: "rodando", done: "concluído", error: "falhou", waiting: "aguardando você" };
/** Terminou: sai o orb, entra o ícone de estado (DESIGN.md 4.1). */
const ICON: Record<Exclude<Status, "running">, IconName> = { done: "check", error: "alert", waiting: "tool" };

export function ToolCall({ name, activity, detail, status = "done" }: ToolCallProps) {
  return (
    <div className={cx("pm-tool", `pm-tool--${status}`)}>
      <span className={cx("pm-tool__icon", status === "running" && "pm-tool__icon--orb")}>
        {/* ao mudar de estado o orb e o ícone trocam em crossfade de 200 ms */}
        <Crossfade value={status} className="pm-tool__xf">
          {(s) => (s === "running" ? <AgentOrb activity={activity ?? activityForTool(name)} size={20} /> : <Icon name={ICON[s]} size={14} />)}
        </Crossfade>
      </span>
      <code className="pm-tool__name">{name}</code>
      {detail ? <span className="pm-tool__detail">{detail}</span> : null}
      <span className="pm-tool__status">{LABEL[status]}</span>
    </div>
  );
}
