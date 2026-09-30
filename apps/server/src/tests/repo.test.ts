import assert from "node:assert/strict";
import { InvalidTransitionError, openRepo } from "../repo.js";
import type { SetStatus } from "../types.js";

const repo = openRepo(":memory:");
const sleep = () => new Promise((r) => setTimeout(r, 3));

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
const a = repo.recordProposal(s1.id, "[DJ MIX] A", "classic", ["t1", "t2", "t3"], "pedido 1");
assert.equal(a.version.version, 1);
assert.equal(a.set.status, "rascunho");
assert.deepEqual(a.version.order, ["t1", "t2", "t3"]);
assert.equal(a.version.note, "pedido 1");

const same = repo.recordProposal(s1.id, "x", "y", ["t1", "t2", "t3"], null);
assert.equal(same.version.id, a.version.id);
assert.equal(repo.listVersions(a.set.id).length, 1);

const b = repo.recordProposal(s1.id, "x", "y", ["t3", "t2", "t1"], "pedido 2");
assert.equal(b.set.id, a.set.id);
assert.equal(b.version.version, 2);
assert.deepEqual(repo.listVersions(a.set.id).map((v) => v.version), [1, 2]);
assert.equal(repo.latestVersion(a.set.id)?.id, b.version.id);

// aguardando_aprovacao volta a rascunho com nova versão
repo.setStatus(a.set.id, "aguardando_aprovacao");
const c = repo.recordProposal(s1.id, "x", "y", ["t3", "t2", "t1"], "mesma ordem");
assert.equal(c.set.id, a.set.id);
assert.equal(c.set.status, "rascunho");
assert.equal(c.version.version, 3);

// enviado: set novo, o enviado não muda
repo.setStatus(a.set.id, "aguardando_aprovacao");
const sent = repo.setStatus(a.set.id, "enviado", { playlist_id: "pl1", url: "https://sp/pl1" });
assert.equal(sent.spotify_playlist_id, "pl1");
assert.equal(sent.spotify_url, "https://sp/pl1");
const d = repo.recordProposal(s1.id, "[DJ MIX] A", "classic", ["t9"], "ajuste");
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
    const { set } = repo.recordProposal(sess.id, "n", "classic", ["x"], null);
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

repo.close();
console.log("[ok] repo: sessões, versões, máquina de estados, planos e aprovações");
