import { test } from "node:test";
import assert from "node:assert/strict";
import {
  currentTraceHeaders,
  newTraceHeaders,
  observabilityState,
} from "../src/lib/server/observability.ts";

test("runtime trace headers use correlated X-Ray and W3C identifiers", () => {
  const headers = newTraceHeaders("thread-123", "claude");
  assert.match(
    headers.traceId,
    /^Root=1-[0-9a-f]{8}-[0-9a-f]{24};Parent=[0-9a-f]{16};Sampled=1$/,
  );
  assert.match(
    headers.traceParent,
    new RegExp(`^00-${headers.rawTraceId}-[0-9a-f]{16}-01$`),
  );
  assert.equal(
    headers.traceId.match(/Parent=([0-9a-f]{16})/)?.[1],
    headers.traceParent.split("-")[2],
  );
  assert.equal(
    headers.baggage,
    "session.id=thread-123,fieldwork.framework=claude",
  );
});

test("trace metadata is absent without an active provider span", () => {
  assert.equal(currentTraceHeaders(), undefined);
  assert.equal(observabilityState("thread-123"), undefined);
});

test("trace baggage encodes values and never includes user content", () => {
  const headers = newTraceHeaders("thread with spaces", "a/b");
  assert.equal(
    headers.baggage,
    "session.id=thread%20with%20spaces,fieldwork.framework=a%2Fb",
  );
  assert.doesNotMatch(
    JSON.stringify(headers),
    /prompt|message|attachment|content=/i,
  );
});
