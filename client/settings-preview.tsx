import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useFrostedGlass } from "./components/frosted";
import { usePointerGlow } from "./components/glow";
import { MarkdownView } from "./components/markdown/markdown-view";
import { ReasoningTrace } from "./components/reasoning-trace";
import { useSelectionActions } from "./components/selection-actions";
import { TaskList } from "./components/task-list";
import { ToolCallout } from "./components/tool-callouts";
import { UserMessage } from "./components/user-message";
import { radius, type ExtendedThemeTokens } from "./components/theme-tokens";
import type { EnhancerPreferences } from "./preferences";
import { toolCardStartsExpanded } from "./tool-collapse";
import type { ReasoningTraceData, TaskListData, ToolCalloutData } from "../shared/contracts";

const REASONING: ReasoningTraceData = {
  id: "settings-reasoning",
  agentModel: "",
  durationMs: 0,
  totalTokens: 128,
  status: "completed",
  steps: [{
    id: "read",
    number: 1,
    title: "Review the layout",
    status: "completed",
    content: "I will keep the text clear and the code easy to read.",
  }],
};

const BASH: ToolCalloutData = {
  id: "settings-bash",
  tool: "bash",
  title: "Check types",
  status: "running",
  command: "npm run typecheck",
  shell: {
    command: "npm run typecheck",
    stdout: "> tsc --noEmit\nChecking source files…",
  },
};

const CHECKLIST: TaskListData = {
  id: "settings-checklist",
  phaseName: "Plan",
  tasks: [
    { id: "layout", title: "Review the layout", phase: "Review", status: "completed" },
    { id: "types", title: "Check the types", phase: "Check", status: "in_progress" },
  ],
};

const REPLY = [
  "## Ready to review",
  "",
  "The `theme` follows your settings.",
  "",
  "- Clear text",
  "- Code with the selected font",
  "",
  "```typescript",
  "const ready = x => x !== null;",
  "```",
].join("\n");

export function SettingsPreview({
  preferences,
  tokens,
}: {
  preferences: EnhancerPreferences;
  tokens: ExtendedThemeTokens;
}) {
  useSelectionActions(tokens, preferences.selectionActions);
  usePointerGlow(preferences.pointerGlow);
  useFrostedGlass(preferences.frostedGlass);
  const textStyle = { color: tokens.foregroundMuted, fontFamily: tokens.fontUi };
  return (
    <View testID="settings-preview" style={[styles.panel, { borderColor: tokens.borderSubtle, backgroundColor: tokens.surface1 }]}>
      <View style={[styles.header, { borderBottomColor: tokens.borderSubtle }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>Preview</Text>
        <Text style={[styles.description, textStyle]}>Sample conversation. Changes appear here immediately.</Text>
      </View>
      <View style={styles.conversation}>
        {preferences.enhancedUserBubble ? (
          <UserMessage
            text="Use clear text and keep the code easy to read."
            tokens={tokens}
            foldAfterLines={preferences.promptFoldLimit}
          />
        ) : (
          <Text style={[styles.note, textStyle]}>Paseo draws the prompt with its own bubble.</Text>
        )}
        <ReasoningTrace
          key={`reasoning-${preferences.collapseReasoning}`}
          data={REASONING}
          tokens={tokens}
          defaultExpanded={!preferences.collapseReasoning}
        />
        <ToolCallout
          key={`tool-${preferences.expandWhileRunning}-${preferences.collapseTools.join(",")}-${preferences.collapseLineLimit}`}
          data={BASH}
          tokens={tokens}
          defaultExpanded={toolCardStartsExpanded(BASH, preferences)}
        />
        <View style={styles.reply}>
          {preferences.assistantMarkdown ? (
            <MarkdownView
              text={REPLY}
              tokens={tokens}
              variant={preferences.markdownVariant}
              foldCodeAfter={preferences.codeFoldLimit}
            />
          ) : (
            <Text style={[styles.note, textStyle]}>Paseo draws the reply. Enable Assistant markdown to preview its styles.</Text>
          )}
        </View>
        <View>
          <Text style={[styles.label, textStyle]}>Checklist</Text>
          <TaskList data={CHECKLIST} tokens={tokens} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: radius.card, overflow: "hidden", minWidth: 0 },
  header: { padding: 16, gap: 4, borderBottomWidth: 1 },
  title: { fontSize: 16, lineHeight: 24, fontWeight: "700" },
  description: { fontSize: 12, lineHeight: 20 },
  conversation: { padding: 16, gap: 8 },
  note: { fontSize: 12, lineHeight: 20, paddingVertical: 8 },
  reply: { paddingVertical: 8 },
  label: { fontSize: 10, lineHeight: 16, fontWeight: "600" },
});
