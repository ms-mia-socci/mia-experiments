import { randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  executePython,
  pythonSchema,
  pythonDescription,
} from "./code-execution";
import { assertActiveRun } from "./approvals";
import type { RunContext } from "./providers";
const runs = new Map<string, RunContext>();
export function registerCodexTools(ctx: RunContext) {
  const token = randomBytes(32).toString("hex");
  runs.set(token, ctx);
  return { token, dispose: () => runs.delete(token) };
}
export async function handleCodexTools(request: Request) {
  const token =
    request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  const ctx = runs.get(token);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    await assertActiveRun(ctx);
  } catch {
    return new Response("Run ended", { status: 410 });
  }
  if (request.headers.has("origin"))
    return new Response("Browser requests not supported", { status: 403 });
  const server = new McpServer({ name: "fieldwork", version: "1.0.0" });
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  server.registerTool(
    "run_python",
    { description: pythonDescription, inputSchema: pythonSchema.shape },
    async (args) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await ctx.call(
              "run_python",
              args,
              async () => await executePython(ctx, args),
            ),
          ),
        },
      ],
    }),
  );
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
