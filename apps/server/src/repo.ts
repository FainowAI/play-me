/**
 * Repositório SQLite (node:sqlite). CONTRATO: interface Repo e openRepo são usadas pelas
 * trilhas agente e HTTP; a implementação é da trilha banco.
 */
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { Approval, ChatSession, PlanInput, PlanRow, SetRow, SetStatus, SetVersion } from "./types.js";

export class InvalidTransitionError extends Error {
  constructor(from: SetStatus, to: SetStatus) {
    super(`Transição de estado inválida: ${from} → ${to}.`);
    this.name = "InvalidTransitionError";
  }
}

export interface Repo {
  createSession(title: string): ChatSession;
  getSession(id: string): ChatSession | undefined;
  listSessions(): ChatSession[]; // mais recente primeiro
  setAgentSessionId(id: string, agentSessionId: string): void;

  getSet(id: string): SetRow | undefined;
  /** Set mais recente da sessão (qualquer estado). */
  getCurrentSet(chatSessionId: string): SetRow | undefined;
  /**
   * Grava uma proposta do agente como nova versão (regras 3 e 4 da EAP):
   * - sem set na sessão → cria set em rascunho, versão 1;
   * - set em rascunho → nova versão (N+1) no mesmo set;
   * - set aguardando aprovação → volta para rascunho e ganha nova versão;
   * - set enviado → cria set NOVO (mesmo nome e curva) em rascunho, versão 1. O enviado nunca muda.
   * Se a ordem for igual à da última versão do set em rascunho, não cria versão nova: devolve a última.
   */
  recordProposal(chatSessionId: string, name: string, curve: string, order: string[], note: string | null): { set: SetRow; version: SetVersion };
  listVersions(setId: string): SetVersion[]; // versão 1 primeiro
  latestVersion(setId: string): SetVersion | undefined;
  savePlans(versionId: string, plans: PlanInput[]): void; // substitui os planos da versão
  listPlans(versionId: string): PlanRow[];
  /** Aplica a máquina de estados; lança InvalidTransitionError fora das transições permitidas. */
  setStatus(setId: string, status: SetStatus, spotify?: { playlist_id: string | null; url: string | null }): SetRow;

  createApproval(chatSessionId: string, setId: string | null, action: string, payload: unknown): Approval;
  getApproval(id: string): Approval | undefined;
  /** Só decide approval pendente; lança Error se já decidida ou inexistente. */
  decideApproval(id: string, decision: "approved" | "rejected"): Approval;

  close(): void;
}

const SCHEMA = `
CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  agent_session_id TEXT,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE sets (
  id TEXT PRIMARY KEY,
  chat_session_id TEXT NOT NULL REFERENCES chat_sessions(id),
  name TEXT NOT NULL,
  curve TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'aguardando_aprovacao', 'enviado')),
  spotify_playlist_id TEXT,
  spotify_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE set_versions (
  id TEXT PRIMARY KEY,
  set_id TEXT NOT NULL REFERENCES sets(id),
  version INTEGER NOT NULL,
  order_json TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (set_id, version)
);
CREATE TABLE transition_plans (
  id TEXT PRIMARY KEY,
  set_version_id TEXT NOT NULL REFERENCES set_versions(id),
  position INTEGER NOT NULL,
  from_track TEXT NOT NULL,
  to_track TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  planner_version TEXT NOT NULL,
  score REAL,
  created_at TEXT NOT NULL
);
CREATE TABLE transition_feedback (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES transition_plans(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  chat_session_id TEXT NOT NULL REFERENCES chat_sessions(id),
  set_id TEXT REFERENCES sets(id),
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_at TEXT,
  created_at TEXT NOT NULL
);
`;

const ALLOWED: Record<SetStatus, SetStatus[]> = {
  rascunho: ["aguardando_aprovacao"],
  aguardando_aprovacao: ["enviado", "rascunho"],
  enviado: [],
};

// ponytail: node:sqlite devolve linhas genéricas; casts localizados aqui.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const now = () => new Date().toISOString();

const raw = <T>(r: Row) => r as T;
const toVersion = (r: Row): SetVersion => ({
  id: r.id, set_id: r.set_id, version: r.version, order: JSON.parse(r.order_json), note: r.note, created_at: r.created_at,
});
const toApproval = (r: Row): Approval => ({
  id: r.id, chat_session_id: r.chat_session_id, set_id: r.set_id, action: r.action,
  payload: JSON.parse(r.payload_json), status: r.status, decided_at: r.decided_at, created_at: r.created_at,
});
const toPlan = (r: Row): PlanRow => ({
  id: r.id, set_version_id: r.set_version_id, position: r.position, from_track: r.from_track, to_track: r.to_track,
  plan: JSON.parse(r.plan_json), planner_version: r.planner_version, score: r.score, created_at: r.created_at,
});

