import { uploadRefs } from "$lib/server/uploads";
import { json, error } from "@sveltejs/kit";
import { requireUser } from "$lib/server/auth";
import { ownedThread, items, events } from "$lib/server/store";
export const GET: import("./$types").RequestHandler = (event) => {
  let t;
  try {
    t = ownedThread(event.params.id, requireUser(event).id);
  } catch {
    error(404, "Conversation not found");
  }
  return json({
    ...t,
    uploads: uploadRefs(t.id),
    events: events(t.id, t.runId),
    documents: items(`documents:${t.id}`).map(({ filename }) => ({
      filename,
      url: `/api/threads/${t.id}/documents/${filename}`,
    })),
  });
};
