import assert from "node:assert/strict";
import test from "node:test";
import type { InvokeHarnessStreamOutput } from "@aws-sdk/client-bedrock-agentcore";
import { HarnessClient, parseHarnessDecision, serializeHarnessInput } from "./harness.js";
import { IDENTITY_CONFIRMATION_CLIENT_ID, type HarnessInput } from "./domain.js";

test("accepts a reformatted DOB correction without an evidence gate or corrective retry", async () => {
  const input: HarnessInput = {
    schemaVersion: 1, useCase: "IDENTITY_CONFIRMATION", clientId: IDENTITY_CONFIRMATION_CLIENT_ID,
    responsePolicy: { message: "Please provide your details." },
    trigger: { messageId: "correction", conversationId: "thread", source: "sms", sentAt: null, content: "Oh, it's actually 1/1/1991" },
    member: { memberId: "member", timeZone: null }, priorMessages: [],
  };
  const decision = {
    collectedDetails: { firstName: null, lastName: null, dateOfBirth: "January 1, 1991" },
    action: "SEND_MESSAGE", reason: "IDENTITY_FOLLOW_UP", topic: "identity confirmation",
    message: "Thanks for the correction. Could you also provide your first and last name?",
  };
  let attempts = 0;
  const harness = new HarnessClient("us-east-1", "test", "staging", { send: async (command) => {
    attempts++;
    assert.deepEqual(JSON.parse(command.input.messages![0]!.content![0]!.text!), input);
    return { stream: (async function* (): AsyncGenerator<InvokeHarnessStreamOutput> {
      yield { contentBlockDelta: { contentBlockIndex: 0, delta: { text: JSON.stringify(decision) } } };
      yield { messageStop: { stopReason: "end_turn" } };
    })() };
  } });
  assert.deepEqual(await harness.decide(input), decision);
  assert.equal(attempts, 1);
});

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
