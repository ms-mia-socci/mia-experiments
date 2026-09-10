import type { ScheduledEvent } from "aws-lambda";
import { createProcessor } from "./runtime.js";
import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.js";
import { FIRST_TOPIC_CLIENT_ID } from "./domain.js";
import { HarnessClient } from "./harness.js";

let processorPromise: ReturnType<typeof createProcessor> | undefined;

export async function handler(event: ScheduledEvent | { type: string }): Promise<unknown> {
  // IAM-only deployment probe exercises the Lambda role -> Harness path using
  // fixed synthetic data. This branch cannot send through Connect.
  if ("type" in event && event.type === "olive.harness.smoke") {
    const config = loadConfig();
    const harness = new HarnessClient(config.AWS_REGION, config.OLIVE_HARNESS_ARN, config.OLIVE_HARNESS_QUALIFIER);
    const decision = await harness.decide({
      schemaVersion: 1, useCase: "FIRST_TOPIC", clientId: FIRST_TOPIC_CLIENT_ID,
      responsePolicy: { message: config.FIRST_TOPIC_RESPONSE },
      member: { memberId: randomUUID(), timeZone: "America/New_York" },
      trigger: { messageId: randomUUID(), conversationId: randomUUID(), source: "sms", sentAt: new Date().toISOString(), content: "Please help me schedule an annual appointment." },
      priorMessages: [],
    });
    if (decision.action !== "SEND_MESSAGE" || decision.reason !== "FIRST_TOPIC" || decision.message !== config.FIRST_TOPIC_RESPONSE) {
      throw new Error("Synthetic Harness smoke decision did not match expected result");
    }
    return { verified: true, action: decision.action, reason: decision.reason, delivered: false };
  }
  processorPromise ??= createProcessor();
  const processor = await processorPromise;
  return processor.poll();
}
