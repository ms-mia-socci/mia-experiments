import { z } from "zod";

export const FIRST_TOPIC_CLIENT_ID = "81209de7-5208-477b-b6c4-7c792e0dfc77";
export const IDENTITY_CONFIRMATION_CLIENT_ID = "724ef93c-546c-4084-acf6-ed035a3528cd";

export const collectionFieldSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  label: z.string().min(1),
  type: z.enum(["text", "date"]),
});
export const DEFAULT_IDENTITY_FIELDS: z.infer<typeof collectionFieldSchema>[] = [
  { key: "firstName", label: "first name", type: "text" },
  { key: "lastName", label: "last name", type: "text" },
  { key: "dateOfBirth", label: "date of birth", type: "date" },
];

export const recentConversationSchema = z.object({
  ticket_id: z.string().min(1),
  conversation_id: z.string().min(1),
  message_id: z.string().min(1),
  source: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  sent_at: z.string().nullable().optional(),
  is_internal: z.boolean().optional().default(false),
  is_automated: z.boolean().optional().default(false),
  hidden: z.boolean().optional().default(false),
});

export const oliveMessageSchema = z.object({
  id: z.string().min(1),
  conversation_id: z.string().min(1),
  content: z.string(),
  direction: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  sent_at: z.string().nullable().optional(),
  inserted_at: z.string().nullable().optional(),
  sequence: z.number().optional(),
  created_by_member_id: z.string().nullable().optional(),
  created_by_user_id: z.string().nullable().optional(),
  is_internal: z.boolean().optional().default(false),
  is_automated: z.boolean().optional().default(false),
  hidden: z.boolean().optional().default(false),
});

export const ticketSchema = z.object({
  id: z.string().min(1),
  conversations: z.array(
    z.object({
      id: z.string().min(1),
      latest_message: z
        .object({
          id: z.string().min(1),
          created_by_member_id: z.string().nullable().optional(),
        })
        .passthrough()
        .nullable()
        .optional(),
    }).passthrough(),
  ),
}).passthrough();

export const memberContextSchema = z.object({
  member: z.object({
    id: z.string().min(1),
    client_id: z.string().min(1),
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    dob: z.string().nullable().optional(),
    time_zone: z.string().nullable().optional(),
  }).passthrough(),
  last_5_messages: z.array(oliveMessageSchema).default([]),
  open_tickets: z.array(z.unknown()).default([]),
}).passthrough();

export const conversationMessagesSchema = z.object({
  items: z.array(oliveMessageSchema),
  has_more: z.boolean(),
  next_after_sequence: z.number().nullable().optional(),
});

export type RecentConversation = z.infer<typeof recentConversationSchema>;
export type OliveMessage = z.infer<typeof oliveMessageSchema>;
export type Ticket = z.infer<typeof ticketSchema>;
export type MemberContext = z.infer<typeof memberContextSchema>;

export type ResolvedConversation = {
  recent: RecentConversation;
  trigger: OliveMessage;
  history: OliveMessage[];
  memberContext: MemberContext;
};

export const harnessDecisionSchema = z
  .object({
    action: z.enum(["SEND_MESSAGE", "NO_ACTION"]),
    reason: z.enum([
      "FIRST_TOPIC",
      "REPEAT_TOPIC",
      "REQUEST_IDENTITY_CONFIRMATION",
      "IDENTITY_FOLLOW_UP",
      "IDENTITY_DETAILS_COLLECTED",
      "IDENTITY_CONVERSATION_COMPLETE",
      "IDENTITY_CONFIRMATION_DECLINED",
      "UNSUPPORTED_CLIENT",
      "INSUFFICIENT_CONTEXT",
    ]),
    topic: z.string().max(160).nullable(),
    message: z.string().max(1600).nullable(),
    collectedDetails: z.record(z.string(), z.string().min(1).max(500).nullable()).optional(),
  })
  .superRefine((decision, context) => {
    if (decision.action === "SEND_MESSAGE" && !decision.message?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["message"],
        message: "SEND_MESSAGE requires a non-empty message",
      });
    }
    if (decision.action === "NO_ACTION" && decision.message !== null) {
      context.addIssue({
        code: "custom",
        path: ["message"],
        message: "NO_ACTION requires message to be null",
      });
    }
  });

export type HarnessDecision = z.infer<typeof harnessDecisionSchema>;

export type HarnessCase = "FIRST_TOPIC" | "IDENTITY_CONFIRMATION";

export type HarnessInput = {
  schemaVersion: 1;
  useCase: HarnessCase;
  clientId: string;
  responsePolicy: {
    message: string;
    collectionFields?: z.infer<typeof collectionFieldSchema>[];
  };
  validationFeedback?: string;
  trigger: {
    messageId: string;
    conversationId: string;
    source: string | null;
    sentAt: string | null;
    content: string;
  };
  member: {
    memberId: string;
    timeZone: string | null;
  };
  priorMessages: Array<{
    messageId: string;
    conversationId: string;
    direction: string | null;
    source: string | null;
    sentAt: string | null;
    content: string;
  }>;
};

export type ProcessRecord = {
  messageId: string;
  conversationId: string;
  ticketId: string;
  memberId?: string;
  clientId?: string;
  status: "PROCESSING" | "COMPLETED" | "ERROR";
  action?: "SEND_MESSAGE" | "NO_ACTION";
  reason?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: number;
};
