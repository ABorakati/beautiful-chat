/**
 * Host tool-call payloads, reduced to what the cards draw.
 *
 * Everything here is pure: the transformer in `index.client.tsx` builds the
 * payload, the renderer and the screenshot harness both call
 * `buildToolCalloutData` on it. Keeping the reduction out of the renderer is
 * what lets `.showcase` exercise the real mapping instead of hand-built
 * `ToolCalloutData` that could drift from the host's shapes.
 */
import type {
  AdvisorData,
  AdvisorNote,
  EvalCell,
  GitHubToolData,
  HubData,
  McpToolData,
  PaseoToolData,
  StatusChip,
  StatusLineData,
  ToolCallKind,
  ToolCalloutData,
} from "../shared/contracts";
import { buildUnifiedDiffText } from "./components/diff-text";
import { buildGitHubData } from "./github-request";
import { buildHubData } from "./hub-details";

type JsonValue = boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };

export function toJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

/**
 * The data a plugin timeline item carries for a tool call. JSON-compatible by
 * contract: the host validates and deep-clones it before rendering.
 */
export interface ToolCallPayload {
  name: string;
  status: string;
  detail?: Record<string, unknown>;
  callId?: string;
  error?: string | null;
  phase?: string;
  /**
   * The host's own metadata for the call. Synthetic rows — advisor notes,
   * retry telemetry, unclaimed `custom` messages — are only identifiable here:
   * their `name` is shared by several sources, and the structured record lives
   * in `metadata`.
   */
  metadata?: Record<string, unknown>;
}

/** The host's tool_call timeline item, as far as this module needs it. */
export interface ToolCallSourceItem {
  name: string;
  status: string;
  detail?: unknown;
  callId?: string;
  error?: unknown;
  metadata?: Record<string, unknown>;
}

export function buildToolCallPayload(
  item: ToolCallSourceItem,
  phase: string,
): ToolCallPayload {
  const detail =
    item.detail && typeof item.detail === "object"
      ? (toJsonValue(item.detail) as Record<string, unknown>)
      : undefined;
  return {
    name: item.name,
    status: item.status,
    ...(detail ? { detail } : {}),
    ...(item.callId ? { callId: item.callId } : {}),
    error: extractErrorText(item.error),
    ...(item.metadata && Object.keys(item.metadata).length > 0
      ? { metadata: toJsonValue(item.metadata) as Record<string, unknown> }
      : {}),
    phase,
  };
}

function extractStringProp(obj: unknown, key: string): string | undefined {
  if (obj && typeof obj === "object" && key in obj) {
    const val = Reflect.get(obj, key);
    return typeof val === "string" ? val : undefined;
  }
  return undefined;
}

/** The eval result nests its cells under `details`, not under the call input. */
interface RawEvalCell {
  title?: unknown;
  code?: unknown;
  language?: unknown;
  output?: unknown;
}

/**
 * Eval reports the source it ran and the text that source printed. Both live
 * inside the result payload, so reading only the top level yields a JSON blob
 * where the cell should be.
 */
export function extractEvalCells(
  detail: Record<string, unknown>,
  input: Record<string, unknown>,
  output: unknown,
): EvalCell[] {
  const container =
    output && typeof output === "object" ? (output as Record<string, unknown>) : detail;
  const details =
    container.details && typeof container.details === "object"
      ? (container.details as Record<string, unknown>)
      : {};
  const fallbackLanguage =
    typeof details.language === "string"
      ? details.language
      : typeof input.language === "string"
        ? input.language
        : "js";

  const raw = Array.isArray(details.cells) ? (details.cells as RawEvalCell[]) : [];
  const cells = raw
    .map((cell): EvalCell | null => {
      const code = typeof cell.code === "string" ? cell.code : "";
      if (!code) return null;
      return {
        title: typeof cell.title === "string" ? cell.title : undefined,
        code,
        language: normalizeKernel(
          typeof cell.language === "string" ? cell.language : fallbackLanguage,
        ),
        output: typeof cell.output === "string" ? cell.output : undefined,
      };
    })
    .filter((cell): cell is EvalCell => cell !== null);

  if (cells.length > 0) return cells;

  // A provider that does not nest still supplies the source on the call input.
  const code = typeof input.code === "string" ? input.code : "";
  if (!code) return [];
  return [
    {
      title: typeof input.title === "string" ? input.title : undefined,
      code,
      language: normalizeKernel(fallbackLanguage),
      output: extractContentText(container),
    },
  ];
}

