import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Glyph } from "./glyph";
import { radius } from "./theme-tokens";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { selectableSurface, unselectable } from "./selection";
import type { StatusLineData } from "../../shared/contracts";

interface StatusLineProps {
  /** The host's own label: `OMP fallback applied for main`, `OMP goal active`. */
  title: string;
  data: StatusLineData;
  status: "running" | "completed" | "failed";
  tokens: ExtendedThemeTokens;
}

const TONE_GLYPH: Record<string, string> = {
  "omp_retry_fallback_applied": "Sparkles",
  "omp_retry_fallback_succeeded": "Sparkles",
  "omp_auto_retry_start": "RefreshCw",
  "omp_auto_retry_end": "RefreshCw",
  omp_goal_updated: "Target",
};

/**
 * One row of omp telemetry: a retry, a fallback, a goal update.
 *
 * These are status lines, not calls. There is no body to open — the host's
 * `detail.text` usually restates what the chips already say — and the row is
 * the same height running or finished so the timeline does not jump as the
 * retry resolves.
 */
export function StatusLine({
  title,
  data,
  status,
  tokens,
}: StatusLineProps): React.ReactElement {
  const tone =
    data.tone === "danger" || status === "failed"
      ? tokens.danger
      : data.tone === "success"
        ? tokens.success
        : tokens.accent;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          marginVertical: 4,
          borderRadius: radius.card,
          backgroundColor: tokens.surfaceGlass,
          borderWidth: 1,
          borderColor: tokens.borderSubtle,
          ...tokens.boxShadow,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 10,
          paddingVertical: 6,
          ...selectableSurface,
        },
        title: {
          fontFamily: tokens.fontUi,
          fontSize: 12,
          fontWeight: "600",
          color: tokens.foreground,
          flexShrink: 1,
        },
        chips: {
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
          flexShrink: 1,
        },
        chip: {
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingHorizontal: 6,
          paddingVertical: 1,
          borderRadius: radius.chip,
          backgroundColor: tokens.surface2,
        },
        chipLabel: {
          fontFamily: tokens.fontUi,
          fontSize: 10,
          color: tokens.foregroundSubtle,
          textTransform: "lowercase",
        },
        chipValue: {
          fontFamily: tokens.fontMono,
          fontSize: 10.5,
          color: tokens.foregroundMuted,
        },
        detail: {
          fontFamily: tokens.fontUi,
          fontSize: 11,
          color: tokens.foregroundSubtle,
          flexShrink: 1,
        },
      }),
    [tokens],
  );

  return (
    <View style={styles.container}>
      <Glyph name={TONE_GLYPH[data.source] ?? "Sparkles"} size={13} color={tone} />
      <Text selectable style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {data.chips.length > 0 ? (
        <View style={[styles.chips, unselectable]}>
          {data.chips.map((chip) => (
            <View key={`${chip.label}-${chip.value}`} style={styles.chip}>
              <Text style={styles.chipLabel}>{chip.label}</Text>
              <Text selectable style={styles.chipValue}>
                {chip.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {data.text ? (
        <Text selectable style={styles.detail} numberOfLines={1}>
          {data.text}
        </Text>
      ) : null}
    </View>
  );
}
