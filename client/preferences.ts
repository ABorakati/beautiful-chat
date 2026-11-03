import { useSyncExternalStore } from "react";

export const ACCENT_PRESETS = {
  host: undefined,
  jade: "#10b981",
  violet: "#8b5cf6",
  amber: "#f59e0b",
  rose: "#f43f5e",
} as const;

export type AccentPreset = keyof typeof ACCENT_PRESETS;
export type UiFontPreference = "inter" | "system";
export type CodeFontPreference = "code" | "plain";
export type MarkdownVariantPreference = "document" | "compact" | "terminal";

/** The groups of tool card a reader can fold separately. */
export const COLLAPSIBLE_TOOL_GROUPS = ["shell", "write", "edit", "read", "other"] as const;
export type CollapsibleToolGroup = (typeof COLLAPSIBLE_TOOL_GROUPS)[number];

/** Zero never folds a code block. Any other value folds a longer one. */
export const CODE_FOLD_LIMITS = [0, 30, 60] as const;
export type CodeFoldLimit = (typeof CODE_FOLD_LIMITS)[number];

/** Zero folds every finished card. Any other value spares a card that short. */
export const COLLAPSE_LINE_LIMITS = [0, 10, 20, 50] as const;
export type CollapseLineLimit = (typeof COLLAPSE_LINE_LIMITS)[number];

export interface EnhancerPreferences {
  accent: AccentPreset;
  uiFont: UiFontPreference;
  codeFont: CodeFontPreference;
  frostedGlass: boolean;
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
  /**
   * The plugin's own markdown rendering for assistant replies. Off hands the
   * turn back to Paseo's renderer, which is the safety valve: the plugin
   * cannot import the host markdown pipeline, so its version is a reasonable
   * subset rather than a superset.
   */
  assistantMarkdown: boolean;
  /** Which look the markdown renderer uses. */
  markdownVariant: MarkdownVariantPreference;
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
  /** A reply's code block longer than this folds to a preview. Zero never folds. */
  codeFoldLimit: CodeFoldLimit;
}

const STORAGE_KEY = "paseo/beautiful-chat/preferences/v1";

export const DEFAULT_PREFERENCES: Readonly<EnhancerPreferences> = {
  accent: "host",
  uiFont: "inter",
  codeFont: "code",
  frostedGlass: true,
  pointerGlow: true,
  enhancedUserBubble: true,
  selectionActions: true,
  assistantMarkdown: true,
  markdownVariant: "document",
  collapseTools: [...COLLAPSIBLE_TOOL_GROUPS],
  collapseLineLimit: 0,
  expandWhileRunning: true,
  collapseReasoning: true,
  codeFoldLimit: 30,
};

const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  const candidate = globalThis as typeof globalThis & { localStorage?: Storage };
  return candidate.localStorage;
}

function isAccentPreset(value: unknown): value is AccentPreset {
  return typeof value === "string" && value in ACCENT_PRESETS;
}

function isCollapseLineLimit(value: unknown): value is CollapseLineLimit {
  return COLLAPSE_LINE_LIMITS.includes(value as CollapseLineLimit);
}

function isCodeFoldLimit(value: unknown): value is CodeFoldLimit {
  return CODE_FOLD_LIMITS.includes(value as CodeFoldLimit);
}

function collapseToolsFrom(value: unknown): CollapsibleToolGroup[] {
  if (!Array.isArray(value)) return [...DEFAULT_PREFERENCES.collapseTools];
  return COLLAPSIBLE_TOOL_GROUPS.filter((group) => value.includes(group));
}

function loadPreferences(): EnhancerPreferences {
  try {
    const stored = storage()?.getItem(STORAGE_KEY);
    if (!stored) return { ...DEFAULT_PREFERENCES };
    const candidate = JSON.parse(stored) as Partial<EnhancerPreferences>;
    return {
      accent: isAccentPreset(candidate.accent) ? candidate.accent : DEFAULT_PREFERENCES.accent,
      uiFont: candidate.uiFont === "system" ? "system" : DEFAULT_PREFERENCES.uiFont,
      codeFont: candidate.codeFont === "plain" ? "plain" : DEFAULT_PREFERENCES.codeFont,
      frostedGlass:
        typeof candidate.frostedGlass === "boolean"
          ? candidate.frostedGlass
          : DEFAULT_PREFERENCES.frostedGlass,
      pointerGlow:
        typeof candidate.pointerGlow === "boolean"
          ? candidate.pointerGlow
          : DEFAULT_PREFERENCES.pointerGlow,
      enhancedUserBubble:
        typeof candidate.enhancedUserBubble === "boolean"
          ? candidate.enhancedUserBubble
          : DEFAULT_PREFERENCES.enhancedUserBubble,
      selectionActions:
        typeof candidate.selectionActions === "boolean"
          ? candidate.selectionActions
          : DEFAULT_PREFERENCES.selectionActions,
      assistantMarkdown:
        typeof candidate.assistantMarkdown === "boolean"
          ? candidate.assistantMarkdown
          : DEFAULT_PREFERENCES.assistantMarkdown,
      markdownVariant:
        candidate.markdownVariant === "compact" || candidate.markdownVariant === "terminal"
          ? candidate.markdownVariant
          : DEFAULT_PREFERENCES.markdownVariant,
      collapseTools: collapseToolsFrom(candidate.collapseTools),
      collapseLineLimit: isCollapseLineLimit(candidate.collapseLineLimit)
        ? candidate.collapseLineLimit
        : DEFAULT_PREFERENCES.collapseLineLimit,
      expandWhileRunning:
        typeof candidate.expandWhileRunning === "boolean"
          ? candidate.expandWhileRunning
          : DEFAULT_PREFERENCES.expandWhileRunning,
      collapseReasoning:
        typeof candidate.collapseReasoning === "boolean"
          ? candidate.collapseReasoning
          : DEFAULT_PREFERENCES.collapseReasoning,
      codeFoldLimit: isCodeFoldLimit(candidate.codeFoldLimit)
        ? candidate.codeFoldLimit
        : DEFAULT_PREFERENCES.codeFoldLimit,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

let preferences = loadPreferences();

function publish(): void {
  for (const listener of listeners) listener();
}

export function getEnhancerPreferences(): EnhancerPreferences {
  return preferences;
}

export function updateEnhancerPreferences(update: Partial<EnhancerPreferences>): void {
  preferences = { ...preferences, ...update };
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Browser storage can be disabled. Keep the change alive for this session.
  }
  publish();
}

export function resetEnhancerPreferences(): void {
  preferences = { ...DEFAULT_PREFERENCES };
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Keep the default session value if storage is unavailable.
  }
  publish();
}

export function useEnhancerPreferences(): EnhancerPreferences {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getEnhancerPreferences,
    getEnhancerPreferences,
  );
}