/** Abre (e migra) o banco. dbPath ":memory:" para testes. */
export function openRepo(dbPath: string): Repo {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  const version = (db.prepare("PRAGMA user_version").get() as Row).user_version;
  if (version === 0) db.exec(`BEGIN; ${SCHEMA} PRAGMA user_version = 1; COMMIT;`);

  const one = <T>(sql: string, map: (r: Row) => T, ...args: string[]): T | undefined => {
    const r = db.prepare(sql).get(...args) as Row | undefined;
    return r && map(r);
  };
  const all = <T>(sql: string, map: (r: Row) => T, ...args: string[]): T[] =>
    (db.prepare(sql).all(...args) as Row[]).map(map);
  const tx = <T>(fn: () => T): T => {
    db.exec("BEGIN");
    try {
      const out = fn();
      db.exec("COMMIT");
      return out;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const touch = (sessionId: string) =>
    db.prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?").run(now(), sessionId);

  const getSession = (sid: string) => one("SELECT * FROM chat_sessions WHERE id = ?", raw<ChatSession>, sid);
  const getSet = (sid: string) => one("SELECT * FROM sets WHERE id = ?", raw<SetRow>, sid);
  const listVersions = (setId: string) =>
    all("SELECT * FROM set_versions WHERE set_id = ? ORDER BY version", toVersion, setId);
  const latestVersion = (setId: string) =>
    one("SELECT * FROM set_versions WHERE set_id = ? ORDER BY version DESC LIMIT 1", toVersion, setId);
  const getApproval = (aid: string) => one("SELECT * FROM approvals WHERE id = ?", toApproval, aid);
  const getCurrentSet = (chatSessionId: string) =>
    one("SELECT * FROM sets WHERE chat_session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", raw<SetRow>, chatSessionId);

  function addVersion(setId: string, n: number, order: string[], note: string | null): SetVersion {
    const v: SetVersion = { id: randomUUID(), set_id: setId, version: n, order, note, created_at: now() };
    db.prepare("INSERT INTO set_versions (id, set_id, version, order_json, note, created_at) VALUES (?,?,?,?,?,?)")
      .run(v.id, setId, n, JSON.stringify(order), note, v.created_at);
    return v;
  }
  function addSet(chatSessionId: string, name: string, curve: string): SetRow {
    const t = now();
    const s: SetRow = {
      id: randomUUID(), chat_session_id: chatSessionId, name, curve, status: "rascunho",
      spotify_playlist_id: null, spotify_url: null, created_at: t, updated_at: t,
    };
    db.prepare("INSERT INTO sets (id, chat_session_id, name, curve, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)")
      .run(s.id, chatSessionId, name, curve, s.status, t, t);
    return s;
  }

  return {
    createSession(title) {
      const t = now();
      const s: ChatSession = { id: randomUUID(), agent_session_id: null, title, created_at: t, updated_at: t };
      db.prepare("INSERT INTO chat_sessions (id, agent_session_id, title, created_at, updated_at) VALUES (?,?,?,?,?)")
        .run(s.id, null, title, t, t);
      return s;
    },
    getSession,
    listSessions: () => all("SELECT * FROM chat_sessions ORDER BY updated_at DESC, rowid DESC", raw<ChatSession>),
    setAgentSessionId(sid, agentSessionId) {
      db.prepare("UPDATE chat_sessions SET agent_session_id = ?, updated_at = ? WHERE id = ?").run(agentSessionId, now(), sid);
    },

    getSet,
    getCurrentSet,
    recordProposal(chatSessionId, name, curve, order, note) {
      return tx(() => {
        let set = getCurrentSet(chatSessionId);
        let out: { set: SetRow; version: SetVersion };
        if (!set || set.status === "enviado") {
          set = addSet(chatSessionId, name, curve);
          out = { set, version: addVersion(set.id, 1, order, note) };
        } else {
          const last = latestVersion(set.id);
          if (set.status === "rascunho" && last && JSON.stringify(last.order) === JSON.stringify(order)) {
            out = { set, version: last };
          } else {
            db.prepare("UPDATE sets SET status = 'rascunho', updated_at = ? WHERE id = ?").run(now(), set.id);
            out = { set: getSet(set.id)!, version: addVersion(set.id, (last?.version ?? 0) + 1, order, note) };
          }
        }
        touch(chatSessionId);
        return out;
      });
    },
    listVersions,
    latestVersion,
    savePlans(versionId, plans) {
      tx(() => {
        db.prepare("DELETE FROM transition_plans WHERE set_version_id = ?").run(versionId);
        const ins = db.prepare(
          "INSERT INTO transition_plans (id, set_version_id, position, from_track, to_track, plan_json, planner_version, score, created_at) VALUES (?,?,?,?,?,?,?,?,?)");
        for (const p of plans) {
          ins.run(randomUUID(), versionId, p.position, p.from_track, p.to_track, JSON.stringify(p.plan), p.planner_version, p.score, now());
        }
      });
    },
    listPlans: (versionId) => all("SELECT * FROM transition_plans WHERE set_version_id = ? ORDER BY position", toPlan, versionId),
    setStatus(setId, status, spotify) {
      const set = getSet(setId);
      if (!set) throw new Error(`Set inexistente: ${setId}.`);
      if (set.status !== status && !ALLOWED[set.status].includes(status)) throw new InvalidTransitionError(set.status, status);
      db.prepare("UPDATE sets SET status = ?, spotify_playlist_id = ?, spotify_url = ?, updated_at = ? WHERE id = ?")
        .run(status, spotify ? spotify.playlist_id : set.spotify_playlist_id, spotify ? spotify.url : set.spotify_url, now(), setId);
      return getSet(setId)!;
    },

    createApproval(chatSessionId, setId, action, payload) {
      const a: Approval = {
        id: randomUUID(), chat_session_id: chatSessionId, set_id: setId, action, payload,
        status: "pending", decided_at: null, created_at: now(),
      };
      db.prepare("INSERT INTO approvals (id, chat_session_id, set_id, action, payload_json, status, created_at) VALUES (?,?,?,?,?,?,?)")
        .run(a.id, chatSessionId, setId, action, JSON.stringify(payload ?? null), a.status, a.created_at);
      return a;
    },
    getApproval,
    decideApproval(aid, decision) {
      const a = getApproval(aid);
      if (!a) throw new Error(`Aprovação inexistente: ${aid}.`);
      if (a.status !== "pending") throw new Error(`Aprovação ${aid} já decidida (${a.status}).`);
      db.prepare("UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?").run(decision, now(), aid);
      return getApproval(aid)!;
    },

    close: () => db.close(),
  };
}
