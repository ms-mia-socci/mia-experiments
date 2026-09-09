import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateRecommendation } from "../src/lib/server/routing-policy.ts";
import {
  createThread,
  recoverExpiredRun,
  appendEvent,
  ownedThread,
  beginRun,
  updateThread,
  decide,
  get,
  type Thread,
} from "../src/lib/server/store.ts";
const folder = mkdtempSync(join(tmpdir(), "fieldwork-test-"));
process.env.FIELDWORK_DB = join(folder, "test.sqlite");
after(() => rmSync(folder, { recursive: true, force: true }));
test("routing rejects unavailable or invented frameworks", () => {
  const r = {
    framework: "codex",
    reason: "Code review needs engineering tools.",
    brief: "Review a TypeScript API design.",
  };
  assert.throws(() =>
    validateRecommendation(r, { strands: true, claude: true, codex: false }),
  );
  assert.throws(() =>
    validateRecommendation(
      { ...r, framework: "imaginary" },
      { strands: true, claude: true, codex: true },
    ),
  );
  assert.equal(
    validateRecommendation(
      { ...r, framework: "claude" },
      { strands: true, claude: true, codex: false },
    ).framework,
    "claude",
  );
});
test("conversation ownership, run lease and one-time approvals", () => {
  const t = createThread("mia", null);
  assert.throws(() => ownedThread(t.id, "tim"), /NOT_FOUND/);
  const run = beginRun(t.id, "mia", "Plan a project");
  assert.throws(() => beginRun(t.id, "mia", "Duplicate"), /BUSY/);
  const approval = {
    id: "approval",
    runId: run.runId!,
    filename: "test.txt",
    content: "hello",
    reason: "User requested",
    expiresAt: Date.now() + 90000,
    status: "pending" as const,
  };
  updateThread(t.id, { pendingApproval: approval });
  assert.throws(() => decide(t.id, "tim", "approval", "approved"), /NOT_FOUND/);
  decide(t.id, "mia", "approval", "approved");
  assert.throws(() => decide(t.id, "mia", "approval", "approved"), /EXPIRED/);
  updateThread(t.id, { status: "complete" });
  const handed = beginRun(t.id, "mia", "Execute brief", "claude");
  assert.equal(handed.framework, "claude");
  assert.equal(handed.phase, "active");
  assert.equal(handed.messages[0].content, "Plan a project");
  updateThread(t.id, {
    pendingApproval: {
      ...approval,
      runId: handed.runId!,
      expiresAt: Date.now() - 1,
    },
  });
  assert.throws(() => decide(t.id, "mia", "approval", "approved"), /EXPIRED/);
  assert.equal(get<Thread>("threads", t.id)?.owner, "mia");
});

test("expired runs recover without changing live leases or other owners' threads", () => {
  const t = createThread("mia", "claude");
  const run = beginRun(t.id, "mia", "Work");
  assert.equal(recoverExpiredRun(t.id, "mia").status, "running");
  updateThread(t.id, {
    deadline: Date.now() - 1,
    pendingApproval: {
      id: "pending",
      runId: run.runId!,
      filename: "x.txt",
      content: "x",
      reason: "save",
      expiresAt: Date.now() + 1000,
      status: "pending",
    },
  });
  assert.throws(() => recoverExpiredRun(t.id, "tim"), /NOT_FOUND/);
  appendEvent(t.id, run.runId!, {
    type: "TEXT_MESSAGE_START",
    messageId: "partial",
  });
  appendEvent(t.id, run.runId!, {
    type: "TEXT_MESSAGE_CONTENT",
    messageId: "partial",
    delta: "Work in progress",
  });
  const recovered = recoverExpiredRun(t.id, "mia");
  assert.equal(recovered.messages.at(-1)?.content, "Work in progress");
  assert.equal(recoverExpiredRun(t.id, "mia").messages.length, 2);
  assert.equal(recovered.status, "error");
  assert.equal(recovered.pendingApproval, null);
  assert.equal(recovered.messages[0].content, "Work");
  assert.equal(beginRun(t.id, "mia", "Retry").status, "running");
});
