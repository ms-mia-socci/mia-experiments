import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "./config.js";
import type { ConnectClient } from "./connect.js";
import {
  FIRST_TOPIC_CLIENT_ID,
  IDENTITY_CONFIRMATION_CLIENT_ID,
  oliveMessageSchema,
  recentConversationSchema,
  type HarnessDecision,
  type HarnessInput,
  type ResolvedConversation,
} from "./domain.js";
import type { HarnessClient } from "./harness.js";
import type { MedusaClient } from "./medusa.js";
import { buildHarnessInput, OliveMessageProcessor } from "./processor.js";
import { MemoryProcessedMessageStore } from "./state.js";

const FIRST_RESPONSE = "Outside-hours response";
const IDENTITY_RESPONSE = "Please confirm first name, last name, and DOB";

test("sends the configured response for a first-topic decision exactly once", async () => {
  const sent: Array<{ memberId: string; content: string }> = [];
  const store = new MemoryProcessedMessageStore();
  const processor = makeProcessor({
    clientId: FIRST_TOPIC_CLIENT_ID,
    decision: {
      action: "SEND_MESSAGE",
      reason: "FIRST_TOPIC",
      topic: "prescription refill",
      message: FIRST_RESPONSE,
    },
    sent,
    store,
  });

  const first = await processor.poll();
  const second = await processor.poll();

  assert.equal(first.sent, 1);
  assert.equal(second.duplicates, 1);
  assert.deepEqual(sent, [{ memberId: "member-1", content: FIRST_RESPONSE }]);
});

test("never invokes the Harness or Connect for an unsupported client", async () => {
  let harnessCalls = 0;
  const sent: Array<{ memberId: string; content: string }> = [];
  const processor = makeProcessor({
    clientId: "891a963b-58d5-4033-94cd-8da4413d0162",
    decision: {
      action: "SEND_MESSAGE",
      reason: "FIRST_TOPIC",
      topic: "ignored",
      message: FIRST_RESPONSE,
    },
    sent,
    onHarness: () => {
      harnessCalls += 1;
    },
  });

  const result = await processor.poll();
  assert.equal(result.skipped, 1);
  assert.equal(harnessCalls, 0);
  assert.equal(sent.length, 0);
});

test("dry-run records an approved identity prompt without calling Connect", async () => {
  const sent: Array<{ memberId: string; content: string }> = [];
  const processor = makeProcessor({
    clientId: IDENTITY_CONFIRMATION_CLIENT_ID,
    dryRun: true,
    decision: {
      action: "SEND_MESSAGE",
      reason: "REQUEST_IDENTITY_CONFIRMATION",
      topic: "identity confirmation",
      message: IDENTITY_RESPONSE,
    },
    sent,
  });

  const result = await processor.poll();
  assert.equal(result.dryRunSends, 1);
  assert.equal(sent.length, 0);
});

test("rejects Harness wording changes before Connect", async () => {
  const sent: Array<{ memberId: string; content: string }> = [];
  const processor = makeProcessor({
    clientId: FIRST_TOPIC_CLIENT_ID,
    decision: {
      action: "SEND_MESSAGE",
      reason: "FIRST_TOPIC",
      topic: "prescription refill",
      message: "Model-authored wording",
    },
    sent,
  });

  const result = await processor.poll();
  assert.equal(result.errors, 1);
  assert.equal(sent.length, 0);
});

test("sends a natural partial-answer follow-up exactly once, not the initial template", async () => {
  const sent: Array<{ memberId: string; content: string }> = [];
  const resolved = resolvedConversation(IDENTITY_CONFIRMATION_CLIENT_ID);
  resolved.trigger.content = "Tim";
  resolved.history[0] = oliveMessageSchema.parse({
    ...resolved.history[0], direction: "care_team_to_member",
    content: IDENTITY_RESPONSE, is_automated: true, created_by_member_id: null,
  });
  const followUp = "Thanks! What are your last name and date of birth?";
  const processor = makeProcessor({
    clientId: IDENTITY_CONFIRMATION_CLIENT_ID, resolved, sent,
    decision: { action: "SEND_MESSAGE", reason: "IDENTITY_FOLLOW_UP", topic: "identity confirmation", message: followUp },
    onHarness: (input) => {
      assert.equal(input.trigger.content, "Tim");
      assert.equal(input.priorMessages[0]?.content, IDENTITY_RESPONSE);
    },
  });
  assert.equal((await processor.poll()).sent, 1);
  assert.equal((await processor.poll()).duplicates, 1);
  assert.deepEqual(sent, [{ memberId: "member-1", content: followUp }]);
});

test("sends the agent's collection acknowledgment and suppresses completed conversation replies", async () => {
  for (const complete of [false, true]) {
    const sent: Array<{ memberId: string; content: string }> = [];
    const processor = makeProcessor({
      clientId: IDENTITY_CONFIRMATION_CLIENT_ID, sent,
      decision: {
        action: complete ? "NO_ACTION" : "SEND_MESSAGE",
        reason: complete ? "IDENTITY_CONVERSATION_COMPLETE" : "IDENTITY_DETAILS_COLLECTED",
        topic: "identity confirmation", message: complete ? null : "Thank you for providing those details.",
      },
    });
    const result = await processor.poll();
    assert.equal(result.errors, 0);
    assert.equal(sent.length, complete ? 0 : 1);
  }
});

