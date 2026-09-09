import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5373");
  await page.getByRole("button", { name: /Mia Socci/ }).click();
  await page.waitForLoadState("networkidle");

  const thread = {
    id: "component-fixture",
    owner: "mia",
    title: "Component preview",
    framework: null,
    phase: "routing",
    status: "complete",
    messages: [
      {
        id: "m",
        role: "assistant",
        agent: "coordinator",
        content:
          "See the [AG-UI documentation](https://docs.ag-ui.com/) and [Strands documentation](https://strandsagents.com/).",
      },
    ],
    recommendation: {
      framework: "claude",
      reason: "Use web search to find current primary sources.",
      brief: "Research AG-UI and summarize the findings with citations.",
    },
    pendingApproval: null,
    documents: [],
    events: [
      { type: "TOOL_CALL_START", toolCallId: "one", toolCallName: "WebSearch" },
      { type: "TOOL_CALL_ARGS", toolCallId: "one", delta: '{"query":"AG-UI"}' },
      {
        type: "TOOL_CALL_RESULT",
        toolCallId: "one",
        messageId: "one-result",
        role: "tool",
        content: '{"sources":["https://docs.ag-ui.com/"]}',
      },
      { type: "TOOL_CALL_START", toolCallId: "two", toolCallName: "WebFetch" },
      {
        type: "TOOL_CALL_RESULT",
        toolCallId: "two",
        messageId: "two-result",
        role: "tool",
        content: '{"error":"Page unavailable"}',
      },
    ],
  };
  await page.route("**/api/threads", (route) =>
    route.fulfill({ json: [thread] }),
  );
  await page.route("**/api/threads/component-fixture", (route) =>
    route.fulfill({ json: thread }),
  );
  await page.evaluate(() =>
    localStorage.setItem("fieldwork-router-thread", "component-fixture"),
  );
  await page.reload();
  await page.waitForLoadState("networkidle");

  await page
    .getByRole("button", { name: "Start with Claude", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Toggle plan" }).click();
  await page.locator('[data-slot="plan-content"]').waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Toggle plan" }).click();
  await page.locator('[data-slot="plan-content"]').waitFor();
  await page.getByRole("button", { name: "Cited sources · 2" }).click();
  const source = page.getByRole("link", {
    name: "AG-UI documentation",
    exact: true,
  });
  await source.waitFor();
  assert.equal(await source.getAttribute("href"), "https://docs.ag-ui.com/");

  assert.equal(
    await page.getByRole("button", { name: "Route", exact: true }).count(),
    0,
  );
  assert.equal(
    (await page.locator(".inspector-tabs button.active").innerText()).trim(),
    "Activity",
  );
  await page.getByRole("button", { name: "WebSearch Completed" }).click();
  await page.getByRole("button", { name: "WebFetch Error" }).click();
  await page.getByText("Page unavailable", { exact: true }).waitFor();
  assert.ok(
    (await page.locator(".activity-tool").first().innerText()).includes(
      "AG-UI",
    ),
  );
  await page.screenshot({ path: ".local/three-elements.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "Activity default, Plan toggle, cited links, tool inputs/results/error, and browser console passed",
  );
} finally {
  await browser.close();
}
