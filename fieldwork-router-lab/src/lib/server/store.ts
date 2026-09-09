import type { AttachmentRef } from "../attachments";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import type { Framework } from "$lib/catalog";
export type Message = {
  attachments?: AttachmentRef[];
  id: string;
  role: "user" | "assistant";
  content: string;
  agent: string;
};
export type Recommendation = {
  framework: Framework;
  reason: string;
  brief: string;
};
export type Thread = {
  id: string;
  owner: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  phase: "routing" | "active";
  framework: Framework | null;
  recommendation: Recommendation | null;
  messages: Message[];
  status: "ready" | "running" | "complete" | "cancelled" | "error";
  runId: string | null;
  deadline: number;
  pendingApproval: Approval | null;
  runCount: number;
};
export type Approval = {
  id: string;
  runId: string;
  filename: string;
  content: string;
  reason: string;
  expiresAt: number;
  status: "pending" | "approved" | "denied";
};
let connection: DatabaseSync;
function db() {
  if (!connection) {
    const path = process.env.FIELDWORK_DB;
    if (!path) throw new Error("Start this project with npm run dev.");
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    connection = new DatabaseSync(path);
    connection.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS items (scope TEXT, key TEXT, data TEXT, PRIMARY KEY(scope,key)); CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, thread TEXT, run TEXT, data TEXT);",
    );
    chmodSync(path, 0o600);
  }
  return connection;
}
export function get<T = any>(scope: string, key: string): T | undefined {
  const row = db()
    .prepare("SELECT data FROM items WHERE scope=? AND key=?")
    .get(scope, key);
  return row ? JSON.parse(String(row.data)) : undefined;
}
export function put(scope: string, key: string, value: unknown) {
  db()
    .prepare(
      "INSERT INTO items VALUES (?,?,?) ON CONFLICT(scope,key) DO UPDATE SET data=excluded.data",
    )
    .run(scope, key, JSON.stringify(value));
}
export function items<T = any>(scope: string): T[] {
  return db()
    .prepare("SELECT data FROM items WHERE scope=?")
    .all(scope)
    .map((r) => JSON.parse(String(r.data)));
}
export function transaction<T>(fn: () => T) {
  db().exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db().exec("COMMIT");
    return value;
  } catch (error) {
    db().exec("ROLLBACK");
    throw error;
  }
}
export function session(user: "mia" | "tim") {
  const token = randomBytes(32).toString("base64url");
  put("sessions", token, {
    id: user,
    name: user === "mia" ? "Mia" : "Tim",
    expires: Date.now() + 86400000,
  });
  return token;
}
export function createThread(owner: string, framework: Framework | null) {
  const now = new Date().toISOString();
  const thread: Thread = {
    id: randomUUID(),
    owner,
    title: "New conversation",
    createdAt: now,
    updatedAt: now,
    phase: framework ? "active" : "routing",
    framework,
    recommendation: null,
    messages: [],
    status: "ready",
    runId: null,
    deadline: 0,
    pendingApproval: null,
    runCount: 0,
  };
  put("threads", thread.id, thread);
  return thread;
}
export function ownedThread(id: string, owner: string) {
  const t = get<Thread>("threads", id);
  if (!t || t.owner !== owner) throw new Error("NOT_FOUND");
  return t;
}
export function updateThread(id: string, values: Partial<Thread>) {
  return transaction(() => {
    const t = get<Thread>("threads", id);
    if (!t) throw new Error("NOT_FOUND");
    const next = { ...t, ...values, updatedAt: new Date().toISOString() };
    put("threads", id, next);
    return next;
  });
}
export function beginRun(
  id: string,
  owner: string,
  text: string,
  handoff?: Framework,
  attachments: AttachmentRef[] = [],
) {
  return transaction(() => {
    const t = ownedThread(id, owner);
    if (t.status === "running" && t.deadline > Date.now())
      throw new Error("BUSY");
    if (t.runCount >= 40) throw new Error("LIMIT");
    const next: Thread = {
      ...t,
      phase: handoff ? "active" : t.phase,
      framework: handoff || t.framework,
      recommendation: handoff ? null : t.recommendation,
      status: "running",
      runId: randomUUID(),
      deadline: Date.now() + 240000,
      pendingApproval: null,
      runCount: t.runCount + 1,
      title: t.messages.length ? t.title : text.slice(0, 70),
      updatedAt: new Date().toISOString(),
      messages: [
        ...t.messages,
        {
          id: randomUUID(),
          role: "user" as const,
          content: text,
          agent: "user",
          attachments,
        },
      ].slice(-40),
    };
    put("threads", id, next);
    return next;
  });
}
export function appendEvent(thread: string, run: string, data: unknown) {
  db()
    .prepare("INSERT INTO events(thread,run,data) VALUES (?,?,?)")
    .run(thread, run, JSON.stringify(data));
}
export function events(thread: string, run: string | null) {
  return db()
    .prepare("SELECT data FROM events WHERE thread=? AND run=? ORDER BY seq")
    .all(thread, run || "")
    .map((r) => JSON.parse(String(r.data)));
}
export function decide(
  id: string,
  owner: string,
  approvalId: string,
  decision: "approved" | "denied",
) {
  transaction(() => {
    const t = ownedThread(id, owner),
      a = t.pendingApproval;
    if (
      !a ||
      a.id !== approvalId ||
      a.runId !== t.runId ||
      a.status !== "pending" ||
      a.expiresAt < Date.now() ||
      t.status !== "running"
    )
      throw new Error("EXPIRED");
    put("threads", id, { ...t, pendingApproval: { ...a, status: decision } });
  });
}
