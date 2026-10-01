/**
 * Texto puro da shell (sem React, roda em Node): o markdown mínimo do agente e as frases montadas a partir dos dados.
 * Check runnable: src/shell/text.check.ts.
 */
import { splitLabel } from "../state.ts";
import type { Playlist, SetSnapshot, Status } from "../types.ts";

// ---------- markdown mínimo ----------

export type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "ul" | "ol"; start: number; items: string[] };
type ListBlock = Extract<Block, { kind: "ul" | "ol" }>;
const isList = (b: Block | undefined): b is ListBlock => b?.kind === "ul" || b?.kind === "ol";

const HEADING = /^#{1,6}\s+(\S.*)$/;
const ITEM = /^\s*(?:[-*]|(\d{1,3})[.)])\s+(\S.*)$/; // até 3 dígitos: "2026. Ano" segue parágrafo

/** Títulos (#), listas (-, * ou 1.) e parágrafos separados por linha em branco. O resto é texto. */
export function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let inList = false; // a linha anterior era item (sem linha em branco no meio)
  const flush = () => {
    if (para.length > 0) blocks.push({ kind: "p", text: para.join("\n") });
    para = [];
  };
  for (const raw of src.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const heading = HEADING.exec(line);
    const item = ITEM.exec(line);
    const last = blocks[blocks.length - 1];
    if (line.trim() === "") {
      flush();
      inList = false;
    } else if (heading) {
      flush();
      blocks.push({ kind: "h", text: heading[1] ?? "" });
      inList = false;
    } else if (item) {
      flush();
      const kind = item[1] === undefined ? "ul" : "ol";
      if (inList && isList(last) && last.kind === kind) last.items.push(item[2] ?? "");
      else blocks.push({ kind, start: item[1] === undefined ? 1 : Number(item[1]), items: [item[2] ?? ""] });
      inList = true;
    } else if (inList && isList(last)) {
      const i = last.items.length - 1; // linha de continuação do último item
      last.items[i] = `${last.items[i] ?? ""} ${line.trim()}`;
    } else {
      para.push(line);
    }
  }
  flush();
  return blocks;
}

export type Inline = { kind: "text" | "bold" | "code"; text: string };

/** **negrito** e `código`; o resto é texto (nunca HTML). */
export function parseInline(src: string): Inline[] {
  return src
    .split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/) // um grupo só: as capturas ficam nos índices ímpares
    .map((part, i): Inline => (i % 2 === 0 ? { kind: "text", text: part } : part.startsWith("`") ? { kind: "code", text: part.slice(1, -1) } : { kind: "bold", text: part.slice(2, -2) }))
    .filter((t) => t.text !== "");
}

// ---------- frases da tela ----------

const plural = (n: number, one: string, many: string): string => `${n.toLocaleString("pt-BR")} ${n === 1 ? one : many}`;

/** "Eletro · 557 faixas": pílula de contexto do composer. Sem contagem, só o nome. */
export function playlistContext(p: { name: string; total: number | null }): string {
  return p.total === null ? p.name : `${p.name} · ${plural(p.total, "faixa", "faixas")}`;
}

