import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { z } from "zod";
import type { ApiKeys, AppConfig } from "./config.js";

const secretSchema = z
  .object({
    medusaApiKey: z.string().optional(),
    connectApiKey: z.string().optional(),
    STAGING_OLIVE_CONVERSATIONS_API_KEY: z.string().optional(),
    CONNECT_API_KEY_STAGING_MESSAGE_TEST: z.string().optional(),
  })
  .transform((value) => ({
    medusaApiKey:
      value.medusaApiKey ?? value.STAGING_OLIVE_CONVERSATIONS_API_KEY,
    connectApiKey:
      value.connectApiKey ?? value.CONNECT_API_KEY_STAGING_MESSAGE_TEST,
  }))
  .pipe(
    z.object({
      medusaApiKey: z.string().min(1),
      connectApiKey: z.string().min(1),
    }),
  );

let cachedKeys: ApiKeys | undefined;

export async function loadApiKeys(config: AppConfig): Promise<ApiKeys> {
  if (cachedKeys) return cachedKeys;
  if (
    config.STAGING_OLIVE_CONVERSATIONS_API_KEY &&
    config.CONNECT_API_KEY_STAGING_MESSAGE_TEST
  ) {
    cachedKeys = {
      medusaApiKey: config.STAGING_OLIVE_CONVERSATIONS_API_KEY,
      connectApiKey: config.CONNECT_API_KEY_STAGING_MESSAGE_TEST,
    };
    return cachedKeys;
  }
  if (!config.OLIVE_API_SECRET_ARN) {
    throw new Error("OLIVE_API_SECRET_ARN is required when direct keys are absent");
  }
  const client = new SecretsManagerClient({ region: config.AWS_REGION });
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: config.OLIVE_API_SECRET_ARN }),
  );
  if (!response.SecretString) throw new Error("Olive API secret has no string value");
  cachedKeys = secretSchema.parse(JSON.parse(response.SecretString));
  return cachedKeys;
}

export function clearSecretCacheForTest(): void {
  cachedKeys = undefined;
}
