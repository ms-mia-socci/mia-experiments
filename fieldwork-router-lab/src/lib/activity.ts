import type { Message } from "@ag-ui/core";
export function citedSources(markdown: string) {
  const sources = new Map<string, { url: string; title: string }>();
  // Only explicit Markdown citations, not inferred URLs or generated download links.
  const text = markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
  for (const match of text.matchAll(
    /(?<!!)\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
  )) {
    try {
      const url = new URL(match[2]);
      if (url.username || url.password) continue;
      sources.set(url.href, { url: url.href, title: match[1] });
    } catch {}
  }
  return [...sources.values()];
}
function parse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
export function toolActivity(messages: Message[], running: boolean) {
  return messages.flatMap((message) =>
    message.role !== "assistant"
      ? []
      : (message.toolCalls || []).map((call) => {
          const result = messages.find(
            (m) => m.role === "tool" && m.toolCallId === call.id,
          );
          const output =
            result && result.role === "tool"
              ? parse(result.content)
              : undefined;
          const error =
            output?.error ||
            (output?.is_error ? "Tool reported an error." : undefined) ||
            (output?.executed === false
              ? output.message || "Code was not executed."
              : undefined) ||
            (typeof output?.exitCode === "number" && output.exitCode !== 0
              ? output.stderr || `Code exited with status ${output.exitCode}.`
              : undefined) ||
            (!result && !running
              ? "Run ended without a tool result."
              : undefined);
          return {
            id: call.id,
            name: call.function.name,
            input: parse(call.function.arguments || "{}"),
            output,
            error: typeof error === "string" ? error : JSON.stringify(error),
            state: (error
              ? "output-error"
              : result
                ? "output-available"
                : call.function.arguments
                  ? "input-available"
                  : "input-streaming") as
              | "output-error"
              | "output-available"
              | "input-available"
              | "input-streaming",
          };
        }),
  );
}
