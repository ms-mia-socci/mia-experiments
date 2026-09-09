import { chromium } from "playwright";
import assert from "node:assert/strict";
const b = await chromium.launch();
try {
  const p = await b.newPage();
  await p.goto("http://127.0.0.1:5373");
  await p.getByRole("button", { name: /Mia Socci/ }).click();
  await p.waitForLoadState("networkidle");
  const t = {
    id: "navigation-fixture",
    owner: "mia",
    title: "Navigation fixture",
    framework: "claude",
    phase: "active",
    status: "complete",
    messages: [],
    documents: [],
    uploads: [],
    recommendation: null,
    pendingApproval: null,
    events: [],
  };
  let hold = false,
    release,
    arrived;
  const pending = new Promise((r) => (arrived = r));
  await p.route("**/api/threads", (r) => r.fulfill({ json: [t] }));
  await p.route("**/api/threads/navigation-fixture", async (r) => {
    if (hold) {
      arrived();
      await new Promise((resolve) => (release = resolve));
    }
    await r.fulfill({ json: t });
  });
  await p.evaluate(() =>
    localStorage.setItem("fieldwork-router-thread", "navigation-fixture"),
  );
  await p.reload();
  await p.waitForLoadState("networkidle");
  await p
    .getByRole("region", { name: "Claude Agent SDK", exact: true })
    .waitFor();
  hold = true;
  await pending;
  await p
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  release();
  hold = false;
  await p.waitForLoadState("networkidle");
  assert.equal(await p.locator(".chat-panel").count(), 0);
  await p.getByPlaceholder("Tell us what you want to get done…").waitFor();
  assert.equal(
    await p.evaluate(() => localStorage.getItem("fieldwork-router-thread")),
    null,
  );
  console.log(
    "Delayed conversation poll cannot reopen a thread after New conversation.",
  );
} finally {
  await b.close();
}
