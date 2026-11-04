import { useSyncExternalStore } from "react";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  preferenceOverridesSchema,
  presentationSettings,
  presentationSettingsRpc,
  type PresentationSettings,
  type PreferenceOverrides,
} from "../shared/settings";

export const ACCENT_PRESETS = {
  host: undefined,
  jade: "#10b981",
  violet: "#8b5cf6",
  amber: "#f59e0b",
  rose: "#f43f5e",
} as const;

/** `"custom"` follows `accentCustomColor`, which the picker edits. */
export type AccentPreset = keyof typeof ACCENT_PRESETS | "custom";
export type UiFontPreference = "inter" | "system";
/**
 * `code` and `plain` are the embedded Iosevka with and without ligatures, and
 * `custom` uses `customCodeFont`. Paseo's own code font is followed through
 * `hostFonts` instead.
 */
export type CodeFontPreference = "code" | "plain" | "custom";
export type MarkdownVariantPreference = "document" | "compact" | "terminal";
export type LineSpacingPreference = "compact" | "balanced" | "spacious";

/** The groups of tool card a reader can fold separately. */
export const COLLAPSIBLE_TOOL_GROUPS = ["shell", "write", "edit", "read", "other"] as const;
export type CollapsibleToolGroup = (typeof COLLAPSIBLE_TOOL_GROUPS)[number];

/** Zero never folds a code block. Any other value folds a longer one. */
export const CODE_FOLD_LIMITS = [0, 30, 60] as const;
export type CodeFoldLimit = (typeof CODE_FOLD_LIMITS)[number];

/** Zero never folds a prompt. Any other value folds one that runs longer. */
export const PROMPT_FOLD_LIMITS = [0, 15, 30] as const;
export type PromptFoldLimit = (typeof PROMPT_FOLD_LIMITS)[number];

/** Zero folds every finished card. Any other value spares a card that short. */
export const COLLAPSE_LINE_LIMITS = [0, 10, 20, 50] as const;
export type CollapseLineLimit = (typeof COLLAPSE_LINE_LIMITS)[number];

/** Multiplier applied to every font size the plugin draws. */
export const TEXT_SIZE_OPTIONS = [
  { value: "0.9", label: "Small" },
  { value: "1", label: "Default" },
  { value: "1.15", label: "Large" },
  { value: "1.3", label: "XL" },
] as const;

/**
 * Highlighter pastels, the colours a real marker leaves on paper. `null` is
 * the built-in wash the mark style falls back to; `"custom"` (in the type)
 * follows `markCustomColor`.
 */
export const MARK_COLOR_PRESETS = {
  default: null,
  yellow: "#ffd43b",
  green: "#8ce99a",
  blue: "#74c0fc",
  pink: "#fcc2d7",
  orange: "#ffc078",
} as const;
export type MarkColorPreset = keyof typeof MARK_COLOR_PRESETS | "custom";

/**
 * Text-weight colours for bold, picked from the Radix text steps so one hex
 * holds its contrast on dark and light surfaces alike. `null` keeps bold
 * inheriting the text colour; `"accent"` follows the theme's accent.
 */
export const BOLD_COLOR_PRESETS = {
  inherit: null,
  accent: "accent",
  rose: "#e64980",
  orange: "#f76707",
  green: "#40c057",
  blue: "#228be6",
  violet: "#845ef7",
} as const;
export type BoldColorPreset = keyof typeof BOLD_COLOR_PRESETS | "custom";