test("rejects cross-workflow reasons, inconsistent actions, and invalid identity messages", async () => {
  const invalid: HarnessDecision[] = [
    { action: "SEND_MESSAGE", reason: "FIRST_TOPIC", topic: null, message: FIRST_RESPONSE },
    { action: "SEND_MESSAGE", reason: "IDENTITY_CONVERSATION_COMPLETE", topic: null, message: "Thanks" },
    { action: "NO_ACTION", reason: "IDENTITY_FOLLOW_UP", topic: null, message: null },
    { action: "SEND_MESSAGE", reason: "IDENTITY_FOLLOW_UP", topic: null, message: " " },
    { action: "SEND_MESSAGE", reason: "IDENTITY_FOLLOW_UP", topic: null, message: "x".repeat(1601) },
  ];
  for (const decision of invalid) {
    const sent: Array<{ memberId: string; content: string }> = [];
    const result = await makeProcessor({ clientId: IDENTITY_CONFIRMATION_CLIENT_ID, sent, decision }).poll();
    assert.equal(result.errors, 1);
    assert.equal(sent.length, 0);
  }
});

test("identity history excludes other threads, other patients, hidden and internal messages, and profile demographics", () => {
  const resolved = resolvedConversation(IDENTITY_CONFIRMATION_CLIENT_ID);
  const prior = resolved.history[0]!;
  resolved.history.unshift(
    { ...prior, id: "other-patient", created_by_member_id: "other-member" },
    { ...prior, id: "hidden", hidden: true },
    { ...prior, id: "internal", is_internal: true },
    { ...prior, id: "automated-inbound", is_automated: true },
  );
  resolved.memberContext.last_5_messages = [{ ...prior, id: "other-thread", conversation_id: "other-conversation" }];
  resolved.memberContext.member.first_name = "PRIVATE_PROFILE_NAME";
  resolved.memberContext.member.dob = "1900-01-01";
  const input = buildHarnessInput(resolved, "IDENTITY_CONFIRMATION", IDENTITY_RESPONSE, 200);
  assert.deepEqual(input.priorMessages.map((message) => message.messageId), ["message-0"]);
  assert.ok(!JSON.stringify(input).includes("PRIVATE_PROFILE_NAME"));
  assert.ok(!JSON.stringify(input).includes("1900-01-01"));
});

function makeProcessor(options: {
  clientId: string;
  decision: HarnessDecision;
  sent: Array<{ memberId: string; content: string }>;
  dryRun?: boolean;
  store?: MemoryProcessedMessageStore;
  onHarness?: (input: HarnessInput) => void;
  resolved?: ResolvedConversation;
}): OliveMessageProcessor {
  const resolved = options.resolved ?? resolvedConversation(options.clientId);
  const medusa = {
    recent: async () => [resolved.recent],
    expandRecent: async () => [resolved.recent],
    resolve: async () => resolved,
  } as unknown as MedusaClient;
  const harness = {
    decide: async (input: HarnessInput) => {
      options.onHarness?.(input);
      return options.decision;
    },
  } as unknown as HarnessClient;
  const connect = {
    sendMessage: async (memberId: string, content: string) => {
      options.sent.push({ memberId, content });
      return {
        success: true as const,
        data: { id: "event-1", type: "olive.message.send" as const },
      };
    },
  } as unknown as ConnectClient;
  const logger = { info() {}, warn() {}, error() {} };
  return new OliveMessageProcessor(
    config(options.dryRun ?? false),
    medusa,
    harness,
    connect,
    options.store ?? new MemoryProcessedMessageStore(),
    logger,
  );
}

function config(dryRun: boolean) {
  return loadConfig({
    OLIVE_HARNESS_ARN: "arn:aws:bedrock-agentcore:us-east-1:123456789012:harness/test-1234567890",
    DRY_RUN: String(dryRun),
    FIRST_TOPIC_RESPONSE: FIRST_RESPONSE,
    IDENTITY_CONFIRMATION_RESPONSE: IDENTITY_RESPONSE,
  });
}

function resolvedConversation(clientId: string): ResolvedConversation {
  const trigger = oliveMessageSchema.parse({
    id: "message-1",
    conversation_id: "conversation-1",
    content: "I need help with a prescription refill",
    direction: "member_to_care_team",
    source: "sms",
    status: "received",
    sent_at: "2026-09-10T12:00:00",
    created_by_member_id: "member-1",
  });
  const prior = oliveMessageSchema.parse({
    id: "message-0",
    conversation_id: "conversation-1",
    content: "Hello",
    direction: "member_to_care_team",
    source: "sms",
    status: "received",
    sent_at: "2026-09-09T12:00:00",
    created_by_member_id: "member-1",
  });
  return {
    recent: recentConversationSchema.parse({
      ticket_id: "ticket-1",
      conversation_id: "conversation-1",
      message_id: "message-1",
      source: "sms",
      status: "received",
      sent_at: "2026-09-10T12:00:00",
    }),
    trigger,
    history: [prior, trigger],
    memberContext: {
      member: { id: "member-1", client_id: clientId },
      last_5_messages: [],
      open_tickets: [],
    },
  };
}
