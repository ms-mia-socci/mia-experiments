import { handleCodexTools } from "$lib/server/codex-tools";
export const POST: import("./$types").RequestHandler = async ({ request }) =>
  await handleCodexTools(request);
