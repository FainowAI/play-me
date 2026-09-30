import { cx } from "./cx.ts";
import { Icon } from "./Icon.tsx";
import type { ButtonProps } from "./types.ts";

export function Button({ variant = "outline", size = "md", icon, label, type = "button", disabled, title, className, onClick, children }: ButtonProps) {
  return (
    <button type={type} className={cx("pm-btn", `pm-btn--${variant}`, `pm-btn--${size}`, className)} disabled={disabled} onClick={onClick} aria-label={label} title={title}>
      {icon ? <Icon name={icon} size={size === "sm" ? 14 : 16} /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}