/** Kernel ids are short; the highlighter names dialects in full. */
function normalizeKernel(language: string): string {
  const id = language.toLowerCase();
  if (id === "py" || id === "python") return "python";
  return "typescript";
}

/** A tool's human-readable text sits in the first text block of `content`. */
export function extractContentText(container: Record<string, unknown>): string | undefined {
  const content = container.content;
  if (!Array.isArray(content)) return undefined;
  for (const block of content) {
    if (block && typeof block === "object") {
      const text = (block as Record<string, unknown>).text;
      if (typeof text === "string" && text.length > 0) return text;
    }
  }
  return undefined;
}

/** Eval times the whole run and reports it beside the cells. */
export function extractEvalDuration(output: unknown): number | undefined {
  if (!output || typeof output !== "object") return undefined;
  const details = (output as Record<string, unknown>).details;

  if (!details || typeof details !== "object") return undefined;
  const value = (details as Record<string, unknown>).durationMs;
  return typeof value === "number" ? value : undefined;
}

/**
 * The readable message in a failed call's `error`, which each provider shapes
 * its own way. Claude hands over the raw tool result with the text in
 * `content`. `String()` on that record printed "[object Object]".
 */
export function extractErrorText(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "string") return error;
  if (typeof error !== "object") return String(error);
  const record = error as Record<string, unknown>;
  const text =
    asString(record.content) ??
    asString(record.message) ??
    asString(record.text) ??
    extractContentText(record);
  return text ?? JSON.stringify(error);
}

/**
 * The most characters of a raw payload a generic card carries. A search or
 * listing tool can answer with megabytes, and the card only ever shows a
 * screenful of it.
 */
const RAW_PAYLOAD_LIMIT = 20_000;

/**
 * Keeps a raw call payload JSON-serialisable and bounded. Anything that does
 * not stringify (a cycle, a bigint) or that is too long becomes truncated text
 * rather than throwing inside a render.
 */
function capRawPayload(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string") {
    return value.length > RAW_PAYLOAD_LIMIT
      ? `${value.slice(0, RAW_PAYLOAD_LIMIT)}\n… truncated`
      : value;
  }
  try {
    const text = JSON.stringify(value, null, 2);
    if (text === undefined) return undefined;
    return text.length > RAW_PAYLOAD_LIMIT
      ? `${text.slice(0, RAW_PAYLOAD_LIMIT)}\n… truncated`
      : value;
  } catch {
    return String(value).slice(0, RAW_PAYLOAD_LIMIT);
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * One `task` call spawns a batch, so the card reads the call's own arguments:
 * the shared `context` and the `tasks` array. The result text only confirms
 * the ids, and it is absent while the call is still running, which is exactly
 * when the reader most wants to see what was sent.
 */
export function buildSubagentBatch(input: Record<string, unknown>): ToolCalloutData["subagent"] {
  const entries = Array.isArray(input.tasks) ? input.tasks : [];
  const agents = entries.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const brief = asString(row.task);
    if (!brief) return [];
    return [
      {
        name: asString(row.name) ?? `agent ${index + 1}`,
        agentType: asString(row.agent) ?? "task",
        task: brief,
      },
    ];
  });
  if (agents.length === 0) return undefined;
  const context = asString(input.context);
  return context ? { context, agents } : { agents };
}

/** Splits `mcp__server__tool` and keeps the call's own arguments and result. */
export function buildMcpData(
  rawName: string,
  input: Record<string, unknown>,
  output: unknown,
  durationMs: number | undefined,
): McpToolData {
  const parts = rawName.replace(/^mcp__/, "").split("__");
  return {
    server: parts.length > 1 ? (parts[0] ?? "mcp") : "mcp",
    tool: parts.length > 1 ? parts.slice(1).join(" / ") : (parts[0] ?? rawName),
    arguments: input,
    // An MCP server answers with content blocks. Keeping the envelope here put
    // `{"content":[{"type":"text",…}]}` in the response panel, so the prose is
    // unwrapped first and only a genuinely structured payload stays an object.
    result:
      (output && typeof output === "object"
        ? extractContentText(output as Record<string, unknown>)
        : undefined) ?? (output === "" ? undefined : output),
    durationMs,
  };
}

