import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { ConnectClient } from "./connect.js";

const MIA_USER_ID = "17e7b09e-0022-4d65-947d-1905ec619af5";

test("sends Olive messages with Mia as both sender and actor", async () => {
  const config = loadConfig({
    OLIVE_HARNESS_ARN: "test-harness",
    FIRST_TOPIC_RESPONSE: "First topic response",
    IDENTITY_CONFIRMATION_RESPONSE: "Please provide your details.",
  });
  assert.equal(config.OLIVE_SENDER_ID, MIA_USER_ID);
  assert.equal(config.OLIVE_ACTOR_ID, MIA_USER_ID);
  const client = new ConnectClient(config.CONNECT_URL, "test-key", config.OLIVE_SENDER_ID, config.OLIVE_ACTOR_ID,
    async (_url, init) => {
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(String(init.body)), {
        type: "olive.message.send",
        data: { member_id: "member-1", sender_id: MIA_USER_ID, actor_id: MIA_USER_ID, content: "Test reply" },
      });
      return { success: true, data: { id: "event-1", type: "olive.message.send" } };
    });
  await client.sendMessage("member-1", "Test reply");
});

test("CloudFormation sender and actor match the local defaults", async () => {
  const template = await readFile(new URL("../infra/template.yaml", import.meta.url), "utf8");
  assert.match(template, new RegExp(`OLIVE_SENDER_ID: ${MIA_USER_ID}`));
  assert.match(template, new RegExp(`OLIVE_ACTOR_ID: ${MIA_USER_ID}`));
});
