import { cx } from "./cx.ts";
import type { IconName, IconProps } from "./types.ts";

/** Grade de 24 px, traço 1.75, pontas redondas (geometria Lucide). */
const PATH: Record<IconName, string> = {
  play: "M7 5l12 7-12 7z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  arrow: "M4 12h15M13 6l6 6-6 6",
  send: "M12 19V5M6 11l6-6 6 6",
  plus: "M12 5v14M5 12h14",
  alert: "M12 8v5M12 16.5v.5M10.3 3.9L2.6 17.5A2 2 0 004.3 20.5h15.4a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z",
  tool: "M14.7 6.3a4 4 0 00-5.2 5.2L4 17v3h3l5.5-5.5a4 4 0 005.2-5.2l-2.4 2.4-2.5-.6-.6-2.5z",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  wave: "M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2",
  close: "M6 6l12 12M18 6L6 18",
};

export function Icon({ name, size = 16, className }: IconProps) {
  return (
    <svg
      className={cx("pm-icon", className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={name === "play" ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATH[name]} />
    </svg>
  );
}
