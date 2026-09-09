export type Framework = "strands" | "claude" | "codex";
export const catalog = [
  {
    id: "strands" as const,
    name: "AWS Strands",
    short: "Strands",
    mark: "S",
    tag: "Plan & coordinate",
    description: "Shape an idea, break down a task, or coordinate a workflow.",
    color: "sage",
    capabilities: ["Planning", "Task routing", "Custom tools"],
  },
  {
    id: "claude" as const,
    name: "Claude Agent SDK",
    short: "Claude",
    mark: "✳",
    tag: "Research & create",
    description:
      "Research a topic, reason through code, and turn findings into documents.",
    color: "clay",
    capabilities: ["Web research", "Documents", "Coding help"],
  },
  {
    id: "codex" as const,
    name: "OpenAI Codex",
    short: "Codex",
    mark: "›_",
    tag: "Engineering tasks",
    description:
      "Investigate code and work through technical implementation tasks.",
    color: "ink",
    capabilities: ["Code investigation", "Engineering", "Workspace tasks"],
  },
];
export const frameworkName = (id: string) =>
  catalog.find((f) => f.id === id)?.name || "Strands coordinator";
export const isFramework = (id: unknown): id is Framework =>
  catalog.some((f) => f.id === id);
