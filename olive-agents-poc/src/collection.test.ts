import assert from "node:assert/strict";
import test from "node:test";
import type { InvokeHarnessStreamOutput } from "@aws-sdk/client-bedrock-agentcore";
import { collectionFeedback, isCompleteCalendarDate } from "./collection.js";
import { DEFAULT_IDENTITY_FIELDS, IDENTITY_CONFIRMATION_CLIENT_ID, type HarnessDecision, type HarnessInput } from "./domain.js";
import { HarnessClient } from "./harness.js";

function input(): HarnessInput {
  return {
    schemaVersion: 1, useCase: "IDENTITY_CONFIRMATION", clientId: IDENTITY_CONFIRMATION_CLIENT_ID,
    responsePolicy: { message: "Please provide your details.", collectionFields: DEFAULT_IDENTITY_FIELDS },
    member: { memberId: "member", timeZone: null },
    priorMessages: [
      { messageId: "first", conversationId: "thread", direction: "member_to_care_team", source: "sms", sentAt: "1990-01-01", content: "Alex" },
      { messageId: "ankle", conversationId: "thread", direction: "member_to_care_team", source: "sms", sentAt: null, content: "I sprained my ankle" },
      { messageId: "request", conversationId: "thread", direction: "care_team_to_member", source: "sms", sentAt: null, content: "Please provide your last name and date of birth." },
    ],
    trigger: { messageId: "last", conversationId: "thread", source: "sms", sentAt: null, content: "Rivera" },
  };
}
function completed(): HarnessDecision {
  return { action: "SEND_MESSAGE", reason: "IDENTITY_DETAILS_COLLECTED", topic: "identity confirmation", message: "Thank you for providing those details.",
    collectedDetails: { firstName: "Alex", lastName: "Rivera", dateOfBirth: null } };
}

test("rejects completion and completed-conversation silence when DOB is missing", () => {
  const decision = completed();
  assert.match(collectionFeedback(decision, input())!, /NOT complete.*date of birth/);
  decision.action = "NO_ACTION"; decision.reason = "IDENTITY_CONVERSATION_COMPLETE"; decision.message = null;
  assert.match(collectionFeedback(decision, input())!, /NOT complete.*date of birth/);
});

test("timestamps, care-team messages, and other threads cannot supply collected values", () => {
  const request = input();
  const decision = completed();
  decision.collectedDetails!.dateOfBirth = "1990-01-01";
  assert.match(collectionFeedback(decision, request)!, /Unsupported.*dateOfBirth/);
  request.priorMessages.push({ ...request.priorMessages[0]!, messageId: "staff-date", direction: "care_team_to_member", content: "1990-01-01" });
  request.priorMessages.push({ ...request.priorMessages[0]!, messageId: "other-thread-date", conversationId: "other-thread", content: "1990-01-01" });
  assert.match(collectionFeedback(decision, request)!, /Unsupported.*dateOfBirth/);
});

test("a surname or symptom cannot serve as a date field even if quoted from the patient", () => {
  for (const value of ["Rivera", "I sprained my ankle"]) {
    const decision = completed(); decision.collectedDetails!.dateOfBirth = value;
    assert.match(collectionFeedback(decision, input())!, /Unsupported.*dateOfBirth/);
  }
});

test("accepts completion with all values grounded in patient-message content", () => {
  const request = input();
  request.trigger.content = "Rivera, April 12, 1985";
  const decision = completed(); decision.collectedDetails!.dateOfBirth = "April 12, 1985";
  assert.equal(collectionFeedback(decision, request), undefined);
});

test("new requested details use the same generic completeness check", () => {
  const request = input();
  request.responsePolicy.collectionFields = [...DEFAULT_IDENTITY_FIELDS, { key: "symptoms", label: "symptoms", type: "text" }];
  const decision = completed();
  assert.match(collectionFeedback(decision, request)!, /every configured key.*symptoms/);
  decision.collectedDetails!.symptoms = "I sprained my ankle";
  assert.match(collectionFeedback(decision, request)!, /NOT complete.*date of birth/);
});

test("validates complete calendar dates without accepting missing years or rollovers", () => {
  for (const value of ["1990-01-01", "1/1/1990", "April 12, 1985", "Feb 29, 2000"]) assert.equal(isCompleteCalendarDate(value), true, value);
  for (const value of ["January 1", "February 30, 1990", "2/29/1990", "1990-13-01", "31/12/1990", "Rivera"]) assert.equal(isCompleteCalendarDate(value), false, value);
});

test("explicit refusal remains silent without forcing missing-detail collection", () => {
  assert.equal(collectionFeedback({ action: "NO_ACTION", reason: "IDENTITY_CONFIRMATION_DECLINED", topic: null, message: null }, input()), undefined);
});

test("corrects an unsupported completion once and returns the agent-written follow-up", async () => {
  const requests: HarnessInput[] = [];
  const harness = new HarnessClient("us-east-1", "test", "staging", { send: async (command) => {
    requests.push(JSON.parse(command.input.messages![0]!.content![0]!.text!));
    const decision = completed();
    if (requests.length === 2) {
      decision.reason = "IDENTITY_FOLLOW_UP"; decision.message = "Could you also provide your date of birth?";
    }
    return { stream: (async function* (): AsyncGenerator<InvokeHarnessStreamOutput> {
      yield { contentBlockDelta: { contentBlockIndex: 0, delta: { text: JSON.stringify(decision) } } };
      yield { messageStop: { stopReason: "end_turn" } };
    })() };
  } });
  const decision = await harness.decide(input());
  assert.equal(decision.reason, "IDENTITY_FOLLOW_UP");
  assert.equal(requests.length, 2);
  assert.match(requests[1]!.validationFeedback!, /date of birth/);
  assert.equal(requests[1]!.trigger.messageId, requests[0]!.trigger.messageId);
});

test("fails closed after one unsuccessful corrective retry", async () => {
  let attempts = 0;
  const harness = new HarnessClient("us-east-1", "test", "staging", { send: async () => {
    attempts++;
    return { stream: (async function* (): AsyncGenerator<InvokeHarnessStreamOutput> {
      yield { contentBlockDelta: { contentBlockIndex: 0, delta: { text: JSON.stringify(completed()) } } };
      yield { messageStop: { stopReason: "end_turn" } };
    })() };
  } });
  await assert.rejects(harness.decide(input()), /failed validation/);
  assert.equal(attempts, 2);
});
