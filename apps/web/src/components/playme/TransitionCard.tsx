import { signed } from "../../setview.ts";
import { cx } from "./cx.ts";
import { Icon } from "./Icon.tsx";
import { KeyBadge } from "./KeyBadge.tsx";
import { PhraseBar } from "./PhraseBar.tsx";
import { StatusTag } from "./StatusTag.tsx";
import type { TrackRef, TransitionCardProps } from "./types.ts";

function Side({ deck, track }: { deck: "a" | "b"; track: TrackRef }) {
  return (
    <div className="pm-trans__track">
      <span className={`pm-deck pm-deck--${deck}`}>{deck.toUpperCase()}</span>
      <div>
        <div className="pm-trans__title">{track.title}</div>
        <div className="pm-trans__meta">{`${track.bpm} BPM`}</div>
      </div>
      <KeyBadge camelot={track.camelot} />
    </div>
  );
}

export function TransitionCard({ index, trackA, trackB, relation, deltaBpm, deltaEnergy, type, lengthBars, exitAt, entryAt, aSections, bSections, reason, onClick }: TransitionCardProps) {
  // ponytail: role=button + teclado à mão porque o card carrega texto longo (<button> nativo não cabe);
  // clicável vira <div> (article não aceita role=button no axe); se ganhar filho focável, <button> esticado por cima.
  const Tag: "div" | "article" = onClick ? "div" : "article";
  return (
    <Tag
      className={cx("pm-trans", onClick && "pm-trans--link")}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick &&
        ((e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault(); // Espaço não rola a página
            onClick();
          }
        })
      }
    >
      <header className="pm-trans__head">
        <span className="label pm-trans__eyebrow">{`Transição ${index ?? ""}`}</span>
        <StatusTag tone={relation.tone}>{relation.label}</StatusTag>
      </header>
      <div className="pm-trans__pair">
        <Side deck="a" track={trackA} />
        <Icon name="arrow" size={18} className="pm-trans__arrow" />
        <Side deck="b" track={trackB} />
      </div>
      <dl className="pm-trans__stats">
        <div>
          <dt>ΔBPM</dt>
          <dd>{signed(deltaBpm)}</dd>
        </div>
        <div>
          <dt>ΔEnergia</dt>
          <dd>{deltaEnergy === null ? "—" : signed(deltaEnergy)}</dd>
        </div>
        <div>
          <dt>Tipo</dt>
          <dd>{type}</dd>
        </div>
        <div>
          <dt>Duração</dt>
          <dd>{`${lengthBars} c.`}</dd>
        </div>
      </dl>
      {aSections ? <PhraseBar deck="a" label={trackA.title} sections={aSections} exitAt={exitAt} /> : null}
      {bSections ? <PhraseBar deck="b" label={trackB.title} sections={bSections} entryAt={entryAt} /> : null}
      {reason ? <p className="pm-trans__reason">{reason}</p> : null}
    </Tag>
  );
}
