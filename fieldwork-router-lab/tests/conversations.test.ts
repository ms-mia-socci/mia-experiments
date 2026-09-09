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
test("history search is owner scoped, supports message text, and separates archives with pins first", async () => {
  const a = await createThread("mia", "claude"),
    b = await createThread("mia", "codex"),
    privateThread = await createThread("tim", "claude");
  await updateThread(a.id, {
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
  await updateThread(privateThread.id, { title: "orange marmalade private" });
  assert.deepEqual(
    (await listConversations("mia", "MARMALADE")).map((t) => t.id),
    [a.id],
  );
  await editConversation(b.id, "mia", { pinned: true });
  assert.equal((await listConversations("mia"))[0].id, b.id);
  await editConversation(a.id, "mia", { archived: true });
  assert.equal((await listConversations("mia", "marmalade")).length, 0);
  assert.equal((await listConversations("mia", "marmalade", true))[0].id, a.id);
  await editConversation(a.id, "mia", { archived: false });
  assert.equal((await listConversations("mia", "marmalade"))[0].id, a.id);
  await assert.rejects(
    async () => await editConversation(a.id, "tim", { title: "stolen" }),
    /NOT_FOUND/,
  );
  await assert.rejects(
    async () => await editConversation(a.id, "mia", { title: "  " }),
  );
  await assert.rejects(
    async () => await editConversation(a.id, "mia", { owner: "tim" }),
  );
});
test("Strands titles respect manual names and stale runs; running threads cannot be archived", async () => {
  const t = await createThread("mia", null);
  const run = await beginRun(t.id, "mia", "Research AG-UI\n\n and A2A");
  assert.equal(run.title, "Research AG-UI and A2A");
  const r = {
    framework: "claude" as const,
    reason: "Live research",
    brief: "Compare protocols",
  };
  await recommendConversation(t.id, run.runId!, r, "Compare agent protocols");
  assert.equal(
    (await ownedThread(t.id, "mia")).title,
    "Compare agent protocols",
  );
  await editConversation(t.id, "mia", { title: "My sprint research" });
  await recommendConversation(t.id, run.runId!, r, "Another model title");
  assert.equal((await ownedThread(t.id, "mia")).title, "My sprint research");
  await assert.rejects(
    async () => await recommendConversation(t.id, "stale", r, "Wrong"),
    /Run stopped/,
  );
  await assert.rejects(
    async () => await editConversation(t.id, "mia", { archived: true }),
    /BUSY/,
  );
  const empty = await createThread("mia", "claude");
  await editConversation(empty.id, "mia", { title: "Keep this" });
  assert.equal((await beginRun(empty.id, "mia", "Hello")).title, "Keep this");
  assert.ok(firstMessageTitle("hello ".repeat(100)).length <= 65);
});
