import { error, json } from "@sveltejs/kit";
import { requireOrigin, requireUser } from "$lib/server/auth";
import { ownedThread, updateThread } from "$lib/server/store";
import { activeRuns } from "$lib/server/runner";
export const POST: import("./$types").RequestHandler = (event) => {
  requireOrigin(event);
  try {
    ownedThread(event.params.id, requireUser(event).id);
  } catch {
    error(404, "Conversation not found");
  }
  activeRuns.get(event.params.id)?.abort();
  updateThread(event.params.id, { status: "cancelled", pendingApproval: null });
  return json({ ok: true });
};
