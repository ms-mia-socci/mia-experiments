import { get } from "$lib/server/store";
export const handle: import("@sveltejs/kit").Handle = async ({
  event,
  resolve,
}) => {
  const token = event.cookies.get("fieldwork_person");
  if (token) {
    const user = get("sessions", token);
    if (user?.expires > Date.now())
      event.locals.user = { id: user.id, name: user.name };
  }
  return resolve(event);
};
