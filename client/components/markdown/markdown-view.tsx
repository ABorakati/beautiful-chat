import React, { useMemo } from "react";
import { View, Text, ScrollView, StyleSheet, Platform } from "react-native";
import type { StyleProp, TextProps, TextStyle, ViewStyle } from "react-native";
import { Glyph } from "../glyph";
import { radius, withAlpha, type ExtendedThemeTokens } from "../theme-tokens";
import { selectableSurface, unselectable } from "../selection";
import { selectionSurface } from "../selection-actions";
import { SyntaxHighlightBlock } from "../syntax-highlight";
import { isAllowedLink, openLink } from "../open-link";
import { pathTargetProps } from "../path-link-menu";
import {
  parseMarkdown,
  isFilePathToken,
  localPathFromHref,
  soleImageSources,
  type MdAlign, type MdBlock, type MdInline,
  type MdListItem,
} from "./parse";
import { MarkdownImage } from "./markdown-image";

/**
 * The assistant's own prose, drawn by the plugin instead of the host. Three
 * variants exist because one rhythm cannot serve both a one-line answer and a
 * ten-section report; the user picks the one that matches their thread.
 */
export type MarkdownVariant = "document" | "compact" | "terminal";

export const MARKDOWN_VARIANTS: readonly MarkdownVariant[] = ["document", "compact", "terminal"];

export interface MarkdownViewProps {
  text: string;
  tokens: ExtendedThemeTokens;
  variant: MarkdownVariant;
  /** A code block longer than this folds to a preview. Omitted or zero: never. */
  foldCodeAfter?: number;
  /** The agent's working directory, which a relative image path resolves against. */
  cwd?: string | null;
  /**
   * Renders ==text== as a marker highlight. Off keeps the equals signs as the
   * author typed them.
   */
  marks?: boolean;
  /**
   * Shows a local path the reply mentions in the file manager. Undefined
   * leaves every path as text. Opening a file goes through the path menu,
   * which asks first.
   */
  onRevealFile?: (path: string) => void;
}

type MdTableBlock = Extract<MdBlock, { kind: "table" }>;

interface VariantMetrics {
  bodySize: number;
  bodyLineHeight: number;
  /** Body text on the mono family, which also drives table column estimates. */
  mono: boolean;
  blockGap: number;
  headingSizes: readonly [number, number, number, number];
  headingGap: number;
  /** Draws a rule under h1 and h2. */
  headingRule: boolean;
  /** Prefixes headings with their own `#` run instead of relying on size. */
  headingHash: boolean;
  markerWidth: number;
  itemGap: number;
  indentStep: number;
  tableGap: number;
  columnMin: number;
  columnMax: number;
  glyphSize: number;
  codeCompact: boolean;
  codeLineNumbers: boolean;
}

const VARIANT_METRICS: Record<MarkdownVariant, VariantMetrics> = {
  // document: for a long answer read top to bottom. Wide leading and big ruled
  // headings buy scanability with vertical space, so a section can be found
  // without reading it.
  document: {
    bodySize: 13.5,
    bodyLineHeight: 22.5,
    mono: false,
    blockGap: 13,
    headingSizes: [23, 18.5, 15.5, 13],
    headingGap: 9,
    headingRule: true,
    headingHash: false,
    markerWidth: 20,
    itemGap: 6,
    indentStep: 18,
    tableGap: 18,
    columnMin: 60,
    columnMax: 320,
    glyphSize: 13,
    codeCompact: false,
    codeLineNumbers: false,
  },
  // compact: for a short reply in a crowded thread. Spacing is tight and
  // headings stay near body size, so a three-line answer reads as one bubble
  // rather than a document.
  compact: {
    bodySize: 13,
    bodyLineHeight: 19,
    mono: false,
    blockGap: 7,
    headingSizes: [16.5, 14.5, 13.5, 12],
    headingGap: 4,
    headingRule: false,
    headingHash: false,
    markerWidth: 15,
    itemGap: 2,
    indentStep: 13,
    tableGap: 12,
    columnMin: 48,
    columnMax: 240,
    glyphSize: 11,
    codeCompact: true,
    codeLineNumbers: false,
  },
  // terminal: for an answer that is mostly code. Body text joins the code on
  // the mono family at a tight line height, headings keep their literal `##`
  // marker, and fences carry line numbers so prose and code read as one log.
  terminal: {
    bodySize: 12.5,
    bodyLineHeight: 17.5,
    mono: true,
    blockGap: 9,
    headingSizes: [14.5, 13.5, 12.5, 12],
    headingGap: 7,
    headingRule: false,
    headingHash: true,
    markerWidth: 18,
    itemGap: 1,
    indentStep: 16,
    tableGap: 14,
    columnMin: 52,
    columnMax: 280,
    glyphSize: 11,
    codeCompact: false,
    codeLineNumbers: true,
  },
};

