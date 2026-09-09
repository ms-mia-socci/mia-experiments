import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch();
const page = await browser.newPage();
const base = "http://127.0.0.1:5373";
await page.goto(base);
await page.getByRole("button", { name: /Tim Ritzema/ }).click();
await page.locator(".start-page").waitFor();
async function run(framework, text) {
  const t = await (
    await page.request.post(base + "/api/threads", {
      headers: { Origin: base },
      data: { framework },
    })
  ).json();
  const result = await page.request.post(`${base}/api/threads/${t.id}/run`, {
    headers: { Origin: base },
    data: {
      threadId: t.id,
      runId: crypto.randomUUID(),
      state: {},
      messages: [{ id: crypto.randomUUID(), role: "user", content: text }],
      tools: [],
      context: [],
      forwardedProps: {},
    },
    timeout: 90000,
  });
  const stream = await result.text();
  assert.ok(stream.includes("RUN_FINISHED"), stream);
  return await (await page.request.get(`${base}/api/threads/${t.id}`)).json();
}
const vague = await run(null, "I need help.");
assert.equal(vague.recommendation, null);
assert.ok(
  vague.messages.some((m) => m.role === "assistant" && m.content.includes("?")),
);
console.log("Strands clarification passed");
const direct = await run(
  "strands",
  "Give me exactly three concise steps to plan a team workshop. No file needed.",
);
assert.ok(
  direct.messages.some((m) => m.role === "assistant" && m.content.length > 30),
);
console.log("Direct Strands execution passed");
await browser.close();
