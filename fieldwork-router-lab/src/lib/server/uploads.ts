import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, extname } from "node:path";
import sharp from "sharp";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  get,
  put,
  items,
  transaction,
  type Thread,
  type Message,
} from "./store";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_FILES,
  type AttachmentRef,
} from "../attachments";
type Upload = AttachmentRef & {
  text?: string;
  imagePath?: string;
  path: string;
};
export function uploaded(thread: string, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Attachment not found");
  const f = get<Upload>(`uploads:${thread}`, id);
  if (!f) throw new Error("Attachment not found");
  return f;
}
export function uploadRefs(thread: string) {
  return items<Upload>(`uploads:${thread}`).map(
    ({ text, path, imagePath, ...ref }) => ref,
  );
}
export function attached(thread: Thread) {
  return [
    ...new Set(
      thread.messages.flatMap((m) => (m.attachments || []).map((a) => a.id)),
    ),
  ].map((id) => uploaded(thread.id, id));
}
export async function prepareUpload(file: File) {
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES)
    throw new Error("Files must be between 1 byte and 5 MB.");
  const filename = file.name.replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 160);
  const ext = extname(filename).toLowerCase();
  const bytes = Buffer.from(await file.arrayBuffer());
  let text: string | undefined;
  let image: Buffer | undefined;
  let kind: Upload["kind"];
  let mediaType: string;
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
    const meta = await sharp(bytes, { limitInputPixels: 25000000 }).metadata();
    if (!["png", "jpeg", "webp"].includes(meta.format || ""))
      throw new Error("Image contents do not match a supported image format.");
    image = await sharp(bytes, { limitInputPixels: 25000000 })
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png({ palette: true, quality: 80 })
      .toBuffer();
    kind = "image";
    mediaType = `image/${meta.format}`;
  } else if (ext === ".pdf") {
    if (bytes.subarray(0, 5).toString() !== "%PDF-")
      throw new Error("Invalid PDF.");
    const loading = getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
    });
    let pdf;
    try {
      pdf = await loading.promise;
      if (pdf.numPages > 50)
        throw new Error("PDFs may contain at most 50 pages.");
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const p = await pdf.getPage(i);
        const content = await p.getTextContent();
        pages.push(
          content.items.map((x: any) => ("str" in x ? x.str : "")).join(" "),
        );
        if (pages.join("\n").length > 50000)
          throw new Error("PDF text exceeds 50,000 characters.");
      }
      text = pages.join("\n\n");
      if (!text.trim())
        throw new Error(
          "This PDF has no extractable text. Upload page images for a scanned PDF.",
        );
    } finally {
      await loading.destroy();
    }
    kind = "pdf";
    mediaType = "application/pdf";
  } else if ([".txt", ".md", ".csv", ".json", ".log"].includes(ext)) {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("Text files must use UTF-8.");
    }
    if (text.includes("\0")) throw new Error("Binary files are not supported.");
    kind = "text";
    mediaType =
      ext === ".json"
        ? "application/json"
        : ext === ".csv"
          ? "text/csv"
          : "text/plain";
  } else
    throw new Error(
      "Supported files: PNG, JPEG, WebP, text, Markdown, CSV, JSON, log, and text-based PDF.",
    );
  if (text && text.length > 50000)
    throw new Error("File text exceeds 50,000 characters.");
  return { filename, bytes, text, image, kind, mediaType };
}
export async function saveUploads(
  thread: string,
  files: File[],
): Promise<AttachmentRef[]> {
  if (!files.length || files.length > MAX_UPLOAD_FILES)
    throw new Error("Choose between 1 and 5 files.");
  const prepared = [];
  for (const file of files) prepared.push(await prepareUpload(file));
  const folder = join(process.env.FIELDWORK_WORKSPACES!, thread, "uploads");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const saved: Upload[] = [];
  try {
    for (const f of prepared) {
      const id = randomUUID(),
        path = join(folder, id),
        imagePath = f.image ? join(folder, `${id}.png`) : undefined;
      saved.push({
        id,
        filename: f.filename,
        mediaType: f.mediaType,
        size: f.bytes.length,
        kind: f.kind,
        path,
        imagePath,
        text: f.text,
        url: `/api/threads/${thread}/attachments/${id}`,
      });
      await writeFile(path, f.bytes, { mode: 0o600 });
      if (imagePath) await writeFile(imagePath, f.image!, { mode: 0o600 });
    }
    transaction(() => {
      const existing = items<Upload>(`uploads:${thread}`);
      if (existing.length + saved.length > 20)
        throw new Error("This conversation has reached its 20-file limit.");
      if (
        [...existing, ...saved].reduce((n, f) => n + (f.text?.length || 0), 0) >
        150000
      )
        throw new Error("Conversation file text exceeds 150,000 characters.");
      for (const f of saved) put(`uploads:${thread}`, f.id, f);
    });
  } catch (e) {
    for (const f of saved) {
      await rm(f.path, { force: true });
      if (f.imagePath) await rm(f.imagePath, { force: true });
    }
    throw e;
  }
  return saved.map(({ text, path, imagePath, ...ref }) => ref);
}
export function fileText(thread: Thread, m: Message) {
  const files = (m.attachments || []).map((a) => uploaded(thread.id, a.id));
  return (
    m.content +
    files
      .map(
        (f) =>
          `\n\nAttached file: ${f.filename}\n${f.text ? JSON.stringify({ untrustedFileContent: f.text }) : "[Image supplied separately]"}`,
      )
      .join("")
  );
}
export async function imageInputs(thread: Thread) {
  return Promise.all(
    attached(thread)
      .filter((f) => f.imagePath)
      .map(async (f) => ({
        filename: f.filename,
        path: f.imagePath!,
        bytes: await readFile(f.imagePath!),
      })),
  );
}