/**
 * The variant's metrics at the reader's sizes. A variant that sets its body in
 * the code face takes the code size, with its leading and headings scaled to
 * keep their proportions; the others follow the text size.
 */
function variantMetrics(
  variant: MarkdownVariant,
  codeFontSize: number,
  textScale: number,
): VariantMetrics {
  const base = VARIANT_METRICS[variant];
  // `codeFontSize` already carries the text size, so a code-face body scales
  // through it; any other body scales by the text size directly.
  const scale = base.mono ? codeFontSize / base.bodySize : textScale;
  if (scale === 1 && textScale === 1) return base;
  // Headings snap to half points, like the hand-set sizes they replace.
  const scaled = (size: number) => Math.round(size * scale * 2) / 2;
  const [size1, size2, size3, size4] = base.headingSizes;
  return {
    ...base,
    bodySize: base.mono ? codeFontSize : scaled(base.bodySize),
    bodyLineHeight: Math.round(base.bodyLineHeight * scale),
    headingSizes: [scaled(size1), scaled(size2), scaled(size3), scaled(size4)],
    // Spacing follows the text size: a larger body inside the authored gaps
    // reads cramped, and the column estimates derive from it too.
    blockGap: base.blockGap * textScale,
    headingGap: base.headingGap * textScale,
    markerWidth: base.markerWidth * textScale,
    itemGap: base.itemGap * textScale,
    indentStep: base.indentStep * textScale,
    tableGap: base.tableGap * textScale,
    columnMin: base.columnMin * textScale,
    columnMax: base.columnMax * textScale,
  };
}

// One marker per level, so a nested item is distinguishable from its parent
// even when the indent is clipped by a narrow card.
const BULLETS = ["\u2022", "\u25e6", "\u2023"] as const;
const HASH_LABELS = ["# ", "## ", "### ", "#### "] as const;
const HEADING_KEYS = ["h1", "h2", "h3", "h4"] as const;
const INDENT_KEYS = ["indent0", "indent1", "indent2", "indent3"] as const;
const ALIGN_KEYS: Record<MdAlign, "cellLeft" | "cellCenter" | "cellRight"> = {
  left: "cellLeft",
  center: "cellCenter",
  right: "cellRight",
};

// React Native offers no synchronous text measurement, so a column's width is
// estimated from its longest cell. These ratios are the average advance width
// of Inter and Iosevka as a fraction of the font size.
const CHAR_RATIO_UI = 0.55;
const CHAR_RATIO_MONO = 0.62;

// A marker sits in a fixed column, so its width has to carry the gutter the
// style adds; an estimate that forgets it wraps `2.` onto a second line.
const MARKER_GAP = 6;
// The inline-code chip's own horizontal padding, counted twice per chip when a
// table column is measured, and matched by the cell's padding so a chip never
// sits against the column edge.
const CODE_CHIP_PADDING = 4;
const TABLE_CELL_PADDING = 6;

