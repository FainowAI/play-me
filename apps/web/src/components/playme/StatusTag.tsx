import { cx } from "./cx.ts";
import { Icon } from "./Icon.tsx";
import type { IconName, StatusTagProps, Tone } from "./types.ts";

/** Todo estado tem ícone + palavra (DESIGN.md §2): neutral fica só com o texto. */
const ICON: Partial<Record<Tone, IconName>> = { ok: "check", info: "arrow", warn: "alert", danger: "alert" };

export function StatusTag({ tone = "neutral", children }: StatusTagProps) {
  const icon = ICON[tone];
  return (
    <span className={cx("pm-tag", `pm-tag--${tone}`)}>
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}