/** Paseo's own agent tools. Only `create_agent` carries a record worth a card. */
export function buildPaseoData(
  rawName: string,
  input: Record<string, unknown>,
  outputText: string | undefined,
  durationMs: number | undefined,
): PaseoToolData | undefined {
  if (rawName !== "create_agent") return undefined;
  const provider = asString(input.provider) ?? "agent";
  const [providerId, model] = provider.split("/");
  return {
    id: `paseo-${rawName}`,
    tool: "create_agent",
    durationMs,
    createAgent: {
      title: asString(input.title) ?? "New agent",
      provider: providerId ?? provider,
      model: model ?? asString(input.model),
      initialPrompt: asString(input.initialPrompt) ?? "",
      agentId: outputText?.match(/[0-9a-f]{8}-[0-9a-f-]{27}/i)?.[0],
      status: "created",
    },
  };
}

interface AskOption {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

/**
 * The ask tool nests its prompt under `questions`, so reading `input.question`
 * finds nothing and the options never reach the callout.
 */
export function extractAskQuestion(input: Record<string, unknown>): {
  question: string;
  options: AskOption[];
} | null {
  const raw = Array.isArray(input.questions)
    ? (input.questions[0] as Record<string, unknown> | undefined)
    : typeof input.question === "string"
      ? input
      : undefined;
  if (!raw) return null;

  const question = typeof raw.question === "string" ? raw.question : "";
  const recommended = typeof raw.recommended === "number" ? raw.recommended : undefined;
  const options = Array.isArray(raw.options)
    ? raw.options.flatMap((entry, index): AskOption[] => {
        if (!entry || typeof entry !== "object") return [];
        const option = entry as Record<string, unknown>;
        const label = typeof option.label === "string" ? option.label : "";
        if (!label) return [];
        return [
          {
            id: typeof option.id === "string" ? option.id : `opt-${index}`,
            label,
            description: typeof option.description === "string" ? option.description : undefined,
            recommended: index === recommended,
          },
        ];
      })
    : [];

  if (!question && options.length === 0) return null;
  return { question, options };
}

/**
 * The chosen answer is reported as prose, so the prefix is stripped and the
 * remainder kept verbatim — it may be a typed reply rather than a label.
 */
export function extractAskAnswer(text?: string): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/^user\s+(?:selected|answered|chose)\s*:?\s*/i);
  const answer = match ? trimmed.slice(match[0].length).trim() : trimmed;
  return answer.length > 0 ? answer : undefined;
}

/**
 * The selected option labels.
 *
 * The ask result nests its answer, so reading the top level yields the whole
 * JSON object where the choice should be. `details.selectedOptions` is the
 * authoritative list and covers multi-select; the prose line is the fallback
 * for a host that does not report it. A typed reply arrives here too, and
 * matches no option label, which is exactly how free text should behave.
 */
export function extractAskSelections(output: unknown, outputText?: string): string[] {
  const container =
    output && typeof output === "object" ? (output as Record<string, unknown>) : undefined;

  const details = container?.details;
  if (details && typeof details === "object") {
    const selected = (details as Record<string, unknown>).selectedOptions;
    if (Array.isArray(selected)) {
      const labels = selected.filter(
        (entry): entry is string => typeof entry === "string" && entry.length > 0,
      );
      if (labels.length > 0) return labels;
    }
  }

  const prose = container ? extractContentText(container) : outputText;
  const single = extractAskAnswer(prose);
  return single ? [single] : [];
}

/** Extension to the language ids the highlighter and the devicons share. */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  py: "python",
  rs: "rust",
  go: "go",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  json: "json",
  jsonc: "json",
  md: "markdown",
  markdown: "markdown",
  html: "html",
  htm: "html",
  css: "css",
  scss: "css",
  sass: "css",
  sql: "sql",
  yml: "yaml",
  yaml: "yaml",
};

