import { test, after, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import {
  memoryScopes,
  memoryActor,
  defaultMemorySettings,
} from "../src/lib/memory-policy.ts";
import {
  memoryProfile,
  saveMemorySettings,
  recallMemory,
  captureMemory,
  inspectMemory,
  resetMemory,
} from "../src/lib/server/memory.ts";
import { createThread, beginRun } from "../src/lib/server/store.ts";
const folder = mkdtempSync(join(tmpdir(), "fieldwork-memory-"));
process.env.FIELDWORK_DB = join(folder, "test.sqlite");
process.env.FIELDWORK_MEMORY_ID = "test-memory";
after(() => {
  mock.restoreAll();
  rmSync(folder, { recursive: true, force: true });
});
const calls: { name: string; input: any }[] = [];
let fail = false;
mock.method(
  BedrockAgentCoreClient.prototype,
  "send",
  async function (command: any) {
    calls.push({ name: command.constructor.name, input: command.input });
    if (fail) throw new Error("Unavailable");
    if (
      command.constructor.name === "RetrieveMemoryRecordsCommand" ||
      command.constructor.name === "ListMemoryRecordsCommand"
    )
      return {
        memoryRecordSummaries: [
          {
            memoryRecordId: "record-" + command.input.namespace,
            content: { text: "Prefers concise official sources" },
            namespaces: [command.input.namespace],
          },
        ],
      };
    if (command.constructor.name === "ListEventsCommand")
      return { events: [{ eventId: "event" }] };
    return {};
  },
);
const all = {
  ...defaultMemorySettings,
  enabled: true,
  crossSession: true,
  shareAcrossAgents: true,
};
test("memory is opt-in; framework and user namespaces never overlap", () => {
  const p = memoryProfile("mia");
  assert.equal(p.settings.enabled, false);
  assert.deepEqual(memoryScopes("mia", p, "claude"), []);
  const scoped = { ...p, settings: { ...all, shareAcrossAgents: false } };
  assert.equal(memoryScopes("mia", scoped, "claude").length, 2);
  assert.ok(
    memoryScopes("mia", scoped, "claude").every(
      (s) => s.framework === "claude" && s.namespace.endsWith("/"),
    ),
  );
  assert.notEqual(
    memoryActor("mia", p.generation, "claude"),
    memoryActor("tim", p.generation, "claude"),
  );
  assert.throws(() => saveMemorySettings("mia", { ...all, owner: "tim" }));
});
test("all frameworks use shared retrieval policy, failures remain nonfatal, and capture honors changes", async () => {
  const t = beginRun(
    createThread("mia", "claude").id,
    "mia",
    "Prefer short answers",
  );
  calls.length = 0;
  let run = await recallMemory(t);
  await captureMemory(t, [], run);
  assert.equal(calls.length, 0);
  saveMemorySettings("mia", all);
  run = await recallMemory(t);
  assert.equal(run.recalled.length, 6);
  assert.match(run.context, /untrusted historical data/);
  assert.ok(calls.every((c) => c.input.namespace.includes("fw_mia_")));
  await captureMemory(t, [], run);
  const write = calls.findLast((c) => c.name === "CreateEventCommand")!;
  assert.equal(
    write.input.actorId,
    memoryActor("mia", run.profile.generation, "claude"),
  );
  assert.equal(write.input.extractionMode, undefined);
  saveMemorySettings("mia", { ...all, enabled: false });
  calls.length = 0;
  await captureMemory(t, [], run);
  assert.equal(calls.length, 0);
  saveMemorySettings("mia", { ...all, crossSession: false });
  run = await recallMemory(t);
  assert.equal(run.recalled.length, 0);
  await captureMemory(t, [], run);
  assert.equal(calls.at(-1)?.input.extractionMode, "SKIP");
  saveMemorySettings("mia", all);
  fail = true;
  run = await recallMemory(t);
  assert.equal(run.context, "");
  assert.match(run.status, /unavailable/);
  fail = false;
});
test("reset rotates recall scope and cleans only the requesting user; disabled kinds are excluded", async () => {
  saveMemorySettings("mia", {
    ...all,
    usePreferences: false,
    shareAcrossAgents: false,
  });
  const before = memoryProfile("mia");
  const t = beginRun(createThread("mia", "codex").id, "mia", "Project context");
  let run = await recallMemory(t);
  assert.equal(run.recalled.length, 1);
  assert.equal(run.recalled[0].kind, "summaries");
  assert.equal(run.recalled[0].framework, "codex");
  await captureMemory(t, [], run);
  calls.length = 0;
  await inspectMemory("mia");
  assert.ok(calls.every((c) => c.input.namespace.includes("fw_mia_")));
  calls.length = 0;
  await resetMemory("mia");
  const after = memoryProfile("mia");
  assert.notEqual(after.generation, before.generation);
  assert.equal(after.settings.usePreferences, false);
  assert.ok(
    calls
      .filter((c) => c.name.startsWith("Delete"))
      .every((c) => (c.input.actorId || c.input.namespace).includes("fw_mia_")),
  );
  assert.ok(
    memoryScopes("mia", after, "codex").every(
      (s) => !s.namespace.includes(before.generation),
    ),
  );
  assert.equal(memoryProfile("tim").settings.enabled, false);
});
