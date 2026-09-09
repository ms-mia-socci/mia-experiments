import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  get,
  put,
  transaction,
  createThread,
  beginRun,
} from "../src/lib/server/store";
const folder = mkdtempSync(join(tmpdir(), "fw-database-"));
process.env.FIELDWORK_DB = join(folder, "db.sqlite");
after(() => rmSync(folder, { recursive: true, force: true }));
test("transactions roll back partial writes and isolate concurrent read/modify/write", async () => {
  const id = randomUUID();
  await put("test", id, { n: 0 });
  await assert.rejects(
    transaction(async () => {
      await put("test", id, { n: 99 });
      throw Error("rollback");
    }),
  );
  assert.equal((await get("test", id)).n, 0);
  await Promise.all(
    Array.from({ length: 3 }, () =>
      transaction(async () => {
        const current = await get("test", id);
        await new Promise((r) => setTimeout(r, 10));
        await put("test", id, { n: current.n + 1 });
      }),
    ),
  );
  assert.equal((await get("test", id)).n, 3);
});
test("only one concurrent request can acquire a conversation run lease", async () => {
  const t = await createThread(randomUUID(), "claude");
  const results = await Promise.allSettled([
    beginRun(t.id, t.owner, "one"),
    beginRun(t.id, t.owner, "two"),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
});
