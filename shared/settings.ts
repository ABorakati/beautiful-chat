import { defineSettings, settingsRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Every field is optional: a missing one keeps the client's default. */
function optional<Schema extends z.ZodType>(schema: Schema) {
  return schema.optional();
}

const boolean = optional(z.boolean());

/**
 * Explicit choices only, so a reset restores the defaults without replaying
 * legacy browser settings. Every field is optional: a missing one falls back
 * to the client's default. Preferences are shared by all clients of the host.
 */
export const preferenceOverridesSchema = z.object({
  accent: optional(z.enum(["host", "jade", "violet", "amber", "rose"])),
  uiFont: optional(z.enum(["inter", "system"])),
  codeFont: optional(z.enum(["code", "plain", "custom"])),
  customCodeFont: optional(z.string().max(200)),
  textScale: optional(z.number().transform((value) => Math.min(1.35, Math.max(0.85, value)))),
  frostedGlass: boolean,
  hostFonts: boolean,
  lineSpacing: optional(z.enum(["compact", "balanced", "spacious"])),
  pointerGlow: boolean,
  enhancedUserBubble: boolean,
  selectionActions: boolean,
  confirmOpenPath: boolean,
  assistantMarkdown: boolean,
  markdownVariant: optional(z.enum(["document", "compact", "terminal"])),
  paseoToolFolding: boolean,
  overviewReasoning: boolean,
  collapseTools: optional(
    z.array(z.enum(["shell", "write", "edit", "read", "other"])).transform((groups) => [...new Set(groups)]),
  ),
  collapseLineLimit: optional(z.union([z.literal(0), z.literal(10), z.literal(20), z.literal(50)])),
  expandWhileRunning: boolean,
  collapseReasoning: boolean,
  liveChecklist: boolean,
  codeFoldLimit: optional(z.union([z.literal(0), z.literal(30), z.literal(60)])),
  promptFoldLimit: optional(z.union([z.literal(0), z.literal(15), z.literal(30)])),
});

export const presentationSettings = defineSettings({
  id: "presentation",
  scope: "host",
  version: 1,
  schema: z.object({
    preferences: preferenceOverridesSchema.default({}),
    legacyMigrated: z.boolean().default(false),
  }),
});

export type PreferenceOverrides = z.output<typeof preferenceOverridesSchema>;
export type PresentationSettings = z.output<typeof presentationSettings.schema>;
export const presentationSettingsRpc = settingsRpc(presentationSettings.id);
