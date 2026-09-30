/** Helpers compartilhados pelos componentes desta pasta. */

/** Junta classes ignorando falsos (clsx mínimo). */
export const cx = (...classes: (string | false | null | undefined)[]): string => classes.filter(Boolean).join(" ");

/** Tom Camelot normalizado ("8a" → "8A", "01A" → "1A"), ou null fora de 1A–12B: só esses têm cor (`--key-*`) nos tokens. */
export function parseKey(camelot: string | null | undefined): string | null {
  const m = /^(\d{1,2})([AB])$/i.exec((camelot ?? "").trim());
  const n = Number(m?.[1]);
  return m && n >= 1 && n <= 12 ? `${n}${m[0].slice(-1).toUpperCase()}` : null;
}
