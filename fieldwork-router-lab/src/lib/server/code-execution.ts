import { z } from "zod";
import { join } from "node:path";
import { readBlob, writeBlob } from "./blobs";
import { randomUUID } from "node:crypto";
import {
  BedrockAgentCoreClient,
  StartCodeInterpreterSessionCommand,
  InvokeCodeInterpreterCommand,
  StopCodeInterpreterSessionCommand,
  type CodeInterpreterResult,
  type ToolArguments,
} from "@aws-sdk/client-bedrock-agentcore";
import { awsConfig } from "./aws";
import { requestApproval, assertActiveRun } from "./approvals";
import { attached } from "./uploads";
import { put, items } from "./store";
import type { RunContext } from "./providers";
import { currentTraceHeaders } from "./observability";
const filename = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,89}\.[a-zA-Z0-9]{1,10}$/);
export const pythonSchema = z.object({
  code: z.string().min(1).max(30000),
  reason: z.string().min(1).max(1000),
  inputs: z
    .array(z.object({ attachmentId: z.string().uuid(), filename }))
    .max(5),
  outputs: z.array(filename.regex(/\.(txt|md|csv|json|png|pdf)$/)).max(5),
});
export const pythonDescription =
  "Execute Python in a fresh AWS AgentCore Code Interpreter session after user approval. 60 second total AWS work limit. Copy uploaded attachment IDs via inputs to flat filenames. Write requested outputs to flat filenames for download. No local execution fallback. Report errors honestly; do not retry denial or AWS quota errors.";
export const executionRules =
  " Use run_python for requested Python execution, calculations, charts or data processing. User approval covers exact code, input files and output files. Only claim execution after a successful tool result. Use relative filenames in the sandbox. Give artifact download links. Never run scripts on the app host or work around a denied or failed sandbox request.";
