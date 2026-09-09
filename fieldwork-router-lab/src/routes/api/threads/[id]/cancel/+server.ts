import { error, json } from "@sveltejs/kit";
import { requireOrigin, requireUser } from "$lib/server/auth";
import { ownedThread, updateThread, transaction } from "$lib/server/store";
import { activeRuns } from "$lib/server/runner";
export const POST: import("./$types").RequestHandler = async (event) => {
  requireOrigin(event);
  let controller: AbortController | undefined;
  try {
    await transaction(async () => {
      const thread = await ownedThread(event.params.id, requireUser(event).id);
      if (thread.status !== "running") return;
      controller = activeRuns.get(thread.id);
      await updateThread(thread.id, {
        status: "cancelled",
        pendingApproval: null,
      });
    });
  } catch {
    error(404, "Conversation not found");
  }
  controller?.abort();
  return json({ ok: true });
};
