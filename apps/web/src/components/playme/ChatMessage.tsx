import { cx } from "./cx.ts";
import type { ChatMessageProps } from "./types.ts";

export function ChatMessage({ role = "assistant", children }: ChatMessageProps) {
  return (
    <div className={cx("pm-msg", `pm-msg--${role}`)}>
      {role === "assistant" ? <span className="pm-msg__who">Play.Me</span> : null}
      <div className="pm-msg__body">{children}</div>
    </div>
  );
}
