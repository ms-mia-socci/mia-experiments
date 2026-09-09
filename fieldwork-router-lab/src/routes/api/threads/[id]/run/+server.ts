import { invokeRuntime } from "$lib/server/remote-runtime";
import { uploaded } from "$lib/server/uploads";
import { error } from "@sveltejs/kit";
import { RunAgentInputSchema } from "@ag-ui/core";
import { requireOrigin, requireUser, available } from "$lib/server/auth";
import { ownedThread, beginRun } from "$lib/server/store";
import { isFramework } from "$lib/catalog";
import { streamRun } from "$lib/server/runner";
export const POST: import("./$types").RequestHandler = async (event) => {
  requireOrigin(event);
  const owner = requireUser(event).id;
  const raw = await event.request.text();
  if (raw.length > 30000) error(413, "Message too long");
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    error(400, "Invalid JSON");
  }
  const parsed = RunAgentInputSchema.safeParse(body);
  if (!parsed.success) error(400, "Invalid AG-UI request");
  const input = parsed.data;
  const last = input.messages.filter((m) => m.role === "user").at(-1);
  if (
    !last ||
    typeof last.content !== "string" ||
    !last.content.trim() ||
    last.content.length > 8000
  )
    error(400, "Enter a message under 8,000 characters.");
  const handoff = input.forwardedProps?.handoff;
  if (handoff !== undefined && (!isFramework(handoff) || !available()[handoff]))
    error(409, "That framework is not available.");
  let current;
  try {
    current = await ownedThread(event.params.id, owner);
  } catch {
    error(404, "Conversation not found");
  }
  if (handoff && current.phase !== "routing")
    error(409, "Start a new conversation to switch frameworks.");
  // The server chooses the handoff brief from saved state; the browser cannot supply hidden instructions.
  const text = handoff
    ? `Please carry out this task: ${
        current.recommendation?.brief ||
        current.messages
          .filter((m) => m.role === "user")
          .map((m) => m.content)
          .join("\n")
      }`
    : last.content;
  const ids = input.forwardedProps?.attachmentIds ?? [];
  if (
    !Array.isArray(ids) ||
    ids.length > 5 ||
    ids.some((id) => typeof id !== "string")
  )
    error(400, "Invalid attachments");
  let attachments;
  try {
    attachments = await Promise.all(
      [...new Set(ids)].map(async (id) => {
        const { path, imagePath, text, ...ref } = await uploaded(
          current.id,
          id,
        );
        return ref;
      }),
    );
  } catch {
    error(404, "Attachment not found");
  }
  let thread;
  try {
    thread = await beginRun(current.id, owner, text, handoff, attachments);
  } catch (e) {
    error(
      409,
      (e as Error).message === "BUSY"
        ? "This conversation already has a running task."
        : "Conversation run limit reached.",
    );
  }
  return process.env.FIELDWORK_RUNTIME_ARN
    ? invokeRuntime(thread, !!handoff)
    : streamRun(thread, !!handoff);
};