/** Every style the renderer draws with, so callers never infer it from the builder. */
interface MarkdownStyles {
  root: ViewStyle;
  headingBlock: ViewStyle;
  headingBlockFirst: ViewStyle;
  h1: TextStyle;
  h2: TextStyle;
  h3: TextStyle;
  h4: TextStyle;
  headingHash: TextStyle;
  headingRule: ViewStyle;
  paragraph: TextStyle;
  plain: TextStyle;
  listBlock: ViewStyle;
  listRow: ViewStyle;
  indent0: ViewStyle;
  indent1: ViewStyle;
  indent2: ViewStyle;
  indent3: ViewStyle;
  markerBullet: TextStyle;
  markerOrdered: TextStyle;
  checkboxCell: ViewStyle;
  itemText: TextStyle;
  itemTextDone: TextStyle;
  itemBody: ViewStyle;
  itemRunDone: TextStyle;
  quote: ViewStyle;
  quoteText: TextStyle;
  codeBlock: ViewStyle;
  rule: ViewStyle;
  tableScroll: ViewStyle;
  tableContent: ViewStyle;
  tableHeaderRow: ViewStyle;
  tableRow: ViewStyle;
  tableHeaderCell: TextStyle;
  tableCell: TextStyle;
  cellLeft: TextStyle;
  cellCenter: TextStyle;
  cellRight: TextStyle;
  strong: TextStyle;
  emphasis: TextStyle;
  strike: TextStyle;
  mark: TextStyle;
  codeSpan: TextStyle;
  link: TextStyle;
  imageAlt: TextStyle;
  imageParagraph: ViewStyle;
}

interface RenderContext {
  styles: MarkdownStyles;
  tokens: ExtendedThemeTokens;
  metrics: VariantMetrics;
  foldCodeAfter: number;
  cwd: string | null;
  onRevealFile?: (path: string) => void;
}

export function MarkdownView({
  text,
  tokens,
  variant,
  foldCodeAfter = 0,
  cwd,
  marks = true,
  onRevealFile,
}: MarkdownViewProps) {
  const blocks = useMemo(() => parseMarkdown(text, { marks }), [text, marks]);
  const metrics = useMemo(
    () => variantMetrics(variant, tokens.codeFontSize, tokens.textScale),
    [variant, tokens.codeFontSize, tokens.textScale],
  );
  const styles = useMemo(() => buildStyles(tokens, metrics), [tokens, metrics]);
  const context = useMemo<RenderContext>(
    () => ({ styles, tokens, metrics, foldCodeAfter, cwd: cwd ?? null, onRevealFile }),
    [styles, tokens, metrics, foldCodeAfter, cwd, onRevealFile],
  );

  return (
    <View {...selectionSurface} style={styles.root}>
      {blocks.map((block, index) => renderBlock(block, `b${index}`, index === 0, context))}
    </View>
  );
}

function renderBlock(
  block: MdBlock,
  key: string,
  first: boolean,
  context: RenderContext,
): React.ReactNode {
  const { styles, tokens, metrics } = context;

  switch (block.kind) {
    case "heading": {
      const headingStyle = styles[HEADING_KEYS[block.level - 1] ?? "h4"];
      return (
        <View key={key} style={first ? styles.headingBlockFirst : styles.headingBlock}>
          <Text selectable style={headingStyle}>
            {metrics.headingHash ? (
              <Text style={styles.headingHash}>{HASH_LABELS[block.level - 1] ?? "# "}</Text>
            ) : null}
            {renderInline(block.spans, styles, key, context.onRevealFile)}
          </Text>
          {metrics.headingRule && block.level <= 2 ? <View style={styles.headingRule} /> : null}
        </View>
      );
    }

    case "paragraph":
      return renderParagraph(block.spans, key, context);

    case "list": {
      const numberWidth = orderedColumnWidth(block.items, metrics);
      return (
        <View key={key} style={styles.listBlock}>
          {block.items.map((item, index) =>
            renderItem(item, `${key}l${index}`, numberWidth, context),
          )}
        </View>
      );
    }

    case "quote":
      return (
        <View key={key} style={styles.quote}>
      {block.paragraphs.map((spans, index) =>
        splitImageRuns(spans, `${key}q${index}`, context, styles.quoteText) ?? (
        <Text key={`${key}q${index}`} selectable style={styles.quoteText}>
          {renderInline(spans, styles, `${key}q${index}`, context.onRevealFile)}
        </Text>
      ))}
        </View>
      );

    case "code":
      return (
        <View key={key} style={styles.codeBlock}>
          <SyntaxHighlightBlock
            code={block.code}
            // An empty info string is the author asking for no grammar, which
            // the daemon answers as plain text instead of guessing a language.
            language={block.language === "" ? "plaintext" : block.language}
            tokens={tokens}
            compact={metrics.codeCompact}
            showLineNumbers={metrics.codeLineNumbers}
            foldAfterLines={context.foldCodeAfter}
          />
        </View>
      );

    case "rule":
      return <View key={key} style={styles.rule} />;

    case "table":
      return renderTable(block, key, context);

    case "plain":
      return (
        <Text key={key} selectable style={styles.plain}>
          {block.text}
        </Text>
      );
  }
}

