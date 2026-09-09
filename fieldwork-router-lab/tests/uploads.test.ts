import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareUpload } from "../src/lib/server/uploads.ts";
test("upload validation rejects executable, forged image, binary and oversized content", async () => {
  for (const f of [
    new File(["echo hello"], "run.sh"),
    new File(["not an image"], "image.png", { type: "image/png" }),
    new File(["a\0b"], "binary.txt"),
    new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.txt"),
    new File([], "empty.txt"),
    new File(["not pdf"], "fake.pdf"),
  ])
    await assert.rejects(() => prepareUpload(f));
});
test("UTF-8 text is extracted and filenames cannot traverse directories", async () => {
  const f = await prepareUpload(
    new File(["Project: iris"], "../../notes.TXT", {
      type: "application/octet-stream",
    }),
  );
  assert.equal(f.text, "Project: iris");
  assert.equal(f.kind, "text");
  assert.equal(f.filename.includes("/"), false);
});
