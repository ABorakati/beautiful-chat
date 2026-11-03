import type { ToolCalloutData } from "../shared/contracts";
import type { CollapsibleToolGroup, EnhancerPreferences } from "./preferences";

function toolGroup(tool: ToolCalloutData["tool"]): CollapsibleToolGroup {
  if (tool === "bash" || tool === "shell" || tool === "git") return "shell";
  if (tool === "write" || tool === "edit" || tool === "read") return tool;
  return "other";
}

function lineCount(text: string | undefined): number {
  return text ? text.split("\n").length : 0;
}

/**
 * Roughly how tall the open card is, in lines of the text it shows. Exact
 * enough to tell a three-line edit from a whole file, which is all the line
 * limit asks.
 */
function bodyLines(data: ToolCalloutData): number {
  const mcp = data.mcp
    ? JSON.stringify(data.mcp.arguments, null, 2) +
      "\n" +
      (typeof data.mcp.result === "string"
        ? data.mcp.result
        : JSON.stringify(data.mcp.result ?? "", null, 2))
    : undefined;
  return (
    lineCount(data.shell?.command ?? data.command) +
    lineCount(data.shell?.stdout) +
    lineCount(data.shell?.stderr) +
    lineCount(data.code) +
    lineCount(data.diff) +
    lineCount(data.output) +
    lineCount(mcp) +
    (data.cells ?? []).reduce((sum, cell) => sum + lineCount(cell.code) + lineCount(cell.output), 0)
  );
}

/**
 * Whether a tool card opens. A failure always does, so the error is in view,
 * and so does a question, since folding it would hide what the agent asked.
 * A running card opens while it streams unless the reader turned that off,
 * and a finished one folds when its group is set to collapse and it runs
 * past the line limit.
 */
export function toolCardStartsExpanded(
  data: ToolCalloutData,
  preferences: EnhancerPreferences,
): boolean {
  if (data.status === "failed" || data.tool === "ask") return true;
  if (data.status === "running" && preferences.expandWhileRunning) return true;
  if (!preferences.collapseTools.includes(toolGroup(data.tool))) return true;
  return preferences.collapseLineLimit > 0 && bodyLines(data) <= preferences.collapseLineLimit;
}
