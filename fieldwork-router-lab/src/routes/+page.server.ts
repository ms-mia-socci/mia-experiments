import { available } from "$lib/server/auth";
export const load = ({ locals }: import("./$types").PageServerLoadEvent) => ({
  user: locals.user || null,
  available: available(),
});
