import { error, json } from "@sveltejs/kit";
import { requireOrigin, requireUser } from "$lib/server/auth";
import { ownedThread } from "$lib/server/store";
import { saveUploads, uploadRefs } from "$lib/server/uploads";
export const POST: import("./$types").RequestHandler = async (event) => {
  requireOrigin(event);
  const owner = requireUser(event).id;
  try {
    const t = ownedThread(event.params.id, owner);
    if (t.status === "running" && t.deadline > Date.now())
      error(409, "Wait for the current run to finish.");
  } catch (e) {
    if ((e as any).status) throw e;
    error(404, "Conversation not found");
  }
  const reader = event.request.body?.getReader();
  if (!reader) error(400, "Missing upload");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 26 * 1024 * 1024) {
      await reader.cancel();
      error(413, "Upload exceeds 25 MB.");
    }
    chunks.push(value);
  }
  let form;
  try {
    form = await new Response(Buffer.concat(chunks), {
      headers: {
        "content-type": event.request.headers.get("content-type") || "",
      },
    }).formData();
  } catch {
    error(400, "Invalid upload form");
  }
  const files = form.getAll("files");
  if (files.some((f) => typeof f === "string")) error(400, "Invalid file");
  try {
    return json({ items: await saveUploads(event.params.id, files as File[]) });
  } catch (e) {
    error(400, (e as Error).message);
  }
};
export const GET: import("./$types").RequestHandler = (event) => {
  const owner = requireUser(event).id;
  try {
    ownedThread(event.params.id, owner);
  } catch {
    error(404, "Conversation not found");
  }
  return json({ items: uploadRefs(event.params.id) });
};
