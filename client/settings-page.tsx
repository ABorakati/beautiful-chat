import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { hostFontEscape } from "./components/host-font-escape";
import {
  radius,
  fontCode,
  fontMono,
  fontUi,
  resolveCodeFonts,
  useThemeTokens,
  type ExtendedThemeTokens,
} from "./components/theme-tokens";
import { SettingsPreview } from "./settings-preview";
import {
  ACCENT_PRESETS,
  TEXT_SIZE_OPTIONS,
  COLLAPSIBLE_TOOL_GROUPS,
  resetEnhancerPreferences,
  updateEnhancerPreferences,
  useEnhancerPreferences,
  useEnhancerPreferencesError,
  type AccentPreset,
  type CodeFoldLimit,
  type CodeFontPreference,
  type CollapseLineLimit,
  type CollapsibleToolGroup,
  type LineSpacingPreference,
  type MarkdownVariantPreference,
  type PromptFoldLimit,
  type UiFontPreference,
} from "./preferences";

const ACCENT_OPTIONS: ReadonlyArray<{ id: AccentPreset; label: string }> = [
  { id: "host", label: "Paseo theme" },
  { id: "jade", label: "Jade" },
  { id: "violet", label: "Violet" },
  { id: "amber", label: "Amber" },
  { id: "rose", label: "Rose" },
];
const TOOL_GROUP_OPTIONS: ReadonlyArray<{ value: CollapsibleToolGroup; label: string }> = [
  { value: "shell", label: "Shell and Git" },
  { value: "write", label: "Writes" },
  { value: "edit", label: "Edits" },
  { value: "read", label: "Reads" },
  { value: "other", label: "Other tools" },
];
const LINE_LIMIT_OPTIONS: ReadonlyArray<{ value: `${CollapseLineLimit}`; label: string }> = [
  { value: "0", label: "Always" },
  { value: "10", label: "Over 10 lines" },
  { value: "20", label: "Over 20 lines" },
  { value: "50", label: "Over 50 lines" },
];
const CODE_FOLD_OPTIONS: ReadonlyArray<{ value: `${CodeFoldLimit}`; label: string }> = [
  { value: "0", label: "Never" },
  { value: "30", label: "Over 30 lines" },
  { value: "60", label: "Over 60 lines" },
];
const PROMPT_FOLD_OPTIONS: ReadonlyArray<{ value: `${PromptFoldLimit}`; label: string }> = [
  { value: "0", label: "Never" },
  { value: "15", label: "Over 15 lines" },
  { value: "30", label: "Over 30 lines" },
];
const LINE_SPACING = { compact: 1, balanced: 1.15, spacious: 1.3 } as const;
const TWO_COLUMN_WIDTH = 860;
const PREVIEW_WIDTH = 380;
const MAX_PAGE_WIDTH = 1200;
/** The host's page padding on both sides. */
const PANE_MARGIN = 32;
const TRACK_WIDTH = 40;
const TRACK_HEIGHT = 24;
const KNOB = 16;

function Chip({ text, tokens }: { text: string; tokens: ExtendedThemeTokens }) {
  return (
    <Text
      style={[
        styles.chip,
        { color: tokens.foregroundMuted, backgroundColor: tokens.surface2, fontFamily: tokens.fontUi },
      ]}
    >
      {text}
    </Text>
  );
}

