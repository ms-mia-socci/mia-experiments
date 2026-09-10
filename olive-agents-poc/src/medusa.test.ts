import assert from "node:assert/strict";
import test from "node:test";
import { recentConversationSchema } from "./domain.js";
import { MedusaClient } from "./medusa.js";
import type { fetchJson } from "./http.js";

test("resolves the documented ticket, context, history sequence", async () => {
  const calls: string[] = [];
  const request = async (url: string): Promise<unknown> => {
    calls.push(new URL(url).pathname);
    if (url.includes("/tickets/")) {
      return {
        id: "ticket-1",
        conversations: [
          {
            id: "conversation-1",
            latest_message: {
              id: "message-1",
              created_by_member_id: "member-1",
            },
          },
        ],
      };
    }
    if (url.includes("/members/")) {
      return {
        member: { id: "member-1", client_id: "client-1" },
        last_5_messages: [],
        open_tickets: [],
      };
    }
    if (url.includes("/messages")) {
      return {
        items: [message("message-1")],
        has_more: false,
        next_after_sequence: null,
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const client = new MedusaClient(
    "https://staging.medusa.test",
    "secret",
    request as typeof fetchJson,
  );
  const resolved = await client.resolve(recent());

  assert.equal(resolved.memberContext.member.id, "member-1");
  assert.equal(resolved.trigger.id, "message-1");
  assert.deepEqual(calls, [
    "/api/v2/olive/tickets/ticket-1",
    "/api/v2/olive/members/member-1/context",
    "/api/v2/olive/conversations/conversation-1/messages",
  ]);
});

test("falls back to history when the ticket latest message has advanced", async () => {
  const calls: string[] = [];
  const request = async (url: string): Promise<unknown> => {
    calls.push(new URL(url).pathname);
    if (url.includes("/tickets/")) {
      return {
        id: "ticket-1",
        conversations: [
          {
            id: "conversation-1",
            latest_message: {
              id: "newer-message",
              created_by_member_id: null,
            },
          },
        ],
      };
    }
    if (url.includes("/messages")) {
      return {
        items: [message("message-1")],
        has_more: false,
        next_after_sequence: null,
      };
    }
    if (url.includes("/members/")) {
      return {
        member: { id: "member-1", client_id: "client-1" },
        last_5_messages: [],
        open_tickets: [],
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const client = new MedusaClient(
    "https://staging.medusa.test",
    "secret",
    request as typeof fetchJson,
  );
  await client.resolve(recent());

  assert.deepEqual(calls, [
    "/api/v2/olive/tickets/ticket-1",
    "/api/v2/olive/conversations/conversation-1/messages",
    "/api/v2/olive/members/member-1/context",
  ]);
});

function recent() {
  return recentConversationSchema.parse({
    ticket_id: "ticket-1",
    conversation_id: "conversation-1",
    message_id: "message-1",
    status: "received",
  });
}

test("recovers multiple inbound messages even when latest activity is outbound", async () => {
  const client = new MedusaClient("https://staging.medusa.test", "secret", (async () => ({
    items: [
      { ...message("old"), sent_at: "2026-09-10T11:00:00" },
      message("inbound-1"),
      { ...message("inbound-2"), sent_at: "2026-09-10T12:00:10" },
      { ...message("staff"), direction: "care_team_to_member", sent_at: "2026-09-10T12:00:20" },
    ], has_more: false,
  })) as typeof fetchJson);
  const rows = await client.expandRecent([{ ...recent(), message_id: "staff", status: "delivered" }], Date.parse("2026-09-10T11:59:00Z"));
  assert.deepEqual(rows.map((row) => row.message_id), ["inbound-1", "inbound-2"]);
});

function message(id: string) {
  return {
    id,
    conversation_id: "conversation-1",
    content: "Please help with a refill",
    direction: "member_to_care_team",
    created_by_member_id: "member-1",
    created_by_user_id: null,
    is_internal: false,
    is_automated: false,
    hidden: false,
    sent_at: "2026-09-10T12:00:00",
  };
}
