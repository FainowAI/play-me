import { cx, parseKey } from "./cx.ts";
import type { KeyBadgeProps } from "./types.ts";

export function KeyBadge({ camelot, size }: KeyBadgeProps) {
  const id = parseKey(camelot);
  if (!id) {
    return (
      <span className="pm-key pm-key--none" title="Tom sem dado">
        —
      </span>
    );
  }
  return (
    <span className={cx("pm-key", size === "lg" && "pm-key--lg")} style={{ background: `var(--key-${id})` }} title={`Camelot ${id} · ${id.endsWith("A") ? "menor" : "maior"}`}>
      {id}
    </span>
  );
}
