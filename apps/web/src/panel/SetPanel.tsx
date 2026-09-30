import "./panel.css";
import { Fragment, useId } from "react";
import type { KeyboardEvent } from "react";
import { Button, KeyBadge, SetArc, StatusTag, ThinkingStatus, TrackRow, TransitionCard } from "../components/playme/index.ts";
import type { Tone } from "../components/playme/index.ts";
import { groupBySection, relationLabel, transitionCard, splitProblems } from "../setview.ts";
import { splitLabel } from "../state.ts";
import type { PanelTab } from "../state.ts";
import type { SetSnapshot, SetStatus, SetVersionDetail, SnapshotTrack } from "../types.ts";
import { arcCaption, arcPoints, metaLine } from "./logic.ts";
import type { SetPanelProps } from "./types.ts";

const SET_TAG: Record<SetStatus, { tone: Tone; label: string }> = {
  rascunho: { tone: "neutral", label: "Rascunho" },
  aguardando_aprovacao: { tone: "warn", label: "Aguardando aprovação" },
  enviado: { tone: "ok", label: "Enviado ao Spotify" },
};

// versões criadas pelo gate de envio chegam sem planos, guia e transições (handoff do servidor)
const NO_PLANS = "Sem planos nesta versão; peça um novo set ou uma avaliação da ordem.";

const TABS: { id: PanelTab; label: string }[] = [
  { id: "ordem", label: "Ordem" },
  { id: "transicoes", label: "Transições" },
  { id: "guia", label: "Guia do Mix" },
];

/** Painel do set (400 px): cabeçalho com versão e abas, corpo rolável, rodapé com as faixas fora do set. */
export function SetPanel({ set, version, busy, tab, onTab, onVersion, onOpenTransition, onOpenTrack, onClose }: SetPanelProps) {
  const uid = useId();
  const tabId = (id: PanelTab) => `${uid}-tab-${id}`;
  const snap = version.snapshot;
  const latest = set.versions[set.versions.length - 1]?.version ?? version.version;
  const tag = SET_TAG[set.set.status];
  const meta = snap ? metaLine(snap) : `${version.order.length} faixas`;

  // ponytail: a seta troca e ativa a aba (ativação automática, sem modo manual); Home e End vão às pontas.
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = TABS.length - 1;
    const to = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    const next = to === null ? undefined : TABS[to];
    if (!next) return;
    e.preventDefault();
    onTab(next.id);
    document.getElementById(tabId(next.id))?.focus();
  };

  return (
    <aside aria-label="Painel do set" className="pn-panel">
      <header className="pn-head">
        <div className="pn-head__top">
          <span className="pn-head__set">
            <span className="label">Set ·</span>
            <span className="pn-ver">
              <select aria-label="Versão do set" value={version.version} onChange={(e) => onVersion(Number(e.target.value) === latest ? null : Number(e.target.value))}>
                {set.versions.map((v) => (
                  <option key={v.id} value={v.version}>
                    {`V${v.version}`}
                  </option>
                ))}
              </select>
            </span>
          </span>
          {busy ? <ThinkingStatus activity="composing" verb="Recalculando" /> : null}
          {version.version !== latest ? <StatusTag tone="neutral">versão anterior</StatusTag> : null}
          <StatusTag tone={tag.tone}>{tag.label}</StatusTag>
          {onClose ? (
            <Button variant="ghost" size="sm" icon="close" onClick={onClose}>
              Fechar
            </Button>
          ) : null}
        </div>
        <h2 className="title-2 pn-title">{set.set.name}</h2>
        <div className="pn-meta">{meta}</div>
        {snap ? (
          <div role="tablist" aria-label="Visões do set" className="pn-tabs">
            {TABS.map((t, i) => (
              <button
                key={t.id}
                id={tabId(t.id)}
                type="button"
                role="tab"
                className="pn-tab"
                aria-selected={t.id === tab}
                aria-controls={`${uid}-panel`}
                tabIndex={t.id === tab ? 0 : -1}
                onClick={() => onTab(t.id)}
                onKeyDown={(e) => onTabKey(e, i)}
              >
                {t.label}
              </button>
            ))}
          </div>
        ) : null}
      </header>
      <div id={`${uid}-panel`} className="pn-body" role={snap ? "tabpanel" : undefined} aria-labelledby={snap ? tabId(tab) : undefined} tabIndex={0}>
        {!snap ? (
          <Legacy ids={version.order} />
        ) : tab === "ordem" ? (
          <Order order={snap.order} onOpenTrack={onOpenTrack} />
        ) : tab === "transicoes" ? (
          <Transitions version={version} onOpenTransition={onOpenTransition} />
        ) : (
          <Guide version={version} />
        )}
      </div>
      {snap ? <Pending {...splitProblems(version)} /> : null}
    </aside>
  );
}

/** Versão antiga do banco, sem snapshot: só os ids. */
function Legacy({ ids }: { ids: string[] }) {
  return (
    <>
      <p className="pn-lead">Versão sem dados de faixa; peça um novo set.</p>
      <ul className="pn-ids mono">
        {ids.map((id) => (
          <li key={id}>{id}</li>
        ))}
      </ul>
    </>
  );
}

