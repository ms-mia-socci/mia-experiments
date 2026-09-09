import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpAgent } from "@ag-ui/client";
import { EventSchemas } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import {
  replayEvents,
  protocolMessages,
  chatMessages,
  emptyWorkspaceState,
} from "../src/lib/agui.ts";
import { codexToolEvents } from "../src/lib/server/codex-events.ts";
import { toolActivity } from "../src/lib/activity.ts";
import type { RunContext } from "../src/lib/server/providers.ts";
const initial = [
  {
    id: "user",
    role: "user" as const,
    content: "hello",
    agent: "user",
    attachments: [],
  },
];
const fixture = [
  { type: "RUN_STARTED", threadId: "t", runId: "r" },
  { type: "MESSAGES_SNAPSHOT", messages: protocolMessages(initial) },
  { type: "STATE_SNAPSHOT", snapshot: emptyWorkspaceState() },
  {
    type: "TEXT_MESSAGE_START",
    messageId: "a",
    role: "assistant",
    metadata: { fieldwork: { agent: "claude" } },
  },
  { type: "TEXT_MESSAGE_CONTENT", messageId: "a", delta: "Hello" },
  { type: "TEXT_MESSAGE_CONTENT", messageId: "a", delta: " world" },
  { type: "TEXT_MESSAGE_END", messageId: "a" },
  { type: "TOOL_CALL_START", toolCallId: "tool", toolCallName: "search" },
  { type: "TOOL_CALL_ARGS", toolCallId: "tool", delta: '{"q":' },
  { type: "TOOL_CALL_ARGS", toolCallId: "tool", delta: '"test"}' },
  { type: "TOOL_CALL_END", toolCallId: "tool" },
  {
    type: "TOOL_CALL_RESULT",
    toolCallId: "tool",
    messageId: "result",
    role: "tool",
    content: '{"ok":true}',
  },
  {
    type: "STATE_DELTA",
    delta: [
      {
        op: "add",
        path: "/recommendation",
        value: {
          framework: "claude",
          reason: "research",
          brief: "find sources",
        },
      },
    ],
  },
  { type: "RUN_FINISHED", threadId: "t", runId: "r" },
];
test("live HttpAgent and saved replay produce identical messages, tools and shared state", async () => {
  const encoder = new EventEncoder();
  const agent = new HttpAgent({
    url: "http://fixture.invalid",
    threadId: "t",
    fetch: async () =>
      new Response(
        fixture.map((e) => encoder.encode(EventSchemas.parse(e))).join(""),
        { headers: { "content-type": "text/event-stream" } },
      ),
  });
  let changes = 0;
  await agent.runAgent(
    { runId: "r" },
    {
      onMessagesChanged() {
        changes++;
      },
    },
  );
  const replay = await replayEvents(fixture, initial);
  assert.deepEqual(replay.messages, agent.messages);
  assert.deepEqual(replay.state, agent.state);
  assert.equal(chatMessages(replay.messages, "codex")[1].agent, "claude");
  assert.equal(
    chatMessages(replay.messages, "codex")[1].content,
    "Hello world",
  );
  assert.deepEqual(toolActivity(replay.messages, false)[0].input, {
    q: "test",
  });
  assert.equal(
    toolActivity(replay.messages, false)[0].state,
    "output-available",
  );
  assert.ok(changes > 0);
});
test("partial and legacy replay preserve saved messages without doubling streamed content", async () => {
  const textEvents = fixture.slice(3, 7);
  const saved = [
    ...initial,
    {
      id: "a",
      role: "assistant" as const,
      content: "Hello world",
      agent: "claude",
    },
  ];
  const replay = await replayEvents(
    [
      ...textEvents,
      { type: "CUSTOM", name: "approval_requested", value: { id: "approval" } },
    ],
    saved,
  );
  assert.equal(
    chatMessages(replay.messages, "claude")[1].content,
    "Hello world",
  );
  assert.equal(replay.state.approval?.id, "approval");
  const snapshot = await replayEvents(
    [
      {
        type: "MESSAGES_SNAPSHOT",
        messages: [
          { id: "replacement", role: "assistant", content: "Updated" },
        ],
      },
    ],
    saved,
  );
  assert.equal(snapshot.messages.length, 1);
  assert.equal(snapshot.messages[0].id, "replacement");
  await assert.rejects(
    replayEvents([{ type: "TEXT_MESSAGE_CONTENT", delta: "missing ID" }], []),
  );
});
test("Codex lifecycle normalization gives one standard tool card and excludes private reasoning and duplicate shared tools", async () => {
  const emitted: unknown[] = [];
  const ctx = {
    emit(e: unknown) {
      emitted.push(EventSchemas.parse(e));
    },
    endText() {},
  } as RunContext;
  const accept = codexToolEvents(ctx);
  accept(
    {
      id: "cmd",
      type: "command_execution",
      command: "pwd",
      aggregated_output: "",
      status: "in_progress",
    },
    false,
  );
  accept(
    {
      id: "cmd",
      type: "command_execution",
      command: "pwd",
      aggregated_output: "/workspace",
      status: "completed",
      exit_code: 0,
    },
    true,
  );
  accept(
    {
      id: "cmd",
      type: "command_execution",
      command: "pwd",
      aggregated_output: "/workspace",
      status: "completed",
      exit_code: 0,
    },
    true,
  );
  accept({ id: "private", type: "reasoning", text: "private" }, true);
  accept(
    {
      id: "shared",
      type: "mcp_tool_call",
      server: "fieldwork",
      tool: "run_python",
      arguments: {},
      status: "completed",
    },
    true,
  );
  const restored = await replayEvents(emitted, []);
  assert.equal(toolActivity(restored.messages, false).length, 1);
  assert.equal(
    toolActivity(restored.messages, false)[0].output.stdout,
    "/workspace",
  );
  assert.equal(JSON.stringify(emitted).includes("private"), false);
});

test("chunk events and shared-state patches restore through the library pipeline", async () => {
  const restored = await replayEvents(
    [
      {
        type: "TEXT_MESSAGE_CHUNK",
        messageId: "chunk",
        role: "assistant",
        delta: "Hello",
      },
      { type: "TEXT_MESSAGE_CHUNK", messageId: "chunk", delta: " again" },
      {
        type: "STATE_SNAPSHOT",
        snapshot: { ...emptyWorkspaceState(), approval: { id: "pending" } },
      },
      {
        type: "STATE_DELTA",
        delta: [{ op: "replace", path: "/approval", value: null }],
      },
    ],
    [],
  );
  assert.equal(
    chatMessages(restored.messages, "claude")[0].content,
    "Hello again",
  );
  assert.equal(restored.state.approval, null);
});