/** Pedido pronto do Início vira mensagem: "Monte um set da Eletro, warm up até peak time." */
export function suggestion(label: string, playlist: string | null): string {
  const ask = label.charAt(0).toLowerCase() + label.slice(1); // só a inicial: "BPM" segue maiúsculo
  // nome de playlist vira parte da mensagem do usuário: só letras, dígitos e pontuação simples, até 60 caracteres
  const name = playlist?.replace(/[^\p{L}\p{N} .,'&()-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return `Monte um set${name ? ` da ${name}` : ""}, ${ask}.`;
}

/** "Ver as 20 transições". */
export const transitionsLabel = (n: number): string => (n === 1 ? "Ver a transição" : `Ver as ${n} transições`);

/** "Fora do set: A (razão), B e mais 2." Até `max` faixas: com centenas de pendentes a lista inteira não cabe no chat. Só faixas ausentes da ordem. */
export function outOfSetLine(problems: { label: string; reasons: string[] }[], max = 3): string {
  const shown = problems.slice(0, max).map((p) => {
    const { title } = splitLabel(p.label);
    const reason = p.reasons[0];
    return reason ? `${title} (${reason})` : title;
  });
  const rest = problems.length - shown.length;
  return `Fora do set: ${shown.join(", ")}${rest > 0 ? ` e mais ${rest}` : ""}.`;
}

/** Playlist de origem pelo nome do set ("[DJ MIX] Eletro" → "Eletro"); null se o nome não segue o padrão. */
export function sourceName(setName: string): string | null {
  return /^\[DJ MIX\]\s*(.+)$/i.exec(setName.trim())?.[1] ?? null;
}

/** "privada · 21 faixas · a Eletro original não mudou". */
export function sentMeta(setName: string, tracks: number): string {
  const source = sourceName(setName);
  return `privada · ${plural(tracks, "faixa", "faixas")} · ${source ? `a ${source} original não mudou` : "a playlist original não mudou"}`;
}

// ---------- cobertura de metadados (tool_end.summary de metadata_coverage) ----------

type Summary = Record<string, number | boolean | null>;

/** Número do resumo para a tela; dado faltando é dito ("—"), nunca inventado. */
export function count(v: number | boolean | null | undefined): string {
  return typeof v === "number" ? v.toLocaleString("pt-BR") : "—";
}

/** Barra de progresso real: (total − pendentes) / total. null se o resumo não traz os dois números. */
export function coverage(s: Summary): { total: number; done: number; pct: number } | null {
  const total = s.total;
  const pending = s.pendente;
  if (typeof total !== "number" || typeof pending !== "number" || total <= 0) return null;
  const done = Math.max(0, total - pending);
  return { total, done, pct: Math.min(100, Math.round((done / total) * 100)) };
}

// ---------- estado da tela: cabeçalho do chat, playlist em contexto, Jev, pedido de aprovação ----------

/** Curvas do MCP em português; curva desconhecida aparece com o nome cru, sem `_`. */
const CURVE: Record<string, string> = { classic: "clássica", peak_time: "peak time", warm_up: "warm up", sunrise: "sunrise" };
/** Nome da curva em português (classic → clássica); desconhecida sai como veio, sem underscore. */
export const curveLabel = (curve: string): string => CURVE[curve] ?? curve.replace(/_/g, " ");

/** "21 faixas · 103 min · 122–131 BPM · 7B → 3A · curva clássica": linha mono do cabeçalho, do snapshot da versão vista. Sem snapshot (ou sem faixas), nada. */
export function headData(version: { snapshot: SetSnapshot | null } | null): string | null {
  const snap = version?.snapshot;
  if (!snap || snap.order.length === 0) return null;
  const parts = [plural(snap.order.length, "faixa", "faixas")];
  if (typeof snap.duration_ms === "number") parts.push(`${Math.round(snap.duration_ms / 60000)} min`); // só quando o Spotify informou a de todas
  const bpm = snap.order.map((t) => Math.round(t.bpm));
  const [lo, hi] = [Math.min(...bpm), Math.max(...bpm)];
  parts.push(lo === hi ? `${lo} BPM` : `${lo}–${hi} BPM`);
  const from = snap.order[0]?.camelot;
  const to = snap.order.at(-1)?.camelot;
  if (from && to) parts.push(`${from} → ${to}`);
  if (snap.curve) parts.push(`curva ${curveLabel(snap.curve)}`);
  return parts.join(" · ");
}

/**
 * Playlist em contexto ao abrir: a última usada (`storedId`, guardado pela shell), senão a com mais faixas fora dos sets
 * já enviados ([DJ MIX] …; contagem desconhecida perde e empate fica com a primeira), senão a primeira da lista.
 */
export function initialPlaylist(playlists: Playlist[], storedId: string | null): Playlist | null {
  const last = playlists.find((p) => p.id === storedId);
  if (last) return last;
  const own = playlists.filter((p) => !p.name.startsWith("[DJ MIX]"));
  return own.reduce<Playlist | null>((best, p) => (best === null || (p.total ?? -1) > (best.total ?? -1) ? p : best), null) ?? playlists[0] ?? null;
}

/** Jev do /api/status em tom e frase curta. `connected` é o ping real do servidor: null = ainda não respondeu. */
export function jevState(jev: Status["jev"]): { tone: "ok" | "warn" | "neutral"; value: string } {
  if (jev.connected) return { tone: "ok", value: jev.model ? `conectado · ${jev.model}` : "conectado" };
  if (!jev.key) return { tone: "warn", value: "sem chave · regras" };
  return jev.connected === false ? { tone: "warn", value: "chave no .env · sem resposta" } : { tone: "neutral", value: "verificando" };
}

/**
 * Títulos do pedido de aprovação na ordem dos ids, pelos rótulos dos snapshots (a mais nova vence); id sem rótulo fica como o id.
 * Nenhum rótulo conhecido (o set ainda não chegou): undefined, para o gate não piscar uma lista de ids crus.
 */
export function approvalTitles(ids: string[], order: { track_id: string; label: string }[]): string[] | undefined {
  const labels = new Map(order.map((t) => [t.track_id, t.label] as const));
  if (!ids.some((id) => labels.has(id))) return undefined;
  return ids.map((id) => {
    const label = labels.get(id);
    return label === undefined ? id : splitLabel(label).title;
  });
}
