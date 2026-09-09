import { redirect } from "@sveltejs/kit";
import { memoryProfile, memoryConfigured } from "$lib/server/memory";
export const load: import("./$types").PageServerLoad = async ({ locals }) => {
  if (!locals.user) redirect(303, "/");
  return {
    user: locals.user,
    settings: (await memoryProfile(locals.user.id)).settings,
    configured: memoryConfigured(),
  };
};
