import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useAgent, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useRevealedText } from "@getpaseo/plugin/client/react-native";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { useThemeTokens } from "./components/theme-tokens";
import { ToolCallout } from "./components/tool-callouts";
import { toolCardStartsExpanded } from "./tool-collapse";
import { ReasoningTrace } from "./components/reasoning-trace";
import { TaskList } from "./components/task-list";
import { UserMessage } from "./components/user-message";
import { hostFontEscape } from "./components/host-font-escape";
import { pathContextProps } from "./components/path-link-menu";
import { promptRowAnchor } from "./components/prompt-anchor";
import { surfaceProps } from "./components/view-props";
import { useSelectionActions } from "./components/selection-actions";
import { usePointerGlow } from "./components/glow";
import { useFrostedGlass } from "./components/frosted";
import type { TurnUsage } from "./components/user-message";
import { NoticeCallout } from "./components/notice-callout";
import { StatusLine } from "./components/status-line";
import { useEnhancerPreferences } from "./preferences";
import { publishHubSnapshot } from "./hub-activity";
import { MarkdownView } from "./components/markdown/markdown-view";
import { TimelineTailHub } from "./components/hub-live";
import { ChecklistFeed, toTaskListData, useChecklistRowVisible } from "./components/checklist-live";
import { AssistantFooter } from "./components/turn-footer";
import { SystemCard } from "./components/system-card";
import { parseSystemEnvelope } from "./system-envelope";
import { useIsTimelineTail } from "./timeline-tail";
import { buildToolCalloutData } from "./tool-call-data";
import type { ToolCallPayload } from "./tool-call-data";
import type { ToolCalloutData, ReasoningTraceData, NoticeCalloutData } from "../shared/contracts";
import { revealPathRpc } from "../shared/file-rpc";
import { useImageFile } from "./image-file";

export type LiveToolCallPayload = ToolCallPayload;

export interface LiveReasoningPayload {
  text: string;
  phase?: string;
}

export interface LiveTodoPayload {
  items: Array<Record<string, unknown>>;
  key: string;
}

export interface LiveNoticePayload {
  level: string;
  message: string;
  fatal?: boolean;
}

export function LiveToolCallRenderer({
  agentId,
  item,
  theme,
  layout,
  timestamp,
}: PluginTimelineItemProps<LiveToolCallPayload>) {
  const revealPath = useRpc(revealPathRpc);
  const cwd = useAgent(agentId, (agent) => agent.cwd);
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme.colors, preferences);
  useSelectionActions(tokens, preferences.selectionActions);
  usePointerGlow(preferences.pointerGlow);
  useFrostedGlass(preferences.frostedGlass);
  const data = item.data;

  const calloutData = useMemo(() => buildToolCalloutData(data), [data]);

  // The dock has no access to the job manager, so the timeline is its only
  // source: every job snapshot that passes through a card is republished, and
  // the store drops the agent's entry once a snapshot reports nothing running.
  const hubData = calloutData.hub;
  useEffect(() => {
    if (!hubData || hubData.kind !== "jobs") return;
    publishHubSnapshot(agentId, {
      at: timestamp.getTime(),
      running: hubData.data.jobs.filter((job) => job.status === "running"),
      agents: hubData.data.agents ?? [],
    });
  }, [hubData, agentId]);

  // A relayed `custom` message without a readable envelope reads as prose.
  const displayData: ToolCalloutData =
    calloutData.tool === "system" ? { ...calloutData, tool: "note" } : calloutData;
  // Advisor notes open: a collapsed one says only "Advisor · 1 note".
  const isExpanded =
    displayData.tool === "advisor" || toolCardStartsExpanded(displayData, preferences);

  // The daemon side owns the shell, so revealing a file is one RPC. A path the
  // daemon cannot stat answers with an error the press simply ignores.
  const handleRevealPath = useCallback(
    (path: string) => {
      void revealPath({ cwd: cwd ?? "", path }).catch(() => {});
    },
    [cwd, revealPath],
  );

  // Only a read or write of an image asks the daemon for bytes; the hook
  // itself refuses every other path, so a code read costs no RPC.
  const imageFile = useImageFile(
    calloutData.tool === "read" || calloutData.tool === "write" ? calloutData.filePath : undefined,
    cwd,
  );

  // Telemetry is a status line, not a call: no header, no body, no disclosure.
  if (calloutData.tool === "status" && calloutData.telemetry) {
    return (
      <View {...hostFontEscape}>
        <StatusLine
          title={calloutData.title}
          data={calloutData.telemetry}
          status={calloutData.status}
          tokens={tokens}
        />
      </View>
    );
  }

  // A relayed `custom` message is not a tool call. When its text is an
  // envelope the plugin can read, the row draws the same standalone card an
  // `error` item uses. Text it cannot read falls through to the prose card
  // below, so an unknown custom type still shows its words.
  if (calloutData.tool === "system") {
    const envelope = parseSystemEnvelope(calloutData.text ?? "");
    if (envelope) {
      return (
        <View {...hostFontEscape}>
          <SystemCard envelope={envelope} tokens={tokens} />
        </View>
      );
    }
  }

  return (
    <View {...surfaceProps(hostFontEscape, pathContextProps(agentId, cwd) ?? {})}>
      <ToolCallout
        data={displayData}
        tokens={tokens}
        defaultExpanded={isExpanded}
        onRevealPath={handleRevealPath}
        imageFile={imageFile}
      />
      <ChecklistFeed agentId={agentId} />
      <TimelineTailHub
        agentId={agentId}
        tokens={tokens}
        itemKey={`tool:${data.callId ?? calloutData.title}:${timestamp.getTime()}`}
        at={timestamp.getTime()}
        kind="tool"
      />
    </View>
  );
}

