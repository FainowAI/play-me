import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { InvalidTransitionError, openRepo } from "../repo.js";
import type { ServerEvent, SetSnapshot, SetStatus } from "../types.js";

const repo = openRepo(":memory:");
const sleep = () => new Promise((r) => setTimeout(r, 3));
const snap = (curve: string): SetSnapshot => ({
  curve,
  average_score: 0.84,
  order: [{ position: 1, track_id: "t1", label: "Um — Artista", bpm: 124, camelot: "8A", energy: 6, target_energy: 4, section: "abertura", source: "web", key_review: true }],
  transitions: [],
  weak_transitions: [],
  problem_tracks: [{ track_id: "t1", label: "Um — Artista", reasons: ["energia não informada"] }],
  warnings: ["aviso"],
});

// ---------- sessões ----------
const s1 = repo.createSession("um");
await sleep();
const s2 = repo.createSession("dois");
assert.equal(s1.agent_session_id, null);
assert.deepEqual(repo.listSessions().map((s) => s.id), [s2.id, s1.id]);
await sleep();
repo.setAgentSessionId(s1.id, "agent-1");
assert.deepEqual(repo.listSessions().map((s) => s.id), [s1.id, s2.id]);
assert.equal(repo.getSession(s1.id)?.agent_session_id, "agent-1");
assert.equal(repo.getSession("nope"), undefined);
assert.equal(repo.getSet("nope"), undefined);
assert.equal(repo.getApproval("nope"), undefined);
assert.equal(repo.getCurrentSet(s1.id), undefined);

// ---------- recordProposal ----------
const a = repo.recordProposal(s1.id, "[DJ MIX] A", "classic", ["t1", "t2", "t3"], "pedido 1", null);
assert.equal(a.version.version, 1);
assert.equal(a.set.status, "rascunho");
assert.deepEqual(a.version.order, ["t1", "t2", "t3"]);
assert.equal(a.version.note, "pedido 1");
assert.equal(a.version.snapshot, null);

// mesma ordem: sem versão nova; a versão sem snapshot recebe o que veio, e a que já tem não é trocada
const same = repo.recordProposal(s1.id, "x", "y", ["t1", "t2", "t3"], null, snap("classic"));
assert.equal(same.version.id, a.version.id);
assert.deepEqual(same.version.snapshot, snap("classic"));
assert.deepEqual(repo.latestVersion(a.set.id)?.snapshot, snap("classic"));
repo.recordProposal(s1.id, "x", "y", ["t1", "t2", "t3"], null, snap("warm_up"));
assert.equal(repo.latestVersion(a.set.id)?.snapshot?.curve, "classic");
assert.equal(repo.listVersions(a.set.id).length, 1);

const b = repo.recordProposal(s1.id, "x", "y", ["t3", "t2", "t1"], "pedido 2", snap("peak_time"));
assert.equal(b.set.id, a.set.id);
assert.equal(b.version.version, 2);
assert.deepEqual(repo.listVersions(a.set.id).map((v) => v.version), [1, 2]);
assert.equal(repo.latestVersion(a.set.id)?.id, b.version.id);
assert.deepEqual(repo.latestVersion(a.set.id)?.snapshot, snap("peak_time"));

// aguardando_aprovacao volta a rascunho com nova versão
repo.setStatus(a.set.id, "aguardando_aprovacao");
const c = repo.recordProposal(s1.id, "x", "y", ["t3", "t2", "t1"], "mesma ordem", null);
assert.equal(c.set.id, a.set.id);
assert.equal(c.set.status, "rascunho");
assert.equal(c.version.version, 3);
assert.equal(c.version.snapshot, null);

// enviado: set novo, o enviado não muda
repo.setStatus(a.set.id, "aguardando_aprovacao");
const sent = repo.setStatus(a.set.id, "enviado", { playlist_id: "pl1", url: "https://sp/pl1" });
assert.equal(sent.spotify_playlist_id, "pl1");
assert.equal(sent.spotify_url, "https://sp/pl1");
const d = repo.recordProposal(s1.id, "[DJ MIX] A", "classic", ["t9"], "ajuste", null);
assert.notEqual(d.set.id, a.set.id);
assert.equal(d.set.status, "rascunho");
assert.equal(d.version.version, 1);
assert.equal(repo.getSet(a.set.id)?.status, "enviado");
assert.equal(repo.listVersions(a.set.id).length, 3);
assert.equal(repo.getCurrentSet(s1.id)?.id, d.set.id);

