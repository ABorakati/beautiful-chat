import React, { useState, useCallback, useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Glyph } from "./glyph";
import { frosted } from "./frosted";
import { Pop } from "./motion";
import { radius, type ExtendedThemeTokens } from "./theme-tokens";
import { FileTypeLogo, detectFileType } from "./file-type-logo";

interface SyntaxHighlightProps {
  code: string;
  language?: "typescript" | "bash" | "diff" | "json" | "python" | string;
  tokens: ExtendedThemeTokens;
  showLineNumbers?: boolean;
  filename?: string;
  compact?: boolean;
}

const STATIC_KEYWORDS: Record<string, true> = {
  import: true,
  export: true,
  from: true,
  default: true,
  const: true,
  let: true,
  var: true,
  function: true,
  return: true,
  async: true,
  await: true,
  if: true,
  else: true,
  switch: true,
  case: true,
  try: true,
  catch: true,
  type: true,
  interface: true,
  class: true,
  new: true,
  extends: true,
  implements: true,
};

const PYTHON_KEYWORDS: Record<string, true> = {
  import: true,
  from: true,
  as: true,
  def: true,
  lambda: true,
  return: true,
  yield: true,
  async: true,
  await: true,
  if: true,
  elif: true,
  else: true,
  for: true,
  while: true,
  in: true,
  is: true,
  not: true,
  and: true,
  or: true,
  try: true,
  except: true,
  finally: true,
  raise: true,
  with: true,
  class: true,
  pass: true,
  global: true,
  None: true,
  True: true,
  False: true,
  self: true,
};

/** Eval runs both kernels, so the callout must colour either dialect. */
function keywordsFor(language: string): Record<string, true> {
  return language === "python" ? PYTHON_KEYWORDS : STATIC_KEYWORDS;
}

/**
 * Strings, numbers, identifiers, and punctuation. Identifiers cover keywords
 * too, so the dialect lives in the lookup table rather than this pattern.
 */
const CODE_TOKEN_RE =
  /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+\b|[a-zA-Z_$][a-zA-Z0-9_$]*|[^\s\w]+)/g;

/**
 * The dialect used to colour code tokens. A `diff` block carries no dialect of
 * its own, so it borrows the one belonging to the file being patched.
 */
function dialectFor(language: string, filename?: string): string {
  if (language !== "diff") return language;
  const base = (filename || "").toLowerCase().split(/[/\\]/).pop() || "";
  const ext = base.includes(".") ? base.split(".").pop() : "";
  if (ext === "py") return "python";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "css" || ext === "scss" || ext === "sass") return "css";
  return "typescript";
}

/**
 * Which tint a diff row carries, or null for context rows, hunk headers and
 * every non-diff block. Reading it for the neighbouring rows is what lets a
 * run of changes render as one shape instead of a stack of them.
 */
function diffTint(line: string | undefined, language: string): "add" | "remove" | null {
  if (language !== "diff" || line === undefined) return null;
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "remove";
  return null;
}

/** A tag opening or closing marks the text as markup. */
const HTML_LIKE = /<\/?[a-zA-Z][\w-]*(?:\s|\/?>)/;
/** A declaration inside a block marks the text as style rules. */
const CSS_LIKE = /[a-zA-Z-]+\s*:\s*[^;{}]+;/;

export function detectEmbedded(text: string): "html" | "css" | null {
  if (HTML_LIKE.test(text)) return "html";
  if (text.includes("{") && CSS_LIKE.test(text)) return "css";
  return null;
}

/**
 * JavaScript carries markup and style rules inside template literals, and a
 * literal routinely spans many lines. Highlighting runs per line, so the dialect
 * of each line is resolved up front: a template's whole body is read once,
 * classified once, and that verdict is applied to every line it covers.
 */
