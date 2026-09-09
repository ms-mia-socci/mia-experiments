import {
  context,
  trace,
  SpanStatusCode,
  type Attributes,
  type Context,
  type Span,
} from "@opentelemetry/api";
import { randomBytes } from "node:crypto";

const tracer = trace.getTracer("fieldwork-router-lab", "1.0.0");

export type TraceHeaders = {
  traceId: string;
  traceParent: string;
  baggage: string;
  rawTraceId: string;
};

export type ObservabilityState = {
  traceId: string;
  sessionId: string;
  sampled: boolean;
  contentCapture: "disabled";
  consoleUrl: string;
};

export const cloudWatchObservabilityUrl =
  "https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#gen-ai-observability";

function xrayHeader(traceId: string, spanId: string, sampled: boolean) {
  return `Root=1-${traceId.slice(0, 8)}-${traceId.slice(8)};Parent=${spanId};Sampled=${sampled ? "1" : "0"}`;
}

function headers(traceId: string, spanId: string, sampled: boolean): TraceHeaders {
  return {
    traceId: xrayHeader(traceId, spanId, sampled),
    traceParent: `00-${traceId}-${spanId}-${sampled ? "01" : "00"}`,
    baggage: "",
    rawTraceId: traceId,
  };
}

export function newTraceHeaders(sessionId: string, framework?: string | null) {
  const epoch = Math.floor(Date.now() / 1000)
    .toString(16)
    .padStart(8, "0")
    .slice(-8);
  const result = headers(
    epoch + randomBytes(12).toString("hex"),
    randomBytes(8).toString("hex"),
    true,
  );
  const values = [["session.id", sessionId]];
  if (framework) values.push(["fieldwork.framework", framework]);
  result.baggage = values
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join(",");
  return result;
}

export function currentTraceHeaders(): TraceHeaders | undefined {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext || !trace.isSpanContextValid(spanContext)) return;
  return headers(
    spanContext.traceId,
    spanContext.spanId,
    Boolean(spanContext.traceFlags & 1),
  );
}

export function observabilityState(
  sessionId: string,
): ObservabilityState | undefined {
  const current = currentTraceHeaders();
  if (!current) return;
  return {
    traceId: current.rawTraceId,
    sessionId,
    sampled: current.traceParent.endsWith("-01"),
    contentCapture: "disabled",
    consoleUrl: cloudWatchObservabilityUrl,
  };
}

export function setSpanOutcome(
  span: Span | undefined,
  outcome: "complete" | "cancelled" | "error",
) {
  if (!span) return;
  span.setAttribute("fieldwork.outcome", outcome);
  span.setStatus({
    code: outcome === "error" ? SpanStatusCode.ERROR : SpanStatusCode.OK,
    ...(outcome === "error" ? { message: "Fieldwork operation failed" } : {}),
  });
}

export function recordUsage(value: {
  framework: string;
  totals: { input: number; output: number };
  model: string | null;
  costUsd: number | null;
}) {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.setAttributes({
    "fieldwork.framework": value.framework,
    "gen_ai.usage.input_tokens": value.totals.input,
    "gen_ai.usage.output_tokens": value.totals.output,
    "gen_ai.usage.total_tokens": value.totals.input + value.totals.output,
    ...(value.model ? { "gen_ai.request.model": value.model } : {}),
    ...(value.costUsd === null
      ? {}
      : { "fieldwork.usage.estimated_cost_usd": value.costUsd }),
  });
}

export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
  parent: Context = context.active(),
): Promise<T> {
  const span = tracer.startSpan(name, { attributes }, parent);
  try {
    return await context.with(trace.setSpan(parent, span), () => fn(span));
  } catch (error) {
    span.setAttribute("error.type", error instanceof Error ? error.name : "Error");
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: "Fieldwork operation failed",
    });
    throw error;
  } finally {
    span.end();
  }
}

export function activeContext() {
  return context.active();
}
