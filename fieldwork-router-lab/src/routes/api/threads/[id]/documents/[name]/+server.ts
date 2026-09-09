import { readBlob } from "$lib/server/blobs";
import { error } from "@sveltejs/kit";
import { requireUser } from "$lib/server/auth";
import { ownedThread, get } from "$lib/server/store";
import { previewHtml, previewPolicy } from "$lib/server/rendering/html";
export const GET: import("./$types").RequestHandler = async (event) => {
  const user = requireUser(event);
  try {
    await ownedThread(event.params.id, user.id);
  } catch {
    error(404, "Document not found");
  }
  const d = await get(`documents:${event.params.id}`, event.params.name);
  if (!d) error(404, "Document not found");
  if (d.blobPath) {
    const bytes = await readBlob(d.blobPath);
    d.content = bytes.toString(d.encoding === "base64" ? "base64" : "utf8");
  }
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (event.url.searchParams.get("preview") === "1") {
    if (!d.filename.endsWith(".html")) error(400, "HTML only");
    return new Response(previewHtml(d.content), {
      headers: {
        ...headers,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": previewPolicy,
        "Referrer-Policy": "no-referrer",
      },
    });
  }
  const pdf = d.encoding === "base64";
  return new Response(
    pdf ? new Uint8Array(Buffer.from(d.content, "base64")) : d.content,
    {
      headers: {
        ...headers,
        "Content-Type":
          d.mediaType ||
          (pdf ? "application/pdf" : "text/plain; charset=utf-8"),
        "Content-Disposition": `attachment; filename="${d.filename}"`,
      },
    },
  );
};
