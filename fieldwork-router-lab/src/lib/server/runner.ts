import { recallMemory, captureMemory, type MemoryRun } from "./memory";
import { randomUUID } from "node:crypto";
import { EventEncoder } from "@ag-ui/encoder";
import { EventSchemas } from "@ag-ui/core";
import {
  protocolMessages,
  chatMessages,
  replayEvents,
  emptyWorkspaceState,
  type WireEvent,
} from "../agui";
import {
  appendEvent,
  transaction,
  get,
  updateThread,
  events,
  items,
  type Thread,
  type Message,
} from "./store";
import { runClaude, runStrands, runCodex, type RunContext } from "./providers";
import {
  activeContext,
  observabilityState,
  recordUsage,
  setSpanOutcome,
  withSpan,
} from "./observability";
import { publicRunError } from "./run-errors";
export const activeRuns = new Map<string, AbortController>();
export async function streamRun(thread: Thread, handoff = false) {
  const documents = await items<{ filename: string }>(`documents:${thread.id}`);
  const controller = new AbortController();
  activeRuns.set(thread.id, controller);
  const encoder = new EventEncoder();
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    async start(output) {
      const parentContext = activeContext();
      const encode = new TextEncoder();
      let writes = Promise.resolve();
      let persistenceError: unknown;
      const emit = (event: WireEvent) => {
        const value = EventSchemas.parse({ ...event, timestamp: Date.now() });
        writes = writes
          .then(() => appendEvent(thread.id, thread.runId!, value))
          .catch((error) => {
            persistenceError = error;
            controller.abort();
          });
        if (!closed)
          try {
            output.enqueue(encode.encode(encoder.encode(value)));
          } catch {
            closed = true;
          }
      };
      let messages: Message[] = [];
      const workspace = {
        ...emptyWorkspaceState(),
        recommendation: thread.recommendation,
        documents: documents.map(({ filename }) => ({
          filename,
          url: `/api/threads/${thread.id}/documents/${filename}`,
        })),
      };
      const setState: RunContext["setState"] = (key, value) => {
        Object.assign(workspace, { [key]: value });
        if (key === "usage" && value)
          recordUsage(value as import("../usage").UsageSnapshot);
        emit({
          type: "STATE_DELTA",
          delta: [{ op: "add", path: `/${key}`, value }],
        });
      };
      let textId: string | null = null;
      const endText = () => {
        if (textId) emit({ type: "TEXT_MESSAGE_END", messageId: textId });
        textId = null;
      };
      const text = (delta: string) => {
        if (!delta) return;
        if (!textId) {
          textId = randomUUID();
          emit({
            type: "TEXT_MESSAGE_START",
            messageId: textId,
            role: "assistant",
            metadata: {
              fieldwork: {
                agent:
                  thread.phase === "routing" ? "coordinator" : thread.framework,
              },
            },
          });
        }
        emit({ type: "TEXT_MESSAGE_CONTENT", messageId: textId, delta });
      };
      const call: RunContext["call"] = async (name, args, fn) => {
        endText();
        const toolCallId = randomUUID();
        emit({ type: "TOOL_CALL_START", toolCallId, toolCallName: name });
        emit({
          type: "TOOL_CALL_ARGS",
          toolCallId,
          delta: JSON.stringify(args),
        });
        emit({ type: "TOOL_CALL_END", toolCallId });
        try {
          const result = await withSpan(
            `execute_tool ${name}`,
            {
              "gen_ai.operation.name": "execute_tool",
              "gen_ai.tool.name": name,
              "fieldwork.framework":
                thread.phase === "routing" ? "coordinator" : thread.framework!,
              "fieldwork.run.id": thread.runId!,
            },
            fn,
          );
          emit({
            type: "TOOL_CALL_RESULT",
            toolCallId,
            messageId: randomUUID(),
            role: "tool",
            content: JSON.stringify(result),
          });
          return result;
        } catch (e) {
          emit({
            type: "TOOL_CALL_RESULT",
            toolCallId,
            messageId: randomUUID(),
            role: "tool",
            content: JSON.stringify({ error: (e as Error).message }),
          });
          throw e;
        }
      };
      const ctx: RunContext = {
        thread,
        controller,
        emit,
        setState,
        text,
        endText,
        call,
      };
      const timeout = setTimeout(
        () => controller.abort(),
        Math.max(1, Math.min(210000, thread.deadline - Date.now() - 10000)),
      );
      const cancellation = setInterval(() => {
        void get<Thread>("threads", thread.id)
          .then((current) => {
            if (current?.runId !== thread.runId || current.status !== "running")
              controller.abort();
          })
          .catch(() => controller.abort());
      }, 1000);
      const heartbeat = setInterval(() => {
        if (!closed)
          try {
            output.enqueue(encode.encode(": heartbeat\n\n"));
          } catch {
            closed = true;
          }
      }, 10000);
      void withSpan(
        "invoke_agent fieldwork-router",
        {
          "gen_ai.operation.name": "invoke_agent",
          "gen_ai.agent.name": "fieldwork-router",
          "fieldwork.framework":
            thread.phase === "routing" ? "coordinator" : thread.framework!,
          "fieldwork.phase": thread.phase,
          "fieldwork.run.id": thread.runId!,
          "session.id": thread.id,
          "fieldwork.handoff": handoff,
          "fieldwork.telemetry.content_capture": false,
        },
        async (runSpan) => {
        let status: Thread["status"] = "complete";
        const telemetry = observabilityState(thread.id);
        if (telemetry) workspace.observability = telemetry;
        emit({
          type: "RUN_STARTED",
          threadId: thread.id,
          runId: thread.runId!,
        });
        emit({
          type: "MESSAGES_SNAPSHOT",
          messages: protocolMessages(thread.messages),
        });
        emit({ type: "STATE_SNAPSHOT", snapshot: workspace });
        emit({
          type: "CUSTOM",
          name: "agent_active",
          value: { framework: thread.framework, phase: thread.phase },
        });
        if (handoff)
          emit({
            type: "CUSTOM",
            name: "handoff",
            value: {
              to: thread.framework,
              from: "coordinator",
              brief: thread.messages.at(-1)?.content,
            },
          });
        let memory: MemoryRun | undefined;
        try {
          memory = await withSpan(
            "retrieve_memory",
            {
              "gen_ai.operation.name": "retrieve_memory",
              "fieldwork.run.id": thread.runId!,
            },
            () => recallMemory(thread),
          );
          ctx.memoryContext = memory.context;
          await setState("memory", {
            status: memory.status,
            items: memory.recalled,
          });
          controller.signal.throwIfAborted();
          await withSpan(
            `invoke_framework ${thread.phase === "routing" ? "coordinator" : thread.framework}`,
            {
              "gen_ai.operation.name": "invoke_agent",
              "gen_ai.agent.name":
                thread.phase === "routing" ? "coordinator" : thread.framework!,
              "fieldwork.framework":
                thread.phase === "routing" ? "strands" : thread.framework!,
              "fieldwork.run.id": thread.runId!,
            },
            async () => {
              if (thread.phase === "routing") await runStrands(ctx, true);
              else if (thread.framework === "claude") await runClaude(ctx);
              else if (thread.framework === "codex") await runCodex(ctx);
              else await runStrands(ctx, false);
            },
          );
          controller.signal.throwIfAborted();
        } catch (e) {
          endText();
          status = controller.signal.aborted ? "cancelled" : "error";
          const failure = publicRunError(e, status === "cancelled");
          await setState("approval", null);
          emit({ type: "RUN_ERROR", ...failure });
          console.error(
            "[fieldwork]",
            (e as Error).name,
            (e as Error).message
              .replaceAll(process.env.ANTHROPIC_API_KEY || "___", "[REDACTED]")
              .replaceAll(process.env.OPENAI_API_KEY || "___", "[REDACTED]"),
          );
        } finally {
          endText();
          clearTimeout(timeout);
          clearInterval(heartbeat);
          clearInterval(cancellation);
          await writes;
          if (persistenceError) status = "error";
          if (activeRuns.get(thread.id) === controller)
            activeRuns.delete(thread.id);
          const restored = await replayEvents(
            await events(thread.id, thread.runId),
            thread.messages,
          );
          const initialIds = new Set(thread.messages.map((m) => m.id));
          messages = chatMessages(
            restored.messages,
            thread.phase === "routing" ? "coordinator" : thread.framework!,
          ).filter((m) => !initialIds.has(m.id));
          await transaction(async () => {
            const latest = await get<Thread>("threads", thread.id);
            if (latest?.status === "cancelled") status = "cancelled";
            if (latest?.runId === thread.runId)
              await updateThread(thread.id, {
                status,
                messages: [...thread.messages, ...messages].slice(-40),
                pendingApproval: null,
              });
          });
          if (status === "complete") await setState("approval", null);
          if (status === "complete" && memory)
            await withSpan(
              "store_memory",
              {
                "gen_ai.operation.name": "store_memory",
                "fieldwork.run.id": thread.runId!,
              },
              () => captureMemory(thread, messages, memory!),
            );
          if (status === "complete")
            emit({
              type: "RUN_FINISHED",
              threadId: thread.id,
              runId: thread.runId!,
            });
          await writes;
          setSpanOutcome(runSpan, status);
          if (!closed) {
            closed = true;
            output.close();
          }
        }
        },
        parentContext,
      ).catch(() => {
        if (!closed) {
          closed = true;
          output.error(new Error("Run finalization failed"));
        }
      });
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