export interface EnhancerPreferences {
  accent: AccentPreset;
  uiFont: UiFontPreference;
  codeFont: CodeFontPreference;
  /** A CSS font-family, read only when `codeFont` is `custom`. */
  customCodeFont: string;
  /** Scales every text style the plugin renders; 1 is the authored size. */
  textScale: number;
  frostedGlass: boolean;
  /** Uses Paseo's interface and code fonts on web and desktop. */
  hostFonts: boolean;
  /** Scales the line height of card and reply text. */
  lineSpacing: LineSpacingPreference;
  /**
   * A light that follows the pointer across a card. Web and desktop only:
   * touch platforms have no hover, so the attribute is inert there.
   */
  pointerGlow: boolean;
  /**
   * Paseo maps a stream item to the plugin timeline item before any transformer
   * runs, and that mapping carries only the text. Pasted images therefore never
   * reach plugin code, so the enhanced bubble cannot draw them. Turning this off
   * hands prompts back to the host, whose own bubble still shows them.
   */
  enhancedUserBubble: boolean;
  /**
   * The Copy / Add to chat bar that follows a highlight. Web and desktop only:
   * iOS and Android route selection through the platform's own menu, which the
   * plugin cannot extend, so the toggle has no effect there.
   */
  selectionActions: boolean;
  /** Ask before a path opens in its default app. Executables always ask. */
  confirmOpenPath: boolean;
  /**
   * The plugin's own markdown rendering for assistant replies. Off hands the
   * turn back to Paseo's renderer, which is the safety valve: the plugin
   * cannot import the host markdown pipeline, so its version is a reasonable
   * subset rather than a superset.
   */
  assistantMarkdown: boolean;
  /** Which look the markdown renderer uses. */
  markdownVariant: MarkdownVariantPreference;
  /** Let Paseo draw tool calls when its Chat display folds them. Web and desktop only. */
  paseoToolFolding: boolean;
  /** Show reasoning while Paseo folds tool calls. */
  overviewReasoning: boolean;
  /** Tool card groups that fold shut once their call finishes. */
  collapseTools: CollapsibleToolGroup[];
  /** A finished card at or under this many lines stays open. Zero folds them all. */
  collapseLineLimit: CollapseLineLimit;
  /**
   * A running card opens so its output can be watched as it streams, and
   * folds when the call finishes. Off leaves running cards to the rules above.
   */
  expandWhileRunning: boolean;
  /** A reasoning summary folds once the thought completes. Off keeps every summary open. */
  collapseReasoning: boolean;
  /** Show only the newest checklist where it arrived. Off shows every update. */
  liveChecklist: boolean;
  /** A reply's code block longer than this folds to a preview. Zero never folds. */
  codeFoldLimit: CodeFoldLimit;
  /** A prompt that runs past this many lines folds to a preview. Zero never folds. */
  promptFoldLimit: PromptFoldLimit;
  /** Renders ==text== in a reply as a marker highlight. Off shows the syntax as typed. */
  markSyntax: boolean;
  markColor: MarkColorPreset;
  boldColor: BoldColorPreset;

  /** The hex behind each `"custom"` choice, edited by the colour picker. */
  accentCustomColor: string;
  markCustomColor: string;
  boldCustomColor: string;
}

const STORAGE_KEY = "paseo/beautiful-chat/preferences/v1";

export const DEFAULT_PREFERENCES: Readonly<EnhancerPreferences> = {
  accent: "host",
  uiFont: "inter",
  codeFont: "code",
  customCodeFont: "",
  textScale: 1,
  frostedGlass: true,
  hostFonts: false,
  lineSpacing: "compact",
  pointerGlow: true,
  enhancedUserBubble: true,
  selectionActions: true,
  confirmOpenPath: true,
  assistantMarkdown: true,
  markdownVariant: "document",
  paseoToolFolding: false,
  overviewReasoning: true,
  collapseTools: [...COLLAPSIBLE_TOOL_GROUPS],
  collapseLineLimit: 0,
  expandWhileRunning: true,
  collapseReasoning: true,
  liveChecklist: true,
  codeFoldLimit: 30,
  promptFoldLimit: 15,
  markSyntax: true,
  markColor: "default",
  boldColor: "inherit",
  accentCustomColor: "#38bdf8",
  markCustomColor: "#f5d90a",
  boldCustomColor: "#e64980",
};

// Fails to compile when a preference is missing from the saved schema, or
// the schema holds one the client does not know.
const schemaCoversEveryPreference: [
  Exclude<keyof EnhancerPreferences, keyof PreferenceOverrides>,
  Exclude<keyof PreferenceOverrides, keyof EnhancerPreferences>,
] extends [never, never]
  ? true
  : never = true;
void schemaCoversEveryPreference;

const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  const candidate = globalThis as typeof globalThis & { localStorage?: Storage };
  return candidate.localStorage;
}

/**
 * The choices an older version kept in this browser, read once so they move
 * to the host. Undefined when this client has no browser storage at all.
 */
function loadLegacyPreferences(): PreferenceOverrides | undefined {
  try {
    const legacyStorage = storage();
    if (!legacyStorage) return undefined;
    const stored = legacyStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    const candidate: unknown = JSON.parse(stored);
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return {};
    // Each field is checked on its own, so one bad value costs only itself.
    const valid: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(preferenceOverridesSchema.shape)) {
      // Text size never existed in browser storage, so it is not imported.
      if (key === "textScale") continue;
      const parsed = schema.safeParse((candidate as Record<string, unknown>)[key]);
      if (parsed.success && parsed.data !== undefined) valid[key] = parsed.data;
    }
    return preferenceOverridesSchema.parse(valid);
  } catch {
    return {};
  }
}

