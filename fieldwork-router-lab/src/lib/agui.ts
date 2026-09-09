import {
  EventSchemas,
  type AGUIEvent,
  type Message as AgentMessage,
} from "@ag-ui/core";
import {
  HttpAgent,
  defaultApplyEvents,
  transformChunks,
  type AgentStateMutation,
} from "@ag-ui/client";
import { from, lastValueFrom, reduce } from "rxjs";
import type { Message, Approval, Recommendation } from "./server/store";
import type { UsageSnapshot } from "./usage";
import type { ObservabilityState } from "./server/observability";
type Event = AGUIEvent;
export type WireEvent = {
  [T in Event["type"]]: Omit<Extract<Event, { type: T }>, "type"> & {
    type: `${T}`;
  };
}[Event["type"]];
export type WorkspaceState = {
  recommendation: Recommendation | null;
  approval: Approval | null;
  documents: { filename: string; url: string }[];
  usage: UsageSnapshot | null;
  observability: ObservabilityState | null;
  memory: {
    status: string;
    items: { framework: string; kind: string; text: string }[];
  } | null;
};
export const emptyWorkspaceState = (): WorkspaceState => ({
  recommendation: null,
  approval: null,
  documents: [],
  usage: null,
  observability: null,
  memory: null,
});
export function protocolMessages(messages: Message[]): AgentMessage[] {
  return messages.map(({ agent, attachments, ...m }) => ({
    ...m,
    metadata: { fieldwork: { agent, ...(attachments ? { attachments } : {}) } },
  }));
}
export function chatMessages(
  messages: readonly AgentMessage[],
  fallback: string,
): Message[] {
  return messages.flatMap((m) => {
    if (
      (m.role !== "user" && m.role !== "assistant") ||
      typeof m.content !== "string"
    )
      return [];
    const extra = m.metadata?.fieldwork;
    return [
      {
        id: m.id,
        role: m.role,
        content: m.content,
        agent: extra?.agent || (m.role === "user" ? "user" : fallback),
        ...(extra?.attachments ? { attachments: extra.attachments } : {}),
      },
    ];
  });
}
// Apply saved events using the same library reducer as HttpAgent, including partial
// runs. No HTTP request or lifecycle verification is needed to restore an open run.
export async function replayEvents(
  saved: unknown[],
  initial: Message[],
  state: WorkspaceState = emptyWorkspaceState(),
) {
  const replayedIds = new Set(
    saved.flatMap((e: any) =>
      (e.type === "TEXT_MESSAGE_START" || e.type === "TEXT_MESSAGE_CHUNK") &&
      e.messageId
        ? [e.messageId]
        : [],
    ),
  );
  const restoredEvents = saved.map((e: any) => {
    // Read-only compatibility for conversations recorded before shared-state events.
    const key =
      e.type === "CUSTOM"
        ? (
            {
              usage_snapshot: "usage",
              memory_recalled: "memory",
              approval_requested: "approval",
              approval_resolved: "approval",
              route_recommended: "recommendation",
            } as Record<string, string>
          )[e.name]
        : undefined;
    return key
      ? {
          type: "STATE_DELTA",
          delta: [
            {
              op: "add",
              path: `/${key}`,
              value: e.name === "approval_resolved" ? null : e.value,
            },
          ],
        }
      : e;
  });
  const agent = new HttpAgent({
    url: "http://unused.invalid",
    initialMessages: protocolMessages(
      initial.filter((m) => !replayedIds.has(m.id)),
    ),
    initialState: state,
  });
  const input = {
    threadId: "replay",
    runId: "replay",
    messages: agent.messages,
    state,
    tools: [],
    context: [],
    forwardedProps: {},
  };
  const seed: AgentStateMutation = { messages: agent.messages, state };
  const result = await lastValueFrom(
    defaultApplyEvents(
      input,
      from(restoredEvents.map((e) => EventSchemas.parse(e))).pipe(
        transformChunks(),
      ),
      agent,
      [],
    ).pipe(reduce((current, update) => ({ ...current, ...update }), seed)),
  );
  return {
    messages: result.messages!,
    state: { ...emptyWorkspaceState(), ...result.state } as WorkspaceState,
  };
}
