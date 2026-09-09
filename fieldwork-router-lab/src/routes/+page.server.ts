import { available } from "$lib/server/auth";
export const load = ({ locals }: import("./$types").PageServerLoadEvent) => ({
  user: locals.user || null,
  cloudLogin: Boolean(process.env.FIELDWORK_OIDC_ISSUER),
  available: available(),
});
