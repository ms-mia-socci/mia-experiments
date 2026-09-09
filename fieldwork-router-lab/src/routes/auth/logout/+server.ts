import { redirect } from "@sveltejs/kit";
import { requireOrigin } from "$lib/server/auth";
export const POST: import("./$types").RequestHandler = (event) => {
  requireOrigin(event);
  event.cookies.delete("fieldwork_person", { path: "/" });
  redirect(303, "/");
};
