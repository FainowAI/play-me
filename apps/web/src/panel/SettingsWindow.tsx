import { useId, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { ApiError } from "../api.ts";
import { Button, StatusTag } from "../components/playme/index.ts";
import type { Tone } from "../components/playme/index.ts";
import { jevState } from "../shell/text.ts";
import type { Theme } from "../state.ts";
import { DEFAULT_WEIGHTS } from "../types.ts";
import type { Status, Weights } from "../types.ts";
import { WEIGHT_KEYS, redistribute } from "./logic.ts";
import type { SettingsWindowProps } from "./types.ts";

const THEMES: { id: Theme; label: string }[] = [
  { id: "dark", label: "Cabine" },
  { id: "light", label: "Dia" },
];

const WEIGHT_LABEL: Record<keyof Weights, string> = {
  camelot: "Camelot",
  bpm: "BPM",
  energy: "Energia",
  style: "Estilo e groove",
  progression: "Progressão",
};

function Conn({ name, detail, tone, tag, children }: { name: string; detail: string; tone: Tone; tag: string; children?: ReactNode }) {
  return (
    <li className="pn-conn">
      <div className="pn-conn__text">
        <span className="pn-conn__name">{name}</span>
        <span className="pn-conn__detail">{detail}</span>
      </div>
      <StatusTag tone={tone}>{tag}</StatusTag>
      {children}
    </li>
  );
}

/** Jev: tom e frase pelo ping real do servidor (a mesma leitura da sidebar e do Início). */
function JevConn({ jev }: { jev: Status["jev"] }) {
  const { tone, value } = jevState(jev);
  return (
    <Conn
      name="Jev · TypeSafe"
      detail="Early access. Decide o tipo de transição quando a confiança passa de 0,7; senão, valem as regras."
      tone={tone}
      tag={value.charAt(0).toUpperCase() + value.slice(1)}
    />
  );
}

/** Janela de Configurações (760 px, dentro do Overlay da shell): conexões, tema e pesos da nota do par. */
export function SettingsWindow({ status, theme, onTheme, settings, onSave, onClose }: SettingsWindowProps) {
  const uid = useId();
  const [draft, setDraft] = useState<Weights | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // o que o usuário mexeu; senão o salvo (pode chegar da API depois de abrir a janela); senão o padrão
  const weights = draft ?? settings?.weights ?? DEFAULT_WEIGHTS;
  const sum = WEIGHT_KEYS.reduce((s, k) => s + weights[k], 0);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ weights });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Servidor local não respondeu.");
    } finally {
      setSaving(false);
    }
  };

  // ponytail: com duas opções, qualquer seta alterna o tema; o foco vai junto (tabIndex móvel).
  const onThemeKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!e.key.startsWith("Arrow")) return;
    e.preventDefault();
    const other = THEMES.find((t) => t.id !== theme);
    if (!other) return;
    onTheme(other.id);
    e.currentTarget.parentElement?.querySelector<HTMLElement>('[aria-checked="false"]')?.focus();
  };

  return (
    <>
      <header className="pn-win__head pn-win__head--center">
        <h2 className="title-2 pn-h2 pn-grow">Configurações</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Fechar
        </Button>
      </header>
      <section className="pn-block" aria-labelledby={`${uid}-conn`}>
        <span id={`${uid}-conn`} className="label">
          Conexões
        </span>
        {status ? (
          <ul className="pn-conns">
            <Conn
              name="Spotify"
              detail="Catálogo: playlists e ISRC. Cria só playlist nova e privada."
              tone={status.spotify.connected ? "ok" : "warn"}
              tag={status.spotify.connected ? "Conectado" : "Não conectado"}
            >
              <Button variant="ghost" size="sm" disabled title="npm run auth -w packages/mcp-server">
                Reconectar
              </Button>
            </Conn>
            <Conn name="ReccoBeats" detail="Sem chave · BPM e tom pelo ID do Spotify" tone="ok" tag="Ativa" />
            <Conn name="Trilha de áudio" detail="Opcional. Pasta de música + analisador local (Beat This!) para estrutura por compasso." tone="neutral" tag="Opcional">
              <Button variant="outline" size="sm" disabled title="pós-MVP">
                Configurar
              </Button>
            </Conn>
            <JevConn jev={status.jev} />
            <Conn
              name="Claude · API da Anthropic"
              detail="Chave lida do .env do servidor local. Nunca aparece aqui."
              tone={status.anthropic ? "ok" : "danger"}
              tag={status.anthropic ? "Configurada" : "Sem chave"}
            >
              {status.anthropic ? <span className="pn-conn__model">{status.model}</span> : null}
            </Conn>
          </ul>
        ) : (
          <p className="pn-lead">Servidor local não respondeu.</p>
        )}
      </section>
      <div className="pn-prefs">
        <div className="pn-pref">
          <span className="label">Tema</span>
          <div role="radiogroup" aria-label="Tema" className="pn-seg">
            {THEMES.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={t.id === theme} tabIndex={t.id === theme ? 0 : -1} onClick={() => onTheme(t.id)} onKeyDown={onThemeKey}>
                {t.label}
              </button>
            ))}
          </div>
          <p className="pn-note">Cabine é o padrão para a pista.</p>
        </div>
        <div className="pn-pref">
          <span className="label">Pesos da nota do par</span>
          {WEIGHT_KEYS.map((k) => (
            <div key={k} className="pn-weight">
              <label htmlFor={`${uid}-${k}`}>{WEIGHT_LABEL[k]}</label>
              <input
                id={`${uid}-${k}`}
                type="range"
                min={0}
                max={100}
                step={1}
                value={weights[k]}
                aria-valuetext={`${weights[k]}%`}
                onChange={(e) => setDraft(redistribute(weights, k, Number(e.target.value)))}
              />
              <span className="pn-weight__value" aria-hidden="true">{`${weights[k]}%`}</span>
            </div>
          ))}
          <div className="pn-total">{`Soma ${sum}%`}</div>
          <p className="pn-note">Soma 100%. Afeta a ordem dos próximos sets, não os já enviados.</p>
        </div>
      </div>
      <footer className="pn-win__foot">
        {error ? (
          <span role="alert" className="pn-win__error">
            <StatusTag tone="danger">{error}</StatusTag>
          </span>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? "Salvando" : "Salvar"}
        </Button>
      </footer>
    </>
  );
}
