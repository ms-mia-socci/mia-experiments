import { z } from "zod";
import type { Framework } from "./catalog";
export const memorySettingsSchema = z
  .object({
    enabled: z.boolean(),
    crossSession: z.boolean(),
    shareAcrossAgents: z.boolean(),
    usePreferences: z.boolean(),
    useSummaries: z.boolean(),
  })
  .strict();
export type MemorySettings = z.infer<typeof memorySettingsSchema>;
export const defaultMemorySettings: MemorySettings = {
  enabled: false,
  crossSession: false,
  shareAcrossAgents: false,
  usePreferences: true,
  useSummaries: true,
};
export type MemoryProfile = {
  settings: MemorySettings;
  generation: string;
  retired: string[];
  version: number;
};
export type MemoryItem = {
  id: string;
  text: string;
  kind: "preferences" | "summaries";
  framework: Framework;
  namespace: string;
};
export function memoryActor(
  owner: string,
  generation: string,
  framework: Framework,
) {
  return `fw_${owner}_${generation}_${framework}`;
}
export function memoryScopes(
  owner: string,
  profile: MemoryProfile,
  framework: Framework,
) {
  if (!profile.settings.enabled || !profile.settings.crossSession) return [];
  const agents: Framework[] = profile.settings.shareAcrossAgents
    ? ["strands", "claude", "codex"]
    : [framework];
  return agents.flatMap((agent) =>
    (["preferences", "summaries"] as const)
      .filter((kind) =>
        kind === "preferences"
          ? profile.settings.usePreferences
          : profile.settings.useSummaries,
      )
      .map((kind) => ({
        framework: agent,
        kind,
        namespace: `/${kind}/${memoryActor(owner, profile.generation, agent)}/`,
      })),
  );
}