/**
 * A paragraph is one Text unless it holds an image. A picture cannot live in a
 * line box, so the runs around each image become their own Text and the image
 * stands between them as a block, which is also how the daemon writes one: a
 * reply that is nothing but `![Image](file:///...)`.
 */
function renderParagraph(spans: MdInline[], key: string, context: RenderContext): React.ReactNode {
  const { styles } = context;
  // A paragraph that is only a saved image's path, `file://` URL or link is
  // the picture an image tool made, so it draws like `![...](...)` would.
  const sole = soleImageSources(spans);
  const runs: MdInline[] =
    sole === null ? spans : sole.map((image) => ({ kind: "image", ...image }));
  const parts = splitImageRuns(runs, key, context, styles.paragraph);
  if (parts === null) {
    return (
      <Text key={key} selectable style={styles.paragraph}>
        {renderInline(spans, styles, key, context.onRevealFile)}
      </Text>
    );
  }

  return (
    <View key={key} style={styles.imageParagraph}>
      {parts}
    </View>
  );
}

/**
 * The runs around each image as their own Text, with the image as a block
 * between them. Null when the runs hold no image, so the caller keeps its one
 * Text. Paragraphs, list items and quotes draw pictures this way.
 */
function splitImageRuns(
  spans: MdInline[],
  key: string,
  context: RenderContext,
  textStyle: StyleProp<TextStyle>,
): React.ReactNode[] | null {
  const { styles, tokens, cwd } = context;
  if (!spans.some((span) => span.kind === "image")) return null;

  const parts: React.ReactNode[] = [];
  let run: MdInline[] = [];
  const flushRun = (): void => {
    // Whitespace between two images is layout, not prose.
    const prose = run.some((span) => span.kind !== "text" || span.text.trim() !== "");
    if (prose) {
      const runKey = `${key}p${parts.length}`;
      parts.push(
        <Text key={runKey} selectable style={textStyle}>
          {renderInline(run, styles, runKey, context.onRevealFile)}
        </Text>,
      );
    }
    run = [];
  };

  for (const span of spans) {
    if (span.kind !== "image") {
      run.push(span);
      continue;
    }
    flushRun();
    parts.push(
      <MarkdownImage
        key={`${key}p${parts.length}`}
        src={span.src}
        alt={span.alt}
        tokens={tokens}
        cwd={cwd}
      />,
    );
  }
  flushRun();
  return parts;
}

function renderItem(
  item: MdListItem,
  key: string,
  numberWidth: number,
  context: RenderContext,
): React.ReactNode {
  const { styles, tokens, metrics } = context;
  const depth = item.depth > 3 ? 3 : item.depth;
  const indentStyle = styles[INDENT_KEYS[depth] ?? "indent0"];
  // The body is the flexible column, so a wrapped second line starts under the
  // item's first character instead of under its marker. An item that holds an
  // image stacks its runs and pictures in that column instead.
  const runs = splitImageRuns(
    item.spans,
    key,
    context,
    item.checked === true ? [styles.paragraph, styles.itemRunDone] : styles.paragraph,
  );
  const body =
    runs === null ? (
      <Text selectable style={item.checked === true ? styles.itemTextDone : styles.itemText}>
        {renderInline(item.spans, styles, key, context.onRevealFile)}
      </Text>
    ) : (
      <View style={styles.itemBody}>{runs}</View>
    );

  if (item.checked !== undefined) {
    return (
      <View key={key} style={[styles.listRow, indentStyle]}>
        <View style={styles.checkboxCell}>
          <Glyph
            name={item.checked ? "CheckCircle" : "Circle"}
            size={metrics.glyphSize}
            color={item.checked ? tokens.success : tokens.foregroundSubtle}
          />
        </View>
        {body}
      </View>
    );
  }

  if (item.ordered) {
    return (
      <View key={key} style={[styles.listRow, indentStyle]}>
        <Text
          numberOfLines={1}
          style={[styles.markerOrdered, { width: numberWidth }]}
        >{`${item.index}.`}</Text>
        {body}
      </View>
    );
  }

  return (
    <View key={key} style={[styles.listRow, indentStyle]}>
      <Text numberOfLines={1} style={styles.markerBullet}>
        {BULLETS[depth % BULLETS.length] ?? BULLETS[0]}
      </Text>
      {body}
    </View>
  );
}

