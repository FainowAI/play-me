import { HARMONIC_THRESHOLDS } from "../constants.js";
import type { CamelotKey, CamelotLetter, HarmonicType } from "../types.js";

/** Tons menores (A) e maiores (B) por posição na roda Camelot. */
const MINOR_BY_NUMBER = ["G#m", "D#m", "A#m", "Fm", "Cm", "Gm", "Dm", "Am", "Em", "Bm", "F#m", "C#m"] as const;
const MAJOR_BY_NUMBER = ["B", "F#", "C#", "G#", "D#", "A#", "F", "C", "G", "D", "A", "E"] as const;

const ENHARMONIC: Record<string, string> = {
  AB: "G#", BB: "A#", DB: "C#", EB: "D#", GB: "F#", CB: "B", FB: "E", "E#": "F", "B#": "C",
};

function normalizeRoot(root: string): string {
  const upper = root.toUpperCase().replace("♯", "#").replace("♭", "B");
  // "BB" (Bb) precisa ser distinguido de "B": só a segunda letra 'B' indica bemol
  return ENHARMONIC[upper] ?? upper;
}

/**
 * Converte "8A", "08b", "Am", "A minor", "F#m", "Ebm", "C", "Db major", "Gb maj" em chave Camelot.
 * Retorna null quando não reconhece.
 */
export function parseKey(input: string): CamelotKey | null {
  const raw = input.trim();
  const camelot = raw.match(/^0?(1[0-2]|[1-9])\s*([ABab])$/);
  if (camelot?.[1] && camelot[2]) {
    return { number: Number(camelot[1]), letter: camelot[2].toUpperCase() as CamelotLetter };
  }

  const musical = raw.match(/^([A-Ga-g])([#♯b♭]?)\s*(m|min|minor|menor|maj|major|maior)?$/);
  if (!musical?.[1]) return null;
  const accidental = musical[2] ?? "";
  const root = normalizeRoot(musical[1] + (accidental === "b" || accidental === "♭" ? "B" : accidental));
  const quality = (musical[3] ?? "").toLowerCase();
  const isMinor = quality === "m" || quality.startsWith("min") || quality === "menor";

  if (isMinor) {
    const idx = MINOR_BY_NUMBER.indexOf(`${root}m` as (typeof MINOR_BY_NUMBER)[number]);
    return idx >= 0 ? { number: idx + 1, letter: "A" } : null;
  }
  const idx = MAJOR_BY_NUMBER.indexOf(root as (typeof MAJOR_BY_NUMBER)[number]);
  return idx >= 0 ? { number: idx + 1, letter: "B" } : null;
}

export function formatCamelot(key: CamelotKey): string {
  return `${key.number}${key.letter}`;
}

export function musicalName(key: CamelotKey): string {
  const list = key.letter === "A" ? MINOR_BY_NUMBER : MAJOR_BY_NUMBER;
  return list[key.number - 1] ?? "?";
}

/** Passos no sentido horário de a até b (0..11). */
function stepsClockwise(a: number, b: number): number {
  return (((b - a) % 12) + 12) % 12;
}

export interface HarmonicMatch {
  score: number; // 0..1
  relation: string; // descrição em português
  type: HarmonicType;
}

/**
 * Compatibilidade harmônica entre duas chaves Camelot.
 * Seguras: mesmo tom, ±1 na mesma letra, relativa.
 * Criativas: diagonal (A↔B com ±1, a tríade menor cabe inteira na escala maior vizinha), +2, semitom (+7).
 */
export function harmonicMatch(from: CamelotKey, to: CamelotKey): HarmonicMatch {
  const cw = stepsClockwise(from.number, to.number);
  const sameLetter = from.letter === to.letter;

  let score: number;
  let relation: string;

  if (sameLetter && cw === 0) {
    score = 1;
    relation = "mesmo tom";
  } else if (sameLetter && cw === 1) {
    score = 0.92;
    relation = "adjacente +1";
  } else if (sameLetter && cw === 11) {
    score = 0.92;
    relation = "adjacente −1";
  } else if (!sameLetter && cw === 0) {
    score = 0.88;
    relation = "relativa";
  } else if (!sameLetter && (cw === 1 || cw === 11)) {
    score = 0.72;
    relation = "diagonal";
  } else if (sameLetter && (cw === 2 || cw === 10)) {
    score = 0.56;
    relation = cw === 2 ? "salto +2 (boost)" : "salto −2";
  } else if (sameLetter && cw === 7) {
    score = 0.55; // técnica clássica de boost: criativa, não choque
    relation = "semitom acima (boost de energia)";
  } else if (sameLetter && cw === 5) {
    score = 0.42;
    relation = "semitom abaixo";
  } else if (cw === 6) {
    score = 0.05;
    relation = "trítono (choque forte)";
  } else {
    score = 0.18;
    relation = "choque harmônico";
  }

  const type: HarmonicType =
    score >= HARMONIC_THRESHOLDS.safe ? "segura" : score >= HARMONIC_THRESHOLDS.creative ? "criativa" : "arriscada";
  return { score, relation, type };
}

export const ALL_KEYS: CamelotKey[] = Array.from({ length: 12 }, (_, i) => i + 1).flatMap((number) => [
  { number, letter: "A" as const },
  { number, letter: "B" as const },
]);

/** Chaves que ligam `from` a `to` com duas transições de pelo menos `minScore`. */
export function bridgeKeys(from: CamelotKey, to: CamelotKey, minScore: number): CamelotKey[] {
  return ALL_KEYS.filter(
    (candidate) => harmonicMatch(from, candidate).score >= minScore && harmonicMatch(candidate, to).score >= minScore,
  ).sort(
    (a, b) =>
      harmonicMatch(from, b).score + harmonicMatch(b, to).score - (harmonicMatch(from, a).score + harmonicMatch(a, to).score),
  );
}

/**
 * Menor caminho de tons entre `from` e `to` usando só passos com nota >= `minScore`.
 * Retorna as chaves intermediárias (sem as pontas). Vazio quando já são compatíveis.
 */
export function keyPath(from: CamelotKey, to: CamelotKey, minScore: number): CamelotKey[] {
  const id = (key: CamelotKey): string => formatCamelot(key);
  if (harmonicMatch(from, to).score >= minScore) return [];
  const previous = new Map<string, CamelotKey | null>([[id(from), null]]);
  const queue: CamelotKey[] = [from];
  while (queue.length) {
    const current = queue.shift() as CamelotKey;
    for (const next of ALL_KEYS) {
      if (previous.has(id(next)) || harmonicMatch(current, next).score < minScore) continue;
      previous.set(id(next), current);
      if (harmonicMatch(next, to).score >= minScore) {
        const path: CamelotKey[] = [next];
        let cursor = current;
        while (id(cursor) !== id(from)) {
          path.unshift(cursor);
          cursor = previous.get(id(cursor)) as CamelotKey;
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [];
}