export function classifyLines(lines: string[], base: string): string[] {
  // A block that already declares itself markup or styles needs no detection.
  if (base === "html" || base === "css" || base === "bash") {
    return lines.map(() => base);
  }

  const dialects: string[] = new Array(lines.length).fill(base);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const open = line.indexOf("`");
    if (open === -1) continue;

    // Find the line that closes this template literal.
    let end = i;
    if (line.indexOf("`", open + 1) === -1) {
      while (end + 1 < lines.length && !lines[end + 1]?.includes("`")) end++;
      end = Math.min(end + 1, lines.length - 1);
    }

    const body = lines.slice(i, end + 1).join("\n");
    const embedded = detectEmbedded(body);
    if (embedded) {
      for (let j = i; j <= end; j++) dialects[j] = embedded;
    }
    i = end;
  }

  return dialects;
}

/** `${...}` stays JavaScript wherever it is spliced in. */
const INTERPOLATION_RE = /\$\{[^}]*\}/g;

/**
 * Splits a line on its interpolations, tokenising the literal parts with
 * `renderPart` and the spliced expressions as accented code.
 */
function renderWithInterpolation(
  line: string,
  tokens: ExtendedThemeTokens,
  renderPart: (text: string) => React.ReactNode,
): React.ReactNode {
  INTERPOLATION_RE.lastIndex = 0;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Each literal run is wrapped so its own token array keeps a stable key.
  const pushLiteral = (text: string, index: number) => {
    parts.push(<Text key={`l${index}`}>{renderPart(text)}</Text>);
  };

  while ((match = INTERPOLATION_RE.exec(line)) !== null) {
    if (match.index > lastIndex) {
      pushLiteral(line.slice(lastIndex, match.index), lastIndex);
    }
    parts.push(
      <Text key={`i${match.index}`} style={{ color: tokens.accent }}>
        {match[0]}
      </Text>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < line.length) pushLiteral(line.slice(lastIndex), lastIndex);
  return parts;
}

const HTML_TOKEN_RE =
  /(<!--[\s\S]*?-->|<\/?[a-zA-Z][\w-]*|\/?>|[a-zA-Z-]+(?=\s*=)|"[^"]*"|'[^']*'|=)/g;

function renderHtmlTokens(
  text: string,
  tokens: ExtendedThemeTokens,
  keyPrefix: string,
): React.ReactNode {
  HTML_TOKEN_RE.lastIndex = 0;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = HTML_TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}h${match.index}`;

    if (token.startsWith("<!--")) {
      parts.push(
        <Text key={key} style={{ color: tokens.syntax.comment }}>
          {token}
        </Text>,
      );
    } else if (token.startsWith("<") || token === ">" || token === "/>") {
      parts.push(
        <Text key={key} style={{ color: tokens.syntax.keyword, fontWeight: "600" }}>
          {token}
        </Text>,
      );
    } else if (token.startsWith('"') || token.startsWith("'")) {
      parts.push(
        <Text key={key} style={{ color: tokens.syntax.string }}>
          {token}
        </Text>,
      );
    } else if (token === "=") {
      parts.push(
        <Text key={key} style={{ color: tokens.foregroundMuted }}>
          {token}
        </Text>,
      );
    } else {
      // An attribute name, matched by its lookahead to `=`.
      parts.push(
        <Text key={key} style={{ color: tokens.syntax.property }}>
          {token}
        </Text>,
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

const CSS_TOKEN_RE =
  /(\/\*[\s\S]*?\*\/|[{}:;]|"[^"]*"|'[^']*'|#[0-9a-fA-F]{3,8}\b|-?\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|fr|deg)?|[@.#]?[a-zA-Z][\w-]*)/g;

function renderCssTokens(
  text: string,
  tokens: ExtendedThemeTokens,
  keyPrefix: string,
): React.ReactNode {
  CSS_TOKEN_RE.lastIndex = 0;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  // A name before the first colon is a property; after it, a value.
  let inValue = false;

  while ((match = CSS_TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}c${match.index}`;

    if (token.startsWith("/*")) {
      parts.push(
        <Text key={key} style={{ color: tokens.syntax.comment }}>
          {token}
        </Text>,
      );
    } else if (token === ":") {
      inValue = true;
      parts.push(
        <Text key={key} style={{ color: tokens.foregroundMuted }}>
          {token}
        </Text>,
      );
    } else if (token === ";" || token === "{" || token === "}") {
      inValue = false;
      parts.push(
        <Text key={key} style={{ color: tokens.foregroundMuted }}>
          {token}
        </Text>,
      );
    } else if (token.startsWith("#") && /^#[0-9a-fA-F]{3,8}$/.test(token)) {
      parts.push(
        <Text key={key} style={{ color: tokens.syntax.number }}>
          {token}
        </Text>,
      );
    } else if (/^-?\d/.test(token)) {
      parts.push(
        <Text key={key} style={{ color: tokens.syntax.number }}>
          {token}
        </Text>,
      );
    } else if (token.startsWith('"') || token.startsWith("'")) {
      parts.push(
        <Text key={key} style={{ color: tokens.syntax.string }}>
          {token}
        </Text>,
      );
    } else if (inValue) {
      parts.push(
        <Text key={key} style={{ color: tokens.syntax.string }}>
          {token}
        </Text>,
      );
    } else if (token.startsWith("@") || token.startsWith(".") || token.startsWith("#")) {
      parts.push(
        <Text key={key} style={{ color: tokens.syntax.keyword, fontWeight: "600" }}>
          {token}
        </Text>,
      );
    } else {
      parts.push(
        <Text key={key} style={{ color: tokens.syntax.property }}>
          {token}
        </Text>,
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

export function SyntaxHighlightBlock({
  code,
  language = "typescript",
  tokens,
  showLineNumbers = false,
  filename,
  compact = false,
}: SyntaxHighlightProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [code]);

  const lines = useMemo(() => code.trimEnd().split("\n"), [code]);
  const codeLanguage = useMemo(() => dialectFor(language, filename), [language, filename]);
  // The devicon already names the language. The text badge only earns its
  // place when no brand mark exists for the file.
  const showLanguageBadge = useMemo(
    () => detectFileType(filename, language) === "generic",
    [filename, language],
  );
  const lineDialects = useMemo(() => classifyLines(lines, codeLanguage), [lines, codeLanguage]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          backgroundColor: tokens.surfaceCodeGlass,
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: tokens.borderSubtle,
          overflow: "hidden",
          marginVertical: compact ? 4 : 8,
        },
        header: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderBottomWidth: 1,
          borderBottomColor: tokens.borderSubtle,
          backgroundColor: tokens.surface1,
        },
        filename: {
          fontSize: 12,
          fontFamily: tokens.fontUi,
          fontWeight: "600",
          color: tokens.foregroundMuted,
        },
        langBadge: {
          fontSize: 11,
          fontWeight: "500",
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: tokens.foregroundSubtle,
          backgroundColor: tokens.surface2,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: radius.chip,
        },
        copyButton: {
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: radius.block,
          backgroundColor: tokens.surface2,
        },
        copyText: {
          fontSize: 11,
          color: copied ? tokens.success : tokens.foregroundMuted,
          fontWeight: "500",
        },
        codeArea: {
          padding: compact ? 8 : 12,
        },
        lineRow: {
          flexDirection: "row",
          alignItems: "flex-start",
        },
        lineNumber: {
          width: 32,
          fontSize: 12,
          fontFamily: tokens.fontMono,
          color: tokens.foregroundSubtle,
          textAlign: "right",
          paddingRight: 10,
          userSelect: "none" as const,
        },
        lineContent: {
          flex: 1,
          fontSize: 12,
          lineHeight: 18,
          fontFamily: tokens.fontCode,
          color: tokens.foreground,
        },
      }),
    [tokens, compact, copied],
  );

  return (
    <View {...frosted} style={styles.container}>
      {(filename || language) && (
        <View style={styles.header}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <FileTypeLogo filename={filename} language={language} size="sm" />
            {filename ? <Text style={styles.filename}>{filename}</Text> : null}
            {showLanguageBadge ? <Text style={styles.langBadge}>{language}</Text> : null}
          </View>
          <Pressable onPress={handleCopy} style={styles.copyButton}>
            <Pop trigger={copied}>
              <Glyph
                name={copied ? "Check" : "Copy"}
                size={12}
                color={copied ? tokens.success : tokens.foregroundMuted}
              />
            </Pop>
            <Text style={styles.copyText}>{copied ? "Copied" : "Copy"}</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.codeArea}>
        {lines.map((line, idx) => {
          const kind = diffTint(lines[idx], language);
          const lineBg =
            kind === "add"
              ? tokens.syntax.diffAddBg
              : kind === "remove"
                ? tokens.syntax.diffRemoveBg
                : "transparent";

          // A run of same-kind rows is one shape, so only its outer corners
          // are rounded. Rounding every row turns a five-line hunk into five
          // stacked pills.
          const opensRun = kind !== null && diffTint(lines[idx - 1], language) !== kind;
          const closesRun = kind !== null && diffTint(lines[idx + 1], language) !== kind;
          const corner = radius.chip;

          return (
            <View
              key={idx}
              style={[
                styles.lineRow,
                {
                  backgroundColor: lineBg,
                  borderTopLeftRadius: opensRun ? corner : 0,
                  borderTopRightRadius: opensRun ? corner : 0,
                  borderBottomLeftRadius: closesRun ? corner : 0,
                  borderBottomRightRadius: closesRun ? corner : 0,
                },
              ]}
            >
              {showLineNumbers && <Text style={styles.lineNumber}>{idx + 1}</Text>}
              <Text style={styles.lineContent}>
                {renderSyntaxLine(line, language, lineDialects[idx] ?? codeLanguage, tokens)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function renderSyntaxLine(
  line: string,
  language: string,
  lineDialect: string,
  tokens: ExtendedThemeTokens,
): React.ReactNode {
  if (language === "diff") {
    // Hunk headers are metadata, not code.
    if (line.startsWith("@@")) {
      return <Text style={{ color: tokens.syntax.comment }}>{line}</Text>;
    }

    // The body of a diff line is real code, so it gets the same tokens as
    // the file it came from. Only the marker carries the add/remove colour;
    // the row behind it is already tinted.
    const marker = line.startsWith("+") || line.startsWith("-") ? line.slice(0, 1) : "";
    const body = marker ? line.slice(1) : line;

    return (
      <>
        {marker ? (
          <Text
            style={{
              color: marker === "+" ? tokens.syntax.diffAddMarker : tokens.syntax.diffRemoveMarker,
              fontWeight: "600",
            }}
          >
            {marker}
          </Text>
        ) : null}
        {renderDialectLine(body, lineDialect, tokens)}
      </>
    );
  }

  if (language === "bash") return renderBashTokens(line, tokens);
  return renderDialectLine(line, lineDialect, tokens);
}

/** One line, coloured in whichever dialect that line turned out to be. */
function renderDialectLine(
  line: string,
  dialect: string,
  tokens: ExtendedThemeTokens,
): React.ReactNode {
  if (dialect === "bash") return renderBashTokens(line, tokens);

  if (dialect === "html") {
    return renderWithInterpolation(line, tokens, (text) => renderHtmlTokens(text, tokens, ""));
  }

  if (dialect === "css") {
    return renderWithInterpolation(line, tokens, (text) => renderCssTokens(text, tokens, ""));
  }

  const commentMark = dialect === "python" ? "#" : "//";
  const commentIndex = line.indexOf(commentMark);
  if (commentIndex !== -1) {
    return (
      <>
        {renderCodeTokens(line.slice(0, commentIndex), dialect, tokens)}
        <Text style={{ color: tokens.syntax.comment }}>{line.slice(commentIndex)}</Text>
      </>
    );
  }

  return renderCodeTokens(line, dialect, tokens);
}

function renderCodeTokens(
  text: string,
  language: string,
  tokens: ExtendedThemeTokens,
): React.ReactNode {
  const keywords = keywordsFor(language);
  const tokenRegex = CODE_TOKEN_RE;
  tokenRegex.lastIndex = 0;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith('"') || token.startsWith("'") || token.startsWith("`")) {
      parts.push(
        <Text key={match.index} style={{ color: tokens.syntax.string }}>
          {token}
        </Text>,
      );
    } else if (keywords[token]) {
      parts.push(
        <Text key={match.index} style={{ color: tokens.syntax.keyword, fontWeight: "600" }}>
          {token}
        </Text>,
      );
    } else if (/^\d+$/.test(token)) {
      parts.push(
        <Text key={match.index} style={{ color: tokens.syntax.number }}>
          {token}
        </Text>,
      );
    } else {
      parts.push(token);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

const BASH_COMMANDS: Record<string, true> = {
  pnpm: true,
  npm: true,
  npx: true,
  yarn: true,
  bun: true,
  git: true,
  cargo: true,
  docker: true,
  node: true,
  python: true,
  uv: true,
  cd: true,
  ls: true,
  cat: true,
  rm: true,
  cp: true,
  mv: true,
  mkdir: true,
  grep: true,
  find: true,
  curl: true,
  chmod: true,
  export: true,
  echo: true,
  paseo: true,
  ssh: true,
  sudo: true,
  apt: true,
  brew: true,
};

const BASH_SUBCOMMANDS: Record<string, true> = {
  run: true,
  build: true,
  test: true,
  install: true,
  add: true,
  remove: true,
  commit: true,
  push: true,
  pull: true,
  checkout: true,
  status: true,
  branch: true,
  merge: true,
  rebase: true,
  clone: true,
  diff: true,
  log: true,
  init: true,
  start: true,
  stop: true,
  reload: true,
  restart: true,
};

function renderBashTokens(line: string, tokens: ExtendedThemeTokens): React.ReactNode {
  if (line.startsWith("#")) {
    return <Text style={{ color: tokens.syntax.comment }}>{line}</Text>;
  }

  let promptPrefix = "";
  let commandStr = line;
  if (line.startsWith("$ ")) {
    promptPrefix = "$ ";
    commandStr = line.slice(2);
  }

  const tokenRegex =
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|--?[a-zA-Z0-9_-]+|&&|\|\||\||>|>>|;|[^\s"';|&>]+)/g;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let isFirstWord = true;

  while ((match = tokenRegex.exec(commandStr)) !== null) {
    if (match.index > lastIndex) {
      parts.push(commandStr.slice(lastIndex, match.index));
    }

    const token = match[0];

    if (
      token === "&&" ||
      token === "||" ||
      token === "|" ||
      token === ">" ||
      token === ">>" ||
      token === ";"
    ) {
      isFirstWord = true;
      parts.push(
        <Text key={match.index} style={{ color: tokens.syntax.keyword, fontWeight: "600" }}>
          {token}
        </Text>,
      );
    } else if (token.startsWith("-")) {
      parts.push(
        <Text key={match.index} style={{ color: tokens.syntax.property }}>
          {token}
        </Text>,
      );
    } else if (token.startsWith('"') || token.startsWith("'")) {
      parts.push(
        <Text key={match.index} style={{ color: tokens.syntax.string }}>
          {token}
        </Text>,
      );
    } else if (/^\d+$/.test(token)) {
      parts.push(
        <Text key={match.index} style={{ color: tokens.syntax.number }}>
          {token}
        </Text>,
      );
    } else if (isFirstWord || BASH_COMMANDS[token]) {
      isFirstWord = false;
      parts.push(
        <Text key={match.index} style={{ color: tokens.accent, fontWeight: "600" }}>
          {token}
        </Text>,
      );
    } else if (BASH_SUBCOMMANDS[token]) {
      parts.push(
        <Text key={match.index} style={{ color: tokens.syntax.function }}>
          {token}
        </Text>,
      );
    } else {
      parts.push(
        <Text key={match.index} style={{ color: tokens.foreground }}>
          {token}
        </Text>,
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < commandStr.length) {
    parts.push(commandStr.slice(lastIndex));
  }

  return (
    <>
      {promptPrefix ? (
        <Text style={{ color: tokens.foregroundSubtle, fontWeight: "600" }}>{promptPrefix}</Text>
      ) : null}
      {parts}
    </>
  );
}

/**
 * Whole-line verdicts in command output. A line that opens with one of these
 * takes its colour, because that is the part a reader scans for.
 */
const LINE_VERDICTS: Array<{
  re: RegExp;
  tone: "success" | "danger" | "warning";
}> = [
  { re: /^\s*(?:PASS|OK|DONE|SUCCESS|✓|✔)\b/i, tone: "success" },
  { re: /^\s*(?:FAIL(?:ED)?|ERROR|ERR|FATAL|✕|✗|×)\b/i, tone: "danger" },
  { re: /^\s*(?:WARN(?:ING)?|SKIP(?:PED)?|DEPRECATED)\b/i, tone: "warning" },
];

/** Inline spans worth colouring inside an otherwise plain output line. */
const OUTPUT_TOKENS =
  /(https?:\/\/[^\s]+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b[\w.-]+\.[a-z]{1,5}(?::\d+)?\b|\b\d+(?:\.\d+)?(?:ms|s|m|h|%|KB|MB|GB)?\b|\b(?:PASS|OK|DONE|SUCCESS)\b|\b(?:FAIL(?:ED)?|ERROR|FATAL)\b|\b(?:WARN(?:ING)?|SKIPPED)\b)/g;

/**
 * Command output, coloured. Verdict lines take one tone end to end; everything
 * else keeps muted body text with counts, durations, paths, and quoted values
 * lifted out so the numbers are findable.
 */
export function renderTerminalOutput(text: string, tokens: ExtendedThemeTokens): React.ReactNode {
  const lines = text.replace(/\s+$/, "").split("\n");

  return lines.map((line, lineIdx) => {
    const key = `out-${lineIdx}`;

    const verdict = LINE_VERDICTS.find((v) => v.re.test(line));
    if (verdict) {
      const tone =
        verdict.tone === "success"
          ? tokens.success
          : verdict.tone === "danger"
            ? tokens.danger
            : tokens.warning;
      return (
        <Text key={key} style={{ color: tone }}>
          {line}
          {lineIdx < lines.length - 1 ? "\n" : ""}
        </Text>
      );
    }

    if (line.startsWith("+")) {
      return (
        <Text key={key} style={{ color: tokens.syntax.diffAddMarker }}>
          {line}
          {lineIdx < lines.length - 1 ? "\n" : ""}
        </Text>
      );
    }
    if (line.startsWith("-") && !line.startsWith("--")) {
      return (
        <Text key={key} style={{ color: tokens.syntax.diffRemoveMarker }}>
          {line}
          {lineIdx < lines.length - 1 ? "\n" : ""}
        </Text>
      );
    }

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    OUTPUT_TOKENS.lastIndex = 0;

    while ((match = OUTPUT_TOKENS.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push(line.slice(lastIndex, match.index));
      }
      const token = match[0];
      const spanKey = `${key}-${match.index}`;
      let color = tokens.foreground;

      if (/^https?:\/\//.test(token)) {
        color = tokens.accent;
      } else if (token.startsWith('"') || token.startsWith("'")) {
        color = tokens.syntax.string;
      } else if (/^(?:PASS|OK|DONE|SUCCESS)$/i.test(token)) {
        color = tokens.success;
      } else if (/^(?:FAIL(?:ED)?|ERROR|FATAL)$/i.test(token)) {
        color = tokens.danger;
      } else if (/^(?:WARN(?:ING)?|SKIPPED)$/i.test(token)) {
        color = tokens.warning;
      } else if (/^\d/.test(token)) {
        color = tokens.syntax.number;
      } else {
        color = tokens.syntax.property;
      }

      parts.push(
        <Text key={spanKey} style={{ color }}>
          {token}
        </Text>,
      );
      lastIndex = match.index + token.length;
    }

    if (lastIndex < line.length) {
      parts.push(line.slice(lastIndex));
    }

    return (
      <Text key={key} style={{ color: tokens.foregroundMuted }}>
        {parts}
        {lineIdx < lines.length - 1 ? "\n" : ""}
      </Text>
    );
  });
}
