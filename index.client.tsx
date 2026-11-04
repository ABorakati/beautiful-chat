import type { PluginClientContext } from "@getpaseo/plugin/client";
import { z } from "zod";
import { BeautifulChatSettingsPage } from "./client/settings-page";
import { embedFonts } from "./client/components/embed-fonts";
import { installFrostedGlass } from "./client/components/frosted";
import { installShimmer } from "./client/components/shimmer";
import { installPointerGlow } from "./client/components/glow";
import { installHostNoticeStyle } from "./client/components/host-notice";
import { installChatFind } from "./client/components/chat-find";
import { installPathLinkMenu } from "./client/components/path-link-menu";
import { extractPromptImages } from "./client/prompt-images";
import { getEnhancerPreferences, subscribeEnhancerPreferences } from "./client/preferences";
import { hostFoldsToolCalls, observeHostToolFolding } from "./client/host-settings";
import {
  checklistKey,
  isSupersededChecklist,
  subscribeSupersededChecklist,
} from "./client/components/checklist-live";
import { buildToolCallPayload } from "./client/tool-call-data";
import {
  LiveToolCallRenderer,
  LiveReasoningRenderer,
  LiveTodoRenderer,
  LiveUserMessageRenderer,
  LiveNoticeRenderer,
  LiveAssistantRenderer,
} from "./client/live-renderers";

type JsonValue = boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };

function toJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

