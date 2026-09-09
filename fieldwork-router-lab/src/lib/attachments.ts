export const MAX_UPLOAD_FILES = 5;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const UPLOAD_ACCEPT =
  ".txt,.md,.csv,.json,.log,.pdf,.png,.jpg,.jpeg,.webp";
export type AttachmentRef = {
  id: string;
  filename: string;
  mediaType: string;
  size: number;
  kind: "image" | "text" | "pdf";
  url: string;
};
