import {
  conversationMessagesSchema,
  memberContextSchema,
  recentConversationSchema,
  ticketSchema,
  type MemberContext,
  type OliveMessage,
  type RecentConversation,
  type ResolvedConversation,
  type Ticket,
} from "./domain.js";
import { fetchJson } from "./http.js";

const MAX_HISTORY_PAGES = 20;

export class MedusaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly request: typeof fetchJson = fetchJson,
  ) {}

  private async get(path: string): Promise<unknown> {
    return this.request(new URL(path, this.baseUrl).toString(), {
      method: "GET",
      headers: { "X-API-Key": this.apiKey },
      redirect: "follow",
    });
  }

  async recent(minutes: number): Promise<RecentConversation[]> {
    const payload = await this.get(
      `/api/v2/olive/recon/conversations/recent?minutes=${minutes}`,
    );
    return recentConversationSchema.array().parse(payload);
  }

  async expandRecent(rows: RecentConversation[], since: number): Promise<RecentConversation[]> {
    const candidates: RecentConversation[] = [];
    const seen = new Set<string>();
    // Discovery returns only the latest activity per conversation, including
    // outbound messages. Read each discovered thread to recover inbound bursts.
    for (const row of rows) {
      const history = await this.conversationHistory(row.conversation_id);
      for (const message of history) {
        const rawTime = message.inserted_at ?? message.sent_at;
        if (!rawTime || !isInboundTrigger(message)) continue;
        // Medusa timestamps without an offset are UTC database timestamps.
        const timestamp = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(rawTime) ? rawTime : `${rawTime}Z`);
        if (!Number.isFinite(timestamp) || timestamp < since || seen.has(message.id)) continue;
        seen.add(message.id);
        candidates.push({ ...row, message_id: message.id, status: "received", sent_at: message.sent_at });
      }
    }
    return candidates;
  }

  async ticket(ticketId: string): Promise<Ticket> {
    return ticketSchema.parse(
      await this.get(`/api/v2/olive/tickets/${encodeURIComponent(ticketId)}`),
    );
  }

  async memberContext(memberId: string): Promise<MemberContext> {
    return memberContextSchema.parse(
      await this.get(
        `/api/v2/olive/members/${encodeURIComponent(memberId)}/context`,
      ),
    );
  }

  async conversationHistory(conversationId: string): Promise<OliveMessage[]> {
    const messages: OliveMessage[] = [];
    let afterSequence: number | undefined;

    for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
      const query = new URLSearchParams({ limit: "200" });
      if (afterSequence !== undefined) {
        query.set("after_sequence", String(afterSequence));
      }
      const payload = conversationMessagesSchema.parse(
        await this.get(
          `/api/v2/olive/conversations/${encodeURIComponent(conversationId)}/messages?${query}`,
        ),
      );
      messages.push(...payload.items);
      if (!payload.has_more) return messages;
      if (
        payload.next_after_sequence === null ||
        payload.next_after_sequence === undefined ||
        payload.next_after_sequence === afterSequence
      ) {
        throw new Error("Medusa history pagination did not advance");
      }
      afterSequence = payload.next_after_sequence;
    }

    throw new Error(
      `Medusa history exceeded ${MAX_HISTORY_PAGES * 200} messages`,
    );
  }

  async resolve(recent: RecentConversation): Promise<ResolvedConversation> {
    const ticket = await this.ticket(recent.ticket_id);
    const conversation = ticket.conversations.find(
      (candidate) => candidate.id === recent.conversation_id,
    );
    if (!conversation) {
      throw new Error("Recent conversation was not present on its ticket");
    }

    let memberId =
      conversation.latest_message?.id === recent.message_id
        ? conversation.latest_message.created_by_member_id
        : undefined;
    let context: MemberContext | undefined;
    let history: OliveMessage[];

    if (memberId) {
      // This preserves the documented happy-path order: ticket, member context,
      // then conversation history. History remains authoritative for direction.
      context = await this.memberContext(memberId);
      history = await this.conversationHistory(recent.conversation_id);
    } else {
      history = await this.conversationHistory(recent.conversation_id);
      memberId = history.find((message) => message.id === recent.message_id)
        ?.created_by_member_id;
      if (!memberId) {
        throw new Error("The triggering message has no member sender");
      }
      context = await this.memberContext(memberId);
    }

    const trigger = history.find((message) => message.id === recent.message_id);
    if (!trigger) {
      throw new Error("The triggering message was not present in history");
    }
    if (trigger.created_by_member_id !== memberId) {
      throw new Error("The triggering sender did not match the resolved member");
    }

    return { recent, trigger, history, memberContext: context };
  }
}

export function isInboundCandidate(recent: RecentConversation): boolean {
  return (
    recent.status === "received" &&
    !recent.is_internal &&
    !recent.is_automated &&
    !recent.hidden
  );
}

export function isInboundTrigger(message: OliveMessage): boolean {
  return (
    message.direction === "member_to_care_team" &&
    !message.is_internal &&
    !message.is_automated &&
    !message.hidden
  );
}
