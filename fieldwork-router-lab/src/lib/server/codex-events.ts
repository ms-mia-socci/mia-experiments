import type { ThreadItem } from "@openai/codex-sdk";
import type { RunContext } from "./providers";
// Translate SDK lifecycle items once, at the provider boundary.
export function codexToolEvents(ctx: RunContext) {
  const started = new Set<string>(),
    finished = new Set<string>();
  return (item: ThreadItem, complete: boolean) => {
    if (item.type === "agent_message" || item.type === "reasoning") return;
    if (item.type === "mcp_tool_call" && item.server === "fieldwork") return; // shared tool emits its own canonical events
    if (item.type === "todo_list") {
      ctx.emit({
        type: "ACTIVITY_SNAPSHOT",
        messageId: item.id,
        activityType: "plan",
        content: { items: item.items },
        replace: true,
      });
      return;
    }
    const args =
      item.type === "command_execution"
        ? { command: item.command }
        : item.type === "mcp_tool_call"
          ? item.arguments
          : item.type === "web_search"
            ? { query: item.query }
            : item.type === "file_change"
              ? { changes: item.changes }
              : {};
    if (!started.has(item.id)) {
      ctx.endText();
      started.add(item.id);
      ctx.emit({
        type: "TOOL_CALL_START",
        toolCallId: item.id,
        toolCallName:
          item.type === "mcp_tool_call"
            ? `${item.server}.${item.tool}`
            : item.type,
      });
      ctx.emit({
        type: "TOOL_CALL_ARGS",
        toolCallId: item.id,
        delta: JSON.stringify(args),
      });
      ctx.emit({ type: "TOOL_CALL_END", toolCallId: item.id });
    }
    if (complete && !finished.has(item.id)) {
      finished.add(item.id);
      const output =
        item.type === "command_execution"
          ? {
              stdout: item.aggregated_output,
              exitCode: item.exit_code,
              ...(item.status === "failed"
                ? { error: item.aggregated_output || "Command failed" }
                : {}),
            }
          : item.type === "mcp_tool_call"
            ? item.error
              ? { error: item.error.message }
              : (item.result?.structured_content ?? item.result)
            : item.type === "error"
              ? { error: item.message }
              : item.type === "file_change" && item.status === "failed"
                ? { error: "File change failed", changes: item.changes }
                : item;
      ctx.emit({
        type: "TOOL_CALL_RESULT",
        toolCallId: item.id,
        messageId: crypto.randomUUID(),
        role: "tool",
        content: JSON.stringify(output ?? null),
      });
    }
  };
}
