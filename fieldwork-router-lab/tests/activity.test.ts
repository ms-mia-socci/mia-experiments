import { test } from "node:test";
import assert from "node:assert/strict";
import { citedSources, toolActivity } from "../src/lib/activity.ts";
test("sources use explicit public citations, deduplicate, and exclude downloads/code/images", () => {
  assert.deepEqual(
    citedSources(
      "[Docs](https://example.com/docs) [Again](https://example.com/docs) [Download](/api/file) ![Image](https://example.com/image) `[Code](https://example.com/code)` [Bad](javascript:alert) [Secret](https://key@example.com)",
    ),
    [{ url: "https://example.com/docs", title: "Again" }],
  );
});
test("tool states use AG-UI messages for pending, successful and failed calls", () => {
  const call = {
    id: "1",
    type: "function" as const,
    function: { name: "search", arguments: '{"q":"ai"}' },
  };
  const message = {
    id: "assistant",
    role: "assistant" as const,
    toolCalls: [call],
  };
  assert.equal(toolActivity([message], true)[0].state, "input-available");
  assert.deepEqual(toolActivity([message], true)[0].input, { q: "ai" });
  assert.equal(toolActivity([message], false)[0].state, "output-error");
  const result = {
    id: "result",
    role: "tool" as const,
    toolCallId: "1",
    content: '{"ok":true}',
  };
  assert.equal(
    toolActivity([message, result], false)[0].state,
    "output-available",
  );
  assert.equal(
    toolActivity(
      [message, { ...result, content: '{"error":"Failed"}' }],
      false,
    )[0].error,
    "Failed",
  );
});
