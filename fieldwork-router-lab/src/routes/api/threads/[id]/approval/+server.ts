import { error, json } from "@sveltejs/kit";
import { requireUser, requireOrigin } from "$lib/server/auth";
import { decide } from "$lib/server/store";
export const POST: import("./$types").RequestHandler = async (event) => {
  requireOrigin(event);
  const owner = requireUser(event).id;
  const { id, decision } = await event.request.json();
  if (!["approved", "denied"].includes(decision))
    error(400, "Invalid decision");
  try {
    await decide(event.params.id, owner, id, decision);
  } catch (e) {
    error(
      (e as Error).message === "NOT_FOUND" ? 404 : 409,
      "Approval is no longer available.",
    );
  }
  return json({ ok: true });
};
