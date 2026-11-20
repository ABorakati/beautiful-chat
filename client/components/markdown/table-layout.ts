/**
 * Pure table column layout for markdown tables.
 *
 * Columns keep their measured widths when they fit the card, share remaining
 * width via water-fill redistribution when they exceed it, and fall back to
 * horizontal scrolling once each column would become too narrow to read.
 */

/** The table container's right inset, counted when columns share the card width. */
export const TABLE_END_PADDING = 6;

/** Below this (at 1x textScale), a fitted column can no longer hold a readable word; scroll instead. */
export const MIN_FIT_COLUMN = 44;

export interface FittedColumns {
  widths: number[];
  scroll: boolean;
}

/**
 * Shrinks measured column widths to the card. Columns narrower than their fair
 * share keep their natural width; the rest split what remains, so one long
 * code cell cannot squeeze all the others to a glyph.
 *
 * Before `onLayout` reports a positive width (`availableWidth === null`), the
 * table keeps its natural widths with scrolling enabled so wide tables never
 * overflow the card on the first frame.
 */
export function fitColumnWidths(
  natural: readonly number[],
  availableWidth: number | null,
  gap: number,
  minColumnWidth = MIN_FIT_COLUMN,
): FittedColumns {
  const columns = natural.length;
  if (columns === 0) return { widths: [], scroll: false };
  if (availableWidth === null || !Number.isFinite(availableWidth)) {
    return { widths: natural.slice(), scroll: true };
  }

  const usable = availableWidth - TABLE_END_PADDING - gap * (columns - 1);
  if (usable <= 0) return { widths: natural.slice(), scroll: true };

  const total = natural.reduce((sum, width) => sum + width, 0);
  if (total <= usable) return { widths: natural.slice(), scroll: false };

  const effectiveMin =
    Number.isFinite(minColumnWidth) && minColumnWidth > 0 ? minColumnWidth : MIN_FIT_COLUMN;
  if (usable / columns < effectiveMin) return { widths: natural.slice(), scroll: true };

  const widths = natural.slice();
  const fixed = new Set<number>();
  const order = natural
    .map((_, index) => index)
    .sort((a, b) => (natural[a] ?? 0) - (natural[b] ?? 0));
  let remaining = usable;
  let remainingColumns = columns;

  for (const index of order) {
    const naturalWidth = natural[index] ?? 0;
    const fairShare = remaining / remainingColumns;
    if (naturalWidth <= fairShare) {
      widths[index] = naturalWidth;
      fixed.add(index);
      remaining -= naturalWidth;
      remainingColumns -= 1;
      continue;
    }
    const share = remaining / remainingColumns;
    for (const rest of order) {
      if (!fixed.has(rest)) widths[rest] = share;
    }
    break;
  }

  // Whole pixels keep the grid from spilling past the measured width.
  return { widths: widths.map((width) => Math.floor(width)), scroll: false };
}
