import type { AppConfig } from "./config.js";
import type { ConnectClient } from "./connect.js";
import {
  FIRST_TOPIC_CLIENT_ID,
  IDENTITY_CONFIRMATION_CLIENT_ID,
  harnessDecisionSchema,
  DEFAULT_IDENTITY_FIELDS,
  type HarnessCase,
  type HarnessDecision,
  type HarnessInput,
  type OliveMessage,
  type ProcessRecord,
  type RecentConversation,
  type ResolvedConversation,
} from "./domain.js";
import type { HarnessClient } from "./harness.js";
import {
  isInboundTrigger,
  type MedusaClient,
} from "./medusa.js";
import type { ProcessedMessageStore } from "./state.js";

export type PollSummary = {
  discovered: number;
  candidates: number;
  completed: number;
  sent: number;
  dryRunSends: number;
  skipped: number;
  duplicates: number;
  errors: number;
};

type Logger = Pick<Console, "info" | "warn" | "error">;

export class OliveMessageProcessor {
  constructor(
    private readonly config: AppConfig,
    private readonly medusa: MedusaClient,
    private readonly harness: HarnessClient,
    private readonly connect: ConnectClient,
    private readonly store: ProcessedMessageStore,
    private readonly logger: Logger = console,
  ) {}

  async poll(): Promise<PollSummary> {
    const since = Date.now() - this.config.POLL_WINDOW_MINUTES * 60_000;
    const recent = await this.medusa.recent(this.config.POLL_WINDOW_MINUTES);
    const candidates = await this.medusa.expandRecent(recent, since);
    const summary: PollSummary = {
      discovered: recent.length,
      candidates: candidates.length,
      completed: 0,
      sent: 0,
      dryRunSends: 0,
      skipped: 0,
      duplicates: 0,
      errors: 0,
    };

    for (const candidate of candidates) {
      try {
        const outcome = await this.processCandidate(candidate);
        summary[outcome] += 1;
        if (outcome !== "duplicates") {
          summary.completed += 1;
        }
      } catch (error) {
        summary.errors += 1;
        this.logger.error("Olive message processing failed", {
          messageId: candidate.message_id,
          conversationId: candidate.conversation_id,
          error: safeError(error),
        });
      }
    }

    this.logger.info("Olive poll completed", summary);
    return summary;
  }

  private async processCandidate(
    candidate: RecentConversation,
  ): Promise<"sent" | "dryRunSends" | "skipped" | "duplicates"> {
    if (await this.store.exists(candidate.message_id)) return "duplicates";

    const resolved = await this.medusa.resolve(candidate);
    const member = resolved.memberContext.member;
    const now = new Date();
    const record: ProcessRecord = {
      messageId: candidate.message_id,
      conversationId: candidate.conversation_id,
      ticketId: candidate.ticket_id,
      memberId: member.id,
      clientId: member.client_id,
      status: "PROCESSING",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt:
        Math.floor(now.getTime() / 1000) +
        this.config.MESSAGE_RECORD_TTL_DAYS * 24 * 60 * 60,
    };
    if (!(await this.store.claim(record))) return "duplicates";

    try {
      if (!isInboundTrigger(resolved.trigger)) {
        await this.store.complete(candidate.message_id, {
          action: "NO_ACTION",
          reason: "NOT_INBOUND_MEMBER_MESSAGE",
        });
        return "skipped";
      }

      const useCase = useCaseForClient(member.client_id);
      if (!useCase) {
        await this.store.complete(candidate.message_id, {
          action: "NO_ACTION",
          reason: "UNSUPPORTED_CLIENT",
        });
        return "skipped";
      }

      const responseMessage =
        useCase === "FIRST_TOPIC"
          ? this.config.FIRST_TOPIC_RESPONSE
          : this.config.IDENTITY_CONFIRMATION_RESPONSE;
      const input = buildHarnessInput(
        resolved,
        useCase,
        responseMessage,
        this.config.MAX_HISTORY_MESSAGES,
        this.config.IDENTITY_COLLECTION_FIELDS,
      );
      const decision = await this.harness.decide(input);
      validateDecision(decision, useCase, responseMessage);

      if (decision.action === "NO_ACTION") {
        await this.store.complete(candidate.message_id, {
          action: "NO_ACTION",
          reason: decision.reason,
        });
        return "skipped";
      }

      if (this.config.DRY_RUN) {
        await this.store.complete(candidate.message_id, {
          action: "SEND_MESSAGE",
          reason: `DRY_RUN_${decision.reason}`,
        });
        this.logger.info("Olive dry-run response approved", {
          messageId: candidate.message_id,
          conversationId: candidate.conversation_id,
          clientId: member.client_id,
          reason: decision.reason,
        });
        return "dryRunSends";
      }

      // FIRST_TOPIC remains fixed text; identity replies are authored by the
      // harness using the conversation, not a field-combination template.
      const sent = await this.connect.sendMessage(member.id, decision.message!);
      await this.store.complete(candidate.message_id, {
        action: "SEND_MESSAGE",
        reason: decision.reason,
        eventId: sent.data.id,
      });
      this.logger.info("Olive response accepted by Connect", {
        messageId: candidate.message_id,
        conversationId: candidate.conversation_id,
        clientId: member.client_id,
        connectEventId: sent.data.id,
        reason: decision.reason,
      });
      return "sent";
    } catch (error) {
      await this.store.fail(candidate.message_id, safeError(error));
      throw error;
    }
  }
}

