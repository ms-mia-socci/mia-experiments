import { listConversations } from "$lib/server/conversations";
import { json, error } from "@sveltejs/kit";
import { requireUser, requireOrigin, available } from "$lib/server/auth";
import { createThread } from "$lib/server/store";
import { isFramework } from "$lib/catalog";
export const GET: import("./$types").RequestHandler = async (event) => {
  const owner = requireUser(event).id;
  return json(
    await listConversations(
      owner,
      event.url.searchParams.get("q")?.slice(0, 200) || "",
      event.url.searchParams.get("archived") === "1",
    ),
  );
};
export const POST: import("./$types").RequestHandler = async (event) => {
  requireOrigin(event);
  const user = requireUser(event);
  const body = await event.request.json().catch(() => ({}));
  const framework = body.framework ?? null;
  if (framework !== null && !isFramework(framework))
    error(400, "Unknown framework");
  if (
    framework &&
    !available()[framework as keyof ReturnType<typeof available>]
  )
    error(409, "This framework needs credentials before it can run.");
  return json(await createThread(user.id, framework));
};
