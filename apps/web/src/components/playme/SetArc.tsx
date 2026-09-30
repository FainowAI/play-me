import type { SetArcProps } from "./types.ts";

const W = 600;
const H = 120;
const PAD = 16;

export function SetArc({ points, current, caption }: SetArcProps) {
  const n = points.length;
  if (!n) return null;
  const x = (i: number) => PAD + (n === 1 ? 0 : (i * (W - 2 * PAD)) / (n - 1));
  const y = (energy: number) => H - PAD - ((energy - 1) / 9) * (H - 2 * PAD);
  const line = points.map((q, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(q.energy).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)} ${H - PAD} L${x(0).toFixed(1)} ${H - PAD} Z`;
  return (
    <figure className="pm-arc">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Curva de energia do set">
        {[3, 5, 7, 9].map((e) => (
          <line key={e} className="pm-arc__grid" x1={PAD} x2={W - PAD} y1={y(e)} y2={y(e)} />
        ))}
        <path className="pm-arc__area" d={area} />
        <path className="pm-arc__line" d={line} />
        {points.map((q, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(q.energy)}
            r={i === current ? 5 : 3.5}
            className={i === current ? "pm-arc__dot pm-arc__dot--now" : "pm-arc__dot"}
            style={i === current ? undefined : { fill: `var(--energy-${Math.round(q.energy)})` }}
          />
        ))}
      </svg>
      {caption ? <figcaption className="pm-arc__cap">{caption}</figcaption> : null}
    </figure>
  );
}