// ---------- máquina de estados ----------
const states: SetStatus[] = ["rascunho", "aguardando_aprovacao", "enviado"];
const valid = new Set(["rascunho>aguardando_aprovacao", "aguardando_aprovacao>enviado", "aguardando_aprovacao>rascunho"]);
for (const from of states) {
  for (const to of states) {
    const sess = repo.createSession("t");
    const { set } = repo.recordProposal(sess.id, "n", "classic", ["x"], null, null);
    if (from !== "rascunho") repo.setStatus(set.id, "aguardando_aprovacao");
    if (from === "enviado") repo.setStatus(set.id, "enviado");
    if (from === to || valid.has(`${from}>${to}`)) {
      assert.equal(repo.setStatus(set.id, to).status, to, `${from}>${to}`);
    } else {
      assert.throws(() => repo.setStatus(set.id, to), InvalidTransitionError, `${from}>${to}`);
      assert.equal(repo.getSet(set.id)?.status, from);
    }
  }
}
assert.throws(() => repo.setStatus("nope", "enviado"), /inexistente/);

// ---------- planos ----------
const plan = (position: number, score: number | null) => ({
  position, from_track: "a", to_track: "b", plan: { kind: "blend", n: position }, planner_version: "v1", score,
});
repo.savePlans(b.version.id, [plan(1, 0.5), plan(2, null)]);
assert.equal(repo.listPlans(b.version.id).length, 2);
repo.savePlans(b.version.id, [plan(1, 0.9)]);
const plans = repo.listPlans(b.version.id);
assert.equal(plans.length, 1);
assert.deepEqual(plans[0]?.plan, { kind: "blend", n: 1 });
assert.equal(plans[0]?.score, 0.9);
assert.equal(repo.listPlans(c.version.id).length, 0);

// ---------- aprovações ----------
const ap = repo.createApproval(s1.id, d.set.id, "spotify_create_playlist_from_order", { ids: ["t9"] });
assert.equal(ap.status, "pending");
assert.deepEqual(repo.getApproval(ap.id)?.payload, { ids: ["t9"] });
const done = repo.decideApproval(ap.id, "approved");
assert.equal(done.status, "approved");
assert.ok(done.decided_at);
assert.throws(() => repo.decideApproval(ap.id, "rejected"), /já decidida/);
assert.throws(() => repo.decideApproval("nope", "approved"), /inexistente/);
assert.equal(repo.getApproval(ap.id)?.status, "approved");

// ---------- turnos ----------
const evs: ServerEvent[] = [
  { type: "text", text: "olá" },
  { type: "tool_start", tool: "dj_build_set", tool_use_id: "u1", detail: "Eletro · curva classic" },
  { type: "tool_end", tool: "dj_build_set", tool_use_id: "u1", is_error: false, detail: "21 faixas · curva classic" },
];
const turnA = repo.addTurn(s2.id, "monte um set", evs, 0.03);
await sleep();
const turnB = repo.addTurn(s2.id, "de novo", [], null);
assert.deepEqual(repo.listTurns(s2.id), [turnA, turnB]); // mais antigo primeiro
assert.deepEqual(repo.listTurns(s2.id)[0]?.events, evs);
assert.equal(repo.listTurns(s2.id)[1]?.cost_usd, null);
assert.deepEqual(repo.listTurns("nope"), []);
assert.throws(() => repo.addTurn("nope", "x", [], null), /FOREIGN KEY/);

repo.close();

// ---------- migração do banco em arquivo: novo grava v2; v1 (Sprint 2) sobe para v2 sem perder dados ----------
const dir = mkdtempSync(join(tmpdir(), "playme-repo-"));
const userVersion = (file: string) => {
  const db = new DatabaseSync(file);
  const v = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  db.close();
  return v;
};
try {
  const fresh = join(dir, "novo.sqlite");
  openRepo(fresh).close();
  assert.equal(userVersion(fresh), 2);

  const file = join(dir, "v1.sqlite");
  const seed = openRepo(file);
  const old = seed.createSession("antiga");
  const oldSet = seed.recordProposal(old.id, "[DJ MIX] Antiga", "classic", ["o1", "o2"], "pedido antigo", null);
  seed.close();
  // rebaixa à mão para o schema da Sprint 2: sem snapshot_json e sem turns
  const raw = new DatabaseSync(file);
  raw.exec("DROP TABLE turns; ALTER TABLE set_versions DROP COLUMN snapshot_json; PRAGMA user_version = 1;");
  raw.close();
  assert.equal(userVersion(file), 1);

  const migrated = openRepo(file);
  const [v1] = migrated.listVersions(oldSet.set.id);
  assert.deepEqual(v1?.order, ["o1", "o2"]);
  assert.equal(v1?.note, "pedido antigo");
  assert.equal(v1?.snapshot, null);
  assert.equal(migrated.getCurrentSet(old.id)?.id, oldSet.set.id);
  migrated.addTurn(old.id, "depois da migração", [], null);
  assert.equal(migrated.listTurns(old.id).length, 1);
  assert.deepEqual(migrated.recordProposal(old.id, "x", "classic", ["o1", "o2"], null, snap("classic")).version.snapshot, snap("classic"));
  migrated.close();
  assert.equal(userVersion(file), 2);
  openRepo(file).close(); // abrir de novo não migra outra vez (um segundo ADD COLUMN falharia)
  assert.equal(userVersion(file), 2);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log("[ok] repo: sessões, versões e snapshot, turnos, migração v1 para v2, máquina de estados, planos e aprovações");
