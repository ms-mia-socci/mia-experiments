import { chromium } from "playwright";
import assert from "node:assert/strict";
const b = await chromium.launch();
let page, original;
try {
  page = await b.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5373");
  await page.getByRole("button", { name: /Mia Socci/ }).click();
  await page.waitForLoadState("networkidle");
  original = await page.evaluate(
    async () => (await (await fetch("/api/memory")).json()).settings,
  );
  await page
    .getByRole("link", { name: "Profile and memory settings", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Memory settings", exact: true })
    .waitFor();
  const enabled = page.getByRole("checkbox", { name: /^Use cloud memory/ });
  await enabled.uncheck();
  assert.ok(
    await page.getByRole("checkbox", { name: /^Remember across/ }).isDisabled(),
  );
  await enabled.check();
  await page.getByRole("checkbox", { name: /^Remember across/ }).check();
  await page.getByRole("checkbox", { name: /^Share memory/ }).check();
  await page.getByRole("checkbox", { name: /^Preferences/ }).uncheck();
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await page.getByRole("status").waitFor();
  await page.reload();
  assert.ok(
    await page.getByRole("checkbox", { name: /^Share memory/ }).isChecked(),
  );
  assert.equal(
    await page.getByRole("checkbox", { name: /^Preferences/ }).isChecked(),
    false,
  );
  await page.getByRole("button", { name: "Reset memory…" }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.screenshot({ path: ".local/memory-settings.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.getByRole("link", { name: "← Back to workspace" }).click();
  await page.waitForLoadState("networkidle");
  const t = {
    id: "memory-fixture",
    title: "Memory fixture",
    framework: "claude",
    phase: "active",
    status: "complete",
    messages: [],
    documents: [],
    uploads: [],
    recommendation: null,
    pendingApproval: null,
    events: [
      {
        type: "CUSTOM",
        name: "memory_recalled",
        value: {
          status: "Recalled 1 memories",
          items: [
            {
              id: "one",
              framework: "strands",
              kind: "preferences",
              text: "Prefers concise official sources",
            },
          ],
        },
      },
    ],
  };
  await page.route("**/api/threads", (r) => r.fulfill({ json: [t] }));
  await page.route("**/api/threads/memory-fixture", (r) =>
    r.fulfill({ json: t }),
  );
  await page.evaluate(() =>
    localStorage.setItem("fieldwork-router-thread", "memory-fixture"),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Memory", exact: true }).click();
  await page
    .getByText("Prefers concise official sources", { exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Settings persistence, opt-in controls, reset confirmation, mobile layout, and recalled-memory panel passed.",
  );
} finally {
  if (page && original)
    await page.evaluate(
      async (settings) =>
        fetch("/api/memory", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settings),
        }),
      original,
    );
  await b.close();
}
