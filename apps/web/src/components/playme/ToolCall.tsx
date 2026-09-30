import { activityForTool } from "../../activity.ts";
import { AgentOrb } from "./AgentOrb.tsx";
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
      {status === "running" ? (
        <span className="pm-tool__icon pm-tool__icon--orb">
          <AgentOrb activity={activity ?? activityForTool(name)} size={20} />
        </span>
      ) : (
        <span className="pm-tool__icon">
          <Icon name={ICON[status]} size={14} />
        </span>
      )}
      <code className="pm-tool__name">{name}</code>
      {detail ? <span className="pm-tool__detail">{detail}</span> : null}
      <span className="pm-tool__status">{LABEL[status]}</span>
    </div>
  );
}
