import { get } from "$lib/server/store";
export const handle: import("@sveltejs/kit").Handle = async ({
  event,
  resolve,
}) => {
  if (process.env.FIELDWORK_SERVICE === "agent") {
    if (
      !["/invocations", "/ping", "/api/agent-tools"].includes(
        event.url.pathname,
      )
    )
      return new Response("Not found", { status: 404 });
    return resolve(event);
  }
  if (
    event.url.pathname === "/invocations" ||
    (process.env.FIELDWORK_SERVICE === "web" &&
      event.url.pathname === "/api/agent-tools")
  )
    return new Response("Not found", { status: 404 });
  const token = event.cookies.get("fieldwork_person");
  if (token) {
    const user = await get("sessions", token);
    if (user?.expires > Date.now())
      event.locals.user = { id: user.id, name: user.name };
  }
  return resolve(event);
};
