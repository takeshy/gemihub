import { z } from "zod";
import type { UserSettings } from "./settings";

export const KakerattaProfileSchema = z.object({
  model: z.string().default(""),
  readFiles: z.boolean().default(false),
  ragSetting: z.string().nullable().default(null),
  webSearch: z.boolean().default(false),
});

export const KakerattaDirectSchema = KakerattaProfileSchema.extend({
  enabled: z.boolean().default(true),
  mcpServerIds: z.array(z.string()).default([]),
});

export const KakerattaSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  pollEnabled: z.boolean().default(true),
  url: z.string().default(""),
  headers: z.record(z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/), z.string().regex(/^[^\r\n]*$/)).default({}),
  defaultProfile: KakerattaProfileSchema.default({ model: "", readFiles: false, ragSetting: null, webSearch: false }),
  personas: z.record(z.string(), KakerattaProfileSchema).default({}),
  direct: KakerattaDirectSchema.default({ model: "", readFiles: false, ragSetting: null, webSearch: false, enabled: true, mcpServerIds: [] }),
});

export type KakerattaSettings = z.infer<typeof KakerattaSettingsSchema>;
export type KakerattaProfile = z.infer<typeof KakerattaProfileSchema>;

/** Validate saved profiles before any ask is claimed, including stale profiles. */
export function getKakerattaRagError(config: KakerattaSettings, settings: Pick<UserSettings, "usePersonalVertex">): string | null {
  if (settings.usePersonalVertex && [config.defaultProfile, ...Object.values(config.personas), ...(config.direct.enabled ? [config.direct] : [])].some(profile => profile.ragSetting)) {
    return "RAG is unavailable with personal Vertex AI. Set RAG to None in the default and persona profiles, or select the Gemini API key provider.";
  }
  return null;
}

export function resolveKakerattaProfile(config: KakerattaSettings, context: unknown): KakerattaProfile {
  const id = (context as { persona?: { id?: unknown } } | null)?.persona?.id;
  return (typeof id === "string" && Object.hasOwn(config.personas, id) ? config.personas[id] : undefined) ?? config.defaultProfile;
}
