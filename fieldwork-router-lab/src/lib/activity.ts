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
export function toolActivity(events: any[], running: boolean) {
  return events
    .filter((e) => e.type === "TOOL_CALL_START")
    .map((e) => {
      const args = events
        .filter(
          (a) => a.type === "TOOL_CALL_ARGS" && a.toolCallId === e.toolCallId,
        )
        .map((a) => a.delta)
        .join("");
      const result = events.find(
        (a) => a.type === "TOOL_CALL_RESULT" && a.toolCallId === e.toolCallId,
      );
      const output = result ? parse(result.content) : undefined;
      const error =
        output?.error ||
        (output?.is_error ? "Tool reported an error." : undefined) ||
        (!result && !running ? "Run ended without a tool result." : undefined);
      return {
        id: e.toolCallId,
        name: e.toolCallName,
        input: parse(args || "{}"),
        output,
        error: typeof error === "string" ? error : JSON.stringify(error),
        state: (error
          ? "output-error"
          : result
            ? "output-available"
            : args
              ? "input-available"
              : "input-streaming") as
          | "output-error"
          | "output-available"
          | "input-available"
          | "input-streaming",
      };
    });
}
