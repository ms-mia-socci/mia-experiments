import { chromium } from "playwright";
import assert from "node:assert/strict";
const b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto("http://127.0.0.1:5373");
  await p.getByRole("button", { name: /Mia Socci/ }).click();
  await p.waitForLoadState("networkidle");
  const t = await p.evaluate(
    async () =>
      await (
        await fetch("/api/threads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ framework: "claude" }),
        })
      ).json(),
  );
  const unique = `History check ${Date.now()}`;
  await p.evaluate(
    async ({ id, title }) =>
      fetch(`/api/threads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      }),
    { id: t.id, title: unique },
  );
  await p.reload();
  await p.waitForLoadState("networkidle");
  await p.getByRole("searchbox", { name: "Search conversations" }).fill(unique);
  const row = p.locator(".history-row").filter({ hasText: unique });
  await row.waitFor();
  await row.getByRole("button", { name: `Options for ${unique}` }).click();
  await row.getByRole("button", { name: "Rename", exact: true }).click();
  const renamed = unique + " renamed";
  await p.getByRole("textbox", { name: "Conversation title" }).fill(renamed);
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.getByRole("button", { name: `Options for ${renamed}` }).waitFor();
  await p.getByRole("button", { name: `Options for ${renamed}` }).click();
  await p.getByRole("button", { name: "Pin", exact: true }).click();
  await p.getByRole("button", { name: `Options for ${renamed}` }).click();
  await p.getByRole("button", { name: "Unpin", exact: true }).waitFor();
  await p.getByRole("button", { name: "Archive", exact: true }).click();
  await p.getByText("No matching conversations.", { exact: true }).waitFor();
  await p.getByRole("button", { name: "Archived", exact: true }).click();
  await p.getByRole("button", { name: `Options for ${renamed}` }).click();
  await p.getByRole("button", { name: "Restore", exact: true }).click();
  await p.getByRole("button", { name: "Recent", exact: true }).click();
  await p.getByRole("button", { name: `Options for ${renamed}` }).waitFor();
  await p.reload();
  await p.waitForLoadState("networkidle");
  assert.ok(
    (await p.locator(".history-row").first().innerText()).includes(renamed),
  );
  await p.screenshot({ path: ".local/conversation-management.png" });
  // Keep this synthetic fixture out of the user's Recent list.
  await p.evaluate(
    async (id) =>
      fetch(`/api/threads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: false, archived: true }),
      }),
    t.id,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Search, rename, pin ordering, archive/restore and reload persistence passed.",
  );
} finally {
  await b.close();
}
