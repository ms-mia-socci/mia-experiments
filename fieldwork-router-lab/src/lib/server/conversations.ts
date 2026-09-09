import { z } from "zod";
import {
  get,
  items,
  ownedThread,
  put,
  transaction,
  type Thread,
  type Recommendation,
} from "./store";
export const conversationPatch = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);

export async function editConversation(
  id: string,
  owner: string,
  input: unknown,
) {
  const patch = conversationPatch.parse(input);
  return await transaction(async () => {
    const t = await ownedThread(id, owner);
    if (patch.archived && t.status === "running" && t.deadline > Date.now())
      throw Error("BUSY");
    const next = {
      ...t,
      ...patch,
      ...(patch.title ? { titleSource: "manual" as const } : {}),
    };
    await put("threads", id, next);
    return next;
  });
}
export async function recommendConversation(
  id: string,
  runId: string,
  recommendation: Recommendation,
  title?: string,
) {
  return await transaction(async () => {
    const t = await get<Thread>("threads", id);
    if (!t || t.runId !== runId || t.status !== "running")
      throw Error("Run stopped");
    const next = {
      ...t,
      recommendation,
      ...(title && t.titleSource !== "manual"
        ? { title, titleSource: "agent" as const }
        : {}),
    };
    await put("threads", id, next);
    return next;
  });
}
export async function listConversations(
  owner: string,
  query = "",
  archived = false,
) {
  const q = query.toLocaleLowerCase().trim();
  return (await items<Thread>("threads"))
    .filter(
      (t) =>
        t.owner === owner &&
        Boolean(t.archived) === archived &&
        (!q ||
          t.title.toLocaleLowerCase().includes(q) ||
          t.messages.some((m) => m.content.toLocaleLowerCase().includes(q))),
    )
    .sort(
      (a, b) =>
        Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
        b.updatedAt.localeCompare(a.updatedAt),
    )
    .map(({ id, title, framework, phase, updatedAt, pinned, archived }) => ({
      id,
      title,
      framework,
      phase,
      updatedAt,
      pinned: !!pinned,
      archived: !!archived,
    }));
}
