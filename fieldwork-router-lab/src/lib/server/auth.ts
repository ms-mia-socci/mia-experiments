import { error, type RequestEvent } from "@sveltejs/kit";
export function requireUser(event: RequestEvent) {
  if (!event.locals.user) error(401, "Choose a person to continue.");
  return event.locals.user;
}
export function requireOrigin(event: RequestEvent) {
  if (event.request.headers.get("origin") !== event.url.origin)
    error(403, "Invalid request origin");
}
export function available() {
  return {
    strands: !!process.env.ANTHROPIC_API_KEY,
    claude: !!process.env.ANTHROPIC_API_KEY,
    codex: !!process.env.OPENAI_API_KEY && !!process.env.OPENAI_API_ENDPOINT,
  };
}
