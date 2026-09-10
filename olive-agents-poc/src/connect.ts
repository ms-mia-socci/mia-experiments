import { z } from "zod";
import { fetchJson } from "./http.js";

const connectResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    id: z.string().min(1),
    type: z.literal("olive.message.send"),
  }),
});

export type ConnectSendResult = z.infer<typeof connectResponseSchema>;

export class ConnectClient {
  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly senderId: string,
    private readonly actorId: string,
    private readonly request: typeof fetchJson = fetchJson,
  ) {}

  async sendMessage(memberId: string, content: string): Promise<ConnectSendResult> {
    const payload = await this.request(
      this.url,
      {
        method: "POST",
        headers: {
          "X-API-Key": this.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          type: "olive.message.send",
          data: {
            member_id: memberId,
            sender_id: this.senderId,
            actor_id: this.actorId,
            content,
          },
        }),
      },
      20_000,
    );
    return connectResponseSchema.parse(payload);
  }
}
