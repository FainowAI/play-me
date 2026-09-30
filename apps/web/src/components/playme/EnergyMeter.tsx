import { cx } from "./cx.ts";
import type { EnergyMeterProps } from "./types.ts";

const SEGMENTS = Array.from({ length: 10 }, (_, i) => i + 1);

export function EnergyMeter({ value, estimated, showNumber }: EnergyMeterProps) {
  const v = Math.max(0, Math.min(10, Math.round(value || 0)));
  return (
    <span className={cx("pm-energy", estimated && "pm-energy--est")} role="meter" aria-valuemin={1} aria-valuemax={10} aria-valuenow={v} aria-label={`Energia ${v} de 10`}>
      <span className="pm-energy__track">
        {SEGMENTS.map((n) => (
          <i key={n} className="pm-energy__seg" style={n <= v ? { background: `var(--energy-${n})` } : undefined} />
        ))}
      </span>
      {showNumber === false ? null : <span className="pm-energy__num">{`E${v}${estimated ? "*" : ""}`}</span>}
    </span>
  );
}
