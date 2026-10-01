import { useId, type CSSProperties } from "react";
import type { SetArcProps } from "./types.ts";

const W = 600;
const H = 120;
const PAD = 16;
/** Energia 1–10 (o token `--energy-N` só existe nessa faixa). */
const level = (energy: number) => Math.min(10, Math.max(1, Math.round(energy)));

export function SetArc({ points, current, caption }: SetArcProps) {
  const gid = useId().replace(/[^\w-]/g, ""); // o id vai dentro de url(#…): sem os caracteres especiais do useId
  const n = points.length;
  if (!n) return null;
  const x = (i: number) => PAD + (n === 1 ? 0 : (i * (W - 2 * PAD)) / (n - 1));
  const y = (energy: number) => H - PAD - ((energy - 1) / 9) * (H - 2 * PAD);
  const line = points.map((q, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(q.energy).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)} ${H - PAD} L${x(0).toFixed(1)} ${H - PAD} Z`;
  // Energias novas = versão nova do set: a chave remonta o <g> e o traço é desenhado de novo em 400 ms (pm-draw, motion.css), com área e pontos em fade.
  const version = points.map((q) => level(q.energy)).join(",");
  return (
    <figure className="pm-arc">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Curva de energia do set">
        <defs>
          {/* cor como dado: o traço passa pelo energy-N de cada faixa. userSpaceOnUse: com energia igual em todas (linha reta) o bbox teria altura 0 e o gradiente sumiria */}
          <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={PAD} x2={W - PAD} y1={0} y2={0}>
            {points.map((q, i) => (
              <stop key={i} offset={n === 1 ? 0 : i / (n - 1)} style={{ stopColor: `var(--energy-${level(q.energy)})` }} />
            ))}
          </linearGradient>
        </defs>
        {[3, 5, 7, 9].map((e) => (
          <line key={e} className="pm-arc__grid" x1={PAD} x2={W - PAD} y1={y(e)} y2={y(e)} />
        ))}
        <g key={version}>
          <path className="pm-arc__area" d={area} />
          <path className="pm-arc__line" d={line} pathLength={1} style={{ stroke: `url(#${gid})` }} />
          {points.map((q, i) => (
            <circle
              key={i}
              cx={x(i)}
              cy={y(q.energy)}
              r={i === current ? 5 : 3.5}
              className={i === current ? "pm-arc__dot pm-arc__dot--now" : "pm-arc__dot"}
              // --t = onde o ponto está no traço (0–1): o fade entra junto com a ponta do traço
              style={{ "--t": n === 1 ? 0 : i / (n - 1), ...(i === current ? null : { fill: `var(--energy-${level(q.energy)})` }) } as CSSProperties}
            />
          ))}
        </g>
      </svg>
      {caption ? <figcaption className="pm-arc__cap">{caption}</figcaption> : null}
    </figure>
  );
}
