import type { Framework } from "./catalog";
export type TokenTotals = {
  input: number;
  output: number;
  cacheRead: number | null;
  cacheWrite: number | null;
  reasoning: number | null;
};
export type UsageSnapshot = {
  version: 1;
  framework: Framework;
  runId: string;
  model: string | null;
  totals: TokenTotals;
  context: {
    input: number;
    limit: number | null;
    basis: "last-model-request";
  } | null;
  costUsd: number | null;
  scope: "reported-so-far" | "run-total";
  updatedAt: number;
};
const n = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
const optional = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
export const emptyTotals = (): TokenTotals => ({
  input: 0,
  output: 0,
  cacheRead: null,
  cacheWrite: null,
  reasoning: null,
});
export function anthropicTokens(u: any): TokenTotals {
  return {
    input:
      n(u.input_tokens) +
      n(u.cache_read_input_tokens) +
      n(u.cache_creation_input_tokens),
    output: n(u.output_tokens),
    cacheRead: optional(u.cache_read_input_tokens),
    cacheWrite: optional(u.cache_creation_input_tokens),
    reasoning: null,
  };
}
export function strandsTokens(u: any): TokenTotals {
  const cached = n(u.cacheReadInputTokens) + n(u.cacheWriteInputTokens);
  return {
    input:
      n(u.inputTokens) +
      (u.inputTokens + u.outputTokens === u.totalTokens ? 0 : cached),
    output: n(u.outputTokens),
    cacheRead: optional(u.cacheReadInputTokens),
    cacheWrite: optional(u.cacheWriteInputTokens),
    reasoning: null,
  };
}
export function codexTokens(u: any): TokenTotals {
  return {
    input: n(u.input_tokens),
    output: n(u.output_tokens),
    cacheRead: optional(u.cached_input_tokens),
    cacheWrite: optional(u.cache_write_input_tokens),
    reasoning: optional(u.reasoning_output_tokens),
  };
}
export function addTotals(a: TokenTotals, b: TokenTotals): TokenTotals {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead:
      a.cacheRead === null && b.cacheRead === null
        ? null
        : n(a.cacheRead) + n(b.cacheRead),
    cacheWrite:
      a.cacheWrite === null && b.cacheWrite === null
        ? null
        : n(a.cacheWrite) + n(b.cacheWrite),
    reasoning:
      a.reasoning === null && b.reasoning === null
        ? null
        : n(a.reasoning) + n(b.reasoning),
  };
}
export function claudeTotals(models: Record<string, any>): TokenTotals {
  return Object.values(models).reduce(
    (sum, u) =>
      addTotals(sum, {
        input:
          n(u.inputTokens) +
          n(u.cacheReadInputTokens) +
          n(u.cacheCreationInputTokens),
        output: n(u.outputTokens),
        cacheRead: optional(u.cacheReadInputTokens),
        cacheWrite: optional(u.cacheCreationInputTokens),
        reasoning: optional(u.thinkingTokens),
      }),
    emptyTotals(),
  );
}
export function latestUsage(events: any[]): UsageSnapshot | null {
  const value = events.findLast(
    (e) => e.type === "CUSTOM" && e.name === "usage_snapshot",
  )?.value;
  return value?.version === 1 ? value : null;
}
