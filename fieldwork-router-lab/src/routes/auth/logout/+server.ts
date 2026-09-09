import { put } from "$lib/server/store";
import { redirect } from "@sveltejs/kit";
import { requireOrigin } from "$lib/server/auth";
export const POST: import("./$types").RequestHandler = async (event) => {
  requireOrigin(event);
  const token = event.cookies.get("fieldwork_person");
  if (token) await put("sessions", token, { expires: 0 });
  event.cookies.delete("fieldwork_person", { path: "/" });
  if (process.env.FIELDWORK_OIDC_DOMAIN)
    redirect(
      303,
      `${process.env.FIELDWORK_OIDC_DOMAIN}/logout?client_id=${process.env.FIELDWORK_OIDC_CLIENT_ID}&logout_uri=${encodeURIComponent(process.env.ORIGIN + "/")}`,
    );
  redirect(303, "/");
};
