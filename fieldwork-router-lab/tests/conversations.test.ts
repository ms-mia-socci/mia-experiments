import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createThread,
  beginRun,
  updateThread,
  ownedThread,
} from "../src/lib/server/store.ts";
import {
  listConversations,
  editConversation,
  recommendConversation,
} from "../src/lib/server/conversations.ts";
import { firstMessageTitle } from "../src/lib/conversation-title.ts";
const folder = mkdtempSync(join(tmpdir(), "fw-conversations-"));
process.env.FIELDWORK_DB = join(folder, "db.sqlite");
after(() => rmSync(folder, { recursive: true, force: true }));
test("history search is owner scoped, supports message text, and separates archives with pins first", () => {
  const a = createThread("mia", "claude"),
    b = createThread("mia", "codex"),
    privateThread = createThread("tim", "claude");
  updateThread(a.id, {
    title: "Research",
    messages: [
      {
        id: "x",
        role: "user",
        agent: "user",
        content: "Compare the orange marmalade vendors",
      },
    ],
  });
  updateThread(privateThread.id, { title: "orange marmalade private" });
  assert.deepEqual(
    listConversations("mia", "MARMALADE").map((t) => t.id),
    [a.id],
  );
  editConversation(b.id, "mia", { pinned: true });
  assert.equal(listConversations("mia")[0].id, b.id);
  editConversation(a.id, "mia", { archived: true });
  assert.equal(listConversations("mia", "marmalade").length, 0);
  assert.equal(listConversations("mia", "marmalade", true)[0].id, a.id);
  editConversation(a.id, "mia", { archived: false });
  assert.equal(listConversations("mia", "marmalade")[0].id, a.id);
  assert.throws(
    () => editConversation(a.id, "tim", { title: "stolen" }),
    /NOT_FOUND/,
  );
  assert.throws(() => editConversation(a.id, "mia", { title: "  " }));
  assert.throws(() => editConversation(a.id, "mia", { owner: "tim" }));
});
test("Strands titles respect manual names and stale runs; running threads cannot be archived", () => {
  const t = createThread("mia", null);
  const run = beginRun(t.id, "mia", "Research AG-UI\n\n and A2A");
  assert.equal(run.title, "Research AG-UI and A2A");
  const r = {
    framework: "claude" as const,
    reason: "Live research",
    brief: "Compare protocols",
  };
  recommendConversation(t.id, run.runId!, r, "Compare agent protocols");
  assert.equal(ownedThread(t.id, "mia").title, "Compare agent protocols");
  editConversation(t.id, "mia", { title: "My sprint research" });
  recommendConversation(t.id, run.runId!, r, "Another model title");
  assert.equal(ownedThread(t.id, "mia").title, "My sprint research");
  assert.throws(
    () => recommendConversation(t.id, "stale", r, "Wrong"),
    /Run stopped/,
  );
  assert.throws(
    () => editConversation(t.id, "mia", { archived: true }),
    /BUSY/,
  );
  const empty = createThread("mia", "claude");
  editConversation(empty.id, "mia", { title: "Keep this" });
  assert.equal(beginRun(empty.id, "mia", "Hello").title, "Keep this");
  assert.ok(firstMessageTitle("hello ".repeat(100)).length <= 65);
});
