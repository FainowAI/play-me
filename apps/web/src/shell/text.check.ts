// Check da lógica pura do texto da shell (Node sem build): `node --no-warnings src/shell/text.check.ts` em apps/web.
import assert from "node:assert/strict";
import { count, coverage, outOfSetLine, parseBlocks, parseInline, playlistContext, sentMeta, sourceName, suggestion, transitionsLabel } from "./text.ts";

// parágrafos por linha em branco; linha simples fica no mesmo parágrafo (quebra preservada)
assert.deepEqual(parseBlocks("Olá\nmundo\n\nSegundo"), [
  { kind: "p", text: "Olá\nmundo" },
  { kind: "p", text: "Segundo" },
]);

// lista depois de parágrafo sem linha em branco; ordenada guarda o número inicial; linhas em branco separam listas
assert.deepEqual(parseBlocks("Itens:\n- a\n* b\n\n3. c\n4) d"), [
  { kind: "p", text: "Itens:" },
  { kind: "ul", start: 1, items: ["a", "b"] },
  { kind: "ol", start: 3, items: ["c", "d"] },
]);

// título, continuação de item e falsos positivos (negrito no início, ano com ponto, marcador sem texto)
assert.deepEqual(parseBlocks("## Set\nAbre em 8A\n- passa\n  para 9A"), [
  { kind: "h", text: "Set" },
  { kind: "p", text: "Abre em 8A" },
  { kind: "ul", start: 1, items: ["passa para 9A"] },
]);
assert.deepEqual(parseBlocks("**Negrito** no início\n2026. Ano\n-"), [{ kind: "p", text: "**Negrito** no início\n2026. Ano\n-" }]);
assert.deepEqual(parseBlocks("a\r\n\r\nb"), [
  { kind: "p", text: "a" },
  { kind: "p", text: "b" },
]);
assert.deepEqual(parseBlocks("  \n"), []);

// inline: negrito e código; asterisco sem par fica como texto; HTML nunca é interpretado (vira texto)
assert.deepEqual(parseInline("a **b** `c` d"), [
  { kind: "text", text: "a " },
  { kind: "bold", text: "b" },
  { kind: "text", text: " " },
  { kind: "code", text: "c" },
  { kind: "text", text: " d" },
]);
assert.deepEqual(parseInline("**sem fim e <b>x</b>"), [{ kind: "text", text: "**sem fim e <b>x</b>" }]);

// frases
assert.equal(suggestion("Só faixas entre 124 e 126 BPM", "Eletro"), "Monte um set da Eletro, só faixas entre 124 e 126 BPM.");
assert.equal(suggestion("Warm up até peak time", null), "Monte um set, warm up até peak time.");
assert.equal(playlistContext({ name: "Eletro", total: 557 }), "Eletro · 557 faixas");
assert.equal(playlistContext({ name: "Uma", total: 1 }), "Uma · 1 faixa");
assert.equal(playlistContext({ name: "Eletro", total: null }), "Eletro");
assert.equal(transitionsLabel(20), "Ver as 20 transições");
assert.equal(transitionsLabel(1), "Ver a transição");

const problem = (label: string, reasons: string[]) => ({ track_id: label, label, reasons });
assert.equal(outOfSetLine([problem("Cruisin' — Artista", ["133 BPM fora da curva"]), problem("This Rhythm", [])]), "Fora do set: Cruisin' (133 BPM fora da curva), This Rhythm.");
assert.equal(outOfSetLine(["a", "b", "c", "d", "e"].map((l) => problem(l, []))), "Fora do set: a, b, c e mais 2.");

assert.equal(sourceName("[DJ MIX] Eletro"), "Eletro");
assert.equal(sourceName("Meu set"), null);
assert.equal(sentMeta("[DJ MIX] Eletro", 21), "privada · 21 faixas · a Eletro original não mudou");
assert.equal(sentMeta("Meu set", 1), "privada · 1 faixa · a playlist original não mudou");

// cobertura: barra = (total − pendentes) / total; sem os números, sem barra
assert.deepEqual(coverage({ total: 557, mixar: 22, web: 414, a_validar: 0, pendente: 121 }), { total: 557, done: 436, pct: 78 });
assert.equal(coverage({ total: 0, pendente: 0 }), null);
assert.equal(coverage({ mixar: 22 }), null);
assert.equal(count(22), "22");
assert.equal(count(null), "—");
assert.equal(count(undefined), "—");
assert.equal(count(true), "—");

console.log("[ok] shell text: markdown, frases, cobertura");
