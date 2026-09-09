import { randomUUID } from "node:crypto";
import { EventEncoder } from "@ag-ui/encoder";
import type { BaseEvent } from "@ag-ui/core";
import {
  appendEvent,
  get,
  updateThread,
  type Thread,
  type Message,
} from "./store";
import { runClaude, runStrands, runCodex, type RunContext } from "./providers";
export const activeRuns = new Map<string, AbortController>();
export function streamRun(thread: Thread, handoff = false) {
  const controller = new AbortController();
  activeRuns.set(thread.id, controller);
  const encoder = new EventEncoder();
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    start(output) {
      const encode = new TextEncoder();
      const emit = (event: Record<string, any>) => {
        const value = { ...event, timestamp: Date.now() };
        appendEvent(thread.id, thread.runId!, value);
        if (!closed)
          try {
            output.enqueue(encode.encode(encoder.encode(value as BaseEvent)));
          } catch {
            closed = true;
          }
      };
      const messages: Message[] = [];
      let textId: string | null = null;
      const endText = () => {
        if (textId) emit({ type: "TEXT_MESSAGE_END", messageId: textId });
        textId = null;
      };
      const text = (delta: string) => {
        if (!delta) return;
        if (!textId) {
          textId = randomUUID();
          messages.push({
            id: textId,
            role: "assistant",
            content: "",
            agent:
              thread.phase === "routing" ? "coordinator" : thread.framework!,
          });
          emit({
            type: "TEXT_MESSAGE_START",
            messageId: textId,
            role: "assistant",
          });
        }
        messages.at(-1)!.content += delta;
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
          const result = await fn();
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
      const ctx: RunContext = { thread, controller, emit, text, endText, call };
      const timeout = setTimeout(() => controller.abort(), 210000);
      const heartbeat = setInterval(() => {
        if (!closed)
          try {
            output.enqueue(encode.encode(": heartbeat\n\n"));
          } catch {
            closed = true;
          }
      }, 10000);
      void (async () => {
        let status: Thread["status"] = "complete";
        emit({ type: "RUN_STARTED", threadId: thread.id, runId: thread.runId });
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
        try {
          if (thread.phase === "routing") await runStrands(ctx, true);
          else if (thread.framework === "claude") await runClaude(ctx);
          else if (thread.framework === "codex") await runCodex(ctx);
          else await runStrands(ctx, false);
          controller.signal.throwIfAborted();
        } catch (e) {
          endText();
          status = controller.signal.aborted ? "cancelled" : "error";
          const message =
            status === "cancelled"
              ? "Run stopped."
              : "The agent could not finish. Your conversation is saved; please try again.";
          emit({ type: "RUN_ERROR", code: status.toUpperCase(), message });
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
          activeRuns.delete(thread.id);
          const latest = get<Thread>("threads", thread.id);
          if (latest?.runId === thread.runId)
            updateThread(thread.id, {
              status,
              messages: [...thread.messages, ...messages].slice(-40),
              pendingApproval: null,
            });
          if (status === "complete")
            emit({
              type: "RUN_FINISHED",
              threadId: thread.id,
              runId: thread.runId,
            });
          if (!closed) {
            closed = true;
            output.close();
          }
        }
      })();
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
