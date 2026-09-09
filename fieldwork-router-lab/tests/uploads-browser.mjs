import { chromium } from "playwright";
import assert from "node:assert/strict";
import sharp from "sharp";
const b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  p.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("BROWSER", e.message);
  });
  await p.goto("http://127.0.0.1:5373");
  await p.getByRole("button", { name: /Mia Socci/ }).click();
  await p.waitForLoadState("networkidle");
  const png = await sharp({
    create: { width: 150, height: 100, channels: 3, background: "#729658" },
  })
    .png()
    .toBuffer();
  await p.locator("input[type=file]").setInputFiles([
    {
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("The project name is ORCHID-928."),
    },
    { name: "sample.png", mimeType: "image/png", buffer: png },
  ]);
  await p.getByRole("button", { name: "Remove image" }).waitFor();
  await p.screenshot({ path: ".local/upload-composer.png" });
  await p.getByRole("button", { name: "Remove image" }).click();
  assert.equal(
    await p.getByRole("button", { name: "Remove image" }).count(),
    0,
  );
  await p
    .getByPlaceholder("Tell us what you want to get done…")
    .fill(
      "Please route this task to Claude: read my attached notes and tell me the project name.",
    );
  await p.getByRole("button", { name: "Submit", exact: true }).click();
  await p
    .getByRole("button", { name: "Start with Claude", exact: true })
    .waitFor({ timeout: 90000 });
  await p
    .getByRole("button", { name: "Start with Claude", exact: true })
    .click();
  await p.waitForFunction(
    () =>
      document.querySelector(".run-status")?.textContent === "Ready" &&
      document.querySelector(".chat-heading h2")?.textContent ===
        "Claude Agent SDK",
    {},
    { timeout: 90000 },
  );
  const answers = await p
    .locator(".chat-message.is-assistant")
    .allTextContents();
  assert.match(answers.at(-1), /ORCHID-928/);
  await p.locator(".message-file").first().waitFor();
  await p.reload();
  await p.waitForLoadState("networkidle");
  await p.locator(".message-file").first().waitFor();
  await p.getByRole("button", { name: /^Files/ }).click();
  await p.getByRole("link", { name: "Download notes.txt" }).waitFor();
  await p.screenshot({ path: ".local/upload-handoff.png" });
  assert.deepEqual(errors, []);
  console.log(
    "Attachment previews/removal, upload, routing handoff, message refs, Files panel and reload passed",
  );
} finally {
  await b.close();
}