function SettingText({
  title,
  description,
  chip,
  tokens,
}: {
  title: string;
  description: string;
  chip?: string;
  tokens: ExtendedThemeTokens;
}) {
  return (
    <View style={styles.settingText}>
      <View style={styles.titleRow}>
        <Text style={[styles.rowTitle, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>
          {title}
        </Text>
        {chip ? <Chip text={chip} tokens={tokens} /> : null}
      </View>
      <Text style={[styles.description, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
        {description}
      </Text>
    </View>
  );
}

function Toggle({
  value,
  onChange,
  label,
  tokens,
}: {
  value: boolean;
  onChange(next: boolean): void;
  label: string;
  tokens: ExtendedThemeTokens;
}) {
  const position = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    const animation = Animated.timing(position, {
      toValue: value ? 1 : 0,
      duration: 140,
      useNativeDriver: Platform.OS !== "web",
    });
    animation.start();
    return () => animation.stop();
  }, [value, position]);

  return (
    <Pressable
      accessibilityRole="switch"
      // React Native Web needs the ARIA attribute as well as accessibilityState.
      aria-checked={value}
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      onPress={() => onChange(!value)}
      style={styles.toggleTarget}
    >
      <View
        style={[
          styles.track,
          {
            backgroundColor: value ? tokens.accent : tokens.surface2,
            borderColor: value ? tokens.accent : tokens.border,
          },
        ]}
      >
        <Animated.View
          style={[
            styles.knob,
            {
              backgroundColor: value ? tokens.accentForeground : tokens.foregroundMuted,
              transform: [{ translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, TRACK_WIDTH - KNOB - 8] }) }],
            },
          ]}
        />
      </View>
    </Pressable>
  );
}

function ToggleRow({
  title,
  description,
  chip,
  value,
  onChange,
  tokens,
}: {
  title: string;
  description: string;
  chip?: string;
  value: boolean;
  onChange(next: boolean): void;
  tokens: ExtendedThemeTokens;
}) {
  return (
    <View style={[styles.row, styles.toggleRow, { borderTopColor: tokens.borderSubtle }]}>
      <SettingText title={title} description={description} chip={chip} tokens={tokens} />
      <Toggle value={value} onChange={onChange} label={title} tokens={tokens} />
    </View>
  );
}

