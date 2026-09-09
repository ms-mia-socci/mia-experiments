import { randomUUID } from "node:crypto";
import {
  get,
  put,
  updateThread,
  transaction,
  type Thread,
  type Approval,
} from "./store";
import type { RunContext } from "./providers";
export async function assertActiveRun(ctx: RunContext) {
  ctx.controller.signal.throwIfAborted();
  const t = await get<Thread>("threads", ctx.thread.id);
  if (
    !t ||
    t.owner !== ctx.thread.owner ||
    t.runId !== ctx.thread.runId ||
    t.status !== "running"
  )
    throw new Error("Run stopped");
}
export async function requestApproval(
  ctx: RunContext,
  args: Pick<Approval, "filename" | "content" | "reason" | "kind">,
) {
  await assertActiveRun(ctx);
  if ((await get<Thread>("threads", ctx.thread.id))?.pendingApproval)
    throw new Error(
      "Another approval is pending. Wait for it before requesting another action.",
    );
  const id = randomUUID();
  const approval: Approval = {
    ...args,
    id,
    runId: ctx.thread.runId!,
    expiresAt: Date.now() + 90000,
    status: "pending",
  };
  ctx.controller.signal.throwIfAborted();
  await transaction(async () => {
    await assertActiveRun(ctx);
    if ((await get<Thread>("threads", ctx.thread.id))?.pendingApproval)
      throw Error("Another approval is pending");
    await updateThread(ctx.thread.id, { pendingApproval: approval });
  });
  ctx.setState("approval", approval);
  let decision = "expired";
  while (Date.now() < approval.expiresAt) {
    ctx.controller.signal.throwIfAborted();
    const t = await get<Thread>("threads", ctx.thread.id);
    if (t?.runId !== ctx.thread.runId || t.status !== "running")
      throw new Error("Run stopped");
    if (
      t.pendingApproval?.id === id &&
      t.pendingApproval.status !== "pending"
    ) {
      decision = t.pendingApproval.status;
      break;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  await assertActiveRun(ctx);
  await updateThread(ctx.thread.id, { pendingApproval: null });
  ctx.setState("approval", null);
  await put(`decisions:${ctx.thread.id}`, id, {
    ...approval,
    status: decision,
    at: new Date().toISOString(),
  });
  await assertActiveRun(ctx);
  return decision;
}
