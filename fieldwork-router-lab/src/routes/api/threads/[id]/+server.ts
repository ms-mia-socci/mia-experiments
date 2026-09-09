import { editConversation } from "$lib/server/conversations";
import { requireOrigin } from "$lib/server/auth";
import { uploadRefs } from "$lib/server/uploads";
import { json, error } from "@sveltejs/kit";
import { requireUser } from "$lib/server/auth";
import { recoverExpiredRun, items, events } from "$lib/server/store";
export const GET: import("./$types").RequestHandler = async (event) => {
  let t;
  try {
    t = await recoverExpiredRun(event.params.id, requireUser(event).id);
  } catch {
    error(404, "Conversation not found");
  }
  return json({
    ...t,
    uploads: await uploadRefs(t.id),
    events: await events(t.id, t.runId),
    documents: (await items(`documents:${t.id}`)).map(({ filename }) => ({
      filename,
      url: `/api/threads/${t.id}/documents/${filename}`,
    })),
  });
};

export const PATCH: import("./$types").RequestHandler = async (event) => {
  requireOrigin(event);
  const owner = requireUser(event).id;
  try {
    const t = await editConversation(
      event.params.id,
      owner,
      await event.request.json(),
    );
    return json({
      id: t.id,
      title: t.title,
      pinned: !!t.pinned,
      archived: !!t.archived,
    });
  } catch (e) {
    const message = (e as Error).message;
    if (message === "NOT_FOUND") error(404, "Conversation not found");
    if (message === "BUSY") error(409, "Stop the run before archiving");
    error(
      400,
      "Use a title of 1–80 characters and valid conversation settings",
    );
  }
};
