import { error } from "@sveltejs/kit";
import { readFile } from "node:fs/promises";
import { requireUser } from "$lib/server/auth";
import { ownedThread } from "$lib/server/store";
import { uploaded } from "$lib/server/uploads";
export const GET: import("./$types").RequestHandler = async (event) => {
  const owner = requireUser(event).id;
  let f;
  try {
    ownedThread(event.params.id, owner);
    f = uploaded(event.params.id, event.params.file);
  } catch {
    error(404, "Attachment not found");
  }
  const preview =
    event.url.searchParams.get("preview") === "1" && !!f.imagePath;
  return new Response(
    new Uint8Array(await readFile(preview ? f.imagePath! : f.path)),
    {
      headers: {
        "Content-Type": preview ? "image/png" : f.mediaType,
        "Content-Disposition": `${preview ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    },
  );
};
