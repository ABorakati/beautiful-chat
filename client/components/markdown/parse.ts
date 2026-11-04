/**
 * Markdown, small enough to own. The plugin sandbox admits `react`,
 * `react-native`, `zod` and `@getpaseo/plugin*` only, so a markdown library is
 * not available at any price: this module turns the subset an assistant
 * actually writes into a block tree the renderer walks.
 *
 * Two rules govern every branch below. A malformed document must not throw,
 * and it must not lose a character: anything the grammar does not recognise
 * survives as text, and a construct that starts but never finishes degrades to
 * a `plain` block holding its own source verbatim.
 *
 * Pure module: no React, no runtime imports.
 */

/** One inline run. `text` is the only leaf; every other kind carries runs. */
export type MdInline =
  | { kind: "text"; text: string }
  | { kind: "codeSpan"; text: string }
  | { kind: "strong"; spans: MdInline[] }
  | { kind: "emphasis"; spans: MdInline[] }
  | { kind: "strike"; spans: MdInline[] }
  | { kind: "mark"; spans: MdInline[] }
  | { kind: "link"; href: string; spans: MdInline[] }
  /** `![alt](src)`. The renderer decides whether `src` is something it can draw. */
  | { kind: "image"; src: string; alt: string }
  /** A local path the reply mentions, which the client can offer to show. */
  | { kind: "filePath"; path: string };

/** One table cell, already reduced to inline runs. */
export type MdCell = MdInline[];

export type MdAlign = "left" | "center" | "right";

/** Deeper hashes clamp to 4: a chat bubble has no room for six tiers. */
export type MdHeadingLevel = 1 | 2 | 3 | 4;

export interface MdListItem {
  spans: MdInline[];
  /** 0 for a top-level item, one step per indent level the author opened. */
  depth: number;
  /** Per item, not per list: `1.` nested under `-` keeps its own kind. */
  ordered: boolean;
  /** The number the author typed, so a list starting at `3.` still says 3. */
  index: number;
  /** Set only by `- [ ]` / `- [x]`; an ordinary bullet leaves it undefined. */
  checked?: boolean;
}

