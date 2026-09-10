import { loadApiKeys } from "./secrets.js";
import { loadConfig, type ApiKeys, type AppConfig } from "./config.js";
import { ConnectClient } from "./connect.js";
import { HarnessClient } from "./harness.js";
import { MedusaClient } from "./medusa.js";
import { OliveMessageProcessor } from "./processor.js";
import {
  DynamoProcessedMessageStore,
  MemoryProcessedMessageStore,
  type ProcessedMessageStore,
} from "./state.js";

export async function createProcessor(options: {
  config?: AppConfig;
  keys?: ApiKeys;
  store?: ProcessedMessageStore;
} = {}): Promise<OliveMessageProcessor> {
  const config = options.config ?? loadConfig();
  if (!config.DRY_RUN && !config.PROCESSED_MESSAGES_TABLE && !options.store) {
    throw new Error("Live delivery requires a durable processed-message table");
  }
  const keys = options.keys ?? (await loadApiKeys(config));
  const store =
    options.store ??
    (config.PROCESSED_MESSAGES_TABLE
      ? new DynamoProcessedMessageStore(
          config.AWS_REGION,
          config.PROCESSED_MESSAGES_TABLE,
        )
      : new MemoryProcessedMessageStore());

  return new OliveMessageProcessor(
    config,
    new MedusaClient(config.MEDUSA_BASE_URL, keys.medusaApiKey),
    new HarnessClient(
      config.AWS_REGION,
      config.OLIVE_HARNESS_ARN,
      config.OLIVE_HARNESS_QUALIFIER,
    ),
    new ConnectClient(
      config.CONNECT_URL,
      keys.connectApiKey,
      config.OLIVE_SENDER_ID,
      config.OLIVE_ACTOR_ID,
    ),
    store,
  );
}
