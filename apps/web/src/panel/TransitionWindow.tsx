import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api.ts";
import { Button, CamelotWheel, EnergyMeter, KeyBadge, StatusTag } from "../components/playme/index.ts";
import { HARMONIC_TONE, TYPE_LABEL, compatibleKeys, relationLabel, sectionLabel, signed } from "../setview.ts";
import { splitLabel } from "../state.ts";
import type { SnapshotTrack } from "../types.ts";
import { bpmText } from "./logic.ts";
import type { TransitionWindowProps } from "./types.ts";

/** Deck A (sai) ou B (entra): título, artista, BPM em destaque, tom e energia estimada. */
function Deck({ deck, track }: { deck: "a" | "b"; track: SnapshotTrack }) {
  const { title, artist } = splitLabel(track.label);
  const role = deck === "a" ? "sai" : "entra";
  return (
    <div className="pn-deck">
      <span className={`pm-deck pm-deck--${deck}`}>{deck.toUpperCase()}</span>
      <div className="pn-deck__main">
        <span className="pn-deck__title">{title}</span>
        <span className="pn-deck__artist">{artist ? `${artist} · ${role}` : role}</span>
      </div>
      <div className="pn-deck__data">
        <span className="data-xl mono">
          {bpmText(track.bpm)}
          <span className="pn-unit"> BPM</span>
        </span>
        <div className="pn-deck__meta">
          <KeyBadge camelot={track.camelot} />
          {track.energy !== null ? <EnergyMeter value={track.energy} estimated /> : <span className="mono pn-dash">—</span>}
        </div>
      </div>
    </div>
  );
}

/**
 * Passagem N → N+1 (gaveta de 820 px): decks, números do plano, guia do Mix e ações.
 * Devolve só os blocos: padding e gap do miolo são do Overlay da shell.
 */
export function TransitionWindow({ version, position, onClose, onSend, onRate }: TransitionWindowProps) {
  const [saving, setSaving] = useState(false); // nota em gravação: os cinco botões ficam desabilitados
  const [error, setError] = useState<string | null>(null);
  const ratingRef = useRef<HTMLDivElement>(null);
  const clicked = useRef<number | null>(null);
  // ponytail: desabilitar o botão clicado tira o foco dele (teclado e leitor de tela perderiam o lugar): devolve ao terminar de gravar
  useEffect(() => {
    if (saving || clicked.current === null) return;
    ratingRef.current?.querySelectorAll("button")[clicked.current - 1]?.focus(); // os cinco primeiros botões da linha são as notas 1 a 5
    clicked.current = null;
  }, [saving]);
  const row = version.plans.find((p) => p.position === position);
  const a = version.snapshot?.order[position - 1];
  const b = version.snapshot?.order[position];
  if (!row || !a || !b) {
    return (
      <header className="pn-win__head">
        <div className="pn-win__titles">
          <h2 className="title-2 pn-h2">{`Transição ${position} → ${position + 1}`}</h2>
          <p className="pn-lead">Passagem sem plano nesta versão.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Fechar
        </Button>
      </header>
    );
  }

  const plan = row.plan;
  const rated = row.feedback?.rating; // a última nota gravada: o plano volta com ela quando a shell relê o set
  const guide = version.guide[position - 1];
  const rel = relationLabel(plan);
  const titleA = splitLabel(a.label).title;
  const titleB = splitLabel(b.label).title;
  const stats: [string, string][] = [
    ["Tipo", TYPE_LABEL[plan.type] ?? plan.type],
    ["Duração", `${plan.length_bars} c.`],
    ["Harmonia", `${plan.harmonic.from} → ${plan.harmonic.to}`],
    ["ΔBPM", signed(Math.round(plan.tempo.to_bpm - plan.tempo.from_bpm))],
    ["ΔEnergia", plan.energy_delta === null ? "—" : signed(plan.energy_delta)],
  ];

  const rate = async (n: number) => {
    clicked.current = n;
    setSaving(true);
    setError(null);
    try {
      await onRate(row.id, n);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Servidor local não respondeu.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <header className="pn-win__head">
        <div className="pn-win__titles">
          <span className="label">{`Transição ${position} → ${position + 1} · ${sectionLabel(a.section).toLowerCase()} → ${sectionLabel(b.section).toLowerCase()} · plano por metadados`}</span>
          <h2 className="title-2 pn-h2">{`${titleA} → ${titleB}`}</h2>
        </div>
        <StatusTag tone={rel.tone}>{rel.label}</StatusTag>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Fechar
        </Button>
      </header>
      <div className="pn-decks">
        <Deck deck="a" track={a} />
        <Deck deck="b" track={b} />
      </div>
      <dl className="pn-stats">
        {stats.map(([name, value]) => (
          <div key={name}>
            <dt className="label">{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="pn-dashed">
        <div className="pn-dashed__text">
          <span className="label">Estrutura por compasso · trilha opcional</span>
          <p className="pn-lead">
            Sem arquivo, o plano não marca o compasso de saída de A nem o de entrada de B. O Mix do Spotify alinha as batidas; você escolhe o ponto ouvindo.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled title="trilha de áudio opcional, pós-MVP">
          Casar arquivos
        </Button>
      </div>
      <div className="pn-lower">
        <div className="pn-col">
          <div className="pn-guide-card">
            <span className="label">Guia do Mix</span>
            <p>{guide?.text ?? "Guia indisponível para esta passagem."}</p>
          </div>
          <div className="pn-tags">
            <StatusTag tone={HARMONIC_TONE[plan.harmonic.class]}>{`Harmonia ${plan.harmonic.class} · ${plan.harmonic.relation}`}</StatusTag>
            {plan.alerts.map((alert, i) => (
              <StatusTag key={i} tone="warn">
                {alert}
              </StatusTag>
            ))}
            {plan.alerts.some((x) => /vocal/i.test(x)) ? null : <StatusTag tone="neutral">Vocal e grave: sem dado</StatusTag>}
            {plan.energy_delta !== null && plan.energy_delta <= -3 ? <StatusTag tone="ok">Respiro depois do clímax</StatusTag> : null}
          </div>
          <div className="pn-rating" ref={ratingRef}>
            <span className="label">{rated ? `Sua nota · ${rated}` : "Sua nota"}</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <Button key={n} variant={n === rated ? "primary" : "outline"} size="sm" className="pn-mono" label={n === rated ? `Nota ${n}, atual` : `Nota ${n}`} disabled={saving} onClick={() => void rate(n)}>
                {n}
              </Button>
            ))}
            {saving ? <span className="pn-note">Salvando</span> : null}
            {error ? (
              <span role="alert">
                <StatusTag tone="danger">{error}</StatusTag>
              </span>
            ) : null}
            <span className="pn-grow" />
            <Button variant="outline" size="sm" onClick={() => onSend(`Troca a faixa ${position + 1} por outra que encaixe.`)}>
              Trocar B
            </Button>
            <Button variant="ghost" size="sm" icon="play" disabled>
              Prévia · pós-MVP
            </Button>
          </div>
        </div>
        <CamelotWheel active={a.camelot} compatible={compatibleKeys(a.camelot)} size={176} />
      </div>
    </>
  );
}