export type MdBlock =
  | { kind: "heading"; level: MdHeadingLevel; spans: MdInline[] }
  | { kind: "paragraph"; spans: MdInline[] }
  | { kind: "list"; ordered: boolean; items: MdListItem[] }
  | { kind: "quote"; paragraphs: MdInline[][] }
  | { kind: "code"; code: string; language: string }
  | { kind: "rule" }
  | { kind: "table"; header: MdCell[]; rows: MdCell[][]; align: MdAlign[] }
  /** The degraded case: source that opened a construct it never closed. */
  | { kind: "plain"; text: string };

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*(\S*)/;
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*)$/;
// Three or more of one marker, nothing else. Checked before the bullet rule,
// which `- - -` would otherwise claim as a list item.
const RULE_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE_RE = /^ {0,3}>[ \t]?(.*)$/;
const BULLET_RE = /^([ \t]*)([-*+])[ \t]+(.*)$/;
const ORDERED_RE = /^([ \t]*)(\d{1,9})[.)][ \t]+(.*)$/;
const TASK_RE = /^\[([ xX])\][ \t]*(.*)$/;
const DELIMITER_CELL_RE = /^:?-+:?$/;
const WORD_RE = /[\w\u00c0-\uffff]/;
const TRAILING_SPACE_RE = /[ \t]+$/;
// ASCII punctuation is exactly what a backslash may escape in markdown.
const ESCAPABLE_RE = /[!-\/:-@\[-`{-~]/;
// Sticky, so a candidate is tested in place instead of slicing the line.
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>()[\]]+/y;
// A bare `file://` URL, which an image tool often prints in place of markdown.
// It becomes a link the renderer shows in the file manager, never one it opens.
const FILE_URL_RE = /file:\/\/[^\s<>()[\]]+/iy;
// The types the chat can draw: the list `IMAGE_EXTENSIONS` in
// `client/image-file.ts` and the daemon's `IMAGE_MIMES` hold. This module stays
// pure, so it keeps its own copy.
const IMAGE_FILE_RE = /\.(?:png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i;

// A path candidate: a Windows drive, a home prefix, a rooted slash, or a
// relative run of segments, followed by a body that excludes the characters
// prose wraps paths in — half- and full-width both, so a CJK sentence stops
// the token where it starts. Validation is `isFilePathToken`'s job; this only
// carves the candidate out of the line.
const PATH_TOKEN_RE =
  /(?:[A-Za-z]:[\\/]|~\/|(?:[\w.@-]+\/)+|\/)[^\s<>()[\]{}"'`|*?,;，。；：！？（）【】]*/y;

/** Emphasis inside emphasis is rare and cheap to bound; deeper text stays flat. */
const MAX_INLINE_DEPTH = 4;

// Fullwidth and CJK punctuation reads as a break even though the code points
// sit inside the wide range `WORD_RE` calls word characters: a URL or a path
// after "：" or "）" starts a new token, exactly as it would after ":" or ")".
const WIDE_BREAK_RE = /[\u3000-\u303f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]/;

/** Two spaces, or a trailing backslash, are the author asking for a new line. */
const HARD_BREAK_RE = /(?: {2,}|\\)$/;

export function parseMarkdown(text: string, options?: { marks?: boolean }): MdBlock[] {
  const marks = options?.marks !== false;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      index++;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence !== null) {
      index = readFence(lines, index, fence, blocks);
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading !== null) {
      const hashes = (heading[1] ?? "#").length;
      const level = (hashes > 4 ? 4 : hashes) as MdHeadingLevel;
      const title = (heading[2] ?? "").replace(TRAILING_SPACE_RE, "");
      blocks.push({ kind: "heading", level, spans: parseInline(title, 0, marks) });
      index++;
      continue;
    }

    if (RULE_RE.test(line)) {
      blocks.push({ kind: "rule" });
      index++;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      index = readQuote(lines, index, blocks, marks);
      continue;
    }

    if (BULLET_RE.test(line) || ORDERED_RE.test(line)) {
      index = readList(lines, index, blocks, marks);
      continue;
    }

    if (isTableStart(lines, index)) {
      index = readTable(lines, index, blocks, marks);
      continue;
    }

    index = readParagraph(lines, index, blocks, marks);
  }

  return blocks;
}

/** True when the line at `index` opens a block, so a paragraph must stop short of it. */
function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  if (line.trim() === "") return true;
  if (FENCE_RE.test(line)) return true;
  if (HEADING_RE.test(line)) return true;
  if (RULE_RE.test(line)) return true;
  if (QUOTE_RE.test(line)) return true;
  if (BULLET_RE.test(line)) return true;
  if (ORDERED_RE.test(line)) return true;
  return isTableStart(lines, index);
}

/**
 * A fence owns every line up to its closing run of the same character. An
 * unterminated fence is the normal shape of a streaming answer's tail, and it
 * degrades to `plain` carrying its own source — including the opening fence, so
 * nothing the author typed disappears while the rest of the block arrives.
 */
function readFence(lines: string[], start: number, match: RegExpExecArray, out: MdBlock[]): number {
  const marker = match[1] ?? "```";
  const language = (match[2] ?? "").trim();
  const closeRe = marker.startsWith("~") ? /^~+[ \t]*$/ : /^`+[ \t]*$/;
  const body: string[] = [];
  let index = start + 1;
  let closed = false;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (trimmed.length >= marker.length && closeRe.test(trimmed)) {
      closed = true;
      index++;
      break;
    }
    body.push(line);
    index++;
  }

  if (!closed) {
    out.push({ kind: "plain", text: [lines[start] ?? "", ...body].join("\n") });
    return lines.length;
  }

  out.push({ kind: "code", code: body.join("\n"), language });
  return index;
}

/**
 * Consecutive `>` lines only. A lazy continuation — prose under a quote with no
 * marker of its own — reads as the next paragraph instead, which is what an
 * assistant that forgot the marker actually meant.
 */
function readQuote(
  lines: string[],
  start: number,
  out: MdBlock[],
  marks: boolean,
): number {
  const collected: string[] = [];
  let index = start;

  while (index < lines.length) {
    const match = QUOTE_RE.exec(lines[index] ?? "");
    if (match === null) break;
    // Nesting flattens: `>> deeper` joins the one level this renderer draws.
    let content = match[1] ?? "";
    let inner = QUOTE_RE.exec(content);
    while (inner !== null) {
      content = inner[1] ?? "";
      inner = QUOTE_RE.exec(content);
    }
    collected.push(content);
    index++;
  }

  const paragraphs: MdInline[][] = [];
  let run: string[] = [];
  for (const line of collected) {
    if (line.trim() === "") {
      if (run.length > 0) paragraphs.push(parseInline(joinSoft(run), 0, marks));
      run = [];
      continue;
    }
    run.push(line);
  }
  if (run.length > 0) paragraphs.push(parseInline(joinSoft(run), 0, marks));

  out.push({ kind: "quote", paragraphs });
  return index === start ? start + 1 : index;
}

interface RawItem {
  text: string;
  depth: number;
  ordered: boolean;
  index: number;
  checked?: boolean;
}

/**
 * One list block per run of markers. A top-level marker that switches kind —
 * bullet to number, or plain bullet to checkbox — starts a new block, because
 * those are three different things on screen even when no blank line separates
 * them.
 */
function readList(lines: string[], start: number, out: MdBlock[], marks: boolean): number {
  const items: RawItem[] = [];
  // Each entry is the indent column of one open level, so nesting follows what
  // the author actually typed instead of assuming two spaces per level.
  const indents: number[] = [];
  let index = start;
  let blankSeen = false;
  let blockOrdered: boolean | null = null;
  let blockTask: boolean | null = null;

  while (index < lines.length) {
    const raw = lines[index] ?? "";

    if (raw.trim() === "") {
      blankSeen = true;
      index++;
      continue;
    }

    // A rule, a heading or a fence ends the list rather than being swallowed as
    // item text: losing a code block inside a bullet is worse than ending early.
    if (RULE_RE.test(raw) || HEADING_RE.test(raw) || FENCE_RE.test(raw)) break;

    const bullet = BULLET_RE.exec(raw);
    const ordered = bullet === null ? ORDERED_RE.exec(raw) : null;
    const marker = bullet ?? ordered;

    if (marker !== null) {
      const depth = depthFor(indents, indentWidth(marker[1] ?? ""));
      const body = marker[3] ?? "";
      const task = bullet === null ? null : TASK_RE.exec(body);
      const isOrdered = bullet === null;
      const isTask = task !== null;

      if (depth === 0) {
        if (blockOrdered !== null && (blockOrdered !== isOrdered || blockTask !== isTask)) break;
        blockOrdered = isOrdered;
        blockTask = isTask;
      } else if (blockOrdered === null) {
        blockOrdered = isOrdered;
        blockTask = isTask;
      }

      const item: RawItem = {
        text: task === null ? body : (task[2] ?? ""),
        depth,
        ordered: isOrdered,
        index: isOrdered ? Number(marker[2] ?? "1") : items.length + 1,
      };
      if (task !== null) item.checked = (task[1] ?? " ").toLowerCase() === "x";
      items.push(item);
      blankSeen = false;
      index++;
      continue;
    }

    const previous = items[items.length - 1];
    if (previous === undefined) break;
    // After a blank line only indented prose still belongs to the item; flush
    // left text is the paragraph that follows the list.
    if (blankSeen && indentWidth(raw) < 2) break;
    if (blankSeen && startsBlock(lines, index)) break;
    previous.text = `${previous.text} ${raw.trim()}`;
    blankSeen = false;
    index++;
  }

  if (items.length === 0) return start + 1;

  // A marker with no body is not a row. `- ` is legal markdown, and a bare
  // marker is the ordinary tail of a streaming answer, so dropping it keeps a
  // stray bullet out of the card instead of drawing a marker beside nothing.
  const parsed: MdListItem[] = [];
  for (const item of items) {
    const spans = parseInline(item.text.trim(), 0, marks);
    if (spans.length === 0) continue;
    const entry: MdListItem = {
      spans,
      depth: item.depth,
      ordered: item.ordered,
      index: item.index,
    };
    if (item.checked !== undefined) entry.checked = item.checked;
    parsed.push(entry);
  }
  if (parsed.length === 0) return index;

  out.push({ kind: "list", ordered: blockOrdered ?? false, items: parsed });
  return index;
}

/** Resolves an indent column against the open levels, opening one when it grows. */
function depthFor(indents: number[], indent: number): number {
  while (indents.length > 1) {
    const top = indents[indents.length - 1] ?? 0;
    if (indent >= top) break;
    indents.pop();
  }
  const top = indents[indents.length - 1];
  if (top === undefined) {
    indents.push(indent);
    return 0;
  }
  // Two columns is the smallest deliberate nest; one is a stray space.
  if (indent >= top + 2) {
    indents.push(indent);
    return indents.length - 1;
  }
  return indents.length - 1;
}

function indentWidth(prefix: string): number {
  let width = 0;
  for (let i = 0; i < prefix.length; i++) {
    const ch = prefix[i];
    if (ch === "\t") width += 4;
    else if (ch === " ") width += 1;
    else break;
  }
  return width;
}

/**
 * A table needs a pipe in both the header and the delimiter. Requiring the
 * delimiter's pipe keeps prose that happens to contain a `|` above a `---` rule
 * from being read as a one-column table.
 */
function isTableStart(lines: string[], index: number): boolean {
  const header = lines[index] ?? "";
  if (!header.includes("|")) return false;
  const delimiter = lines[index + 1];
  if (delimiter === undefined || !delimiter.includes("|")) return false;
  return parseDelimiter(delimiter) !== null;
}

function readTable(lines: string[], start: number, out: MdBlock[], marks: boolean): number {
  let end = start;
  while (end < lines.length) {
    const line = lines[end] ?? "";
    if (line.trim() === "" || !line.includes("|")) break;
    end++;
  }

  const headerCells = splitCells(lines[start] ?? "");
  const align = parseDelimiter(lines[start + 1] ?? "");
  // A header and a delimiter that disagree on width is not a table anyone can
  // read; the run keeps its pipes as plain text instead of being reshaped.
  if (align === null || headerCells.length === 0 || align.length !== headerCells.length) {
    out.push({ kind: "plain", text: lines.slice(start, end).join("\n") });
    return end === start ? start + 1 : end;
  }

  const width = headerCells.length;
  const rows: MdCell[][] = [];
  for (let index = start + 2; index < end; index++) {
    const cells = splitCells(lines[index] ?? "");
    const row: MdCell[] = [];
    for (let column = 0; column < width; column++) {
      row.push(parseInline((cells[column] ?? "").trim(), 0, marks));
    }
    // A row wider than its header keeps the overflow in the last column: a
    // half-written streaming row must not delete text it already carries.
    if (cells.length > width) {
      const last = row[width - 1];
      const overflow = cells.slice(width).join(" ").trim();
      if (last !== undefined && overflow !== "") {
        last.push({ kind: "text", text: ` ${overflow}` });
      }
    }
    rows.push(row);
  }

  out.push({
    kind: "table",
    header: headerCells.map((cell) => parseInline(cell.trim(), 0, marks)),
    rows,
    align,
  });
  return end;
}

function parseDelimiter(line: string): MdAlign[] | null {
  const cells = splitCells(line);
  if (cells.length === 0) return null;
  const align: MdAlign[] = [];
  for (const cell of cells) {
    const text = cell.trim();
    if (!DELIMITER_CELL_RE.test(text)) return null;
    const left = text.startsWith(":");
    const right = text.endsWith(":");
    align.push(left && right ? "center" : right ? "right" : "left");
  }
  return align;
}

/** Splits on unescaped pipes. Outer pipes are optional, as they are in the wild. */
function splitCells(line: string): string[] {
  const body = line.trim();
  const cells: string[] = [];
  let buffer = "";
  let index = body.startsWith("|") ? 1 : 0;

  for (; index < body.length; index++) {
    const ch = body[index];
    if (ch === "\\" && body[index + 1] === "|") {
      buffer += "|";
      index++;
      continue;
    }
    if (ch === "|") {
      cells.push(buffer);
      buffer = "";
      continue;
    }
    buffer += ch ?? "";
  }
  if (buffer.trim() !== "" || cells.length === 0) cells.push(buffer);
  return cells;
}

function readParagraph(lines: string[], start: number, out: MdBlock[], marks: boolean): number {
  const collected: string[] = [];
  let index = start;

  while (index < lines.length) {
    if (index > start && startsBlock(lines, index)) break;
    const raw = lines[index] ?? "";
    if (raw.trim() === "") break;
    collected.push(raw);
    index++;
  }

  if (collected.length === 0) return start + 1;
  out.push({ kind: "paragraph", spans: parseInline(joinSoft(collected), 0, marks) });
  return index;
}

/**
 * Markdown's soft break is a space, so hard-wrapped prose reflows to the card's
 * width instead of keeping the author's column. Only an explicit two-space or
 * backslash ending survives as a real line break.
 */
function joinSoft(lines: string[]): string {
  let out = "";
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const hard = HARD_BREAK_RE.test(line);
    out += line.replace(TRAILING_SPACE_RE, "").replace(/\\$/, "");
    if (index < lines.length - 1) out += hard ? "\n" : " ";
  }
  return out;
}

function isWordChar(ch: string): boolean {
  return ch !== "" && WORD_RE.test(ch);
}

/**
 * Inline runs. Every marker that fails to close is written back as the literal
 * characters the author typed, so `2 * 3 * 4` and a stray `**` read as prose
 * rather than vanishing into an unfinished span.
 */
function parseInline(src: string, depth = 0, marks = true): MdInline[] {
  if (src === "") return [];
  if (depth >= MAX_INLINE_DEPTH) return [{ kind: "text", text: src }];

  const out: MdInline[] = [];
  let buffer = "";
  let index = 0;

  const flush = (): void => {
    if (buffer !== "") {
      out.push({ kind: "text", text: buffer });
      buffer = "";
    }
  };

  while (index < src.length) {
    const ch = src[index] ?? "";

    if (ch === "\\") {
      const next = src[index + 1] ?? "";
      if (ESCAPABLE_RE.test(next)) {
        buffer += next;
        index += 2;
        continue;
      }
    }

    if (ch === "`") {
      let run = 1;
      while (src[index + run] === "`") run++;
      const close = src.indexOf("`".repeat(run), index + run);
      if (close > -1) {
        flush();
        let text = src.slice(index + run, close);
        // One padding space each side is the escape for code that starts or
        // ends with a backtick; it is not part of the code.
        if (text.length > 2 && text.startsWith(" ") && text.endsWith(" ")) {
          text = text.slice(1, -1);
        }
        out.push({ kind: "codeSpan", text });
        index = close + run;
        continue;
      }
    }

    // `***both***` is bold and italic at once. It is tested before the `**`
    // branch, which would close on the third star and leave a stray marker.
    if (ch === "*" && src[index + 1] === "*" && src[index + 2] === "*") {
      const close = src.indexOf("***", index + 3);
      if (close > index + 3) {
        flush();
        out.push({
          kind: "strong",
          spans: [{ kind: "emphasis", spans: parseInline(src.slice(index + 3, close), depth + 2, marks) }],
        });
        index = close + 3;
        continue;
      }
    }
    if ((ch === "*" || ch === "~") && src[index + 1] === ch) {
      const close = src.indexOf(ch + ch, index + 2);
      if (close > index + 2) {
        flush();
        out.push({
          kind: ch === "*" ? "strong" : "strike",
          spans: parseInline(src.slice(index + 2, close), depth + 1, marks),
        });
        index = close + 2;
        continue;
      }
    }

    if (ch === "*" || ch === "_") {
      const close = findEmphasisClose(src, index, ch);
      if (close > index + 1) {
        flush();
        out.push({ kind: "emphasis", spans: parseInline(src.slice(index + 1, close), depth + 1, marks) });
        index = close + 1;
        continue;
      }
    }

    // `==mark==`, the highlighter convention markdown-it-mark established.
    // Both edges must touch content, so a comparison written in prose —
    // "if a == b" — keeps its equals signs instead of highlighting " b".
    if (marks && ch === "=" && src[index + 1] === "=") {
      const close = src.indexOf("==", index + 2);
      if (
        close > index + 2 &&
        (src[index + 2] ?? " ").trim() !== "" &&
        (src[close - 1] ?? " ").trim() !== ""
      ) {
        flush();
        out.push({
          kind: "mark",
          spans: parseInline(src.slice(index + 2, close), depth + 1, marks),
        });
        index = close + 2;
        continue;
      }
    }

    if (ch === "[" || (ch === "!" && src[index + 1] === "[")) {
      const open = ch === "!" ? index + 1 : index;
      const labelEnd = matchBracket(src, open, "[", "]");
      if (labelEnd > -1 && src[labelEnd + 1] === "(") {
        const hrefEnd = matchBracket(src, labelEnd + 1, "(", ")");
        if (hrefEnd > -1) {
          const href = cleanHref(src.slice(labelEnd + 2, hrefEnd));
          const label = src.slice(open + 1, labelEnd);
          flush();
          if (ch === "!") {
            // An image is a leaf: the alt text is prose for a reader who cannot
            // see the picture, never a run of further markup.
            out.push({ kind: "image", src: unescapeMarkdown(href), alt: unescapeMarkdown(label) });
          } else {
            out.push({
              kind: "link",
              href,
              spans:
                label === "" ? [{ kind: "text", text: href }] : parseInline(label, depth + 1, marks),
            });
          }
          index = hrefEnd + 1;
          continue;
        }
      }
    }

    if (
      (ch === "f" || ch === "F") &&
      (!isWordChar(src[index - 1] ?? "") || WIDE_BREAK_RE.test(src[index - 1] ?? ""))
    ) {
      FILE_URL_RE.lastIndex = index;
      const match = FILE_URL_RE.exec(src);
      // Trailing sentence punctuation belongs to the prose, as for a web URL.
      const url = match === null ? "" : (match[0] ?? "").replace(/[.,;:!?'"，。；：！？）】』」]+$/, "");
      if (url.length > "file://".length) {
        flush();
        out.push({ kind: "link", href: url, spans: [{ kind: "text", text: url }] });
        index += url.length;
        continue;
      }
    }

    if (
      (ch === "h" || ch === "w") &&
      (!isWordChar(src[index - 1] ?? "") || WIDE_BREAK_RE.test(src[index - 1] ?? ""))
    ) {
      URL_RE.lastIndex = index;
      const match = URL_RE.exec(src);
      if (match !== null) {
        // Sentence punctuation that trails a bare URL belongs to the prose,
        // half- and full-width both.
        const url = (match[0] ?? "").replace(/[.,;:!?'"]*[，。；：！？）】』」]+$/, "");
        if (url !== "") {
          flush();
          out.push({
            kind: "link",
            href: url.startsWith("www.") ? `https://${url}` : url,
            spans: [{ kind: "text", text: url }],
          });
          index += url.length;
          continue;
        }
      }
    }

    // A local path only ever starts at a break: after a space, punctuation or
    // the string's own edge. Mid-word slashes — "and/or" — never trigger.
    if (
      (ch === "/" || ch === "~" || WORD_RE.test(ch)) &&
      (!isWordChar(src[index - 1] ?? "") || WIDE_BREAK_RE.test(src[index - 1] ?? ""))
    ) {
      PATH_TOKEN_RE.lastIndex = index;
      const match = PATH_TOKEN_RE.exec(src);
      const candidate = match === null ? "" : (match[0] ?? "");
      const filePath = candidate === "" ? null : isFilePathToken(candidate);
      if (filePath !== null) {
        flush();
        out.push({ kind: "filePath", path: filePath });
        index += filePath.length;
        continue;
      }
    }

    buffer += ch;
    index++;
  }

  flush();
  return out;
}

/**
 * A single `*` or `_` closes on the next lone marker that does not sit against
 * whitespace. `_` additionally needs word boundaries on both ends, so
 * `snake_case_name` stays one word instead of turning half of it italic.
 */
function findEmphasisClose(src: string, open: number, marker: string): number {
  if ((src[open + 1] ?? " ").trim() === "") return -1;
  if (marker === "_" && isWordChar(src[open - 1] ?? "")) return -1;

  for (let index = open + 1; index < src.length; index++) {
    const ch = src[index];
    if (ch === "\\") {
      index++;
      continue;
    }
    if (ch !== marker) continue;
    if (src[index + 1] === marker) {
      index++;
      continue;
    }
    if ((src[index - 1] ?? " ").trim() === "") continue;
    if (marker === "_" && isWordChar(src[index + 1] ?? "")) continue;
    return index;
  }
  return -1;
}

/** Index of the delimiter closing the one at `start`, or -1 when it never closes. */
function matchBracket(src: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let index = start; index < src.length; index++) {
    const ch = src[index];
    if (ch === "\\") {
      index++;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function cleanHref(raw: string): string {
  const href = raw.trim();
  // `(<path with spaces.png>)` is markdown's own way to keep a space, so the
  // brackets come off before the title rule below can split on it.
  const angled = /^<([^<>\n]*)>(?:\s|$)/.exec(href);
  if (angled !== null) return angled[1] ?? "";
  // A link title follows the target after whitespace: `(url "title")`. Any
  // other space is part of the target: a model writes a local path with spaces
  // as it stands, and cutting it at the first space finds no file.
  const titled = /^(.+?)\s+(?:"[^"]*"|'[^']*'|\([^)]*\))$/.exec(href);
  if (titled !== null) return titled[1] ?? "";
  return href;
}

/**
 * Drops the backslashes an author (or the daemon, for a provider image) put in
 * front of `)`, `]` and `\\` so they would survive the bracket matcher.
 */
function unescapeMarkdown(raw: string): string {
  return raw.replace(/\\([\\\]\)])/g, "$1");
}

/**
 * Whether a token reads as a local path a daemon could resolve, and the
 * cleaned path when it does.
 *
 * The bar is deliberately high: an absolute shape (drive, home, or a leading
 * slash) is accepted on its own, but a relative token must also end in a file
 * extension, so "and/or" and a date like "2024/01" stay prose. Trailing
 * sentence punctuation is not part of the path; a `:55` line selector is,
 * and the daemon strips it when it resolves.
 */
export function isFilePathToken(raw: string): string | null {
  const token = raw.trim().replace(/[.,;:!?'"]+$/, "");
  if (token.length < 3) return null;
  if (token.includes("://")) return null;
  if (/[<>()[\]{}"'`|*?,;，。；：！？（）【】\s]/.test(token)) return null;

  const windows = /^[A-Za-z]:[\\/]/.test(token);
  const rooted = token.startsWith("/") || token.startsWith("~/") || token.startsWith("~\\");
  const rest = windows ? token.slice(2) : token;
  if (!/[\\/]/.test(rest)) return null;
  // The extension check ignores a trailing `:55` or `:55:3` line selector.
  const bare = token.replace(/:\d+(?::\d+)?$/, "");
  if (!windows && !rooted && !/\.[A-Za-z0-9]{1,8}$/.test(bare)) return null;
  return token;
}

/**
 * The local path a `file://` URL names, or null. Parsed by hand, not with
 * `URL`, because React Native's `URL` does not implement `pathname`. A host
 * other than `localhost` is a UNC share.
 */
export function fileUrlToPath(href: string): string | null {
  const match = /^file:\/\/([^/?#]*)([^?#]*)/i.exec(href.trim());
  if (match === null) return null;
  let path: string;
  try {
    path = decodeURIComponent(match[2] || "/");
  } catch {
    // A stray `%` that is not an escape: keep the raw path, and let the
    // daemon report that it cannot find it.
    path = match[2] || "/";
  }
  if (path === "/") return null;
  const host = match[1] ?? "";
  if (host && host.toLowerCase() !== "localhost") return `//${host}${path}`;
  // `file:///C:/x` carries a leading slash that is not part of the path.
  return /^\/[a-zA-Z]:[\\/]/.test(path) ? path.slice(1) : path;
}

const SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

/**
 * The local path a markdown link or image points at, or null when the target
 * is a web URL, a heading anchor or any other scheme. `file://` URLs, absolute,
 * home and relative paths count; `javascript:`, `data:`, `sandbox:` and the
 * like never do, so a press on them stays with `openLink`, which drops them.
 * A `#L12` selector is kept for the daemon to strip; any other fragment is a
 * heading, not a file.
 */
export function localPathFromHref(href: string): string | null {
  const target = href.trim();
  if (/^file:/i.test(target)) return fileUrlToPath(target);
  // A Windows drive reads like a one-letter scheme, so test it first.
  const drive = /^[a-zA-Z]:[\\/]/.test(target);
  if (!drive && SCHEME.test(target)) return null;
  // `//host/x` is a scheme-relative web URL in markdown.
  if (target === "" || /^[#?]/.test(target) || target.startsWith("//")) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f<>]/.test(target)) return null;
  const hash = target.indexOf("#");
  let path = hash >= 0 && !/#L\d+(?:-L?\d+)?$/.test(target) ? target.slice(0, hash) : target;
  path = path.replace(/\?.*$/, "");
  try {
    path = decodeURI(path);
  } catch {
    // A stray `%` is part of the name.
  }
  if (path === "") return null;
  // A bare word ("notes") is a heading or a page name, not a file: a relative
  // target needs a folder or an extension. A `:12` selector is not one.
  const rooted = drive || /^(?:[\\/]|~[\\/])/.test(path);
  if (!rooted && !/[\\/]/.test(path) && !/\.[A-Za-z0-9]{1,8}$/.test(path.replace(/:\d+(?::\d+)?$/, ""))) {
    return null;
  }
  return path;
}

/**
 * The picture a run names on its own, or null when it names none. An image is
 * its own source; a local path or a link to a local file counts when the file
 * is a type the chat can draw. Web links stay links: a page is not a picture,
 * even when its address ends in `.png`.
 */
export function localImageSource(span: MdInline): { src: string; alt: string } | null {
  if (span.kind === "image") return { src: span.src, alt: span.alt };
  if (span.kind === "filePath") {
    const bare = span.path.replace(/:\d+(?::\d+)?$/, "");
    return IMAGE_FILE_RE.test(bare) ? { src: span.path, alt: "" } : null;
  }
  if (span.kind === "link") {
    const path = localPathFromHref(span.href);
    if (path === null || !IMAGE_FILE_RE.test(path)) return null;
    // A label that only repeats the target says nothing; the card then names
    // the file instead.
    const label = inlineToText(span.spans).trim();
    return { src: span.href, alt: label === span.href || label === path ? "" : label };
  }
  return null;
}

/**
 * A paragraph that holds nothing but pictures, as the images to draw, or null
 * when it holds prose too.
 *
 * An image tool does not always write `![...](...)`: it may print the saved
 * path, a `file://` URL or a link to the file on a line of its own. Such a
 * paragraph is the picture, so it draws as one. A path inside a sentence stays
 * a path, so prose that mentions a `.png` does not grow a thumbnail.
 */
export function soleImageSources(spans: MdInline[]): { src: string; alt: string }[] | null {
  const images: { src: string; alt: string }[] = [];
  for (const span of spans) {
    if (span.kind === "text" && span.text.trim() === "") continue;
    const image = localImageSource(span);
    if (image === null) return null;
    images.push(image);
  }
  return images.length === 0 ? null : images;
}

/** The text a reader sees, for measuring and for copy targets. */
export function inlineToText(spans: MdInline[]): string {
  let out = "";
  for (const span of spans) {
    if (span.kind === "text" || span.kind === "codeSpan") out += span.text;
    else if (span.kind === "image") out += span.alt;
    else if (span.kind === "filePath") out += span.path;
    else out += inlineToText(span.spans);
  }
  return out;
}
