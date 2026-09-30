/** Configurações do usuário (hoje só os pesos da nota do par) em data/settings.json. */
import { readFileSync, writeFileSync } from "node:fs";
import type { Settings, Weights } from "./types.js";

/** Mesmos padrões do MCP (DEFAULT_WEIGHTS), em porcentagem. */
export const DEFAULT_WEIGHTS: Weights = { camelot: 35, bpm: 25, energy: 25, style: 10, progression: 5 };
const KEYS = Object.keys(DEFAULT_WEIGHTS);

export class InvalidSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSettingsError";
  }
}

/** Exatamente as 5 chaves, inteiros de 0 a 100, soma 100; senão lança InvalidSettingsError. */
export function validateWeights(value: unknown): Weights {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new InvalidSettingsError("Pesos inválidos: envie weights com camelot, bpm, energy, style e progression.");
  const w = value as Record<string, unknown>;
  if (Object.keys(w).length !== KEYS.length || !KEYS.every((k) => k in w))
    throw new InvalidSettingsError("Pesos inválidos: use exatamente camelot, bpm, energy, style e progression.");
  if (!KEYS.every((k) => Number.isInteger(w[k]) && (w[k] as number) >= 0 && (w[k] as number) <= 100))
    throw new InvalidSettingsError("Pesos inválidos: cada peso é um número inteiro de 0 a 100.");
  const sum = KEYS.reduce((acc, k) => acc + (w[k] as number), 0);
  if (sum !== 100) throw new InvalidSettingsError(`Pesos inválidos: a soma é ${sum} e precisa ser 100.`);
  return w as unknown as Weights;
}

export class SettingsStore {
  constructor(private readonly path: string) {}

  /** Sem arquivo (ou com arquivo inválido) valem os padrões. */
  get(): Settings {
    try {
      const saved = JSON.parse(readFileSync(this.path, "utf8")) as { weights?: unknown };
      return { weights: validateWeights(saved.weights) };
    } catch {
      return { weights: { ...DEFAULT_WEIGHTS } };
    }
  }

  set(settings: Settings): Settings {
    const valid: Settings = { weights: validateWeights(settings.weights) };
    // ponytail: escrita direta; um arquivo truncado por queda vira os padrões no get()
    writeFileSync(this.path, JSON.stringify(valid, null, 2));
    return valid;
  }
}