export function LiveReasoningRenderer({
  agentId,
  item,
  theme,
  timestamp,
}: PluginTimelineItemProps<LiveReasoningPayload>) {
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme.colors, preferences);
  useSelectionActions(tokens, preferences.selectionActions);
  usePointerGlow(preferences.pointerGlow);
  useFrostedGlass(preferences.frostedGlass);
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

  const itemKey = `reasoning:${timestamp.getTime()}`;

  return (
    <View {...hostFontEscape}>
      <ReasoningTrace
        data={reasoningData}
        tokens={tokens}
        defaultExpanded={data.phase === "streaming" || !preferences.collapseReasoning}
      />
      <ChecklistFeed agentId={agentId} />
      <TimelineTailHub
        agentId={agentId}
        tokens={tokens}
        itemKey={itemKey}
        at={timestamp.getTime()}
        kind="tool"
      />
    </View>
  );
}

/** Keeps cards visible unless the feed identifies a newer checklist for this agent. */
export function LiveTodoRenderer({
  agentId,
  item,
  theme,
}: PluginTimelineItemProps<LiveTodoPayload>) {
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme.colors, preferences);
  useSelectionActions(tokens, preferences.selectionActions);
  usePointerGlow(preferences.pointerGlow);
  useFrostedGlass(preferences.frostedGlass);
  const taskListData = useMemo(() => toTaskListData(item.data.items), [item.data.items]);
  const visible = useChecklistRowVisible(
    agentId,
    item.data.key,
    preferences.liveChecklist,
  );
  if (!visible) return null;

  return (
    <View {...hostFontEscape}>
      <TaskList data={taskListData} tokens={tokens} />
    </View>
  );
}

export interface LiveAssistantPayload {
  text: string;
}

/**
 * The assistant's own reply, drawn with the plugin's markdown renderer.
 *
 * The host's renderer carries a pipeline this plugin cannot import — mermaid,
 * images, its own file-path links — so `assistantMarkdown` exists to hand the
 * turn back when a reply needs any of that.
 */
