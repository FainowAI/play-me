import { cx } from "./cx.ts";
import type { PhraseBarProps, SectionType } from "./types.ts";

const SECTION: Record<SectionType, string> = { intro: "Intro", groove: "Groove", build: "Build", drop: "Drop", break: "Break", outro: "Outro" };

export function PhraseBar({ sections, deck, label, exitAt, entryAt }: PhraseBarProps) {
  const total = sections.reduce((sum, s) => sum + s.bars, 0) || 1;
  let at = 0; // compasso em que a seção atual termina: o título de cada segmento diz "c.início–fim"
  const mark = (bar: number | undefined, kind: "out" | "in") => {
    if (bar == null) return null;
    const pct = ((bar - 1) / total) * 100;
    return (
      <span
        className={cx("pm-phrase__mark", `pm-phrase__mark--${kind}`, pct < 8 && "pm-phrase__mark--edge-start", pct > 92 && "pm-phrase__mark--edge-end")}
        style={{ left: `${pct}%` }}
      >
        <b>{`${kind === "out" ? "sai c." : "entra c."}${bar}`}</b>
      </span>
    );
  };
  return (
    <div className="pm-phrase">
      {label ? (
        <div className="pm-phrase__head">
          <span className={cx("pm-deck", deck && `pm-deck--${deck}`)}>{deck ? deck.toUpperCase() : ""}</span>
          <span className="pm-phrase__name">{label}</span>
          <span className="pm-phrase__bars">{`${total} compassos`}</span>
        </div>
      ) : null}
      <div className="pm-phrase__track">
        {sections.map((s, i) => {
          const start = at + 1;
          at += s.bars;
          return (
            <span
              key={i}
              className={cx("pm-phrase__seg", s.vocal && "pm-phrase__seg--vocal")}
              style={{ flexGrow: s.bars, background: `var(--section-${s.type})` }}
              title={`${SECTION[s.type]} · c.${start}–${at}${s.vocal ? " · vocal" : ""}`}
            >
              {s.bars >= 8 ? SECTION[s.type] : ""}
            </span>
          );
        })}
        {mark(exitAt, "out")}
        {mark(entryAt, "in")}
      </div>
    </div>
  );
}