function useCaseForClient(clientId: string): HarnessCase | undefined {
  if (clientId === FIRST_TOPIC_CLIENT_ID) return "FIRST_TOPIC";
  if (clientId === IDENTITY_CONFIRMATION_CLIENT_ID) {
    return "IDENTITY_CONFIRMATION";
  }
  return undefined;
}

function visibleMessage(message: OliveMessage, useCase: HarnessCase): boolean {
  return !message.is_internal && !message.hidden &&
    (!message.is_automated ||
      (useCase === "IDENTITY_CONFIRMATION" && message.direction === "care_team_to_member"));
}

function messageTime(message: OliveMessage): string | null {
  return message.sent_at ?? message.inserted_at ?? null;
}

export function buildHarnessInput(
  resolved: ResolvedConversation,
  useCase: HarnessCase,
  responseMessage: string,
  maxHistoryMessages: number,
  collectionFields = DEFAULT_IDENTITY_FIELDS,
): HarnessInput {
  const triggerIndex = resolved.history.findIndex(
    (message) => message.id === resolved.trigger.id,
  );
  const sameConversationPrior = resolved.history.slice(
    0,
    triggerIndex < 0 ? 0 : triggerIndex,
  );
  const seen = new Set<string>(resolved.history.slice(triggerIndex).map((message) => message.id));
  const prior: OliveMessage[] = [];
  for (const message of [
    ...sameConversationPrior,
    ...resolved.memberContext.last_5_messages,
  ]) {
    if (seen.has(message.id) || !visibleMessage(message, useCase)) continue;
    // Collection is scoped to this thread; another conversation must not make
    // the agent think it already asked for or collected this patient's details.
    if (useCase === "IDENTITY_CONFIRMATION" &&
        message.conversation_id !== resolved.trigger.conversation_id) continue;
    if (message.direction === "member_to_care_team" &&
        message.created_by_member_id !== resolved.trigger.created_by_member_id &&
        message.created_by_member_id !== resolved.memberContext.member.id) continue;
    const sentAt = messageTime(message);
    const triggerSentAt = messageTime(resolved.trigger);
    if (sentAt && triggerSentAt && sentAt > triggerSentAt) continue;
    seen.add(message.id);
    prior.push(message);
  }
  prior.sort((left, right) =>
    (messageTime(left) ?? "").localeCompare(messageTime(right) ?? ""),
  );
  if (prior.length > maxHistoryMessages) {
    throw new Error("History exceeds the configured context limit; manual review required");
  }
  const boundedPrior = prior;

  return {
    schemaVersion: 1,
    useCase,
    clientId: resolved.memberContext.member.client_id,
    responsePolicy: {
      message: responseMessage,
      ...(useCase === "IDENTITY_CONFIRMATION" ? { collectionFields } : {}),
    },
    trigger: {
      messageId: resolved.trigger.id,
      conversationId: resolved.trigger.conversation_id,
      source: resolved.trigger.source ?? null,
      sentAt: messageTime(resolved.trigger),
      content: resolved.trigger.content,
    },
    member: {
      memberId: resolved.memberContext.member.id,
      timeZone: resolved.memberContext.member.time_zone ?? null,
    },
    priorMessages: boundedPrior.map((message) => ({
      messageId: message.id,
      conversationId: message.conversation_id,
      direction: message.direction ?? null,
      source: message.source ?? null,
      sentAt: messageTime(message),
      content: message.content,
    })),
  };
}

export function validateDecision(
  decision: HarnessDecision,
  useCase: HarnessCase,
  configuredMessage: string,
): void {
  harnessDecisionSchema.parse(decision);
  const allowedReasons =
    useCase === "FIRST_TOPIC"
      ? new Set(["FIRST_TOPIC", "REPEAT_TOPIC", "INSUFFICIENT_CONTEXT"])
      : new Set([
          "REQUEST_IDENTITY_CONFIRMATION",
          "IDENTITY_FOLLOW_UP",
          "IDENTITY_DETAILS_COLLECTED",
          "IDENTITY_CONVERSATION_COMPLETE",
          "IDENTITY_CONFIRMATION_DECLINED",
          "INSUFFICIENT_CONTEXT",
        ]);
  if (!allowedReasons.has(decision.reason)) {
    throw new Error("Harness returned a reason outside the selected use case");
  }
  if (useCase === "FIRST_TOPIC" && decision.action === "SEND_MESSAGE" && decision.message !== configuredMessage) {
    throw new Error("Harness altered the configured patient response");
  }
  const sendReasons = new Set([
    "FIRST_TOPIC", "REQUEST_IDENTITY_CONFIRMATION", "IDENTITY_FOLLOW_UP", "IDENTITY_DETAILS_COLLECTED",
  ]);
  if ((decision.action === "SEND_MESSAGE") !== sendReasons.has(decision.reason)) {
    throw new Error("Harness action and reason were inconsistent");
  }
}

function safeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