/** Overrides on top of the defaults; a field the host does not hold keeps its default. */
function withDefaults(overrides: PreferenceOverrides): EnhancerPreferences {
  const defined = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  ) as Partial<EnhancerPreferences>;
  return { ...DEFAULT_PREFERENCES, collapseTools: [...DEFAULT_PREFERENCES.collapseTools], ...defined };
}

let preferences: EnhancerPreferences = withDefaults({});
let invoke: PluginClientContext["rpc"] | undefined;
let pending = Promise.resolve();
let localVersion = 0;
let ready = false;
let storageError: string | null = null;

function publish(): void {
  for (const listener of listeners) listener();
}

export function getEnhancerPreferences(): EnhancerPreferences {
  return preferences;
}

/** True once the host's saved preferences have been read. */
export function areEnhancerPreferencesReady(): boolean {
  return ready;
}

export function getEnhancerPreferencesError(): string | null {
  return storageError;
}

async function savePreferences(
  change: (values: PresentationSettings) => PresentationSettings,
): Promise<PresentationSettings> {
  if (!invoke) throw new Error("Preference storage is not connected to a host.");
  // Every write merges against a fresh revision. Retry bounded conflicts so
  // another client's unrelated changes are kept rather than overwritten.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await invoke(presentationSettingsRpc.read, {});
    if (result.status !== "ready") throw new Error(result.error);
    const current = presentationSettings.schema.parse(result.values);
    const next = change(current);
    if (next === current) return current;
    const saved = await invoke(presentationSettingsRpc.write, {
      revision: result.revision,
      values: next,
    });
    if (saved.status === "saved") return presentationSettings.schema.parse(saved.values);
    if (saved.status === "invalid") throw new Error(saved.error);
  }
  throw new Error("Preferences changed in another client. Please try again.");
}

function enqueue(change: (values: PresentationSettings) => PresentationSettings): Promise<void> {
  const version = localVersion;
  pending = pending
    .then(async () => {
      const values = await savePreferences(change);
      // A queued edit must not be replaced by an older read or write response.
      if (version === localVersion) preferences = withDefaults(values.preferences);
      ready = true;
      storageError = null;
      publish();
    })
    .catch((error: unknown) => {
      storageError = error instanceof Error ? error.message : String(error);
      publish();
    });
  return pending;
}

/**
 * Reads the host's saved preferences, moving this browser's older choices to
 * the host the first time. Until the read answers, the defaults apply and the
 * reply and prompt transformers leave rows to Paseo.
 */
export function initializeEnhancerPreferences(rpc: PluginClientContext["rpc"]): Promise<void> {
  invoke = rpc;
  return enqueue((values) => {
    if (values.legacyMigrated) return values;
    const legacy = loadLegacyPreferences();
    // Native has no browser storage. Leave migration available until a web
    // client connects, or an edit or reset makes the host's copy authoritative.
    if (legacy === undefined) return values;
    // Choices already on the host win over legacy values, and the marker stops
    // stale browser storage from restoring settings after an edit or reset.
    return { preferences: { ...legacy, ...values.preferences }, legacyMigrated: true };
  });
}

export function updateEnhancerPreferences(update: Partial<EnhancerPreferences>): Promise<void> {
  const patch = preferenceOverridesSchema.parse(update);
  localVersion += 1;
  preferences = withDefaults({ ...preferences, ...patch });
  publish();
  return enqueue((values) => ({
    preferences: { ...values.preferences, ...patch },
    legacyMigrated: true,
  }));
}

export function resetEnhancerPreferences(): Promise<void> {
  localVersion += 1;
  preferences = withDefaults({});
  publish();
  // A settings reset would also clear the migration marker, so write an empty
  // set of explicit choices instead.
  return enqueue(() => ({ preferences: {}, legacyMigrated: true }));
}

export function subscribeEnhancerPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useEnhancerPreferences(): EnhancerPreferences {
  return useSyncExternalStore(
    subscribeEnhancerPreferences,
    getEnhancerPreferences,
    getEnhancerPreferences,
  );
}

export function useEnhancerPreferencesError(): string | null {
  return useSyncExternalStore(
    subscribeEnhancerPreferences,
    getEnhancerPreferencesError,
    getEnhancerPreferencesError,
  );
}
