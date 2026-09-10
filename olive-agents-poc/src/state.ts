import {
  ConditionalCheckFailedException,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { ProcessRecord } from "./domain.js";

export interface ProcessedMessageStore {
  exists(messageId: string): Promise<boolean>;
  claim(record: ProcessRecord): Promise<boolean>;
  complete(
    messageId: string,
    result: { action: "SEND_MESSAGE" | "NO_ACTION"; reason: string; eventId?: string },
  ): Promise<void>;
  fail(messageId: string, reason: string): Promise<void>;
}

export class DynamoProcessedMessageStore implements ProcessedMessageStore {
  private readonly client: DynamoDBDocumentClient;

  constructor(
    region: string,
    private readonly tableName: string,
    client?: DynamoDBDocumentClient,
  ) {
    this.client =
      client ?? DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  }

  async exists(messageId: string): Promise<boolean> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { messageId },
        ProjectionExpression: "messageId",
        ConsistentRead: true,
      }),
    );
    return Boolean(response.Item);
  }

  async claim(record: ProcessRecord): Promise<boolean> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: record,
          ConditionExpression: "attribute_not_exists(messageId)",
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return false;
      throw error;
    }
  }

  async complete(
    messageId: string,
    result: { action: "SEND_MESSAGE" | "NO_ACTION"; reason: string; eventId?: string },
  ): Promise<void> {
    const names: Record<string, string> = {
      "#status": "status",
      "#action": "action",
      "#reason": "reason",
    };
    const values: Record<string, unknown> = {
      ":status": "COMPLETED",
      ":action": result.action,
      ":reason": result.reason,
      ":updatedAt": new Date().toISOString(),
    };
    let update =
      "SET #status = :status, #action = :action, #reason = :reason, updatedAt = :updatedAt";
    if (result.eventId) {
      update += ", connectEventId = :eventId";
      values[":eventId"] = result.eventId;
    }
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { messageId },
        UpdateExpression: update,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: "attribute_exists(messageId)",
      }),
    );
  }

  async fail(messageId: string, reason: string): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { messageId },
        UpdateExpression:
          "SET #status = :status, #reason = :reason, updatedAt = :updatedAt",
        ExpressionAttributeNames: { "#status": "status", "#reason": "reason" },
        ExpressionAttributeValues: {
          ":status": "ERROR",
          ":reason": reason.slice(0, 500),
          ":updatedAt": new Date().toISOString(),
        },
        ConditionExpression: "attribute_exists(messageId)",
      }),
    );
  }
}

export class MemoryProcessedMessageStore implements ProcessedMessageStore {
  readonly records = new Map<string, ProcessRecord & { eventId?: string }>();

  async exists(messageId: string): Promise<boolean> {
    return this.records.has(messageId);
  }

  async claim(record: ProcessRecord): Promise<boolean> {
    if (this.records.has(record.messageId)) return false;
    this.records.set(record.messageId, record);
    return true;
  }

  async complete(
    messageId: string,
    result: { action: "SEND_MESSAGE" | "NO_ACTION"; reason: string; eventId?: string },
  ): Promise<void> {
    const record = this.records.get(messageId);
    if (!record) throw new Error("Cannot complete an unclaimed message");
    this.records.set(messageId, {
      ...record,
      status: "COMPLETED",
      action: result.action,
      reason: result.reason,
      ...(result.eventId ? { eventId: result.eventId } : {}),
      updatedAt: new Date().toISOString(),
    });
  }

  async fail(messageId: string, reason: string): Promise<void> {
    const record = this.records.get(messageId);
    if (!record) return;
    this.records.set(messageId, {
      ...record,
      status: "ERROR",
      reason,
      updatedAt: new Date().toISOString(),
    });
  }
}
