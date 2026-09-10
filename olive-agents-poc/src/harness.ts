import {
  BedrockAgentCoreClient,
  InvokeHarnessCommand,
  type InvokeHarnessStreamOutput,
} from "@aws-sdk/client-bedrock-agentcore";
import {
  harnessDecisionSchema,
  type HarnessDecision,
  type HarnessInput,
} from "./domain.js";
import { collectionFeedback } from "./collection.js";

type HarnessInvoker = {
  send(command: InvokeHarnessCommand): Promise<{
    stream?: AsyncIterable<InvokeHarnessStreamOutput> | undefined;
  }>;
};

export class HarnessClient {
  private readonly client: HarnessInvoker;

  constructor(
    region: string,
    private readonly harnessArn: string,
    private readonly qualifier: string,
    client?: HarnessInvoker,
  ) {
    this.client = client ?? new BedrockAgentCoreClient({ region, maxAttempts: 2 });
  }

  async decide(input: HarnessInput): Promise<HarnessDecision> {
    let request = input;
    for (let attempt = 0; attempt < 2; attempt++) {
      const decision = await this.invoke(request);
      const feedback = collectionFeedback(decision, input);
      if (!feedback) return decision;
      request = { ...input, validationFeedback: feedback };
    }
    throw new Error("Harness collection evidence failed validation after a corrective retry");
  }

  private async invoke(input: HarnessInput): Promise<HarnessDecision> {
    const response = await this.client.send(
      new InvokeHarnessCommand({
        harnessArn: this.harnessArn,
        qualifier: this.qualifier,
        // One isolated harness session per Olive message. The full relevant
        // history is supplied explicitly, avoiding hidden cross-message state.
        runtimeSessionId: input.trigger.messageId,
        runtimeUserId: input.member.memberId,
        actorId: input.member.memberId,
        messages: [
          {
            role: "user",
            content: [{ text: serializeHarnessInput(input) }],
          },
        ],
      }),
    );
    if (!response.stream) throw new Error("AgentCore Harness returned no stream");

    let text = "";
    let stopReason: string | undefined;
    for await (const event of response.stream) {
      if (event.contentBlockDelta?.delta?.text) {
        text += event.contentBlockDelta.delta.text;
      }
      if (event.messageStop?.stopReason) stopReason = event.messageStop.stopReason;
      if (event.runtimeClientError) {
        throw new Error("AgentCore Harness runtime error");
      }
      if (event.internalServerException) {
        throw new Error("AgentCore Harness internal server error");
      }
      if (event.validationException) {
        throw new Error("AgentCore Harness rejected the invocation");
      }
    }
    if (stopReason !== "end_turn") {
      throw new Error(`AgentCore Harness stopped with ${stopReason}`);
    }
    return parseHarnessDecision(text);
  }
}

export function serializeHarnessInput(input: HarnessInput, indentation?: number): string {
  // Preserve the existing topic-classification request layout.
  if (input.useCase === "FIRST_TOPIC") return JSON.stringify(input, null, indentation);
  // Present history before the new message so the last conversational content
  // the model reads is the message it must answer, not an older question.
  const { trigger, ...context } = input;
  return JSON.stringify({ ...context, trigger }, null, indentation);
}

export function parseHarnessDecision(text: string): HarnessDecision {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  const candidate = (fenced ?? trimmed).trim();
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("AgentCore Harness did not return a JSON decision");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
  } catch {
    throw new Error("AgentCore Harness returned invalid JSON");
  }
  return harnessDecisionSchema.parse(parsed);
}
