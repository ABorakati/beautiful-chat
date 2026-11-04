import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Glyph } from "./glyph";
import { radius } from "./theme-tokens";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { selectableSurface, unselectable } from "./selection";
import type { AdvisorData, AdvisorNote } from "../../shared/contracts";

interface AdvisorCalloutProps {
  data: AdvisorData;
  tokens: ExtendedThemeTokens;
}

interface SeverityLook {
  label: string;
  accent: string;
  tint: string;
  border: string;
}

/**
 * A note without a severity is still a note; it just carries no weight chip.
 * The three severities omp emits are the only ones the host forwards.
 */
function severityLook(note: AdvisorNote, tokens: ExtendedThemeTokens): SeverityLook | null {
  if (note.severity === "blocker") {
    return { label: "blocker", accent: tokens.danger, tint: tokens.dangerBg, border: tokens.dangerBorder };
  }
  if (note.severity === "concern") {
    return {
      label: "concern",
      accent: tokens.warning,
      tint: tokens.warningBg,
      border: tokens.warningBorder,
    };
  }
  if (note.severity === "nit") {
    return {
      label: "nit",
      accent: tokens.foregroundSubtle,
      tint: tokens.surface2,
      border: tokens.borderSubtle,
    };
  }
  return null;
}

/**
 * Six notes and about a thousand characters is what a reader takes in without
 * losing the turn around the card. The 18-note case exists in the local corpus.
 */
const CLIP_NOTES = 6;
const CLIP_CHARS = 1000;

function clipNotes(notes: AdvisorNote[]): { shown: AdvisorNote[]; clipped: boolean } {
  const shown: AdvisorNote[] = [];
  let chars = 0;
  for (const note of notes) {
    if (shown.length >= CLIP_NOTES) return { shown, clipped: true };
    const budget = CLIP_CHARS - chars;
    if (note.text.length > budget) {
      shown.push({ ...note, text: `${note.text.slice(0, Math.max(0, budget)).trimEnd()}…` });
      return { shown, clipped: true };
    }
    shown.push(note);
    chars += note.text.length;
  }
  return { shown, clipped: false };
}

/**
 * An omp advisor note, drawn as advice rather than as a tool call.
 *
 * The host reduces the structured notes to one `[severity] [advisor] note`
 * string, so the parse in `tool-call-data` is the only source for per-note
 * weight. Order is the advisor's own: blockers are not moved to the top,
 * because a note usually refers to the one before it.
 */
export function AdvisorCallout({ data, tokens }: AdvisorCalloutProps): React.ReactElement {
  const [showAll, setShowAll] = useState(false);
  const clip = useMemo(() => clipNotes(data.notes), [data.notes]);
  const notes = showAll ? data.notes : clip.shown;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          gap: 10,
          ...selectableSurface,
        },
        note: {
          borderLeftWidth: 2,
          paddingLeft: 10,
          gap: 4,
        },
        badges: {
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
        },
        chip: {
          paddingHorizontal: 6,
          paddingVertical: 1,
          borderRadius: radius.chip,
          borderWidth: 1,
        },
        chipText: {
          fontFamily: tokens.fontUi,
          fontSize: tokens.fs(10),
          fontWeight: "700",
          textTransform: "uppercase",
          letterSpacing: 0.3,
        },
        noteText: {
          fontFamily: tokens.fontUi,
          fontSize: tokens.fs(12),
          lineHeight: tokens.fs(18),
          color: tokens.foreground,
        },
        more: {
          alignSelf: "flex-start",
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: radius.chip,
          backgroundColor: tokens.surface2,
        },
        moreText: {
          fontFamily: tokens.fontUi,
          fontSize: tokens.fs(11),
          fontWeight: "600",
          color: tokens.accent,
        },
      }),
    [tokens],
  );

  const total = data.noteCount > 0 ? data.noteCount : data.notes.length;

  return (
    <View style={styles.container}>
      {notes.map((note, index) => {
        const look = severityLook(note, tokens);
        return (
          <View
            key={`${index}-${note.text.slice(0, 16)}`}
            style={[styles.note, { borderLeftColor: look?.accent ?? tokens.borderSubtle }]}
          >
            {look || note.advisor ? (
              <View style={styles.badges}>
                {look ? (
                  <View
                    style={[
                      styles.chip,
                      { backgroundColor: look.tint, borderColor: look.border },
                      unselectable,
                    ]}
                  >
                    <Text style={[styles.chipText, { color: look.accent }]}>{look.label}</Text>
                  </View>
                ) : null}
                {note.advisor ? (
                  <View
                    style={[
                      styles.chip,
                      { backgroundColor: tokens.surface2, borderColor: tokens.borderSubtle },
                      unselectable,
                    ]}
                  >
                    <Glyph name="User" size={9} color={tokens.foregroundMuted} />
                    <Text style={[styles.chipText, { color: tokens.foregroundMuted }]}>
                      {note.advisor}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            <Text selectable style={styles.noteText}>
              {note.text}
            </Text>
          </View>
        );
      })}
      {clip.clipped || showAll ? (
        <Pressable style={styles.more} onPress={() => setShowAll((open) => !open)}>
          <Text style={styles.moreText}>
            {showAll ? "Show fewer" : `Show all ${total} ${total === 1 ? "note" : "notes"}`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
