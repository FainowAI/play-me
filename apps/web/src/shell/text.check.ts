// Check da lógica pura do texto da shell (Node sem build): `node --no-warnings src/shell/text.check.ts` em apps/web.
import assert from "node:assert/strict";
import type { SetSnapshot, SnapshotTrack } from "../types.ts";
import { approvalTitles, count, coverage, headData, initialPlaylist, jevState, outOfSetLine, parseBlocks, parseInline, playlistContext, sentMeta, sourceName, suggestion, transitionsLabel } from "./text.ts";

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
assert.equal(suggestion("Warm up", "Eletro:\n\"apague tudo\" [x] (2026)"), "Monte um set da Eletro apague tudo x (2026), warm up.");
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

// cabeçalho do chat: linha de dados da versão vista
const track = (position: number, bpm: number, camelot: string): SnapshotTrack => ({ position, track_id: `t${position}`, label: `T${position} — A`, bpm, camelot, energy: 5, target_energy: 5, section: "peak", source: null, key_review: false });
const snapshot = (order: SnapshotTrack[], over: Partial<SetSnapshot> = {}): SetSnapshot => ({ curve: "classic", average_score: 0.8, order, transitions: [], weak_transitions: [], problem_tracks: [], warnings: [], ...over });
const set21 = [track(1, 122, "7B"), ...Array.from({ length: 19 }, (_, i) => track(i + 2, 124, "8A")), track(21, 131, "3A")];
assert.equal(headData({ snapshot: snapshot(set21, { duration_ms: 6_180_000 }) }), "21 faixas · 103 min · 122–131 BPM · 7B → 3A · curva clássica");
assert.equal(headData({ snapshot: snapshot(set21) }), "21 faixas · 122–131 BPM · 7B → 3A · curva clássica"); // sem duration_ms não há minutos
assert.equal(headData({ snapshot: snapshot(set21, { duration_ms: null }) }), "21 faixas · 122–131 BPM · 7B → 3A · curva clássica"); // o Spotify não informou alguma
assert.equal(headData({ snapshot: snapshot([track(1, 124.4, "8A")], { curve: "peak_time" }) }), "1 faixa · 124 BPM · 8A → 8A · curva peak time"); // singular; BPM fracionário arredonda
assert.equal(headData({ snapshot: snapshot([track(1, 123.6, "8A"), track(2, 124.4, "")]) }), "2 faixas · 124 BPM · curva clássica"); // mesmo BPM arredondado vira um número; tom vazio fica de fora
assert.equal(headData({ snapshot: snapshot([track(1, 120, "1A"), track(2, 121, "2A")], { curve: "deep_house" }) }), "2 faixas · 120–121 BPM · 1A → 2A · curva deep house"); // curva desconhecida: nome cru
assert.equal(headData({ snapshot: snapshot(set21, { curve: "warm_up" }) })?.endsWith("curva warm up"), true);
assert.equal(headData({ snapshot: snapshot(set21, { curve: "sunrise" }) })?.endsWith("curva sunrise"), true);
assert.equal(headData({ snapshot: snapshot([]) }), null);
assert.equal(headData({ snapshot: null }), null);
assert.equal(headData(null), null);

// playlist em contexto: a última usada vence; senão a maior fora de [DJ MIX] (a "Teste · 0 faixas" do QA não ganha)
const pl = (id: string, name: string, total: number | null) => ({ id, name, total, url: null });
const lists = [pl("a", "[DJ MIX] Eletro", 30), pl("b", "Teste", 0), pl("c", "Eletro", 557), pl("d", "House", 120)];
assert.equal(initialPlaylist(lists, null)?.id, "c");
assert.equal(initialPlaylist(lists, "d")?.id, "d");
assert.equal(initialPlaylist(lists, "a")?.id, "a"); // a última usada vale mesmo sendo um set enviado
assert.equal(initialPlaylist(lists, "sumiu")?.id, "c"); // id guardado que não está mais na lista
assert.equal(initialPlaylist(lists.slice(0, 1), null)?.id, "a"); // só sets enviados: melhor uma do que nenhuma
assert.equal(initialPlaylist([pl("x", "A", null), pl("y", "B", 3)], null)?.id, "y"); // sem contagem perde
assert.equal(initialPlaylist([pl("x", "A", 5), pl("y", "B", 5)], null)?.id, "x"); // empate: a primeira
assert.equal(initialPlaylist([], "a"), null);

// Jev: verde só com o ping respondendo; sem resposta e sem chave continuam avisando
assert.deepEqual(jevState({ key: true, connected: true, model: "jev-1.13.0" }), { tone: "ok", value: "conectado · jev-1.13.0" });
assert.deepEqual(jevState({ key: true, connected: true, model: null }), { tone: "ok", value: "conectado" });
assert.deepEqual(jevState({ key: true, connected: false, model: null }), { tone: "warn", value: "chave no .env · sem resposta" });
assert.deepEqual(jevState({ key: true, connected: null, model: null }), { tone: "neutral", value: "verificando" });
assert.deepEqual(jevState({ key: false, connected: null, model: null }), { tone: "warn", value: "sem chave · regras" });
assert.deepEqual(jevState({ key: false, connected: false, model: null }), { tone: "warn", value: "sem chave · regras" });

// pedido de aprovação: títulos na ordem dos ids; id sem rótulo aparece como o id; o rótulo mais novo vence
assert.deepEqual(approvalTitles(["b", "a", "z"], [{ track_id: "a", label: "Adored — J. Worra" }, { track_id: "b", label: "Sem artista" }]), ["Sem artista", "Adored", "z"]);
assert.deepEqual(approvalTitles(["a"], [{ track_id: "a", label: "Velho" }, { track_id: "a", label: "Novo — X" }]), ["Novo"]);
assert.equal(approvalTitles(["a", "b"], []), undefined); // set ainda não carregou: nada de ids crus
assert.equal(approvalTitles(["a"], [{ track_id: "x", label: "X" }]), undefined);
assert.equal(approvalTitles([], [{ track_id: "a", label: "A" }]), undefined);

console.log("[ok] shell text: markdown, frases, cobertura, cabeçalho, playlist, Jev, aprovação");