function Order({ order, onOpenTrack }: { order: SnapshotTrack[]; onOpenTrack: (trackId: string) => void }) {
  return (
    <>
      <SetArc points={arcPoints(order)} caption={arcCaption(order)} />
      <div className="pn-rows">
        {groupBySection(order).map((g, gi) => (
          <Fragment key={`${g.name}-${gi}`}>
            <div className="label pn-sec">{g.name}</div>
            {g.tracks.map((t) => {
              const { title, artist } = splitLabel(t.label);
              // ponytail: a mesma faixa pode repetir na playlist; a chave e o nome da view transition levam a posição
              const nth = order.slice(0, t.position - 1).filter((o) => o.track_id === t.track_id).length;
              return (
                <TrackRow
                  key={`${t.track_id}-${t.position}`}
                  index={t.position}
                  title={title}
                  artist={artist}
                  bpm={t.bpm}
                  camelot={t.camelot}
                  energy={t.energy}
                  estimated
                  state={t.key_review ? "pending" : "default"}
                  onClick={() => onOpenTrack(t.track_id)}
                  style={{ viewTransitionName: `track-${t.track_id}${nth ? `-${nth}` : ""}` }}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
    </>
  );
}

function Transitions({ version, onOpenTransition }: { version: SetVersionDetail; onOpenTransition: (position: number) => void }) {
  const cards = version.plans.flatMap((p) => {
    const card = transitionCard(version, p.position);
    return card ? [{ position: p.position, card }] : [];
  });
  if (cards.length === 0) return <p className="pn-lead">{NO_PLANS}</p>;
  return (
    <ol className="pn-cards">
      {cards.map(({ position, card }) => (
        <li key={position}>
          <TransitionCard {...card} onClick={() => onOpenTransition(position)} />
        </li>
      ))}
    </ol>
  );
}

function Guide({ version }: { version: SetVersionDetail }) {
  if (version.guide.length === 0) return <p className="pn-lead">{NO_PLANS}</p>;
  return (
    <>
      <p className="pn-lead">Aplique no Mix do app do Spotify, passagem por passagem. O beatgrid do Spotify pode divergir em até 1 compasso.</p>
      <ol className="pn-guide">
        {version.guide.map((g, i) => {
          const plan = version.plans[i]?.plan; // guia e planos vêm na mesma ordem (contract.md)
          const rel = plan ? relationLabel(plan) : null;
          const bass = plan?.bass_swap_bar;
          const mix = [g.preset, `${g.length_bars} c.`, typeof bass === "number" ? `grave troca no c.${bass}` : ""].filter(Boolean).join(" · ");
          return (
            <li key={g.position} className="pn-step">
              <div className="pn-step__row">
                <span className="pn-step__pos">{g.position}</span>
                <span className="pn-step__pair">{`${splitLabel(g.from_label).title} → ${splitLabel(g.to_label).title}`}</span>
                <KeyBadge camelot={plan?.harmonic.from ?? null} />
                <KeyBadge camelot={plan?.harmonic.to ?? null} />
              </div>
              <div className="pn-step__row">
                {rel ? <StatusTag tone={rel.tone}>{rel.label}</StatusTag> : null}
                <span className="pn-step__mix">{mix}</span>
              </div>
              <p className="pn-step__text">{g.text}</p>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/**
 * Rodapé: faixas fora do set. O resumo inteiro é o botão "Ver pendências".
 * ponytail: details/summary nativo (o Button do DS não expõe aria-expanded); o "botão" só pega a aparência ghost sm do DS.
 */
function Pending({ out, warned }: { out: SetSnapshot["problem_tracks"]; warned: SetSnapshot["problem_tracks"] }) {
  // ponytail: faixas fora do set mandam no rodapé; se nenhuma ficou fora, mostra as que entraram com aviso
  const problems = out.length > 0 ? out : warned;
  if (problems.length === 0) {
    return (
      <footer className="pn-foot">
        <p className="pn-foot__none">Nenhuma faixa fora do set.</p>
      </footer>
    );
  }
  return (
    <footer className="pn-foot">
      <details className="pn-pend">
        <summary>
          <StatusTag tone={out.length > 0 ? "warn" : "neutral"}>{out.length > 0 ? `${out.length} fora do set` : `${warned.length} com aviso`}</StatusTag>
          <span className="pn-pend__names">{problems.map((p) => splitLabel(p.label).title).join(" · ")}</span>
          <span className="pm-btn pm-btn--ghost pm-btn--sm">Ver pendências</span>
        </summary>
        <ul className="pn-pend__list">
          {problems.map((p, i) => (
            <li key={`${p.track_id}-${i}`}>
              <span className="pn-pend__title">{splitLabel(p.label).title}</span>
              <span className="pn-pend__why">{p.reasons.join(" · ")}</span>
            </li>
          ))}
        </ul>
      </details>
    </footer>
  );
}
