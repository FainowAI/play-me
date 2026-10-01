/**
 * Lógica pura do painel (sem React nem CSS): roda em Node sem build. Check runnable: ./logic.test.ts.
 */
import { score } from "../setview.ts";
import { curveLabel } from "../shell/text.ts";
import type { SetSnapshot, SnapshotTrack, Weights } from "../types.ts";

/** Energia plotada no arco: a estimada, ou o alvo da curva quando a faixa não tem energia. */
const plotted = (t: SnapshotTrack): number => t.energy ?? t.target_energy;

export const arcPoints = (order: SnapshotTrack[]): { energy: number }[] => order.map((t) => ({ energy: plotted(t) }));

const listPt = (items: number[]): string => (items.length > 1 ? `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}` : items.join(""));

/**
 * Legenda do SetArc: "Pico na faixa 14." e, havendo 3+ faixas seguidas com E9 ou mais, o aviso de falta de respiro.
 * O pico vale sobre o que o arco mostra; o aviso só sobre energia medida (faixa sem energia quebra a sequência).
 * ponytail: avisa só a primeira sequência; as seguintes aparecem depois que essa for corrigida.
 */
export function arcCaption(order: SnapshotTrack[]): string {
  let peak: SnapshotTrack | null = null;
  let run: number[] = [];
  let hot: number[] = [];
  for (const t of order) {
    if (!peak || plotted(t) > plotted(peak)) peak = t;
    if (t.energy !== null && Math.round(t.energy) >= 9) run.push(t.position);
    else run = [];
    if (hot.length === 0 && run.length >= 3) hot = run; // mesma lista: continua crescendo enquanto a sequência durar
  }
  if (!peak) return "";
  const pico = `Pico na faixa ${peak.position}.`;
  return hot.length > 0 ? `${pico} Atenção: ${listPt(hot)} seguidas com E9 ou mais, sem respiro.` : pico;
}

/**
 * Linha mono do cabeçalho do painel. Versão criada pelo gate de envio chega sem transições e com a nota média da ordem
 * anterior; nessas a nota média não aparece. A duração só aparece quando o Spotify informou a de todas as faixas (`duration_ms` numérico).
 */
export function metaLine(snapshot: SetSnapshot): string {
  const parts = [`${snapshot.order.length} faixas`];
  if (typeof snapshot.duration_ms === "number") parts.push(`${Math.round(snapshot.duration_ms / 60000)} min`);
  if (snapshot.transitions.length > 0) parts.push(`nota média ${score(snapshot.average_score)}`);
  parts.push(`curva ${curveLabel(snapshot.curve)}`);
  return parts.join(" · ");
}

export const WEIGHT_KEYS: (keyof Weights)[] = ["camelot", "bpm", "energy", "style", "progression"];

/**
 * Move um peso para `value` e reparte o que sobra entre os outros, na proporção atual (em partes iguais se todos estão em 0).
 * Sempre inteiros somando 100: piso de cada parte e +1 para as maiores sobras (nunca negativo).
 * ponytail: parte do estado atual; arrastar e voltar não restaura a proporção original (peso zerado fica zerado).
 */
export function redistribute(weights: Weights, key: keyof Weights, value: number): Weights {
  const v = Math.min(100, Math.max(0, Math.round(value)));
  const rest = 100 - v;
  const others = WEIGHT_KEYS.filter((k) => k !== key);
  const total = others.reduce((s, k) => s + weights[k], 0);
  const parts = others.map((k) => {
    const share = total > 0 ? (weights[k] * rest) / total : rest / others.length;
    return { k, n: Math.floor(share), frac: share - Math.floor(share) };
  });
  let left = rest - parts.reduce((s, p) => s + p.n, 0);
  for (const p of [...parts].sort((a, b) => b.frac - a.frac)) {
    if (left <= 0) break;
    p.n += 1;
    left -= 1;
  }
  const next: Weights = { ...weights, [key]: v };
  for (const p of parts) next[p.k] = p.n;
  return next;
}

/** BPM como o TrackRow mostra: inteiro sem casa, senão uma casa. */
export const bpmText = (bpm: number): string => (Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(1));

export interface Correction {
  bpm: number;
  key: string;
  energy: number | null;
}
export type CorrectionErrors = Partial<Record<keyof Correction, string>>;

/** Valida o form "Correção manual" com os limites do dj_set_track_analysis (bpm 40–220, energia inteira 1–10, tom Camelot). */
export function parseCorrection(input: { bpm: string; key: string; energy: string }): { ok: true; value: Correction } | { ok: false; errors: CorrectionErrors } {
  const errors: CorrectionErrors = {};
  const bpm = Number(input.bpm.trim().replace(",", ".")); // teclado pt-BR digita vírgula; vazio vira 0 e cai no limite
  if (!(bpm >= 40 && bpm <= 220)) errors.bpm = "BPM entre 40 e 220.";
  const key = input.key.trim().toUpperCase();
  if (!/^(1[0-2]|[1-9])[AB]$/.test(key)) errors.key = "Tom Camelot, como 8A ou 12B.";
  const raw = input.energy.trim();
  const energy = raw === "" ? null : Number(raw.replace(",", "."));
  if (energy !== null && !(Number.isInteger(energy) && energy >= 1 && energy <= 10)) errors.energy = "Energia inteira de 1 a 10, ou vazio.";
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: { bpm, key, energy } };
}

/** Mensagem do "Salvar correção" (contract.md, tela 7). Campo omitido preserva o valor salvo no MCP, então energia vazia sai da frase. */
export function correctionMessage(title: string, trackId: string, c: Correction): string {
  const parts = [`BPM ${c.bpm}`, `tom ${c.key}`, ...(c.energy === null ? [] : [`energia ${c.energy}`])];
  // ponytail: sem o título na frase (texto do Spotify não vira mensagem com papel de usuário); o id basta para a ferramenta
  void title;
  return `Corrige a faixa de id ${trackId}: ${parts.join(", ")}. Grave com fonte manual.`;
}
