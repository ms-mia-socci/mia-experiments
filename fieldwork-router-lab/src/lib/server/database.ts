import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import postgres from "postgres";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

// The same repository runs against local SQLite or a private PostgreSQL database.
const context = new AsyncLocalStorage<{ query: typeof query }>();
let sqlite: DatabaseSync;
let pg: ReturnType<typeof postgres>;
let initialized: Promise<void> | undefined;
let queue: Promise<unknown> = Promise.resolve();
async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}
async function init() {
  if (
    process.env.FIELDWORK_DATABASE_URL ||
    process.env.FIELDWORK_DATABASE_SECRET_ARN
  ) {
    if (process.env.FIELDWORK_DATABASE_URL) {
      if (process.env.FIELDWORK_SERVICE)
        throw Error(
          "Cloud deployments must use the managed database secret and TLS",
        );
      pg = postgres(process.env.FIELDWORK_DATABASE_URL, {
        max: 4,
        idle_timeout: 1,
        onnotice: () => {},
      });
    } else {
      const client = new SecretsManagerClient({ region: "us-east-1" });
      const response = await client.send(
        new GetSecretValueCommand({
          SecretId: process.env.FIELDWORK_DATABASE_SECRET_ARN,
        }),
      );
      client.destroy();
      const secret = JSON.parse(response.SecretString!);
      pg = postgres({
        host: process.env.FIELDWORK_DATABASE_HOST!,
        database: "fieldwork",
        username: secret.username,
        password: secret.password,
        max: 4,
        idle_timeout: 20,
        connect_timeout: 10,
        ssl: {
          rejectUnauthorized: true,
          ca: readFileSync(process.env.FIELDWORK_DATABASE_CA!, "utf8"),
        },
        onnotice: () => {},
      });
    }
    await pg.begin(async (sql) => {
      await sql`SELECT pg_advisory_xact_lock(5373001)`;
      await sql`CREATE TABLE IF NOT EXISTS items (scope TEXT, key TEXT, data TEXT, PRIMARY KEY(scope,key))`;
      await sql`CREATE TABLE IF NOT EXISTS events (seq BIGSERIAL PRIMARY KEY, thread TEXT, run TEXT, data TEXT)`;
      await sql`CREATE INDEX IF NOT EXISTS events_thread_run_seq ON events(thread,run,seq)`;
    });
  } else {
    const path = process.env.FIELDWORK_DB;
    if (!path)
      throw Error("Configure FIELDWORK_DB or FIELDWORK_DATABASE_SECRET_ARN.");
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    sqlite = new DatabaseSync(path);
    sqlite.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS items (scope TEXT, key TEXT, data TEXT, PRIMARY KEY(scope,key)); CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, thread TEXT, run TEXT, data TEXT); CREATE INDEX IF NOT EXISTS events_thread_run_seq ON events(thread,run,seq);",
    );
    chmodSync(path, 0o600);
  }
}
function pgQuery(sql: any) {
  return async (statement: string, parameters: any[] = []): Promise<any[]> => {
    let index = 0;
    return [
      ...(await sql.unsafe(
        statement.replace(/\?/g, () => `$${++index}`),
        parameters,
      )),
    ];
  };
}
export async function query(
  statement: string,
  parameters: any[] = [],
): Promise<any[]> {
  const active = context.getStore();
  if (active) return active.query(statement, parameters);
  await (initialized ??= init());
  if (pg) return pgQuery(pg)(statement, parameters);
  return exclusive(async () => sqlite.prepare(statement).all(...parameters));
}
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  if (context.getStore()) return fn();
  await (initialized ??= init());
  if (pg) {
    for (let attempt = 0; ; attempt++) {
      try {
        return (await pg.begin("isolation level serializable", (sql) =>
          context.run({ query: pgQuery(sql) }, fn),
        )) as T;
      } catch (error) {
        if ((error as { code?: string }).code !== "40001" || attempt >= 4)
          throw error;
      }
    }
  }
  return exclusive(async () => {
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = await context.run(
        {
          query: async (sql, params = []) => sqlite.prepare(sql).all(...params),
        },
        fn,
      );
      sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  });
}
