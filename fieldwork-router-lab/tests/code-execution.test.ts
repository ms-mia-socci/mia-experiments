import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createThread,
  beginRun,
  decide,
  get,
  put,
  updateThread,
} from "../src/lib/server/store.ts";
import {
  executePython,
  pythonSchema,
} from "../src/lib/server/code-execution.ts";
import {
  registerCodexTools,
  handleCodexTools,
} from "../src/lib/server/codex-tools.ts";
import type { RunContext } from "../src/lib/server/providers.ts";
const folder = mkdtempSync(join(tmpdir(), "fw-code-"));
process.env.FIELDWORK_DB = join(folder, "db.sqlite");
after(() => rmSync(folder, { recursive: true, force: true }));
async function context(decision: "approved" | "denied" = "approved") {
  const t = await createThread("mia", "claude");
  const thread = await beginRun(t.id, "mia", "Run Python");
  const events: any[] = [];
  const ctx: RunContext = {
    thread,
    controller: new AbortController(),
    text() {},
    endText() {},
    async call(_name, _args, fn) {
      return fn();
    },
    emit(e) {
      events.push(e);
    },
    async setState(key, value) {
      events.push({ type: "STATE_DELTA", key, value });
      if (key === "approval" && value)
        await decide(
          t.id,
          "mia",
          (value as import("../src/lib/server/store").Approval).id,
          decision,
        );
    },
  };
  return { ctx, events };
}
const args = {
  code: "print(42)",
  reason: "Calculate the answer",
  inputs: [],
  outputs: [],
};
function mockCloud(failure?: string) {
  const calls: any[] = [];
  let destroyed = false;
  const client: any = {
    destroy() {
      destroyed = true;
    },
    async send(command: any) {
      calls.push(command);
      if (
        failure === "quota" &&
        command.constructor.name === "StartCodeInterpreterSessionCommand"
      )
        throw new Error("maxCodeInterpreterSessions limit exceeded");
      if (command.constructor.name === "StartCodeInterpreterSessionCommand")
        return { sessionId: "test-session" };
      if (command.constructor.name === "StopCodeInterpreterSessionCommand")
        return {};
      if (failure === "execute" && command.input.name === "executeCode")
        throw new Error("Execution interrupted");
      const result =
        command.input.name === "readFiles"
          ? {
              content: [
                {
                  type: "resource",
                  resource: {
                    type: "blob",
                    blob: Buffer.from("file bytes"),
                    mimeType: "image/png",
                  },
                },
              ],
            }
          : {
              content: [],
              structuredContent: { stdout: "42\n", stderr: "", exitCode: 0 },
            };
      return {
        stream: (async function* () {
          yield { result };
        })(),
      };
    },
  };
  return { client, calls, destroyed: () => destroyed };
}
test("denied execution never contacts AWS", async () => {
  const { ctx } = await context("denied"),
    cloud = mockCloud();
  const result = await executePython(ctx, args, cloud.client);
  assert.equal(result.executed, false);
  assert.equal(cloud.calls.length, 0);
});
test("approved execution uploads scoped inputs, saves binary artifacts, and stops the session", async () => {
  const { ctx, events } = await context(),
    cloud = mockCloud();
  const id = randomUUID(),
    path = join(folder, id);
  writeFileSync(path, "data");
  const file = {
    id,
    filename: "data.csv",
    path,
    size: 4,
    mediaType: "text/csv",
    kind: "text" as const,
    url: "",
  };
  await put(`uploads:${ctx.thread.id}`, id, file);
  ctx.thread.messages[0].attachments = [file];
  const result = await executePython(
    ctx,
    {
      ...args,
      inputs: [{ attachmentId: id, filename: "input.csv" }],
      outputs: ["chart.png"],
    },
    cloud.client,
  );
  assert.equal(result.executed, true);
  assert.equal(result.stdout, "42\n");
  assert.deepEqual(
    cloud.calls.map((c) => c.input.name || c.constructor.name),
    [
      cloud.calls[0].input.name,
      "writeFiles",
      "executeCode",
      "readFiles",
      "StopCodeInterpreterSessionCommand",
    ],
  );
  const saved = events.find((e) => e.key === "documents").value[0];
  const doc = await get(`documents:${ctx.thread.id}`, saved.filename);
  assert.equal(doc.mediaType, "image/png");
  assert.equal(Buffer.from(doc.content, "base64").toString(), "file bytes");
  assert.equal(cloud.destroyed(), true);
});
test("quota failures never claim execution; execution failures still stop the session", async () => {
  for (const failure of ["quota", "execute"]) {
    const { ctx } = await context(),
      cloud = mockCloud(failure);
    const result = await executePython(ctx, args, cloud.client);
    assert.equal(result.executed, false);
    assert.equal(result.retry, false);
    assert.equal(
      cloud.calls.some(
        (c) => c.constructor.name === "StopCodeInterpreterSessionCommand",
      ),
      failure === "execute",
    );
  }
});
test("rejects traversal, foreign attachments and stale runs before AWS access", async () => {
  assert.equal(
    pythonSchema.safeParse({ ...args, outputs: ["../secret.txt"] }).success,
    false,
  );
  const { ctx } = await context(),
    cloud = mockCloud();
  await assert.rejects(
    executePython(
      ctx,
      {
        ...args,
        inputs: [{ attachmentId: randomUUID(), filename: "input.csv" }],
      },
      cloud.client,
    ),
    /not attached/,
  );
  await updateThread(ctx.thread.id, { status: "cancelled" });
  await assert.rejects(executePython(ctx, args, cloud.client), /Run stopped/);
  assert.equal(cloud.calls.length, 0);
});
test("Codex MCP requires a live run token and exposes the shared Python tool", async () => {
  const { ctx } = await context();
  const bridge = registerCodexTools(ctx);
  const request = (token: string, method: string, params?: unknown) =>
    new Request("http://localhost/api/agent-tools", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  assert.equal(
    (await handleCodexTools(request("invalid", "tools/list"))).status,
    401,
  );
  const response = await handleCodexTools(request(bridge.token, "tools/list"));
  const body = await response.json();
  assert.equal(body.result.tools[0].name, "run_python");
  await updateThread(ctx.thread.id, { status: "complete" });
  assert.equal(
    (await handleCodexTools(request(bridge.token, "tools/list"))).status,
    410,
  );
  bridge.dispose();
  assert.equal(
    (await handleCodexTools(request(bridge.token, "tools/list"))).status,
    401,
  );
});

test("cancellation during AWS execution still stops the session and saves no artifacts", async () => {
  const { ctx, events } = await context();
  const cloud = mockCloud();
  const send = cloud.client.send.bind(cloud.client);
  cloud.client.send = async (command: any, options: any) => {
    if (command.input.name === "executeCode") {
      ctx.controller.abort(new Error("Cancelled"));
      options.abortSignal.throwIfAborted();
    }
    return send(command, options);
  };
  const result = await executePython(
    ctx,
    { ...args, outputs: ["chart.png"] },
    cloud.client,
  );
  assert.equal(result.executed, false);
  assert.equal(
    cloud.calls.at(-1).constructor.name,
    "StopCodeInterpreterSessionCommand",
  );
  assert.equal(
    events.some((e) => e.key === "documents"),
    false,
  );
});