export default function contribute(client: PluginClientContext) {
  // Install the bundled faces before any surface paints.
  const removeFonts = embedFonts();
  const removeFrost = installFrostedGlass();
  const removeShimmer = installShimmer();
  const removeGlow = installPointerGlow();
  // The host draws  rows itself; this only re-chromes them.
  const removeNoticeStyle = installHostNoticeStyle();
  // Paseo's Ctrl+F cannot reveal rows this plugin draws; this bar can.
  const removeChatFind = installChatFind();
  // Add copy, open, and reveal actions to path targets.
  const removePathLinkMenu = installPathLinkMenu(client);

  // Configuration lives in the host Settings area. The plugin has no showcase
  // surface, panels, or Command Center item.
  client.addSettingsScreen({
    id: "chat-presentation",
    title: "Chat presentation",
    icon: "Blocks",
    Component: BeautifulChatSettingsPage,
  });

  let foldsToolCalls = getEnhancerPreferences().paseoToolFolding && hostFoldsToolCalls();
  let hidesReasoning = foldsToolCalls && !getEnhancerPreferences().overviewReasoning;

  // Live chat timeline interception: render real tool calls, reasoning, and todos with enhanced UI.
  const registerToolTransformer = () => client.addTimelineTransformer({
    id: "omp-enhanced-tool-call",
    query: { itemType: "tool_call" },
    transform({ item, phase }) {
      if (item.type !== "tool_call") return undefined;
      // Paseo can fold only its own tool rows. A plugin row breaks the run.
      if (foldsToolCalls) return undefined;
      return {
        items: [
          {
            type: "plugin" as const,
            kind: "omp-tool-call",
            version: 1,
            // `metadata` carries the host's `source`/`customType`: omp's
            // retry, fallback and goal rows share a tool name, and the
            // unclaimed `custom` messages are only identifiable there.
            data: buildToolCallPayload(item, phase) as unknown as JsonValue,
          },
        ],
      };
    },
  });
  let removeToolTransformer = registerToolTransformer();

  const removeToolRenderer = client.addTimelineRenderer({
    kind: "omp-tool-call",
    version: 1,
    schema: z.object({
      name: z.string(),
      status: z.string(),
      detail: z.record(z.string(), z.unknown()).optional(),
      callId: z.string().optional(),
      error: z.string().nullable().optional(),
      phase: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }),
    Component: LiveToolCallRenderer,
  });

  const registerReasoningTransformer = () => client.addTimelineTransformer({
    id: "omp-enhanced-reasoning",
    query: { itemType: "reasoning" },
    transform({ item, phase }) {
      if (item.type !== "reasoning") return undefined;
      if (hidesReasoning) return { items: [] };
      return {
        items: [
          {
            type: "plugin" as const,
            kind: "omp-reasoning",
            version: 1,
            data: {
              text: item.text,
              phase,
            },
          },
        ],
      };
    },
  });
  let removeReasoningTransformer = registerReasoningTransformer();

  let stopObservingHost: (() => void) | undefined;
  const refreshToolFolding = () => {
    const preferences = getEnhancerPreferences();
    if (preferences.paseoToolFolding) {
      stopObservingHost ??= observeHostToolFolding(refreshToolFolding);
    } else {
      stopObservingHost?.();
      stopObservingHost = undefined;
    }
    const nextFoldsToolCalls = preferences.paseoToolFolding && hostFoldsToolCalls();
    const nextHidesReasoning = nextFoldsToolCalls && !preferences.overviewReasoning;
    if (nextFoldsToolCalls === foldsToolCalls && nextHidesReasoning === hidesReasoning) return;
    foldsToolCalls = nextFoldsToolCalls;
    hidesReasoning = nextHidesReasoning;
    // A new transformer identity invalidates Paseo's cached rows.
    removeToolTransformer();
    removeReasoningTransformer();
    removeToolTransformer = registerToolTransformer();
    removeReasoningTransformer = registerReasoningTransformer();
  };
  const unsubscribePreferences = subscribeEnhancerPreferences(refreshToolFolding);
  refreshToolFolding();

  const removeReasoningRenderer = client.addTimelineRenderer({
    kind: "omp-reasoning",
    version: 1,
    schema: z.object({
      text: z.string(),
      phase: z.string().optional(),
    }),
    Component: LiveReasoningRenderer,
  });

  // Transformers have no agent context. Suppress only content that no observed agent needs as its newest list.
  const registerTodoTransformer = () => client.addTimelineTransformer({
    id: "omp-enhanced-todo",
    query: { itemType: "todo" },
    transform({ item }) {
      if (item.type !== "todo") return undefined;
      const key = checklistKey(item.items);
      if (getEnhancerPreferences().liveChecklist && isSupersededChecklist(key)) return { items: [] };
      return {
        items: [
          {
            type: "plugin" as const,
            kind: "omp-todo",
            version: 1,
            data: { items: toJsonValue(item.items), key },
          },
        ],
      };
    },
  });
  let removeTodoTransformer = registerTodoTransformer();
  let todoRefresh: NodeJS.Timeout | undefined;
  const refreshTodoTransformer = () => {
    removeTodoTransformer();
    removeTodoTransformer = registerTodoTransformer();
  };
  // Refresh at most once per frame. A timer, not a frame callback, also runs in a hidden window.
  const stopSupersededWatch = subscribeSupersededChecklist(() => {
    if (todoRefresh !== undefined || !getEnhancerPreferences().liveChecklist) return;
    todoRefresh = setTimeout(() => {
      todoRefresh = undefined;
      refreshTodoTransformer();
    }, 16);
  });
  let liveChecklist = getEnhancerPreferences().liveChecklist;
  const stopChecklistWatch = subscribeEnhancerPreferences(() => {
    const next = getEnhancerPreferences().liveChecklist;
    if (next === liveChecklist) return;
    liveChecklist = next;
    clearTimeout(todoRefresh);
    todoRefresh = undefined;
    refreshTodoTransformer();
  });

  const removeTodoRenderer = client.addTimelineRenderer({
    kind: "omp-todo",
    version: 1,
    schema: z.object({
      items: z.array(z.record(z.string(), z.unknown())),
      key: z.string(),
    }),
    Component: LiveTodoRenderer,
  });

  const removeUserTransformer = client.addTimelineTransformer({
    id: "omp-enhanced-user-message",
    query: { itemType: "user_message" },
    transform({ item }) {
      if (item.type !== "user_message") return undefined;
      // The host strips images while mapping the stream item, so an enhanced
      // bubble would silently swallow a pasted screenshot. The preference lets
      // the reader trade the bubble for the host's image previews.
      if (!getEnhancerPreferences().enhancedUserBubble) return undefined;
      const images = extractPromptImages(item);
      // Replacing the item drops whatever this renderer does not carry, so a
      // message with an attachment it cannot show is left to the host.
      if (images.hasUnrenderable) return undefined;
      // `messageId` rides along so the renderer can carry the host's own
      // `data-history-row-id`, which is the id the chat outline scrolls to.
      // Replacing the item leaves the outline nothing to find otherwise.
      return {
        items: [
          {
            type: "plugin" as const,
            kind: "omp-user-message",
            version: 1,
            data: toJsonValue({
              text: item.text,
              ...(images.uris.length > 0 ? { images: images.uris } : {}),
              ...(item.messageId ? { messageId: item.messageId } : {}),
            }),
          },
        ],
      };
    },
  });

  const removeUserRenderer = client.addTimelineRenderer({
    kind: "omp-user-message",
    version: 1,
    schema: z.object({
      text: z.string(),
      images: z.array(z.string()).optional(),
      messageId: z.string().optional(),
    }),
    Component: LiveUserMessageRenderer,
  });

  // The assistant's reply. The preference is read inside `transform` so a
  // change takes effect on the next message without a plugin reload, and a
  // reply the plugin should not own is left to the host.
  const removeAssistantTransformer = client.addTimelineTransformer({
    id: "omp-enhanced-assistant",
    query: { itemType: "assistant_message" },
    transform({ item }) {
      if (item.type !== "assistant_message") return undefined;
      if (!getEnhancerPreferences().assistantMarkdown) return undefined;
      if (!item.text.trim()) return undefined;
      return {
        items: [
          {
            type: "plugin" as const,
            kind: "omp-assistant",
            version: 1,
            data: { text: item.text },
          },
        ],
      };
    },
  });

  const removeAssistantRenderer = client.addTimelineRenderer({
    kind: "omp-assistant",
    version: 1,
    schema: z.object({ text: z.string() }),
    Component: LiveAssistantRenderer,
  });

  // Only `error` is intercepted here. Paseo 0.8 accepts transformers for
  // user_message, assistant_message, reasoning, tool_call, todo, error, and
  // compaction; `notification` — the ⓘ row a finished background job produces —
  // is not on that list, and registering it throws. Every contribution in this
  // function shares one call frame, so that throw drops every renderer the
  // plugin installs and the whole chat falls back to native styling. Add the
  // notification transformer the day the host accepts the type, not before.

  const removeErrorTransformer = client.addTimelineTransformer({
    id: "omp-enhanced-error",
    query: { itemType: "error" },
    transform({ item }) {
      if (item.type !== "error") return undefined;
      return {
        items: [
          {
            type: "plugin" as const,
            kind: "omp-notice",
            version: 1,
            data: { level: "error", message: item.message, fatal: true },
          },
        ],
      };
    },
  });

  const removeNoticeRenderer = client.addTimelineRenderer({
    kind: "omp-notice",
    version: 1,
    schema: z.object({
      level: z.string(),
      message: z.string(),
      fatal: z.boolean().optional(),
    }),
    Component: LiveNoticeRenderer,
  });

  return () => {
    unsubscribePreferences();
    stopObservingHost?.();
    removeFonts();
    removeFrost();
    removeShimmer();
    removeGlow();
    removeNoticeStyle();
    removeChatFind();
    removePathLinkMenu();
    removeToolTransformer();
    removeToolRenderer();
    removeReasoningTransformer();
    removeReasoningRenderer();
    stopSupersededWatch();
    stopChecklistWatch();
    clearTimeout(todoRefresh);
    removeTodoTransformer();
    removeTodoRenderer();
    removeUserTransformer();
    removeUserRenderer();
    removeAssistantTransformer();
    removeAssistantRenderer();
    removeErrorTransformer();
    removeNoticeRenderer();
  };
}
