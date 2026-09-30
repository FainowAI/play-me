import { Button } from "./Button.tsx";
import type { ApprovalGateProps } from "./types.ts";

export function ApprovalGate({ playlistName, trackCount, duration, onApprove, onReview, disabled }: ApprovalGateProps) {
  return (
    <section className="pm-gate" aria-label="Aprovação">
      <div className="pm-gate__head">
        <span className="label">Aprovação necessária</span>
        <h3 className="title-3">{`Criar ${playlistName}`}</h3>
      </div>
      <p className="pm-gate__text">{`Nova playlist privada no Spotify com ${trackCount} faixas nesta ordem${duration ? ` (${duration})` : ""}. A playlist original não muda.`}</p>
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
