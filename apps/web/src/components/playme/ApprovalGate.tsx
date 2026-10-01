import { Button } from "./Button.tsx";
import type { ApprovalGateProps } from "./types.ts";

const SHOWN = 5; // faixas listadas; o resto vira "e mais N"

export function ApprovalGate({ playlistName, trackCount, duration, tracks, onApprove, onReview, disabled }: ApprovalGateProps) {
  const shown = tracks?.slice(0, SHOWN) ?? [];
  const more = trackCount - shown.length;
  return (
    <section className="pm-gate" aria-label="Aprovação">
      <div className="pm-gate__head">
        <span className="label">Aprovação necessária</span>
        <h3 className="title-3">{`Criar ${playlistName}`}</h3>
      </div>
      <p className="pm-gate__text">{`Nova playlist privada no Spotify com ${trackCount} faixas nesta ordem${duration ? ` (${duration})` : ""}. A playlist original não muda.`}</p>
      {shown.length > 0 && (
        <ol className="pm-gate__list">
          {shown.map((title, i) => (
            <li key={i}>
              <span className="mono" aria-hidden="true">
                {i + 1}
              </span>
              <span>{title}</span>
            </li>
          ))}
          {more > 0 && <li className="pm-gate__text">{`e mais ${more}`}</li>}
        </ol>
      )}
      <div className="pm-gate__actions">
        {/* único botão signal do sistema (DESIGN.md §8) */}
        <Button variant="signal" icon="check" onClick={onApprove} disabled={disabled}>
          Aprovar e criar
        </Button>
        <Button variant="ghost" onClick={onReview} disabled={disabled}>
          Revisar ordem
        </Button>
      </div>
    </section>
  );
}
