import { cx } from "./cx.ts";
import { EnergyMeter } from "./EnergyMeter.tsx";
import { Icon } from "./Icon.tsx";
import { KeyBadge } from "./KeyBadge.tsx";
import { StatusTag } from "./StatusTag.tsx";
import type { TrackRowProps } from "./types.ts";

export function TrackRow({ index, title, artist, bpm, camelot, energy, estimated, state = "default", onClick, style }: TrackRowProps) {
  const className = cx("pm-row", `pm-row--${state}`);
  const cells = (
    <>
      <span className="pm-row__idx">{state === "playing" ? <Icon name="play" size={12} /> : index}</span>
      <span className="pm-row__main">
        <span className="pm-row__title">{title}</span>
        <span className="pm-row__artist">{artist}</span>
      </span>
      <span className="pm-row__bpm">{bpm != null ? bpm.toFixed(bpm % 1 ? 1 : 0) : "—"}</span>
      <KeyBadge camelot={camelot} />
      {energy != null ? <EnergyMeter value={energy} estimated={estimated} /> : <span className="pm-row__na">—</span>}
      {state === "pending" ? <StatusTag tone="warn">A validar</StatusTag> : null}
    </>
  );
  // Clicável = <button> nativo (foco e Enter/Espaço de graça); sem onClick segue a linha estática do bundle.
  return onClick ? (
    <button type="button" className={className} style={style} onClick={onClick}>
      {cells}
    </button>
  ) : (
    <div className={className} style={style} role="row">
      {cells}
    </div>
  );
}
