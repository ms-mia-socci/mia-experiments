import { chromium } from "playwright";
import assert from "node:assert/strict";
import sharp from "sharp";
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5373");
  await page.getByRole("button", { name: /Mia Socci/ }).click();
  await page.waitForLoadState("networkidle");
  const thread = {
    id: "reset-fixture",
    owner: "mia",
    title: "Attachment reset",
    framework: "claude",
    phase: "active",
    status: "ready",
    messages: [],
    events: [],
    documents: [],
    uploads: [],
    recommendation: null,
    pendingApproval: null,
  };
  const ref = {
    id: "image-fixture",
    filename: "sample.png",
    mediaType: "image/png",
    kind: "image",
    size: 100,
    url: "/api/threads/reset-fixture/attachments/image-fixture",
  };
  const png = await sharp({
    create: { width: 80, height: 80, channels: 3, background: "green" },
  })
    .png()
    .toBuffer();
  let rejectUpload = true;
  await page.route("**/api/threads", (r) => r.fulfill({ json: [thread] }));
  await page.route("**/api/threads/reset-fixture", (r) =>
    r.fulfill({ json: thread }),
  );
  await page.route("**/api/threads/reset-fixture/attachments", (r) =>
    rejectUpload
      ? r.fulfill({ status: 400, json: { message: "Try again" } })
      : r.fulfill({ json: { items: [ref] } }),
  );
  await page.route(
    "**/api/threads/reset-fixture/attachments/image-fixture*",
    (r) => r.fulfill({ contentType: "image/png", body: png }),
  );
  await page.route("**/api/threads/reset-fixture/run", async (r) => {
    thread.messages = [
      {
        id: "sent",
        role: "user",
        agent: "user",
        content: "Describe the image",
        attachments: [ref],
      },
    ];
    thread.uploads = [ref];
    await r.fulfill({
      contentType: "text/event-stream",
      body: [
        { type: "RUN_STARTED", threadId: thread.id, runId: "r" },
        { type: "RUN_FINISHED", threadId: thread.id, runId: "r" },
      ]
        .map((e) => `data: ${JSON.stringify(e)}\n\n`)
        .join(""),
    });
  });
  await page.evaluate(() =>
    localStorage.setItem("fieldwork-router-thread", "reset-fixture"),
  );
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page
    .locator("input[type=file]")
    .setInputFiles({ name: "sample.png", mimeType: "image/png", buffer: png });
  await page
    .getByPlaceholder("Message Claude Agent SDK…")
    .fill("Describe the image");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await page.getByText("Try again", { exact: true }).first().waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Remove image" }).count(),
    1,
  );
  rejectUpload = false;
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await page
    .getByRole("button", { name: "Remove image" })
    .waitFor({ state: "detached" });
  await page.locator(".message-file img").waitFor();
  assert.equal(await page.locator(".draft-attachment").count(), 0);
  await page
    .locator("input[type=file]")
    .setInputFiles({ name: "sample.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Remove image" }).waitFor();
  await page.getByRole("button", { name: "Remove image" }).click();
  assert.equal(await page.locator(".draft-attachment").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Failed upload preserves draft; accepted run clears preview; sent image remains; reattach/remove works.",
  );
} finally {
  await browser.close();
}