export function LiveAssistantRenderer({
  agentId,
  item,
  theme,
  timestamp,
}: PluginTimelineItemProps<LiveAssistantPayload>) {
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme.colors, preferences);
  useSelectionActions(tokens, preferences.selectionActions);
  usePointerGlow(preferences.pointerGlow);
  useFrostedGlass(preferences.frostedGlass);
  // A markdown image with a relative path resolves against the agent's cwd.
  const cwd = useAgent(agentId, (agent) => agent.cwd);

  // A path the reply mentions shows in the daemon machine's file manager, the
  // same safe action a tool card's file name takes. Opening it goes through
  // the path menu, which asks first.
  const revealPath = useRpc(revealPathRpc);
  const revealFile = useCallback(
    (path: string) => {
      void revealPath({ cwd: cwd ?? "", path, agentId }).catch(() => {});
    },
    [agentId, cwd, revealPath],
  );


  // Replacing the reply costs the host's footer, which the stream layout hangs
  // off an `assistant_message` item that no longer exists. Rebuild it where the
  // host puts it: under the newest message, once, not under every reply.
  const itemKey = `assistant:${timestamp.getTime()}`;
  const isTail = useIsTimelineTail(agentId, itemKey);

  // Job results, IRC relays and reminders once arrived as replies, because an
  // unclaimed `custom` message used to be filed under this item kind. Current
  // hosts send them as synthetic tool calls instead (see `tool-call-data.ts`);
  // the parse stays for rows recorded by older hosts.
  const envelope = useMemo(() => parseSystemEnvelope(item.data.text), [item.data.text]);

  return (
    <View {...surfaceProps(hostFontEscape, pathContextProps(agentId, cwd) ?? {})}>
      {envelope ? (
        <SystemCard envelope={envelope} tokens={tokens} />
      ) : (
        <MarkdownView
          text={item.data.text}
          tokens={tokens}
          variant={preferences.markdownVariant}
          foldCodeAfter={preferences.codeFoldLimit}
          cwd={cwd}
          marks={preferences.markSyntax}
          onRevealFile={revealFile}
        />
      )}
      {isTail && !envelope ? (
        <AssistantFooter text={item.data.text} at={timestamp} tokens={tokens} />
      ) : null}
      <ChecklistFeed agentId={agentId} />
      <TimelineTailHub
        agentId={agentId}
        tokens={tokens}
        itemKey={itemKey}
        at={timestamp.getTime()}
        kind="reply"
      />
    </View>
  );
}

/**
 * The host draws a `notification` or `error` item as bare text with an icon,
 * which reads as a different product beside the plugin's callouts. Both carry
 * only a level and a message, so the card is a badge plus that message.
 */
export function LiveNoticeRenderer({ item, theme }: PluginTimelineItemProps<LiveNoticePayload>) {
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme.colors, preferences);
  useSelectionActions(tokens, preferences.selectionActions);
  usePointerGlow(preferences.pointerGlow);
  useFrostedGlass(preferences.frostedGlass);
  const data = item.data;
  const level = data.level === "warning" || data.level === "error" ? data.level : "info";

  const noticeData: NoticeCalloutData = useMemo(
    () => ({
      id: `notice-${data.message.length}-${level}`,
      level,
      message: data.message,
      ...(data.fatal ? { fatal: true } : {}),
    }),
    [data.message, data.fatal, level],
  );

  return (
    <View {...hostFontEscape}>
      <NoticeCallout data={noticeData} tokens={tokens} />
    </View>
  );
}

export interface LiveUserMessagePayload {
  text: string;
  images?: string[];
  /** The host's own id for this message, when the provider gave one. */
  messageId?: string;
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
  const tokens = useThemeTokens(theme.colors, preferences);
  useSelectionActions(tokens, preferences.selectionActions);
  usePointerGlow(preferences.pointerGlow);
  useFrostedGlass(preferences.frostedGlass);
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

  // The same envelopes reach this item kind on some hosts and on history
  // replay. A job result is not something the user said, so it never takes the
  // user bubble.
  const envelope = useMemo(() => parseSystemEnvelope(item.data.text), [item.data.text]);

  return (
    <View {...surfaceProps(hostFontEscape, promptRowAnchor(item.data.messageId))}>
      {envelope ? (
        <SystemCard envelope={envelope} tokens={tokens} />
      ) : (
        <UserMessage
          text={item.data.text}
          images={item.data.images}
          timestamp={timestamp}
          tokens={tokens}
          usage={observedLive ? usage : null}
          pending={running && !frozen}
          foldAfterLines={preferences.promptFoldLimit}
        />
      )}
      <ChecklistFeed agentId={agentId} />
      <TimelineTailHub
        agentId={agentId}
        tokens={tokens}
        itemKey={`prompt:${timestamp.getTime()}`}
        at={timestamp.getTime()}
        kind="tool"
      />
    </View>
  );
}
