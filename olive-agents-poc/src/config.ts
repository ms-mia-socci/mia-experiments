import { z } from "zod";
import { collectionFieldSchema, DEFAULT_IDENTITY_FIELDS } from "./domain.js";

const booleanString = z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true");

const configSchema = z.object({
  AWS_REGION: z.string().default("us-east-1"),
  MEDUSA_BASE_URL: z.url().default("https://staging.medusa.121.health"),
  CONNECT_URL: z
    .url()
    .default("https://staging.connect.121.health/api/v1/causeway/events"),
  OLIVE_HARNESS_ARN: z.string().min(1),
  OLIVE_HARNESS_QUALIFIER: z.string().default("staging"),
  OLIVE_API_SECRET_ARN: z.string().optional(),
  STAGING_OLIVE_CONVERSATIONS_API_KEY: z.string().optional(),
  CONNECT_API_KEY_STAGING_MESSAGE_TEST: z.string().optional(),
  PROCESSED_MESSAGES_TABLE: z.string().optional(),
  DRY_RUN: booleanString,
  POLL_WINDOW_MINUTES: z.coerce.number().int().min(1).max(15).default(2),
  MAX_HISTORY_MESSAGES: z.coerce.number().int().min(1).max(1000).default(200),
  MESSAGE_RECORD_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  OLIVE_SENDER_ID: z
    .string()
    .default("0142d143-a313-49dc-ae42-cd4038833539"),
  OLIVE_ACTOR_ID: z
    .string()
    .default("0142d143-a313-49dc-ae42-cd4038833539"),
  FIRST_TOPIC_RESPONSE: z.string().min(1).max(1600),
  IDENTITY_CONFIRMATION_RESPONSE: z.string().min(1).max(1600),
  IDENTITY_COLLECTION_FIELDS: z.string().default(JSON.stringify(DEFAULT_IDENTITY_FIELDS))
    .transform((value) => JSON.parse(value) as unknown)
    .pipe(z.array(collectionFieldSchema).min(1).max(20).refine(
      (fields) => new Set(fields.map((field) => field.key)).size === fields.length,
      "Collection field keys must be unique",
    )),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse(environment);
}

export type ApiKeys = {
  medusaApiKey: string;
  connectApiKey: string;
};