/**
 * A table keeps its own columns and scrolls sideways when the widest row beats
 * the card: clipping would hide the cell that carries the answer.
 */
function renderTable(block: MdTableBlock, key: string, context: RenderContext): React.ReactNode {
  const { styles, metrics } = context;
  const widths = columnWidths(block, metrics);

  return (
    <ScrollView
      key={key}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.tableScroll}
      contentContainerStyle={styles.tableContent}
    >
      <View>
        <View style={styles.tableHeaderRow}>
          {block.header.map((cell, column) => {
            const cellKey = `${key}h${column}`;
            return (
              <Text
                key={cellKey}
                selectable
                style={[
                  styles.tableHeaderCell,
                  styles[ALIGN_KEYS[block.align[column] ?? "left"]],
                  { width: widths[column] ?? metrics.columnMin },
                ]}
              >
                {renderInline(cell, styles, cellKey, context.onRevealFile)}
              </Text>
            );
          })}
        </View>
        {block.rows.map((row, rowIndex) => (
          <View key={`${key}r${rowIndex}`} style={styles.tableRow}>
            {row.map((cell, column) => {
              const cellKey = `${key}r${rowIndex}c${column}`;
              return (
                <Text
                  key={cellKey}
                  selectable
                  style={[
                    styles.tableCell,
                    styles[ALIGN_KEYS[block.align[column] ?? "left"]],
                    { width: widths[column] ?? metrics.columnMin },
                  ]}
                >
                  {renderInline(cell, styles, cellKey, context.onRevealFile)}
                </Text>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

/**
 * Marks a path for the web path menu (Copy Path, Show in File Manager, and an
 * Open that asks first), whether or not the path is absolute: the menu
 * resolves a relative one against the agent folder.
 */
function pathMarkProps(path: string): TextProps | null {
  return Platform.OS === "web" ? ({ dataSet: { bcpath: path } } as unknown as TextProps) : null;
}

function renderInline(
  spans: MdInline[],
  styles: MarkdownStyles,
  keyPrefix: string,
  onRevealFile?: (path: string) => void,
): React.ReactNode[] {
  return spans.map((span, index) => {
    const key = `${keyPrefix}i${index}`;
    switch (span.kind) {
      case "text":
        return span.text;
      case "codeSpan": {
        // The host draws an inline-code path as a link too, so a path the
        // author wrapped in backticks keeps the same affordance here.
        const codePath = onRevealFile ? isFilePathToken(span.text) : null;
        if (codePath !== null) {
          return (
            <Text
              key={key}
              selectable
              accessibilityRole="link"
              accessibilityLabel={`Show ${codePath} in the file manager`}
              onPress={() => onRevealFile?.(codePath)}
              style={[styles.codeSpan, styles.link]}
              {...pathMarkProps(codePath)}
            >
              {span.text}
            </Text>
          );
        }
        return (
          <Text key={key} selectable style={styles.codeSpan} {...pathTargetProps(span.text)}>
            {span.text}
          </Text>
        );
      }
      case "filePath":
        if (!onRevealFile) return span.path;
        return (
          <Text
            key={key}
            selectable
            accessibilityRole="link"
            accessibilityLabel={`Show ${span.path} in the file manager`}
            onPress={() => onRevealFile(span.path)}
            style={styles.link}
            {...pathMarkProps(span.path)}
          >
            {span.path}
          </Text>
        );
      case "strong":
        return (
          <Text key={key} selectable style={styles.strong}>
            {renderInline(span.spans, styles, key, onRevealFile)}
          </Text>
        );
      case "emphasis":
        return (
          <Text key={key} selectable style={styles.emphasis}>
            {renderInline(span.spans, styles, key, onRevealFile)}
          </Text>
        );
      case "strike":
        return (
          <Text key={key} selectable style={styles.strike}>
            {renderInline(span.spans, styles, key, onRevealFile)}
          </Text>
        );
      case "mark":
        return (
          <Text key={key} selectable style={styles.mark}>
            {renderInline(span.spans, styles, key, onRevealFile)}
          </Text>
        );
      case "image":
        // Inside a heading or a table cell there is no block to put a picture
        // in, so the alt text stands in for it, as plain markdown would read.
        // Paragraphs, list items and quotes draw them before reaching here.
        return (
          <Text key={key} selectable style={styles.imageAlt}>
            {span.alt === "" ? span.src : span.alt}
          </Text>
        );
      case "link": {
        // A Text keeps the link inside the paragraph's selection range.
        // Safe web anchors let Paseo offer Copy Link Address.
        // Other targets carry a path mark, not an href that can navigate.
        const web = Platform.OS === "web";
        const allowed = isAllowedLink(span.href);
        // A `file://` URL or a local path is never opened: a press shows it in
        // the file manager, as a path in prose does.
        const localPath = allowed ? null : localPathFromHref(span.href);
        return (
          <Text
            key={key}
            selectable
            accessibilityRole="link"
            {...(localPath !== null && onRevealFile
              ? { accessibilityLabel: `Show ${localPath} in the file manager` }
              : {})}
            {...(web && allowed ? ({ href: span.href } as object) : {})}
            {...(web && !allowed
              ? ({ dataSet: { bcpath: span.href } } as unknown as TextProps)
              : {})}
            onPress={(event) => {
              if (web) event.preventDefault();
              if (localPath !== null) {
                onRevealFile?.(localPath);
                return;
              }
              openLink(span.href);
            }}
            style={styles.link}
          >
            {renderInline(span.spans, styles, key, onRevealFile)}
          </Text>
        );
      }
    }
  });
}

/**
 * Numbers share one right edge, so `9.` and `10.` line up. The column holds the
 * whole marker — digits, dot and gutter — because a column sized to the digits
 * alone wraps the dot under the number and splits the item across two rows.
 */
function orderedColumnWidth(items: MdListItem[], metrics: VariantMetrics): number {
  let longest = 2;
  for (const item of items) {
    if (!item.ordered) continue;
    const length = `${item.index}.`.length;
    if (length > longest) longest = length;
  }
  const ratio = metrics.mono ? CHAR_RATIO_MONO : CHAR_RATIO_UI;
  // The ratio is an average advance, so a marker of wide digits needs the spare
  // point on top of it.
  const marker = Math.ceil(longest * metrics.bodySize * ratio) + 2;
  return Math.max(metrics.markerWidth, marker + MARKER_GAP);
}

/**
 * A chip is wider than the text it holds: the code face is wider than the UI
 * face and the chip carries padding of its own. Walking the runs keeps a cell
 * of inline code from being measured as though it were prose.
 */
function inlineWidth(spans: MdInline[], size: number, ratio: number): number {
  let width = 0;
  for (const span of spans) {
    switch (span.kind) {
      case "text":
        width += span.text.length * size * ratio;
        break;
      case "codeSpan":
        width += span.text.length * size * CHAR_RATIO_MONO + CODE_CHIP_PADDING * 2;
        break;
      case "image":
        width += span.alt.length * size * ratio;
        break;
      case "filePath":
        width += span.path.length * size * ratio;
        break;
      default:
        width += inlineWidth(span.spans, size, ratio);
        break;
    }
  }
  return width;
}

function columnWidths(block: MdTableBlock, metrics: VariantMetrics): number[] {
  const ratio = metrics.mono ? CHAR_RATIO_MONO : CHAR_RATIO_UI;
  const cellSize = metrics.bodySize - 1;
  const widths: number[] = [];

  for (let column = 0; column < block.header.length; column++) {
    // The header is bold, which the average advance does not cover, so it is
    // measured a shade wider than a body cell of the same length.
    let longest = inlineWidth(block.header[column] ?? [], cellSize, ratio) * 1.06;
    for (const row of block.rows) {
      const cell = row[column];
      if (cell === undefined) continue;
      const width = inlineWidth(cell, cellSize, ratio);
      if (width > longest) longest = width;
    }
    const estimate = Math.ceil(longest) + TABLE_CELL_PADDING * 2 + 2;
    widths.push(Math.min(metrics.columnMax, Math.max(metrics.columnMin, estimate)));
  }

  return widths;
}

function buildStyles(tokens: ExtendedThemeTokens, base: VariantMetrics): MarkdownStyles {
  const metrics = { ...base, bodyLineHeight: base.bodyLineHeight * tokens.leading };
  const bodyFont = metrics.mono ? tokens.fontMono : tokens.fontUi;
  const [size1, size2, size3, size4] = metrics.headingSizes;
  // The terminal variant's headings sit within a point of body size, so the
  // accent on h1 and the hash run carry the hierarchy that size cannot.
  const topColor = metrics.headingHash ? tokens.accent : tokens.foreground;

  return StyleSheet.create({
    root: {
      ...selectableSurface,
      width: "100%",
      gap: metrics.blockGap,
    },
    headingBlock: {
      marginTop: metrics.headingGap,
      gap: 4,
    },
    headingBlockFirst: {
      gap: 4,
    },
    h1: {
      fontFamily: bodyFont,
      fontSize: size1,
      lineHeight: size1 * 1.28,
      fontWeight: "700",
      letterSpacing: -0.3,
      color: topColor,
    },
    h2: {
      fontFamily: bodyFont,
      fontSize: size2,
      lineHeight: size2 * 1.3,
      fontWeight: "700",
      letterSpacing: -0.15,
      color: tokens.foreground,
    },
    h3: {
      fontFamily: bodyFont,
      fontSize: size3,
      lineHeight: size3 * 1.35,
      fontWeight: "600",
      color: tokens.foreground,
    },
    h4: {
      fontFamily: bodyFont,
      fontSize: size4,
      lineHeight: size4 * 1.4,
      fontWeight: "600",
      letterSpacing: 0.7,
      textTransform: "uppercase",
      color: tokens.foregroundMuted,
    },
    headingHash: {
      color: tokens.accent,
      fontWeight: "400",
      ...unselectable,
    },
    headingRule: {
      height: 1,
      backgroundColor: tokens.borderSubtle,
    },
    paragraph: {
      fontFamily: bodyFont,
      fontSize: metrics.bodySize,
      lineHeight: metrics.bodyLineHeight,
      color: tokens.foreground,
    },
    plain: {
      fontFamily: tokens.fontMono,
      fontSize: tokens.codeFontSize,
      lineHeight: tokens.codeLineHeight,
      color: tokens.foregroundMuted,
    },
    listBlock: {
      gap: metrics.itemGap,
    },
    listRow: {
      flexDirection: "row",
      alignItems: "flex-start",
    },
    indent0: { marginLeft: 0 },
    indent1: { marginLeft: metrics.indentStep },
    indent2: { marginLeft: metrics.indentStep * 2 },
    indent3: { marginLeft: metrics.indentStep * 3 },
    markerBullet: {
      width: metrics.markerWidth,
      flexShrink: 0,
      fontFamily: bodyFont,
      fontSize: metrics.bodySize,
      lineHeight: metrics.bodyLineHeight,
      color: tokens.foregroundMuted,
      ...unselectable,
    },
    markerOrdered: {
      flexShrink: 0,
      fontFamily: bodyFont,
      fontSize: metrics.bodySize,
      lineHeight: metrics.bodyLineHeight,
      textAlign: "right",
      paddingRight: MARKER_GAP,
      color: tokens.foregroundMuted,
      fontVariant: ["tabular-nums"],
      ...unselectable,
    },
    checkboxCell: {
      width: metrics.markerWidth,
      flexShrink: 0,
      // Centres the box on the first line of the item, not on the whole item.
      paddingTop: Math.max(0, (metrics.bodyLineHeight - metrics.glyphSize) / 2),
      ...unselectable,
    },
    itemText: {
      flex: 1,
      fontFamily: bodyFont,
      fontSize: metrics.bodySize,
      lineHeight: metrics.bodyLineHeight,
      color: tokens.foreground,
    },
    itemTextDone: {
      flex: 1,
      fontFamily: bodyFont,
      fontSize: metrics.bodySize,
      lineHeight: metrics.bodyLineHeight,
      color: tokens.foregroundMuted,
      textDecorationLine: "line-through",
    },
    // The column an item with a picture stacks in. `minWidth` lets the image
    // shrink to the card instead of pushing the row past it.
    itemBody: {
      flex: 1,
      minWidth: 0,
      gap: 8,
    },
    itemRunDone: {
      color: tokens.foregroundMuted,
      textDecorationLine: "line-through",
    },
    quote: {
      borderLeftWidth: 2,
      borderLeftColor: withAlpha(tokens.foregroundMuted, 0.5),
      paddingLeft: 10,
      gap: 5,
    },
    quoteText: {
      fontFamily: bodyFont,
      fontSize: metrics.bodySize,
      lineHeight: metrics.bodyLineHeight,
      fontStyle: "italic",
      color: tokens.foregroundMuted,
    },
    codeBlock: {
      marginVertical: 1,
    },
    rule: {
      height: 1,
      backgroundColor: tokens.border,
      marginVertical: 2,
    },
    tableScroll: {
      alignSelf: "stretch",
    },
    tableContent: {
      paddingRight: 6,
    },
    tableHeaderRow: {
      flexDirection: "row",
      gap: metrics.tableGap,
      paddingBottom: 5,
      marginBottom: 4,
      borderBottomWidth: 1,
      borderBottomColor: tokens.border,
    },
    tableRow: {
      flexDirection: "row",
      gap: metrics.tableGap,
      paddingVertical: 2,
    },
    tableHeaderCell: {
      fontFamily: bodyFont,
      fontSize: metrics.bodySize - 1,
      lineHeight: metrics.bodyLineHeight - 2,
      paddingHorizontal: TABLE_CELL_PADDING,
      fontWeight: "700",
      color: tokens.foreground,
    },
    tableCell: {
      fontFamily: bodyFont,
      fontSize: metrics.bodySize - 1,
      lineHeight: metrics.bodyLineHeight - 2,
      paddingHorizontal: TABLE_CELL_PADDING,
      color: tokens.foreground,
    },
    cellLeft: { textAlign: "left" },
    cellCenter: { textAlign: "center" },
    cellRight: { textAlign: "right" },
    strong: {
      fontWeight: "700",
      color: tokens.strongColor ?? tokens.foreground,
    },
    emphasis: {
      fontStyle: "italic",
    },
    strike: {
      textDecorationLine: "line-through",
      color: tokens.foregroundMuted,
    },
    // The wash comes from the mark colour preference; a mark is an author's
    // annotation rather than a state, so no theme token is spent on it.
    mark: {
      color: tokens.foreground,
      backgroundColor: tokens.markBackground,
      borderRadius: 3,
    },
    codeSpan: {
      fontFamily: tokens.fontMono,
      fontSize: tokens.codeFontSize,
      // A neutral tint, not the accent: inline code is not a link and must not
      // borrow the one colour that means "action" everywhere else in the card.
      backgroundColor: withAlpha(tokens.foreground, tokens.isDark ? 0.12 : 0.07),
      borderRadius: radius.chip,
      paddingHorizontal: CODE_CHIP_PADDING,
      color: tokens.foreground,
    },
    link: {
      color: tokens.accent,
      textDecorationLine: "underline",
    },
    imageAlt: {
      color: tokens.foregroundMuted,
      fontStyle: "italic",
    },
    imageParagraph: {
      gap: 8,
    },
  });
}