const identifier = "aws.codeinterpreter.v1";
const maxArtifact = 5 * 1024 * 1024;
export function executionClient() {
  return new BedrockAgentCoreClient({
    maxAttempts: 1,
    ...awsConfig(),
  });
}
export type ExecutionResult = {
  executed: boolean;
  decision?: string;
  message?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  artifacts?: { filename: string; url: string }[];
  outputErrors?: string[];
  executionMayHaveStarted?: boolean;
  retry?: false;
  cleanupWarning?: string;
};
// Server-only injection supports tests. There is no simulated or local execution mode in the app.
export async function executePython(
  ctx: RunContext,
  input: unknown,
  client?: BedrockAgentCoreClient,
): Promise<ExecutionResult> {
  const args = pythonSchema.parse(input);
  await assertActiveRun(ctx);
  const uploads = await attached(ctx.thread);
  const inputs = args.inputs.map((f) => {
    const source = uploads.find((u) => u.id === f.attachmentId);
    if (!source)
      throw new Error("Input file is not attached to this conversation.");
    return { ...f, source };
  });
  const names = [...args.inputs.map((f) => f.filename), ...args.outputs];
  if (new Set(names).size !== names.length)
    throw new Error("Input and output filenames must be unique.");
  const decision = await requestApproval(ctx, {
    kind: "code",
    filename: "script.py",
    reason: `${args.reason}\nRuns in AWS us-east-1 with a 60 second limit. Requested outputs will be saved to this conversation.`,
    content: `${args.code}\n\n# Inputs copied to AWS:\n${inputs.map((f) => `# ${f.source.filename} → ${f.filename}`).join("\n") || "# None"}\n# Outputs to save: ${args.outputs.join(", ") || "None"}`,
  });
  if (decision !== "approved")
    return {
      executed: false,
      decision,
      message: "Not authorized. Do not retry this turn.",
    };
  client ??= executionClient();
  const cloud = client;
  const signal = AbortSignal.any([
    ctx.controller.signal,
    AbortSignal.timeout(60000),
  ]);
  let sessionId: string | undefined;
  let cleanupError = false;
  const artifacts: { filename: string; url: string }[] = [];
  let outcome: ExecutionResult;
  async function invoke(
    name: "writeFiles" | "executeCode" | "readFiles",
    arguments_: ToolArguments,
  ) {
    await assertActiveRun(ctx);
    const trace = currentTraceHeaders();
    const response = await cloud.send(
      new InvokeCodeInterpreterCommand({
        codeInterpreterIdentifier: identifier,
        sessionId,
        name,
        arguments: arguments_,
        ...(trace
          ? { traceId: trace.traceId, traceParent: trace.traceParent }
          : {}),
      }),
      { abortSignal: signal },
    );
    let result: CodeInterpreterResult | undefined;
    for await (const event of response.stream || []) {
      signal.throwIfAborted();
      if (event.result) result = event.result;
      else
        throw new Error(`AWS stream failed: ${Object.keys(event).join(", ")}`);
    }
    if (!result) throw new Error("AWS returned no tool result.");
    if (result.isError)
      throw new Error(
        (
          result.content?.map((c) => c.text || "").join("\n") ||
          "AWS tool failed"
        ).slice(0, 12000),
      );
    return result;
  }
  try {
    await assertActiveRun(ctx);
    const startTrace = currentTraceHeaders();
    const session = await cloud.send(
      new StartCodeInterpreterSessionCommand({
        codeInterpreterIdentifier: identifier,
        name: `fieldwork-${randomUUID()}`,
        sessionTimeoutSeconds: 300,
        ...(startTrace
          ? {
              traceId: startTrace.traceId,
              traceParent: startTrace.traceParent,
            }
          : {}),
      }),
      { abortSignal: signal },
    );
    sessionId = session.sessionId;
    if (!sessionId) throw new Error("AWS returned no session ID.");
    ctx.emit({
      type: "CUSTOM",
      name: "code_session_started",
      value: { sessionId, region: "us-east-1" },
    });
    for (const f of inputs) {
      const bytes = await readBlob(f.source.path);
      if (bytes.length > maxArtifact) throw new Error("Input exceeds 5 MB.");
      await invoke("writeFiles", {
        content: [{ path: f.filename, blob: bytes }],
      });
    }
    const result = await invoke("executeCode", {
      language: "python",
      code: args.code,
    });
    const details = result.structuredContent;
    const stdout = (
      details?.stdout ??
      (result.content || []).map((c) => c.text || "").join("\n")
    ).slice(0, 20000);
    const stderr = (details?.stderr || "").slice(0, 12000);
    const outputErrors: string[] = [];
    for (const name of args.outputs) {
      try {
        const file = await invoke("readFiles", { paths: [name] });
        const block = (file.content || []).find(
          (c) => c.resource || c.data || c.type === "text",
        );
        const raw = block?.resource?.blob ?? block?.data;
        const text = block?.resource?.text ?? block?.text;
        if (!raw && text === undefined)
          throw new Error("AWS returned no file content.");
        const bytes = raw ? Buffer.from(raw) : Buffer.from(text!);
        if (bytes.length > maxArtifact) throw new Error("Output exceeds 5 MB.");
        await assertActiveRun(ctx);
        const savedName = `${randomUUID().slice(0, 8)}-${name}`;
        const mediaType = name.endsWith(".png")
          ? "image/png"
          : name.endsWith(".pdf")
            ? "application/pdf"
            : "text/plain; charset=utf-8";
        const blobPath = join(
          process.env.FIELDWORK_WORKSPACES || "/tmp/workspaces",
          ctx.thread.id,
          "documents",
          savedName,
        );
        if (process.env.FIELDWORK_ARTIFACT_BUCKET)
          await writeBlob(blobPath, bytes);
        await put(`documents:${ctx.thread.id}`, savedName, {
          filename: savedName,
          ...(process.env.FIELDWORK_ARTIFACT_BUCKET
            ? { blobPath }
            : { content: bytes.toString("base64") }),
          encoding: "base64",
          mediaType,
        });
        const artifact = {
          filename: savedName,
          url: `/api/threads/${ctx.thread.id}/documents/${savedName}`,
        };
        artifacts.push(artifact);
        ctx.setState(
          "documents",
          (await items<{ filename: string }>(`documents:${ctx.thread.id}`)).map(
            ({ filename }) => ({
              filename,
              url: `/api/threads/${ctx.thread.id}/documents/${filename}`,
            }),
          ),
        );
      } catch (error) {
        await assertActiveRun(ctx);
        outputErrors.push(
          `${name}: ${error instanceof Error ? error.message : "Could not read output"}`,
        );
      }
    }
    outcome = {
      executed: true,
      stdout,
      stderr,
      exitCode: details?.exitCode ?? null,
      artifacts,
      outputErrors,
    };
  } catch (error) {
    outcome = {
      executed: false,
      message:
        error instanceof Error
          ? error.message.slice(0, 12000)
          : "AWS execution failed",
      artifacts,
      executionMayHaveStarted: Boolean(sessionId),
      retry: false,
    };
  } finally {
    if (sessionId) {
      try {
        const stopTrace = currentTraceHeaders();
        await cloud.send(
          new StopCodeInterpreterSessionCommand({
            codeInterpreterIdentifier: identifier,
            sessionId,
            ...(stopTrace
              ? {
                  traceId: stopTrace.traceId,
                  traceParent: stopTrace.traceParent,
                }
              : {}),
          }),
          { abortSignal: AbortSignal.timeout(10000) },
        );
      } catch {
        cleanupError = true;
      }
      ctx.emit({
        type: "CUSTOM",
        name: "code_session_finished",
        value: { sessionId, cleanupError },
      });
    }
    cloud.destroy();
  }
  return {
    ...outcome,
    ...(cleanupError
      ? {
          cleanupWarning:
            "Could not confirm session stop. AWS session timeout is 5 minutes.",
        }
      : {}),
  };
}
