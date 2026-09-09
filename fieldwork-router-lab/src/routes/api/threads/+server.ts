import { json, error } from "@sveltejs/kit";
import { requireUser, requireOrigin, available } from "$lib/server/auth";
import { createThread, items, type Thread } from "$lib/server/store";
import { isFramework } from "$lib/catalog";
export const GET: import("./$types").RequestHandler = (event) => {
  const owner = requireUser(event).id;
  return json(
    items<Thread>("threads")
      .filter((t) => t.owner === owner)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ id, title, framework, phase, updatedAt }) => ({
        id,
        title,
        framework,
        phase,
        updatedAt,
      })),
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
  return json(createThread(user.id, framework));
};