/**
 * The language a file is written in, read from its path.
 *
 * Nothing upstream reports this, so the callout used to carry no language at
 * all: the header fell back to a letter monogram and the code block assumed
 * TypeScript, which mislabels every Python or Rust read it renders.
 */
export function languageFromPath(filePath?: string): string | undefined {
  if (!filePath) return undefined;
  const base = (filePath.toLowerCase().split(/[/\\]/).pop() ?? "").split(/[\s:?#]/)[0] ?? "";
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "docker";
  if (!base.includes(".")) return undefined;
  const ext = base.split(".").pop() ?? "";
  return LANGUAGE_BY_EXTENSION[ext];
}

/**
 * Advisor notes, read back out of the host's flattened text.
 *
 * The host joins the notes into one string with `"\n\n"` and prefixes each
 * with `[severity]` and, when it knows one, `[advisor]`. The structured notes
 * never reach the plugin, so this is the only source for per-note severity.
 * A note may itself contain a blank line (4.5% of the local corpus does), so a
 * block without a severity prefix continues the previous note instead of
 * starting a new one. A `[advisor]` name only ever follows a severity, so a
 * bracket at the start of a note is not mistaken for a chip.
 */
const ADVISOR_SEVERITIES: Record<string, true> = { nit: true, concern: true, blocker: true };
const ADVISOR_NOTE = /^\[([^\]\n]+)\](?:\s+\[([^\]\n]+)\])?\s*([\s\S]*)$/;

export function parseAdvisorNotes(text: string): AdvisorNote[] {
  const notes: AdvisorNote[] = [];
  for (const block of text.split("\n\n")) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const match = trimmed.match(ADVISOR_NOTE);
    const severity = match && ADVISOR_SEVERITIES[match[1] ?? ""] ? match[1] : undefined;
    if (match && severity) {
      const advisor = asString(match[2]);
      notes.push({
        severity: severity as AdvisorNote["severity"],
        ...(advisor ? { advisor } : {}),
        text: (match[3] ?? "").trim(),
      });
      continue;
    }
    const previous = notes[notes.length - 1];
    if (previous) {
      previous.text = `${previous.text}\n\n${trimmed}`;
    } else {
      notes.push({ text: trimmed });
    }
  }
  return notes;
}

const OMP_STATUS_SOURCES: Record<string, true> = {
  omp_retry_fallback_applied: true,
  omp_retry_fallback_succeeded: true,
  omp_auto_retry_start: true,
  omp_auto_retry_end: true,
  omp_goal_updated: true,
};

/**
 * One row of omp telemetry the host turns into a synthetic tool call. The chip
 * list is the structured half of `metadata`; `text` is kept for the sources
 * whose prose says something the chips do not (the error, the goal).
 */
function buildStatusLine(
  source: string,
  metadata: Record<string, unknown>,
  plainText: string | undefined,
): StatusLineData {
  const chips: StatusChip[] = [];
  const str = (key: string) => asString(metadata[key]);
  const num = (key: string) => (typeof metadata[key] === "number" ? metadata[key] : undefined);
  let tone: StatusLineData["tone"] = "neutral";
  let keepText = false;
  let detail: string | undefined;

  switch (source) {
    case "omp_retry_fallback_applied": {
      const role = str("role");
      const from = str("from");
      const to = str("to");
      if (role) chips.push({ label: "role", value: role });
      if (from && to) chips.push({ label: "route", value: `${from} → ${to}` });
      break;
    }
    case "omp_retry_fallback_succeeded": {
      const role = str("role");
      const model = str("model");
      if (role) chips.push({ label: "role", value: role });
      if (model) chips.push({ label: "model", value: model });
      tone = "success";
      break;
    }
    case "omp_auto_retry_start": {
      const attempt = num("attempt");
      const maxAttempts = num("maxAttempts");
      const delayMs = num("delayMs");
      if (attempt !== undefined && maxAttempts !== undefined) {
        chips.push({ label: "attempt", value: `${attempt}/${maxAttempts}` });
      }
      if (delayMs !== undefined) {
        chips.push({
          label: "retry in",
          value: delayMs < 1000 ? `${delayMs}ms` : `${(delayMs / 1000).toFixed(1)}s`,
        });
      }
      // The host's text is `Retrying in <delay>: <error>`; the delay is already
      // a chip, so only the error is kept.
      detail = plainText?.replace(/^Retrying in [^:]+:\s*/, "");
      break;
    }
    case "omp_auto_retry_end": {
      const attempt = num("attempt");
      if (attempt !== undefined) chips.push({ label: "attempt", value: String(attempt) });
      tone = metadata.success === true ? "success" : "danger";
      keepText = true;
      break;
    }
    case "omp_goal_updated": {
      // The host's label already names the goal status (`OMP goal active`), so
      // the chip would repeat it; the id is the part the row cannot guess.
      const id = str("goalId");
      if (id) chips.push({ label: "id", value: id });
      keepText = true;
      break;
    }
    default:
      keepText = true;
      break;
  }

  const text = detail ?? (keepText ? plainText : undefined);
  return {
    source,
    tone,
    chips,
    ...(text ? { text } : {}),
  };
}

