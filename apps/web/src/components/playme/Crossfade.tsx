import { useState, type CSSProperties, type ReactNode } from "react";
import { cx } from "./cx.ts";

interface CrossfadeProps<T extends string> {
  value: T;
  className?: string;
  style?: CSSProperties;
  children: (value: T) => ReactNode;
}

/**
 * Troca com crossfade (200 ms, motion.css): quando `value` muda, a camada antiga desvanece enquanto a nova entra, e a antiga sai do DOM
 * no fim. Serve ao orb (muda de atividade) e ao ícone da pílula de ferramenta (muda de estado). O tamanho é de quem chama (className/style).
 * ponytail: uma camada saindo por vez; uma segunda troca dentro dos 200 ms corta a anterior. Com prefers-reduced-motion o index.css
 * deixa a animação em 0,01 ms, então o animationend ainda vem e a camada antiga sai na hora.
 */
export function Crossfade<T extends string>({ value, className, style, children }: CrossfadeProps<T>) {
  const [shown, setShown] = useState(value);
  const [leaving, setLeaving] = useState<T | null>(null);
  if (shown !== value) {
    // estado derivado durante o render (padrão do React): guarda o valor que sai e já renderiza o novo
    setShown(value);
    setLeaving(shown);
  }
  return (
    <span className={cx("pm-xfade", className)} style={style}>
      {leaving !== null && (
        <span
          key={leaving}
          className="pm-xfade__layer pm-xfade__layer--out"
          aria-hidden="true"
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget) setLeaving(null);
          }}
        >
          {children(leaving)}
        </span>
      )}
      <span key={value} className={cx("pm-xfade__layer", leaving !== null && "pm-xfade__layer--in")}>
        {children(value)}
      </span>
    </span>
  );
}
