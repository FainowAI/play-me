import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { orderOptions } from "../../state.ts";
import { Button } from "./Button.tsx";
import type { QuestionsWindowProps } from "./types.ts";

// Ícones do modal: grade de 24 px, traço 1.75, geometria Lucide (como o Icon do DS).
// ponytail: inline porque o Icon do DS não tem lápis nem setas e o Icon.tsx não é desta trilha; se o DS ganhar, trocar.
const GLYPH = {
  pencil: "M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z",
  prev: "M15 18l-6-6 6-6",
  next: "M9 18l6-6-6-6",
};
function Glyph({ name, size = 16 }: { name: keyof typeof GLYPH; size?: number }) {
  return (
    <svg className="pm-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={GLYPH[name]} />
    </svg>
  );
}

const TAGGED = /\(recomendad[oa]\)\s*$/i; // o agente não deve pôr o sufixo; se pôr, a UI não o repete
const OTHER_MAX = 100; // caracteres do texto de "Outra opção" (o servidor aceita até 200)

/**
 * Conteúdo da janela de perguntas do agente (ask_dj), como o modal do Claude: uma pergunta por vez, "1 de N" com ‹ ›,
 * opções numeradas (a recomendada primeiro), "Outra opção" com texto livre e "Pular". Teclado: 1–9 escolhem a opção,
 * Enter confirma o texto, Esc pula a pergunta. Sem padding próprio: o Overlay (kind "window") dá o miolo.
 */
export function QuestionsWindow({ title, questions, onSubmit, disabled }: QuestionsWindowProps) {
  const uid = useId();
  const [i, setI] = useState(0); // pergunta em tela
  const [reached, setReached] = useState(0); // a mais adiante já vista: › só vai até ela
  const [answers, setAnswers] = useState<Record<string, string | null>>({}); // por id da pergunta; null = pulada
  const [editing, setEditing] = useState(false); // "Outra opção" virou input
  const [text, setText] = useState("");
  const list = useRef<HTMLOListElement>(null);
  const refocus = useRef(false); // acabou de responder: o foco vai para a primeira opção da pergunta nova
  const q = questions[i];
  const ordered = orderOptions(q?.options ?? []);
  const last = i === questions.length - 1;

  const go = (n: number) => {
    setI(n);
    setReached((r) => Math.max(r, n));
    setEditing(false);
  };
  // Grava a resposta da pergunta em tela e avança; na última envia tudo (uma entrada por pergunta, as puladas null).
  // ponytail: voltar e trocar uma resposta avança um passo; o envio é sempre a escolha da última pergunta.
  const record = (value: string | null) => {
    if (!q || disabled) return;
    const next = { ...answers, [q.id]: value };
    setAnswers(next);
    if (last) onSubmit(Object.fromEntries(questions.map((x) => [x.id, next[x.id] ?? null])));
    else {
      refocus.current = true;
      go(i + 1);
    }
  };

  // ponytail: teclas no window, não no miolo: o <dialog> modal devolve o foco ao body quando se clica fora de um botão e o miolo não as receberia.
  // Esc pula a pergunta e o preventDefault impede o <dialog> de fechar a janela; os dígitos não valem num campo de texto.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || disabled) return;
    if (e.key === "Escape") {
      e.preventDefault();
      record(null);
      return;
    }
    const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
    const option = !typing && /^[1-9]$/.test(e.key) ? ordered[Number(e.key) - 1] : undefined;
    if (option) {
      e.preventDefault();
      record(option.label);
    }
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // depois de responder o foco cai na primeira opção da pergunta nova (a anterior saiu do DOM); as setas ‹ › mantêm o foco onde estão
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    list.current?.querySelector<HTMLElement>("button")?.focus();
  }, [i]);

  if (!q) return null;
  const current = answers[q.id]; // resposta já dada a esta pergunta (ao voltar com ‹), se houver
  const isOther = typeof current === "string" && !ordered.some((o) => o.label === current);
  const eyebrow = [title, q.header].filter(Boolean).join(" · ");

  return (
    <div className="pm-ask">
      <header className="pm-ask__head">
        <div className="pm-ask__titles">
          {eyebrow && <span className="label pm-ask__eyebrow">{eyebrow}</span>}
          <h2 id={`${uid}-q`} className="title-3 pm-ask__q">
            {q.text}
          </h2>
        </div>
        {questions.length > 1 && (
          <div className="pm-ask__nav">
            <button type="button" className="pm-ask__step" aria-label="Pergunta anterior" disabled={disabled || i === 0} onClick={() => go(i - 1)}>
              <Glyph name="prev" />
            </button>
            <span className="pm-ask__count">{`${i + 1} de ${questions.length}`}</span>
            <button type="button" className="pm-ask__step" aria-label="Próxima pergunta" disabled={disabled || i >= reached} onClick={() => go(i + 1)}>
              <Glyph name="next" />
            </button>
          </div>
        )}
      </header>
      {/* key: cada pergunta remonta a lista e as opções sobem de novo (pm-rise) */}
      <ol key={q.id} ref={list} className="pm-ask__list" aria-labelledby={`${uid}-q`}>
        {ordered.map((o, n) => (
          <li key={n}>
            <button type="button" className="pm-ask__opt" aria-pressed={current === o.label} aria-keyshortcuts={String(n + 1)} disabled={disabled} onClick={() => record(o.label)}>
              <span className="pm-ask__num" aria-hidden="true">
                {n + 1}
              </span>
              <span className="pm-ask__text">
                <span className="pm-ask__label">
                  {o.label}
                  {o.recommended && !TAGGED.test(o.label) && <span className="pm-ask__rec"> (Recomendado)</span>}
                </span>
                {o.description && <span className="pm-ask__desc">{o.description}</span>}
              </span>
            </button>
          </li>
        ))}
        {q.allow_other && (
          <li>
            {editing ? (
              <form
                className="pm-ask__other"
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = text.trim();
                  if (value) record(value);
                }}
              >
                <span className="pm-ask__num" aria-hidden="true">
                  <Glyph name="pencil" size={14} />
                </span>
                <input className="pm-ask__input" autoFocus aria-label="Outra opção" placeholder="Escreva a sua resposta" maxLength={OTHER_MAX} value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} />
                <Button type="submit" variant="primary" size="sm" disabled={disabled || !text.trim()}>
                  Confirmar
                </Button>
              </form>
            ) : (
              <button
                type="button"
                className="pm-ask__opt pm-ask__opt--other"
                aria-pressed={isOther}
                disabled={disabled}
                onClick={() => {
                  setText(isOther ? current : "");
                  setEditing(true);
                }}
              >
                <span className="pm-ask__num" aria-hidden="true">
                  <Glyph name="pencil" size={14} />
                </span>
                <span className="pm-ask__text">
                  <span className="pm-ask__label">Outra opção</span>
                  {isOther && <span className="pm-ask__desc">{current}</span>}
                </span>
              </button>
            )}
          </li>
        )}
      </ol>
      <footer className="pm-ask__foot">
        <Button variant="outline" size="sm" title="Esc" disabled={disabled} onClick={() => record(null)}>
          Pular
        </Button>
      </footer>
    </div>
  );
}
