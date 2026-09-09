import { replayEvents, chatMessages } from "../agui";
import { firstMessageTitle } from "../conversation-title";
import type { AttachmentRef } from "../attachments";
import { query, transaction } from "./database";
export { transaction } from "./database";
import { randomUUID, randomBytes } from "node:crypto";
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
  titleSource?: "manual" | "agent" | "first-message";
  pinned?: boolean;
  archived?: boolean;
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
  kind?: "code" | "document";
  id: string;
  runId: string;
  filename: string;
  content: string;
  reason: string;
  expiresAt: number;
  status: "pending" | "approved" | "denied";
};
export async function get<T = any>(
  scope: string,
  key: string,
): Promise<T | undefined> {
  const [row] = await query("SELECT data FROM items WHERE scope=? AND key=?", [
    scope,
    key,
  ]);
  return row ? JSON.parse(String(row.data)) : undefined;
}
export async function put(scope: string, key: string, value: unknown) {
  await query(
    "INSERT INTO items VALUES (?,?,?) ON CONFLICT(scope,key) DO UPDATE SET data=excluded.data",
    [scope, key, JSON.stringify(value)],
  );
}
export async function items<T = any>(scope: string): Promise<T[]> {
  return (await query("SELECT data FROM items WHERE scope=?", [scope])).map(
    (r) => JSON.parse(String(r.data)),
  );
}
export async function session(user: "mia" | "tim") {
  const token = randomBytes(32).toString("base64url");
  await put("sessions", token, {
    id: user,
    name: user === "mia" ? "Mia" : "Tim",
    expires: Date.now() + 86400000,
  });
  return token;
}
export async function createThread(owner: string, framework: Framework | null) {
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
  await put("threads", thread.id, thread);
  return thread;
}
export async function ownedThread(id: string, owner: string) {
  const t = await get<Thread>("threads", id);
  if (!t || t.owner !== owner) throw new Error("NOT_FOUND");
  return t;
}
export async function updateThread(id: string, values: Partial<Thread>) {
  return await transaction(async () => {
    const t = await get<Thread>("threads", id);
    if (!t) throw new Error("NOT_FOUND");
    const next = { ...t, ...values, updatedAt: new Date().toISOString() };
    await put("threads", id, next);
    return next;
  });
}
export async function beginRun(
  id: string,
  owner: string,
  text: string,
  handoff?: Framework,
  attachments: AttachmentRef[] = [],
) {
  return await transaction(async () => {
    const t = await ownedThread(id, owner);
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
      title:
        t.messages.length || t.titleSource === "manual"
          ? t.title
          : firstMessageTitle(text),
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
    await put("threads", id, next);
    return next;
  });
}
export async function appendEvent(thread: string, run: string, data: unknown) {
  await query("INSERT INTO events(thread,run,data) VALUES (?,?,?)", [
    thread,
    run,
    JSON.stringify(data),
  ]);
}
export async function events(thread: string, run: string | null) {
  return (
    await query(
      "SELECT data FROM events WHERE thread=? AND run=? ORDER BY seq",
      [thread, run || ""],
    )
  ).map((r) => JSON.parse(String(r.data)));
}
export async function decide(
  id: string,
  owner: string,
  approvalId: string,
  decision: "approved" | "denied",
) {
  await transaction(async () => {
    const t = await ownedThread(id, owner),
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
    await put("threads", id, {
      ...t,
      pendingApproval: { ...a, status: decision },
    });
  });
}

// A process restart loses in-memory controllers; expired leases must not leave
// the browser polling a permanently running conversation.
export async function recoverExpiredRun(id: string, owner: string) {
  const t = await ownedThread(id, owner);
  if (t.status !== "running" || t.deadline > Date.now()) return t;
  const restored = await replayEvents(await events(t.id, t.runId), t.messages);
  return await transaction(async () => {
    const current = await ownedThread(id, owner);
    if (
      current.runId !== t.runId ||
      current.status !== "running" ||
      current.deadline > Date.now()
    )
      return current;
    const recovered: Thread = {
      ...current,
      status: "error",
      messages: chatMessages(
        restored.messages,
        t.phase === "routing" ? "coordinator" : t.framework!,
      ),
      pendingApproval: null,
      updatedAt: new Date().toISOString(),
    };
    await put("threads", id, recovered);
    return recovered;
  });
}
