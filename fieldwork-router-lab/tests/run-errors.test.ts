import assert from "node:assert/strict";
import test from "node:test";
import { publicRunError } from "../src/lib/server/run-errors";

test("token exhaustion has an actionable public error", () => {
  const error = new Error(
    "Model reached maximum token limit. This is an unrecoverable state.",
  );
  error.name = "MaxTokensError";

  assert.deepEqual(publicRunError(error, false), {
    code: "OUTPUT_LIMIT",
    message:
      "The agent reached its output limit before it could finish. Your conversation is saved; ask for a shorter result or split the task into sections.",
  });
});

test("cancellation and unexpected failures remain safely classified", () => {
  assert.deepEqual(publicRunError(new Error("secret provider detail"), true), {
    code: "CANCELLED",
    message: "Run stopped.",
  });
  assert.deepEqual(publicRunError(new Error("secret provider detail"), false), {
    code: "ERROR",
    message:
      "The agent could not finish. Your conversation is saved; please try again.",
  });
});