/**
 * The host's tool call, reduced to the card it draws.
 *
 * Synthetic rows are classified before the name-based chain: omp's telemetry
 * shares `detail.type === "plain_text"` with ordinary device tools, and
 * `metadata` is what tells them apart. The chain below it keeps its order.
 */
export function buildToolCalloutData(data: ToolCallPayload): ToolCalloutData {
  const rawName = (data.name || "").toLowerCase();
  const detail = (data.detail && typeof data.detail === "object" ? data.detail : {}) as Record<
    string,
    unknown
  >;
  const metadata = (
    data.metadata && typeof data.metadata === "object" ? data.metadata : {}
  ) as Record<string, unknown>;
  const detailType = typeof detail.type === "string" ? detail.type.toLowerCase() : "";
  const source = asString(metadata.source);
  const customType = asString(metadata.customType);
  const plainText = detailType === "plain_text" ? asString(detail.text) : undefined;
  const plainLabel = detailType === "plain_text" ? asString(detail.label) : undefined;
  const input = (
    detail.input && typeof detail.input === "object"
      ? detail.input
      : detail.arguments && typeof detail.arguments === "object"
        ? detail.arguments
        : detail.args && typeof detail.args === "object"
          ? detail.args
          : {}
  ) as Record<string, unknown>;
  const output = detail.output ?? detail.result ?? detail.content ?? "";

  // Universal path extraction across OMP, Paseo, Claude, and Codex formats
  const filePath: string | undefined =
    (typeof detail.filePath === "string" ? detail.filePath : undefined) ||
    (typeof input.path === "string" ? input.path : undefined) ||
    (typeof input.filePath === "string" ? input.filePath : undefined) ||
    (typeof detail.path === "string" ? detail.path : undefined);

  // Universal command extraction
  const command: string | undefined =
    (typeof detail.command === "string" ? detail.command : undefined) ||
    (typeof input.command === "string" ? input.command : undefined) ||
    (typeof detail.input === "string" ? detail.input : undefined);

  // Universal code / file content extraction
  const code: string | undefined =
    (typeof detail.content === "string" ? detail.content : undefined) ||
    (typeof output === "string" ? output : undefined) ||
    (typeof input.content === "string" ? input.content : undefined);

  // Universal diff extraction. A provider that ships an edit as before and
  // after text instead of a patch — opencode among them — gets the same
  // treatment the host's own view gives it: the diff is computed from the
  // pair, so the card shows the change rather than the tool's summary line.
  const editOld =
    (typeof detail.oldString === "string" ? detail.oldString : undefined) ??
    (typeof input.oldString === "string" ? input.oldString : undefined);
  const editNew =
    (typeof detail.newString === "string" ? detail.newString : undefined) ??
    (typeof input.newString === "string" ? input.newString : undefined);
  const computedEditDiff: string | undefined =
    editOld !== undefined || editNew !== undefined
      ? buildUnifiedDiffText(editOld ?? "", editNew ?? "")
      : undefined;
  const diff: string | undefined =
    (typeof detail.unifiedDiff === "string" ? detail.unifiedDiff : undefined) ||
    (typeof detail.diff === "string" ? detail.diff : undefined) ||
    extractStringProp(output, "diff") ||
    computedEditDiff;

  // A tool that answers with content blocks carries its prose in
  // `content[0].text`. That text is allowed to be empty — a `hub wait` job
  // snapshot puts everything in `details` and nothing in the text — so there
  // is deliberately no stringify fallback here: a card renders from its typed
  // record instead. Stringifying the envelope is what printed raw JSON.
  const outputText: string | undefined =
    typeof output === "string"
      ? output
      : extractStringProp(output, "stdout") ||
        extractStringProp(output, "text") ||
        (output && typeof output === "object"
          ? extractContentText(output as Record<string, unknown>)
          : undefined);
  // A failed call can carry its message beside the detail rather than in it,
  // which left the card saying the command printed nothing.
  const errorText =
    data.status === "failed" && typeof data.error === "string" && data.error.trim()
      ? data.error
      : undefined;
  const durationMs =
    typeof detail.durationMs === "number" ? detail.durationMs : extractEvalDuration(output);
  let toolKind: ToolCallKind = "generic";
  let hub: HubData | undefined;
  let mcp: McpToolData | undefined;
  let subagent: ToolCalloutData["subagent"];
  let paseo: PaseoToolData | undefined;
  let github: GitHubToolData | undefined;
  let evalCells: EvalCell[] = [];
  let askOptions: AskOption[] = [];
  let askAnswer: string[] = [];
  let advisor: AdvisorData | undefined;
  let telemetry: StatusLineData | undefined;
  let text: string | undefined;
  let title = data.name || "tool";

  const isGitHubTool =
    rawName === "github" ||
    detailType === "github" ||
    filePath === "xd://github" ||
    filePath?.startsWith("xd://github/") === true;
  const isGitCommand =
    rawName === "git" || detailType === "git" || /^\s*git(?:\.exe)?(?:\s|$)/i.test(command ?? "");

  if (source === "omp_advisor" || rawName === "advisor") {
    toolKind = "advisor";
    const notes = parseAdvisorNotes(plainText ?? "");
    const noteCount =
      typeof metadata.noteCount === "number" ? metadata.noteCount : notes.length;
    const blockerCount =
      typeof metadata.blockerCount === "number"
        ? metadata.blockerCount
        : notes.filter((note) => note.severity === "blocker").length;
    advisor = { notes, noteCount, blockerCount };
    title = plainLabel ?? "Advisor";
  } else if (source !== undefined && OMP_STATUS_SOURCES[source]) {
    toolKind = "status";
    telemetry = buildStatusLine(source, metadata, plainText);
    title = plainLabel ?? data.name;
  } else if (plainText !== undefined && customType !== undefined) {
    // An unclaimed `custom` message: IRC relays, supervised-process reports.
    // The row is a message, not a tool call, so the renderer draws the
    // `SystemCard` without the tool chrome and falls back to prose when the
    // text is not an envelope it can read.
    toolKind = "system";
    text = plainText;
    title = plainLabel ?? customType;
  } else if (plainText !== undefined) {
    // omp reports `wait`, `think`, `yield`, `ask` and every opaque device tool
    // as prose in `detail.text`. Ignoring that field is what left those cards
    // blank.
    toolKind = "note";
    text = plainText;
    title = plainLabel ?? (data.name || "note");
  } else if (isGitHubTool) {
    toolKind = "github";
    // A device call is a write: `content` is the request, and the tool's own
    // result text is the reply. They are read separately here because the
    // generic `code` extraction prefers whichever it finds first, which drew
    // the request twice and the answer never.
    const request = asString(input.content) ?? asString(detail.content);
    const reply = outputText && outputText !== request ? outputText : undefined;
    github = buildGitHubData(request, reply);
    title = github ? [github.op, github.repo, github.subject].filter(Boolean).join(" ") : "GitHub";
  } else if (isGitCommand) {
    toolKind = "git";
    title = command ? `$ ${command.trim()}` : "Git command";
  } else if (rawName === "read" || detailType === "read") {
    toolKind = "read";
    title = filePath ? `Read ${filePath.split(/[/\\]/).pop() || filePath}` : "Read file";
  } else if (rawName === "write" || detailType === "write") {
    toolKind = "write";
    title = filePath ? `Write ${filePath.split(/[/\\]/).pop() || filePath}` : "Write file";
  } else if (rawName === "edit" || detailType === "edit") {
    toolKind = "edit";
    title = filePath ? `Edit ${filePath.split(/[/\\]/).pop() || filePath}` : "Edit file";
  } else if (rawName === "bash" || rawName === "shell" || detailType === "shell") {
    toolKind = rawName === "shell" || detailType === "shell" ? "shell" : "bash";
    title = command ? `$ ${command.trim()}` : "Execute command";
  } else if (rawName === "thinking") {
    toolKind = "thinking";
    title = "Reasoning Process";
  } else if (
    rawName === "create_agent" ||
    rawName === "list_providers" ||
    rawName === "list_models" ||
    rawName === "get_agent_activity" ||
    rawName === "send_agent_prompt" ||
    rawName === "get_agent_status"
  ) {
    toolKind = "paseo";
    title = `Paseo: ${rawName}`;
    paseo = buildPaseoData(rawName, input, outputText, durationMs);
  } else if (rawName.startsWith("mcp__") || rawName === "mcp") {
    toolKind = "mcp";
    title = rawName.replace(/^mcp__/, "").replace(/__/g, " / ");
    mcp = buildMcpData(rawName, input, output, durationMs);
  } else if (rawName === "ask") {
    toolKind = "ask";
    const asked = extractAskQuestion(input);
    title = asked?.question || "User Decision";
    askOptions = asked?.options ?? [];
    askAnswer = extractAskSelections(output, outputText);
  } else if (rawName === "hub") {
    toolKind = "hub";
    title = `Hub: ${String(input.op || "operation")}`;
    hub = buildHubData(input, outputText, output);
  } else if (rawName === "eval") {
    toolKind = "eval";
    evalCells = extractEvalCells(detail, input, output);
    const cellTitle = evalCells.find((cell) => cell.title)?.title;
    title = cellTitle ? `Eval: ${cellTitle}` : "Eval Kernel";
  } else if (rawName === "task") {
    toolKind = "task";
    subagent = buildSubagentBatch(input);
    const count = subagent?.agents.length ?? 0;
    title = count === 1 ? (subagent?.agents[0]?.name ?? "Subagent") : `${count || "No"} subagents`;
  }

  const exitCodeCandidate =
    typeof detail.exitCode === "number"
      ? detail.exitCode
      : typeof detail.code === "number"
        ? detail.code
        : undefined;

  return {
    id: `live-${rawName}`,
    tool: toolKind,
    title,
    status:
      data.status === "running" ? "running" : data.status === "failed" ? "failed" : "completed",
    filePath,
    // Keep the full command available when the single-line header is collapsed.
    command,
    language:
      toolKind === "bash" || toolKind === "shell" || toolKind === "git"
        ? "bash"
        : languageFromPath(filePath),
    // A github card reads its typed record; leaving `code` and `output` set
    // would draw the request and the reply a second time.
    code: toolKind === "github" || toolKind === "generic" ? undefined : code,
    diff,
    output:
      toolKind === "github" || toolKind === "generic" || evalCells.length > 0
        ? undefined
        : outputText || errorText,
    cells: evalCells.length > 0 ? evalCells : undefined,
    askOptions: askOptions.length > 0 ? askOptions : undefined,
    askAnswer: askAnswer.length > 0 ? askAnswer : undefined,
    exitCode: exitCodeCandidate,
    durationMs,
    hub,
    subagent,
    mcp,
    paseo,
    github,
    advisor,
    telemetry,
    text,
    // Only the generic card draws the raw call, so no typed card shows a
    // payload twice.
    input:
      toolKind === "generic"
        ? capRawPayload(detail.input ?? detail.arguments ?? detail.args)
        : undefined,
    rawOutput: toolKind === "generic" ? (capRawPayload(output) ?? errorText) : undefined,
  };
}
