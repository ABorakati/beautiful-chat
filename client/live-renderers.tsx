import React, { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useAgent, usePaseo } from "@getpaseo/plugin/client";
import { useRevealedText } from "@getpaseo/plugin/client/react-native";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { buildThemeTokens } from "./components/theme-tokens";
import { ToolCallout } from "./components/tool-callouts";
import { ReasoningTrace } from "./components/reasoning-trace";
import { TaskList } from "./components/task-list";
import { UserMessage } from "./components/user-message";
import { hostFontEscape } from "./components/host-font-escape";
import type { TurnUsage } from "./components/user-message";
import { useEnhancerPreferences } from "./preferences";
import type {
  ToolCalloutData,
  ToolCallKind,
  ReasoningTraceData,
  TaskListData,
  TaskItemData,
  EvalCell,
} from "../shared/contracts";

type JsonValue = boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };

function toJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

export interface LiveToolCallPayload {
  name: string;
  status: string;
  detail?: Record<string, unknown>;
  callId?: string;
  error?: string | null;
  phase?: string;
}

export interface LiveReasoningPayload {
  text: string;
  phase?: string;
}

export interface LiveTodoPayload {
  items: Array<Record<string, unknown>>;
  phase?: string;
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

export function LiveToolCallRenderer({
  item,
  theme,
  layout,
}: PluginTimelineItemProps<LiveToolCallPayload>) {
  const preferences = useEnhancerPreferences();
  const tokens = useMemo(
    () => buildThemeTokens(theme.colors, preferences),
    [theme.colors, preferences],
  );
  const data = item.data;

  const calloutData = useMemo((): ToolCalloutData => {
    const rawName = (data.name || "").toLowerCase();
    const detail = (data.detail && typeof data.detail === "object" ? data.detail : {}) as Record<
      string,
      unknown
    >;
    const detailType = typeof detail.type === "string" ? detail.type.toLowerCase() : "";
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

    // Universal diff extraction
    const diff: string | undefined =
      (typeof detail.unifiedDiff === "string" ? detail.unifiedDiff : undefined) ||
      (typeof detail.diff === "string" ? detail.diff : undefined) ||
      extractStringProp(output, "diff");

    const outputText: string | undefined =
      typeof output === "string"
        ? output
        : extractStringProp(output, "stdout") ||
          extractStringProp(output, "text") ||
          (typeof output === "object" && output ? JSON.stringify(output) : undefined);
    let toolKind: ToolCallKind = "bash";
    let evalCells: EvalCell[] = [];
    let askOptions: AskOption[] = [];
    let askAnswer: string[] = [];
    let title = data.name || "tool";

    if (rawName === "read" || detailType === "read") {
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
      title = command ? `$ ${command.trim().slice(0, 55)}` : "Execute command";
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
    } else if (rawName.startsWith("mcp__") || rawName === "mcp") {
      toolKind = "mcp";
      title = rawName.replace(/^mcp__/, "").replace(/__/g, " / ");
    } else if (rawName === "ask") {
      toolKind = "ask";
      const asked = extractAskQuestion(input);
      title = asked?.question || "User Decision";
      askOptions = asked?.options ?? [];
      askAnswer = extractAskSelections(output, outputText);
    } else if (rawName === "hub") {
      toolKind = "hub";
      title = `Hub: ${String(input.op || "operation")}`;
    } else if (rawName === "eval") {
      toolKind = "eval";
      evalCells = extractEvalCells(detail, input, output);
      const cellTitle = evalCells.find((cell) => cell.title)?.title;
      title = cellTitle ? `Eval: ${cellTitle}` : "Eval Kernel";
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
      language: toolKind === "bash" || toolKind === "shell" ? "bash" : languageFromPath(filePath),
      command,
      code,
      diff,
      output: evalCells.length > 0 ? undefined : outputText,
      cells: evalCells.length > 0 ? evalCells : undefined,
      askOptions: askOptions.length > 0 ? askOptions : undefined,
      askAnswer: askAnswer.length > 0 ? askAnswer : undefined,
      exitCode: exitCodeCandidate,
      durationMs:
        typeof detail.durationMs === "number" ? detail.durationMs : extractEvalDuration(output),
    };
  }, [data]);

  // Collapse completed tools by default; expand active or failed tools
  const isExpanded = data.status === "running" || data.status === "failed";

  return (
    <View {...hostFontEscape}>
      <ToolCallout data={calloutData} tokens={tokens} defaultExpanded={isExpanded} />
    </View>
  );
}

export function LiveReasoningRenderer({
  item,
  theme,
}: PluginTimelineItemProps<LiveReasoningPayload>) {
  const preferences = useEnhancerPreferences();
  const tokens = useMemo(
    () => buildThemeTokens(theme.colors, preferences),
    [theme.colors, preferences],
  );
  const data = item.data;
  // The host owns the reveal cadence, so streamed reasoning animates the same
  // way it does in the native timeline instead of appearing in whole blocks.
  const revealed = useRevealedText(
    data.text || "",
    data.phase === "streaming" ? "streaming" : "complete",
  );

  const reasoningData: ReasoningTraceData = useMemo(() => {
    const rawText = revealed;
    // Split into paragraphs or steps if separated
    const paragraphs = rawText.split("\n\n").filter(Boolean);
    // No fabricated title: slicing the first 60 characters of the body cut
    // words in half and then repeated the same text underneath.
    // The final paragraph is the one still being written, so it reads as
    // active while streaming. That is what advances the timeline rail one
    // tick at a time instead of lighting the whole thing up at once.
    const streaming = data.phase === "streaming";
    const steps = paragraphs.map((p, idx) => ({
      id: `live-step-${idx}`,
      number: idx + 1,
      status:
        streaming && idx === paragraphs.length - 1 ? ("active" as const) : ("completed" as const),
      content: p,
    }));

    return {
      id: "live-reasoning",
      agentModel: "",
      durationMs: 0,
      totalTokens: Math.round(rawText.length / 4),
      status: data.phase === "streaming" ? "thinking" : "completed",
      steps:
        steps.length > 0
          ? steps
          : [
              {
                id: "step-1",
                number: 1,
                title: "Thought Process",
                status: "completed" as const,
                content: rawText,
              },
            ],
    };
  }, [data, revealed]);

  return (
    <View {...hostFontEscape}>
      <ReasoningTrace
        data={reasoningData}
        tokens={tokens}
        defaultExpanded={data.phase === "streaming"}
      />
    </View>
  );
}

export function LiveTodoRenderer({ item, theme }: PluginTimelineItemProps<LiveTodoPayload>) {
  const preferences = useEnhancerPreferences();
  const tokens = useMemo(
    () => buildThemeTokens(theme.colors, preferences),
    [theme.colors, preferences],
  );
  const data = item.data;

  const taskListData: TaskListData = useMemo(() => {
    const tasks: TaskItemData[] = (data.items || []).map((task, idx) => ({
      id: typeof task.id === "string" ? task.id : `todo-${idx}`,
      title: typeof task.text === "string" ? task.text : "Untitled task",
      phase: "Execution",
      status:
        task.completed === true
          ? "completed"
          : task.status === "in_progress"
            ? "in_progress"
            : "pending",
    }));

    return {
      id: "live-todo",
      phaseName: "Checklist Progress",
      tasks,
    };
  }, [data]);

  return (
    <View {...hostFontEscape}>
      <TaskList data={taskListData} tokens={tokens} />
    </View>
  );
}

export interface LiveUserMessagePayload {
  text: string;
  images?: string[];
}

/**
 * Usage is reported on the agent, not on the timeline item, so it is read from
 * the live agent handle while the turn runs and frozen once the agent leaves
 * `running`. A turn this client never observed live has no recoverable usage,
 * so its footer is omitted rather than filled with the current session total.
 */
const LIVE_WINDOW_MS = 5 * 60 * 1000;

export function LiveUserMessageRenderer({
  item,
  theme,
  agentId,
  timestamp,
}: PluginTimelineItemProps<LiveUserMessagePayload>) {
  const preferences = useEnhancerPreferences();
  const tokens = useMemo(
    () => buildThemeTokens(theme.colors, preferences),
    [theme.colors, preferences],
  );
  const paseo = usePaseo();
  const handle = useMemo(() => paseo.agents.ref(agentId), [paseo, agentId]);

  // Decided once, on mount: a replayed turn must not borrow later figures.
  const observedLive = useMemo(
    () => Date.now() - timestamp.getTime() < LIVE_WINDOW_MS,
    [timestamp],
  );

  const snapshot = useAgent(agentId, (agent) => ({
    status: agent.status,
    updatedAt: agent.updatedAt,
  }));
  const running = snapshot?.status === "running";

  const [usage, setUsage] = useState<TurnUsage | null>(null);
  const [frozen, setFrozen] = useState(false);

  useEffect(() => {
    if (!observedLive || frozen) return;
    let cancelled = false;
    handle
      .refresh()
      .then((result) => {
        if (cancelled || !result) return;
        const next = result.agent.lastUsage;
        if (next) setUsage(next);
        // The turn has settled, so this reading is final.
        if (next && !running) setFrozen(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [handle, observedLive, frozen, running, snapshot?.updatedAt]);

  return (
    <View {...hostFontEscape}>
      <UserMessage
        text={item.data.text}
        images={item.data.images}
        timestamp={timestamp}
        tokens={tokens}
        usage={observedLive ? usage : null}
        pending={running && !frozen}
      />
    </View>
  );
}
