import { chromium } from "playwright";
import assert from "node:assert/strict";
const base = "http://127.0.0.1:5373",
  browser = await chromium.launch(),
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (e) => {
  throw e;
});
await page.goto(base);
await page.getByRole("button", { name: /Mia Socci/ }).click();
await page.locator(".start-page").waitFor();
const threads = await (await page.request.get(base + "/api/threads")).json();

const thread = threads.find((t) => t.framework === "claude");
assert.ok(thread);
await page.evaluate(
  (id) => localStorage.setItem("fieldwork-router-thread", id),
  thread.id,
);
await page.reload();
await page.getByPlaceholder("Message Claude Agent SDK…").waitFor();
const doc = await page.request.get(
  `${base}/api/threads/${thread.id}/documents/poc-proof.txt`,
);
assert.equal(await doc.text(), "Fieldwork handoff works.");
console.log("reload + download passed");
await page
  .getByPlaceholder("Message Claude Agent SDK…")
  .fill(
    "Save proof.pdf containing a simple one-page HTML document with heading Fieldwork and paragraph Strands to Claude handoff verified.",
  );
await page.getByRole("button", { name: "Submit", exact: true }).click();
await page
  .getByRole("button", { name: "Approve save", exact: true })
  .waitFor({ timeout: 90000 });
await page.getByRole("button", { name: "Approve save", exact: true }).click();
await page.waitForFunction(
  () => document.querySelector(".run-status")?.textContent === "Ready",
  {},
  { timeout: 90000 },
);
const pdf = await page.request.get(
  `${base}/api/threads/${thread.id}/documents/proof.pdf`,
);
assert.equal(pdf.status(), 200);
assert.equal((await pdf.body()).subarray(0, 4).toString(), "%PDF");
console.log("PDF passed");
await page.screenshot({ path: ".local/pdf-flow.png", fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("button", { name: "Toggle behind the work" }).click();
await page.screenshot({ path: ".local/mobile.png", fullPage: true });
assert.equal(
  await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  true,
);
console.log("mobile passed");
const outsider = await browser.newPage();
await outsider.goto(base);
assert.equal((await outsider.request.get(base + "/api/threads")).status(), 401);
await outsider.getByRole("button", { name: /Tim Ritzema/ }).click();
assert.equal(
  (await outsider.request.get(`${base}/api/threads/${thread.id}`)).status(),
  404,
);
assert.equal(
  (
    await outsider.request.get(
      `${base}/api/threads/${thread.id}/documents/proof.pdf`,
    )
  ).status(),
  404,
);
const unavailable = await outsider.request.post(base + "/api/threads", {
  headers: { Origin: base },
  data: { framework: "unknown-framework" },
});
assert.equal(unavailable.status(), 400);
console.log("owner isolation + invalid framework passed");
await browser.close();
