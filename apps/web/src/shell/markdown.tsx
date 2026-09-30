/**
 * Texto do agente como nós React: sem HTML cru e sem dependência. Só o que o agente usa de fato
 * (parágrafos, listas, títulos, **negrito** e `código`); a análise fica em text.ts (checável em Node).
 */
import type { ReactNode } from "react";
import { parseBlocks, parseInline } from "./text.ts";

function inline(src: string): ReactNode[] {
  return parseInline(src).map((t, i) =>
    t.kind === "bold" ? (
      <strong key={i} className="md-strong">
        {t.text}
      </strong>
    ) : t.kind === "code" ? (
      <code key={i} className="md-code">
        {t.text}
      </code>
    ) : (
      t.text
    ),
  );
}

const items = (list: string[]): ReactNode[] => list.map((t, i) => <li key={i}>{inline(t)}</li>);

export function renderMarkdown(text: string): ReactNode {
  return parseBlocks(text).map((b, i) => {
    switch (b.kind) {
      case "h":
        return (
          <h3 key={i} className="title-3 md-text">
            {inline(b.text)}
          </h3>
        );
      case "p":
        return (
          <p key={i} className="md-text md-p">
            {inline(b.text)}
          </p>
        );
      case "ul":
        return (
          <ul key={i} className="md-text md-list">
            {items(b.items)}
          </ul>
        );
      case "ol":
        return (
          <ol key={i} className="md-text md-list" start={b.start}>
            {items(b.items)}
          </ol>
        );
    }
  });
}
