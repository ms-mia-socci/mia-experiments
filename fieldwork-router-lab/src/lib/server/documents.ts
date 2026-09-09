import { z } from "zod";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { get, put, updateThread, type Thread, type Approval } from "./store";
import { renderPdf } from "./rendering/pdf";
import type { RunContext } from "./providers";
export const documentSchema = z.object({
  filename: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}\.(txt|md|csv|json|html|pdf)$/),
  content: z.string().max(100000),
  reason: z.string().max(1000),
});
export async function saveDocument(
  ctx: RunContext,
  input: z.infer<typeof documentSchema>,
) {
  const args = documentSchema.parse(input);
  const id = randomUUID();
  const approval: Approval = {
    ...args,
    id,
    runId: ctx.thread.runId!,
    expiresAt: Date.now() + 90000,
    status: "pending",
  };
  ctx.controller.signal.throwIfAborted();
  updateThread(ctx.thread.id, { pendingApproval: approval });
  ctx.emit({ type: "CUSTOM", name: "approval_requested", value: approval });
  let decision = "expired";
  while (Date.now() < approval.expiresAt) {
    ctx.controller.signal.throwIfAborted();
    const t = get<Thread>("threads", ctx.thread.id);
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
  updateThread(ctx.thread.id, { pendingApproval: null });
  ctx.emit({
    type: "CUSTOM",
    name: "approval_resolved",
    value: { id, decision, filename: args.filename },
  });
  put(`decisions:${ctx.thread.id}`, id, {
    ...approval,
    status: decision,
    at: new Date().toISOString(),
  });
  if (decision !== "approved")
    return {
      saved: false,
      decision,
      message: "Not authorized. Do not retry in this turn.",
    };
  ctx.controller.signal.throwIfAborted();
  const pdf = args.filename.endsWith(".pdf");
  const bytes = pdf
    ? await renderPdf(args.content, ctx.controller.signal)
    : Buffer.from(args.content);
  const folder = join(
    process.env.FIELDWORK_WORKSPACES!,
    ctx.thread.id,
    "documents",
  );
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, args.filename), bytes, { mode: 0o600 });
  put(`documents:${ctx.thread.id}`, args.filename, {
    filename: args.filename,
    content: pdf ? bytes.toString("base64") : args.content,
    encoding: pdf ? "base64" : "utf8",
  });
  const url = `/api/threads/${ctx.thread.id}/documents/${args.filename}`;
  ctx.emit({
    type: "CUSTOM",
    name: "document_saved",
    value: { filename: args.filename, url },
  });
  return { saved: true, filename: args.filename, url };
}
