import { error } from "@sveltejs/kit";
import { RunAgentInputSchema } from "@ag-ui/core";
import { get, put, transaction, type Thread } from "$lib/server/store";
import { streamRun } from "$lib/server/runner";
export const POST: import("./$types").RequestHandler = async ({ request }) => {
  if (process.env.FIELDWORK_SERVICE !== "agent") error(404);
  const input = RunAgentInputSchema.parse(await request.json());
  // Only the web task IAM role invokes this endpoint. Never trust browser owner IDs.
  const thread = await transaction(async () => {
    const current = await get<Thread>("threads", input.threadId);
    if (
      !current ||
      current.owner !== input.forwardedProps?.owner ||
      current.runId !== input.runId ||
      current.status !== "running" ||
      current.deadline < Date.now()
    )
      error(409, "Run is not active");
    if (await get("executions", input.runId)) error(409, "Run already started");
    await put("executions", input.runId, { threadId: current.id });
    return current;
  });
  return streamRun(thread, input.forwardedProps?.handoff === true);
};
