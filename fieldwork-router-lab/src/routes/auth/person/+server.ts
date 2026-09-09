import { error, redirect } from "@sveltejs/kit";
import { requireOrigin } from "$lib/server/auth";
import { session } from "$lib/server/store";
export const POST: import("./$types").RequestHandler = async (event) => {
  if (process.env.FIELDWORK_SERVICE) error(404);
  requireOrigin(event);
  const user = (await event.request.formData()).get("person");
  if (user !== "mia" && user !== "tim") error(400, "Unknown person");
  event.cookies.set("fieldwork_person", await session(user), {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: false,
    maxAge: 86400,
  });
  redirect(303, "/");
};
