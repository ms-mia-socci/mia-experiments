import assert from "node:assert/strict";
import test from "node:test";
import { parseHarnessDecision, serializeHarnessInput } from "./harness.js";
import { IDENTITY_CONFIRMATION_CLIENT_ID, type HarnessInput } from "./domain.js";

test("presents the new message after history in runtime and console inputs", () => {
  const input: HarnessInput = {
    schemaVersion: 1, useCase: "IDENTITY_CONFIRMATION", clientId: IDENTITY_CONFIRMATION_CLIENT_ID,
    responsePolicy: { message: "Please provide your details." },
    trigger: { messageId: "new", conversationId: "thread", source: "sms", sentAt: null, content: "Carter" },
    member: { memberId: "member", timeZone: null },
    priorMessages: [{ messageId: "old", conversationId: "thread", direction: "care_team_to_member", source: "sms", sentAt: null, content: "What is your last name?" }],
  };
  for (const indentation of [undefined, 2]) {
    const serialized = serializeHarnessInput(input, indentation);
    assert.deepEqual(JSON.parse(serialized), input);
    assert.equal(Object.keys(JSON.parse(serialized)).at(-1), "trigger");
  }
  const firstTopic = { ...input, useCase: "FIRST_TOPIC" as const };
  assert.equal(serializeHarnessInput(firstTopic), JSON.stringify(firstTopic));
});

test("parses a strict JSON Harness decision", () => {
  assert.deepEqual(
    parseHarnessDecision(
      '{"action":"NO_ACTION","reason":"REPEAT_TOPIC","topic":"refill","message":null}',
    ),
    {
      action: "NO_ACTION",
      reason: "REPEAT_TOPIC",
      topic: "refill",
      message: null,
    },
  );
});

test("accepts a fenced JSON decision but rejects invalid action/message pairs", () => {
  assert.equal(
    parseHarnessDecision(
      '```json\n{"action":"SEND_MESSAGE","reason":"FIRST_TOPIC","topic":"billing","message":"Reply"}\n```',
    ).message,
    "Reply",
  );
  assert.throws(
    () =>
      parseHarnessDecision(
        '{"action":"NO_ACTION","reason":"REPEAT_TOPIC","topic":"billing","message":"unexpected"}',
      ),
    /NO_ACTION requires message to be null/,
  );
});
