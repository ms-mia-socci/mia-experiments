import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateRecommendation } from "../src/lib/server/routing-policy.ts";
import {
  createThread,
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
