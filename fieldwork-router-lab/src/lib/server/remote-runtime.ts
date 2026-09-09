import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { Readable } from "node:stream";
import { protocolMessages } from "../agui";
import { updateThread, type Thread } from "./store";
import { awsConfig } from "./aws";
import { newTraceHeaders } from "./observability";
const client = new BedrockAgentCoreClient({ ...awsConfig(), maxAttempts: 1 });
export async function invokeRuntime(thread: Thread, handoff: boolean) {
  const telemetry = newTraceHeaders(thread.id, thread.framework);
  try {
    const result = await client.send(
      new InvokeAgentRuntimeCommand({
        agentRuntimeArn: process.env.FIELDWORK_RUNTIME_ARN!,
        // One AgentCore session per conversation groups all turns and handoffs.
        runtimeSessionId: thread.id,
        traceId: telemetry.traceId,
        traceParent: telemetry.traceParent,
        baggage: telemetry.baggage,
        qualifier: "DEFAULT",
        contentType: "application/json",
        accept: "text/event-stream",
        payload: new TextEncoder().encode(
          JSON.stringify({
            threadId: thread.id,
            runId: thread.runId,
            messages: protocolMessages(thread.messages),
            tools: [],
            context: [],
            state: {},
            forwardedProps: { owner: thread.owner, handoff },
          }),
        ),
      }),
    );
    if (!result.response) throw Error("AgentCore returned no stream");
    return new Response(
      Readable.toWeb(result.response as Readable) as ReadableStream<Uint8Array>,
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "private, no-store",
          "X-Accel-Buffering": "no",
        },
      },
    );
  } catch (error) {
    await updateThread(thread.id, { status: "error", pendingApproval: null });
    const failure = error as Error & {
      $metadata?: { httpStatusCode?: number; requestId?: string };
    };
    console.error("[fieldwork] AgentCore invocation failed", {
      name: failure.name,
      message: failure.message,
      httpStatusCode: failure.$metadata?.httpStatusCode,
      requestId: failure.$metadata?.requestId,
    });
    return new Response(
      "AgentCore could not start this run. Please try again.",
      { status: 502 },
    );
  }
}
