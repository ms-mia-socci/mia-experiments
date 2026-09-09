import { randomUUID } from "node:crypto";
import { writeBlob } from "./blobs";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { put, items, transaction } from "./store";
import { requestApproval, assertActiveRun } from "./approvals";
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
  const decision = await requestApproval(ctx, args);
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
  await assertActiveRun(ctx);
  const blobPath = join(
    folder,
    process.env.FIELDWORK_ARTIFACT_BUCKET
      ? `${randomUUID()}-${args.filename}`
      : args.filename,
  );
  await writeBlob(blobPath, bytes);
  await transaction(async () => {
    await assertActiveRun(ctx);
    await put(`documents:${ctx.thread.id}`, args.filename, {
      filename: args.filename,
      ...(process.env.FIELDWORK_ARTIFACT_BUCKET
        ? { blobPath }
        : { content: pdf ? bytes.toString("base64") : args.content }),
      encoding: pdf ? "base64" : "utf8",
    });
  });
  const url = `/api/threads/${ctx.thread.id}/documents/${args.filename}`;
  ctx.setState(
    "documents",
    (await items<{ filename: string }>(`documents:${ctx.thread.id}`)).map(
      ({ filename }) => ({
        filename,
        url: `/api/threads/${ctx.thread.id}/documents/${filename}`,
      }),
    ),
  );
  return { saved: true, filename: args.filename, url };
}