function OptionButton({
  label,
  selected,
  onPress,
  tokens,
}: {
  label: string;
  selected: boolean;
  onPress(): void;
  tokens: ExtendedThemeTokens;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      aria-pressed={selected}
      onPress={onPress}
      style={({ pressed }) => [
        styles.simpleOption,
        {
          backgroundColor: selected ? tokens.accentBg : pressed ? tokens.surface2 : tokens.surface1,
          borderColor: selected ? tokens.accent : tokens.border,
        },
      ]}
    >
      <Text style={[styles.optionLabel, { color: selected ? tokens.accent : tokens.foreground, fontFamily: tokens.fontUi }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ChoiceRow<T extends string>({
  title,
  description,
  value,
  options,
  onChange,
  renderPreview,
  disabled = false,
  hint,
  tokens,
}: {
  title: string;
  description: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange(value: T): void;
  renderPreview?(value: T): React.ReactNode;
  disabled?: boolean;
  hint?: string;
  tokens: ExtendedThemeTokens;
}) {
  return (
    <View style={[styles.row, { borderTopColor: tokens.borderSubtle }, disabled && styles.disabled]}>
      <SettingText title={title} description={description} chip={disabled ? "Disabled" : undefined} tokens={tokens} />
      <View style={styles.options}>
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityLabel={`${title}: ${option.label}`}
              accessibilityState={{ selected, disabled }}
              aria-pressed={selected}
              disabled={disabled}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                renderPreview ? styles.option : styles.simpleOption,
                {
                  backgroundColor: selected ? tokens.accentBg : pressed ? tokens.surface2 : tokens.surface1,
                  borderColor: selected ? tokens.accent : tokens.border,
                },
              ]}
            >
              {renderPreview ? (
                <View pointerEvents="none" aria-hidden style={styles.optionPreview}>
                  {renderPreview(option.value)}
                </View>
              ) : null}
              <Text style={[styles.optionLabel, { color: selected ? tokens.accent : tokens.foreground, fontFamily: tokens.fontUi }]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {hint ? (
        <Text style={[styles.hint, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

/** Each option changes independently. Keep selected values in the displayed order. */
function MultiChoiceRow<T extends string>({
  title,
  description,
  values,
  options,
  onChange,
  tokens,
}: {
  title: string;
  description: string;
  values: readonly T[];
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange(values: T[]): void;
  tokens: ExtendedThemeTokens;
}) {
  return (
    <View style={[styles.row, { borderTopColor: tokens.borderSubtle }]}>
      <SettingText title={title} description={description} tokens={tokens} />
      <View style={styles.options}>
        {options.map((option) => {
          const selected = values.includes(option.value);
          return (
            <OptionButton
              key={option.value}
              label={option.label}
              selected={selected}
              onPress={() =>
                onChange(
                  options
                    .map((candidate) => candidate.value)
                    .filter((value) =>
                      value === option.value ? !selected : values.includes(value),
                    ),
                )
              }
              tokens={tokens}
            />
          );
        })}
      </View>
    </View>
  );
}

function Section({ title, tokens, children }: { title: string; tokens: ExtendedThemeTokens; children: React.ReactNode }) {
  return (
    <View style={[styles.card, { borderColor: tokens.borderSubtle, backgroundColor: tokens.surface0 }]}>
      <View style={[styles.sectionHeader, { backgroundColor: tokens.surface1 }]}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

/** The listed size nearest a saved scale, so an out-of-list value still selects one. */
function textSizeValue(scale: number): (typeof TEXT_SIZE_OPTIONS)[number]["value"] {
  let nearest: (typeof TEXT_SIZE_OPTIONS)[number] = TEXT_SIZE_OPTIONS[1];
  for (const option of TEXT_SIZE_OPTIONS) {
    if (Math.abs(Number(option.value) - scale) < Math.abs(Number(nearest.value) - scale)) nearest = option;
  }
  return nearest.value;
}

/** Paseo mounts this page under the host's Plugin settings. */
export function BeautifulChatSettingsPage({ theme }: PluginSurfaceProps) {
  const preferences = useEnhancerPreferences();
  const storageError = useEnhancerPreferencesError();
  const tokens = useThemeTokens(theme.colors, preferences);
  const [wide, setWide] = useState(false);
  const rootRef = useRef<View>(null);
  const [paneWidth, setPaneWidth] = useState<number | null>(null);
  // Paseo caps settings pages at 720 px. Use the scroll pane width on web for two columns.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof ResizeObserver === "undefined") return;
    let pane = (rootRef.current as unknown as HTMLElement | null)?.parentElement ?? null;
    while (pane && !/auto|scroll/.test(getComputedStyle(pane).overflowY)) pane = pane.parentElement;
    if (!pane) return;
    const observed = pane;
    const observer = new ResizeObserver(() => setPaneWidth(observed.clientWidth));
    observer.observe(observed);
    return () => observer.disconnect();
  }, []);
  const preview = (
    <View style={wide ? styles.previewColumn : styles.stackedPreview}>
      <SettingsPreview preferences={preferences} tokens={tokens} />
    </View>
  );

  return (
    <View
      {...hostFontEscape}
      ref={rootRef}
      onLayout={(event) => setWide(event.nativeEvent.layout.width >= TWO_COLUMN_WIDTH)}
      style={[
        styles.container,
        { backgroundColor: tokens.surface0 },
        paneWidth ? { width: Math.min(paneWidth - PANE_MARGIN, MAX_PAGE_WIDTH), alignSelf: "center" } : null,
      ]}
    >
      <View style={styles.intro}>
        <Text accessibilityRole="header" style={[styles.title, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>
          Beautiful Chat
        </Text>
        <Text style={[styles.description, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
          Changes save automatically on the selected host and apply to all its clients. Reload the
          chat to update items already on screen.
        </Text>
        {storageError ? (
          <Text accessibilityRole="alert" style={[styles.description, { color: tokens.danger, fontFamily: tokens.fontUi }]}>
            Preferences could not be saved or loaded: {storageError} Change the setting again to retry.
          </Text>
        ) : null}
      </View>
      <View style={[styles.columns, wide && styles.wideColumns]}>
        {!wide ? preview : null}
        <View style={[styles.settingsColumn, wide && styles.flexColumn]}>
          <Section title="Appearance" tokens={tokens}>
            <View style={[styles.row, { borderTopColor: tokens.borderSubtle }]}>
              <SettingText title="Accent colour" description="Follow the Paseo theme, or choose a colour." tokens={tokens} />
              <View style={styles.swatches}>
                {ACCENT_OPTIONS.map((option) => {
                  const selected = preferences.accent === option.id;
                  return (
                    <Pressable
                      key={option.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Accent colour: ${option.label}`}
                      accessibilityState={{ selected }}
                      aria-pressed={selected}
                      onPress={() => updateEnhancerPreferences({ accent: option.id })}
                      style={({ pressed }) => [styles.accentOption, {
                        borderColor: selected ? tokens.accent : tokens.border,
                        backgroundColor: selected ? tokens.accentBg : pressed ? tokens.surface2 : tokens.surface1,
                      }]}
                    >
                      <View style={[styles.swatch, { backgroundColor: ACCENT_PRESETS[option.id] ?? theme.colors.accent }]} />
                      <Text style={[styles.optionLabel, { color: selected ? tokens.accent : tokens.foreground, fontFamily: tokens.fontUi }]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <ToggleRow
              title="Use Paseo fonts"
              description="Use the fonts and Code size from Paseo's Appearance settings. Empty font settings keep your choices below."
              chip="Desktop & web"
              value={preferences.hostFonts}
              onChange={(hostFonts) => updateEnhancerPreferences({ hostFonts })}
              tokens={tokens}
            />
            <ChoiceRow<UiFontPreference>
              title="Interface font"
              description="Choose the font for prompts and card text."
              value={preferences.uiFont}
              options={[{ value: "inter", label: "Inter" }, { value: "system", label: "System" }]}
              renderPreview={(value) => <Text style={[styles.fontSample, { color: tokens.foreground, fontFamily: value === "inter" ? fontUi : "System" }]}>Aa</Text>}
              hint={preferences.hostFonts ? "Paseo's interface font takes priority when it is set." : undefined}
              onChange={(uiFont) => updateEnhancerPreferences({ uiFont })}
              tokens={tokens}
            />
            <ChoiceRow<CodeFontPreference>
              title="Code font"
              description="The face for code, diffs, terminal output, and every other monospace surface. Ligatures join code symbols in code blocks only; Literal shows each symbol separately. Custom takes any installed font family."
              value={preferences.codeFont}
              options={[{ value: "code", label: "Ligatures" }, { value: "plain", label: "Literal" }, { value: "custom", label: "Custom" }]}
              renderPreview={(value) => (
                <Text
                  style={[
                    styles.codeSample,
                    {
                      color: tokens.foreground,
                      fontFamily:
                        value === "custom"
                          ? resolveCodeFonts({ ...preferences, codeFont: "custom", hostFonts: false }).code
                          : value === "code"
                            ? fontCode
                            : fontMono,
                    },
                  ]}
                >
                  {"=> !== <="}
                </Text>
              )}
              hint={
                preferences.hostFonts && preferences.codeFont !== "custom"
                  ? "Paseo's code font takes priority when it is set. A custom font takes priority over it."
                  : undefined
              }
              onChange={(codeFont) => updateEnhancerPreferences({ codeFont })}
              tokens={tokens}
            />
            {preferences.codeFont === "custom" ? (
              <TextInput
                accessibilityLabel="Custom code font family"
                value={preferences.customCodeFont}
                onChangeText={(customCodeFont) => updateEnhancerPreferences({ customCodeFont })}
                placeholder="JetBrains Mono"
                placeholderTextColor={tokens.foregroundSubtle}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                style={[
                  styles.fontInput,
                  {
                    color: tokens.foreground,
                    backgroundColor: tokens.surface2,
                    borderColor: tokens.borderSubtle,
                    fontFamily: tokens.fontCode,
                  },
                ]}
              />
            ) : null}
            <ChoiceRow<(typeof TEXT_SIZE_OPTIONS)[number]["value"]>
              title="Text size"
              description="Scale the text the plugin draws, from replies and code to callouts and badges."
              value={textSizeValue(preferences.textScale)}
              options={TEXT_SIZE_OPTIONS}
              onChange={(textScale) => updateEnhancerPreferences({ textScale: Number(textScale) })}
              tokens={tokens}
            />
            <ChoiceRow<LineSpacingPreference>
              title="Line spacing"
              description="Compact keeps the original spacing. Balanced adds 15% and Spacious adds 30%."
              value={preferences.lineSpacing}
              options={[{ value: "compact", label: "Compact" }, { value: "balanced", label: "Balanced" }, { value: "spacious", label: "Spacious" }]}
              renderPreview={(value) => (
                <View style={styles.spacingSample}>
                  {[0, 1, 2].map((line) => (
                    <View
                      key={line}
                      style={[
                        styles.sampleLine,
                        { backgroundColor: tokens.foregroundMuted, marginVertical: (18 * LINE_SPACING[value] - 4) / 2 },
                        line === 2 && styles.shortLine,
                      ]}
                    />
                  ))}
                </View>
              )}
              onChange={(lineSpacing) => updateEnhancerPreferences({ lineSpacing })}
              tokens={tokens}
            />
            <ToggleRow
              title="Frosted glass"
              description="Blur card backgrounds where supported. Disable this setting for solid surfaces."
              value={preferences.frostedGlass}
              onChange={(frostedGlass) => updateEnhancerPreferences({ frostedGlass })}
              tokens={tokens}
            />
            <ToggleRow
              title="Pointer glow"
              description="Show a soft light under the pointer on cards. Reduced motion disables this effect."
              chip="Desktop & web"
              value={preferences.pointerGlow}
              onChange={(pointerGlow) => updateEnhancerPreferences({ pointerGlow })}
              tokens={tokens}
            />
          </Section>

          <Section title="Replies" tokens={tokens}>
            <ToggleRow
              title="Assistant markdown"
              description="Style headings, lists, code, and images. Disable this setting for Mermaid diagrams and Paseo's file-path links. On iOS, styled replies cannot be selected by dragging; use Copy, or disable this setting."
              value={preferences.assistantMarkdown}
              onChange={(assistantMarkdown) => updateEnhancerPreferences({ assistantMarkdown })}
              tokens={tokens}
            />
            <ChoiceRow<MarkdownVariantPreference>
              title="Markdown style"
              description="Choose more space, less space, or a code font."
              value={preferences.markdownVariant}
              disabled={!preferences.assistantMarkdown}
              hint={!preferences.assistantMarkdown ? "Enable Assistant markdown to change the style." : undefined}
              options={[{ value: "document", label: "Document" }, { value: "compact", label: "Compact" }, { value: "terminal", label: "Terminal" }]}
              renderPreview={(value) => (
                <View style={[styles.markdownSample, { gap: value === "document" ? 8 : 4 }]}>
                  <Text style={[styles.sampleHeading, { color: tokens.foreground, fontFamily: value === "terminal" ? tokens.fontMono : tokens.fontUi, fontSize: value === "document" ? 16 : 12 }]}>
                    {value === "terminal" ? "# Title" : "Title"}
                  </Text>
                  <Text style={[styles.sampleBody, { color: tokens.foregroundMuted, fontFamily: value === "terminal" ? tokens.fontMono : tokens.fontUi, lineHeight: value === "document" ? 20 : 16 }]}>{"First line\nNext line"}</Text>
                </View>
              )}
              onChange={(markdownVariant) => updateEnhancerPreferences({ markdownVariant })}
              tokens={tokens}
            />
            <ChoiceRow<`${CodeFoldLimit}`>
              title="Long code blocks"
              description="Fold reply code blocks past the limit to their first ten lines. Copy keeps the whole block."
              value={`${preferences.codeFoldLimit}`}
              options={CODE_FOLD_OPTIONS}
              onChange={(value) => updateEnhancerPreferences({ codeFoldLimit: Number(value) as CodeFoldLimit })}
              tokens={tokens}
            />
          </Section>

          <Section title="Prompts" tokens={tokens}>
            <ToggleRow
              title="Enhanced prompt bubble"
              description="Paseo removes pasted images before the plugin receives a prompt. Disable this setting for Paseo's bubble with images. On iOS, the bubble cannot be selected by dragging; use Copy, or disable this setting."
              value={preferences.enhancedUserBubble}
              onChange={(enhancedUserBubble) => updateEnhancerPreferences({ enhancedUserBubble })}
              tokens={tokens}
            />
            <ChoiceRow<`${PromptFoldLimit}`>
              title="Long prompts"
              description="Fold long prompts to their first eight lines and keep the whole text for Copy. Paseo's own bubble does not fold."
              value={`${preferences.promptFoldLimit}`}
              options={PROMPT_FOLD_OPTIONS}
              onChange={(value) => updateEnhancerPreferences({ promptFoldLimit: Number(value) as PromptFoldLimit })}
              tokens={tokens}
            />
          </Section>

          <Section title="Timeline" tokens={tokens}>
            <MultiChoiceRow<CollapsibleToolGroup>
              title="Collapse when finished"
              description="Fold the selected tool groups after completion. Failed calls and agent questions stay open, and each header still opens or closes its card."
              values={preferences.collapseTools}
              options={TOOL_GROUP_OPTIONS}
              onChange={(values) => updateEnhancerPreferences({ collapseTools: COLLAPSIBLE_TOOL_GROUPS.filter((group) => values.includes(group)) })}
              tokens={tokens}
            />
            <ChoiceRow<`${CollapseLineLimit}`>
              title="Collapse length"
              description="Fold every selected card, or only cards longer than the limit. Short results stay open when a limit is set."
              value={`${preferences.collapseLineLimit}`}
              options={LINE_LIMIT_OPTIONS}
              onChange={(value) => updateEnhancerPreferences({ collapseLineLimit: Number(value) as CollapseLineLimit })}
              tokens={tokens}
            />
            <ToggleRow
              title="Open while running"
              description="Open tool cards while their calls run, then apply the rules above. Disable this setting to apply those rules from the start."
              value={preferences.expandWhileRunning}
              onChange={(expandWhileRunning) => updateEnhancerPreferences({ expandWhileRunning })}
              tokens={tokens}
            />
            <ToggleRow
              title="Let Paseo fold tool calls"
              description="Paseo draws tool calls when its Chat display folds them."
              chip="Desktop & web"
              value={preferences.paseoToolFolding}
              onChange={(paseoToolFolding) => updateEnhancerPreferences({ paseoToolFolding })}
              tokens={tokens}
            />
            {preferences.paseoToolFolding && (
              <ToggleRow
                title="Show reasoning between folded calls"
                description="Off hides reasoning only while Paseo folds tool calls."
                value={preferences.overviewReasoning}
                onChange={(overviewReasoning) => updateEnhancerPreferences({ overviewReasoning })}
                tokens={tokens}
              />
            )}
            <ToggleRow
              title="Fold reasoning summaries"
              description="Fold reasoning summaries after completion. Disable this setting to keep every summary open."
              value={preferences.collapseReasoning}
              onChange={(collapseReasoning) => updateEnhancerPreferences({ collapseReasoning })}
              tokens={tokens}
            />
            <ToggleRow
              title="Live checklist"
              description="Show only checklist updates that the feed identifies as current. Keep cards visible while the feed is unavailable. Disable this setting to show every update."
              value={preferences.liveChecklist}
              onChange={(liveChecklist) => updateEnhancerPreferences({ liveChecklist })}
              tokens={tokens}
            />
          </Section>

          <Section title="Interaction" tokens={tokens}>
            <ToggleRow
              title="Selection actions"
              description="Select text to show Copy and Add to chat. Add to chat inserts the selection as a quote or code block."
              chip="Desktop & web"
              value={preferences.selectionActions}
              onChange={(selectionActions) => updateEnhancerPreferences({ selectionActions })}
              tokens={tokens}
            />
            <ToggleRow
              title="Ask before opening files"
              description="Ask before a safe file opens on the computer that runs the Paseo daemon. Other files and paths outside the working folder always ask."
              chip="Desktop & web"
              value={preferences.confirmOpenPath}
              onChange={(confirmOpenPath) => updateEnhancerPreferences({ confirmOpenPath })}
              tokens={tokens}
            />
          </Section>
          <Pressable
            accessibilityRole="button"
            onPress={resetEnhancerPreferences}
            style={({ pressed }) => [styles.reset, { borderColor: tokens.border, backgroundColor: pressed ? tokens.surface2 : tokens.surface1 }]}
          >
            <Text style={[styles.optionLabel, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>Reset defaults</Text>
          </Pressable>
        </View>
        {wide ? preview : null}
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  // The host uses a content-sized column. A zero flex basis collapses this page.
  container: { alignSelf: "stretch", padding: 16, gap: 24 },
  intro: { gap: 8 },
  title: { fontSize: 20, lineHeight: 28, fontWeight: "700" },
  description: { fontSize: 12, lineHeight: 20 },
  columns: { gap: 24, alignItems: "stretch" },
  wideColumns: { flexDirection: "row", alignItems: "flex-start" },
  settingsColumn: { minWidth: 0, gap: 16 },
  flexColumn: { flex: 1 },
  previewColumn: {
    width: PREVIEW_WIDTH,
    flexShrink: 0,
    // Keep the preview in view while the settings scroll.
    ...(Platform.OS === "web" ? ({ position: "sticky", top: 16 } as unknown as object) : null),
  },
  stackedPreview: { alignSelf: "stretch", minWidth: 0 },
  card: { borderWidth: 1, borderRadius: radius.card, overflow: "hidden" },
  sectionHeader: { padding: 16 },
  sectionTitle: { fontSize: 16, lineHeight: 24, fontWeight: "700" },
  row: { padding: 16, gap: 12, borderTopWidth: 1 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  settingText: { flex: 1, minWidth: 0, gap: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  rowTitle: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  chip: { fontSize: 10, lineHeight: 16, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.chip },
  toggleTarget: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  track: { width: TRACK_WIDTH, height: TRACK_HEIGHT, borderRadius: TRACK_HEIGHT / 2, borderWidth: 1, padding: 3, justifyContent: "center" },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: { flex: 1, minWidth: 88, borderWidth: 1, borderRadius: radius.block, padding: 12, gap: 8 },
  simpleOption: { minHeight: 44, justifyContent: "center", borderWidth: 1, borderRadius: radius.block, paddingHorizontal: 12, paddingVertical: 8 },
  optionPreview: { height: 72, justifyContent: "center" },
  optionLabel: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
  fontSample: { fontSize: 28, lineHeight: 36 },
  codeSample: { fontSize: 16, lineHeight: 24 },
  fontInput: { minHeight: 44, borderWidth: 1, borderRadius: radius.block, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13 },
  spacingSample: { width: "100%", maxWidth: 72 },
  sampleLine: { width: "100%", height: 4, borderRadius: radius.chip },
  shortLine: { width: "64%" },
  markdownSample: { alignSelf: "stretch" },
  sampleHeading: { fontWeight: "700" },
  sampleBody: { fontSize: 10 },
  hint: { fontSize: 12, lineHeight: 20 },
  disabled: { opacity: 0.5 },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  accentOption: { flexDirection: "row", alignItems: "center", minHeight: 44, gap: 8, borderWidth: 1, borderRadius: radius.block, paddingHorizontal: 12, paddingVertical: 8 },
  swatch: { width: 16, height: 16, borderRadius: radius.chip },
  reset: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", borderWidth: 1, borderRadius: radius.block, paddingHorizontal: 16, paddingVertical: 12 },
});
