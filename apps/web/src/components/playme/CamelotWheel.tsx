import { cx, parseKey } from "./cx.ts";
import type { CamelotWheelProps } from "./types.ts";

const S = 240;
const C = S / 2;
/** Anéis: B por fora, A por dentro (raio interno, raio externo). */
const RINGS = [
  ["B", 82, 116],
  ["A", 46, 80],
] as const;
const POSITIONS = Array.from({ length: 12 }, (_, i) => i);

/** Setor do anel entre r0 e r1 para a posição i (0..11, o 12 no topo), com uma folga entre vizinhos. */
function arc(r0: number, r1: number, i: number): string {
  const gap = 0.02;
  const a0 = ((i * 30 - 105) * Math.PI) / 180 + gap;
  const a1 = (((i + 1) * 30 - 105) * Math.PI) / 180 - gap;
  const at = (r: number, a: number) => `${(C + r * Math.cos(a)).toFixed(2)} ${(C + r * Math.sin(a)).toFixed(2)}`;
  return `M${at(r1, a0)} A${r1} ${r1} 0 0 1 ${at(r1, a1)} L${at(r0, a1)} A${r0} ${r0} 0 0 0 ${at(r0, a0)}Z`;
}

export function CamelotWheel({ active, compatible = [], size = S }: CamelotWheelProps) {
  const act = parseKey(active);
  return (
    <svg className="pm-wheel" viewBox={`0 0 ${S} ${S}`} width={size} height={size} role="img" aria-label={`Roda Camelot${act ? `, tom ativo ${act}` : ""}`}>
      {POSITIONS.flatMap((i) =>
        RINGS.map(([ab, r0, r1]) => {
          const id = `${i + 1}${ab}`;
          const on = act === id;
          const near = compatible.includes(id);
          const mid = ((i * 30 - 90) * Math.PI) / 180;
          const rr = (r0 + r1) / 2;
          return (
            <g key={id} className={cx("pm-wheel__seg", on && "is-active", near && "is-near", act && !on && !near && "is-dim")}>
              <path d={arc(r0, r1, i)} style={{ fill: `var(--key-${id})` }} />
              <text x={C + rr * Math.cos(mid)} y={C + rr * Math.sin(mid)} textAnchor="middle" dominantBaseline="central">
                {id}
              </text>
            </g>
          );
        }),
      )}
      {act ? (
        <text className="pm-wheel__center" x={C} y={C} textAnchor="middle" dominantBaseline="central">
          {act}
        </text>
      ) : null}
    </svg>
  );
}
