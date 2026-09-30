import { useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Button, CamelotWheel, EnergyMeter, KeyBadge, StatusTag } from "../components/playme/index.ts";
import type { Tone } from "../components/playme/index.ts";
import { compatibleKeys, sectionLabel } from "../setview.ts";
import { splitLabel } from "../state.ts";
import type { SnapshotTrack } from "../types.ts";
import { bpmText, correctionMessage, parseCorrection } from "./logic.ts";
import type { CorrectionErrors } from "./logic.ts";
import type { TrackDrawerProps } from "./types.ts";

/** Linha "BPM e tom": o que a origem do dado diz (contract.md, tela 7). `web` = ReccoBeats; null = sem entrada no store do MCP. */
function bpmKeySource(source: string | null): { text: string; tone: Tone; tag: string } {
  if (source === null) return { text: "Sem dado no store", tone: "danger", tag: "Pendente" };
  if (source === "web") return { text: "ReccoBeats · BPM conferido; tom a validar no Mixar", tone: "warn", tag: "A validar" };
  return { text: "Mixar do Spotify (ou correção sua) · nunca sobrescrito", tone: "ok", tag: "Conferido" };
}

function Source({ name, text, children }: { name: string; text: string; children?: ReactNode }) {
  return (
    <div>
      <dt>{name}</dt>
      <dd>
        <span className="pn-src__text">{text}</span>
        {children}
      </dd>
    </div>
  );
}

/** Correção manual: valida BPM, tom e energia e pede ao agente que grave com fonte "manual". */
function CorrectionForm({ track, title, onSend, onClose }: { track: SnapshotTrack; title: string; onSend: (message: string) => void; onClose: () => void }) {
  const uid = useId();
  const [bpm, setBpm] = useState(String(track.bpm));
  const [tom, setTom] = useState(track.camelot);
  // ponytail: energia estimada (derivada da ReccoBeats) não vira valor inicial: corrigir só o BPM não deve gravá-la como manual
  const [energy, setEnergy] = useState(track.energy === null || track.energy_estimated ? "" : String(track.energy));
  const [tried, setTried] = useState(false);
  const parsed = parseCorrection({ bpm, key: tom, energy });
  // os erros só aparecem depois da primeira tentativa e somem assim que o campo fica válido
  const errors: CorrectionErrors = tried && !parsed.ok ? parsed.errors : {};
  const fields = [
    { id: "bpm", label: "BPM", value: bpm, set: setBpm, error: errors.bpm, mode: "decimal" },
    { id: "tom", label: "Tom", value: tom, set: setTom, error: errors.key, mode: "text" },
    { id: "energia", label: "Energia", value: energy, set: setEnergy, error: errors.energy, mode: "decimal" },
  ] as const;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!parsed.ok) {
      setTried(true);
      return;
    }
    onSend(correctionMessage(title, track.track_id, parsed.value));
    onClose();
  };

  return (
    <form className="pn-form" noValidate aria-labelledby={`${uid}-h`} onSubmit={submit}>
      <span id={`${uid}-h`} className="label">
        Correção manual
      </span>
      <div className="pn-fields">
        {fields.map((f) => (
          <div key={f.id} className="pn-field">
            <label htmlFor={`${uid}-${f.id}`}>{f.label}</label>
            <input
              id={`${uid}-${f.id}`}
              className="pn-input"
              value={f.value}
              inputMode={f.mode}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={f.error ? true : undefined}
              aria-describedby={f.error ? `${uid}-${f.id}-erro` : undefined}
              onChange={(e) => f.set(e.target.value)}
            />
            {f.error ? (
              <span id={`${uid}-${f.id}-erro`} className="pn-error">
                {f.error}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <div className="pn-actions">
        <Button variant="primary" size="sm" type="submit">
          Salvar correção
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/**
 * Gaveta da faixa (520 px): números, origem de cada dado, tons que combinam e correção manual.
 * Devolve só os blocos: padding e gap do miolo são do Overlay da shell.
 */
export function TrackDrawer({ version, trackId, onClose, onSend }: TrackDrawerProps) {
  const order = version.snapshot?.order ?? [];
  const i = order.findIndex((x) => x.track_id === trackId);
  const t = order[i];
  if (!t) {
    return (
      <header className="pn-win__head">
        <div className="pn-win__titles">
          <h2 className="title-2 pn-h2">Faixa</h2>
          <p className="pn-lead">Faixa fora desta versão.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Fechar
        </Button>
      </header>
    );
  }

  const { title, artist } = splitLabel(t.label);
  const src = bpmKeySource(t.source);
  const compatible = compatibleKeys(t.camelot);
  const before = order[i - 1];
  const after = order[i + 1];
  const around = `${before ? `${splitLabel(before.label).title} antes` : "primeira do set"}, ${after ? `${splitLabel(after.label).title} depois` : "última do set"}`;

  return (
    <>
      <header className="pn-win__head">
        <div className="pn-win__titles">
          <span className="label">{`Faixa ${t.position} · ${sectionLabel(t.section).toLowerCase()}`}</span>
          <h2 className="title-2 pn-h2">{title}</h2>
          {artist ? <span className="pn-deck__artist">{artist}</span> : null}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Fechar
        </Button>
      </header>
      <div className="pn-figure">
        <span className="data-xl mono">
          {bpmText(t.bpm)}
          <span className="pn-unit"> BPM</span>
        </span>
        <KeyBadge camelot={t.camelot} size="lg" />
        {t.energy !== null ? <EnergyMeter value={t.energy} estimated /> : <span className="mono pn-dash">—</span>}
      </div>
      <dl className="pn-src">
        <Source name="BPM e tom" text={src.text}>
          <StatusTag tone={src.tone}>{src.tag}</StatusTag>
        </Source>
        {t.energy !== null ? (
          <Source name="Energia" text={t.energy_estimated ? "Estimativa da ReccoBeats (0–1 → 1–10)" : "Estimativa; energy da ReccoBeats de apoio"}>
            <StatusTag tone="neutral">Estimado</StatusTag>
          </Source>
        ) : (
          <Source name="Energia" text="—" />
        )}
        <Source name="Arquivo" text="Opcional · só para estrutura por compasso">
          <Button variant="outline" size="sm" disabled title="trilha opcional">
            Escolher arquivo
          </Button>
        </Source>
      </dl>
      <div className="pn-dashed pn-dashed--tight">
        <div className="pn-dashed__text">
          <span className="label">Estrutura · trilha opcional</span>
          <p className="pn-lead">Sem arquivo, o plano usa BPM, tom e energia. O Mix do Spotify alinha as batidas na hora.</p>
        </div>
      </div>
      <div className="pn-keys">
        <CamelotWheel active={t.camelot} compatible={compatible} size={152} />
        <div className="pn-keys__side">
          <span className="label">Combina com</span>
          <div className="pn-badges">
            {compatible.map((k) => (
              <KeyBadge key={k} camelot={k} />
            ))}
          </div>
          <p className="pn-lead">{`No set: ${around}.`}</p>
        </div>
      </div>
      <CorrectionForm key={t.track_id} track={t} title={title} onSend={onSend} onClose={onClose} />
    </>
  );
}
