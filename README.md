# OMP Chat Enhancer

A Paseo plugin that presents real Oh My Pi (OMP) reasoning, tool calls, approvals, and tasks in the assistant chat stream.

---

## Design Inspirations

1. **Chain-of-Thought Reasoning Trace**  
   Inspired by [Prompt-kit Chain of Thought](https://www.prompt-kit.com/docs/chain-of-thought):
   - Collapsible trigger bar with duration (`Thought for 4.8s`), step count, token meter, and model chip.
   - Stepper timeline with connected vertical guide dots and status badges (Completed, Active, Pending).
   - Inlined syntax-highlighted code snippets and AST inspection snapshots.

2. **Action Approval Card**  
   Inspired by [aicss.dev Approval Card](https://www.aicss.dev/components/approval-card):
   - Prominent risk classification badge (`HIGH RISK` / `MEDIUM RISK` / `LOW RISK`).
   - Monospace command box with prompt (`$`), arguments, and copy button.
   - Target path diff view with added/removed line markers.
   - Context metadata (working directory, timeout).
   - Action buttons with keyboard shortcut cues (`[⏎ Enter]` for Approve, `[Esc]` for Deny, and `Allow for Session`).

3. **Multi-Step Task Progress List**  
   Inspired by [aicss.dev Task List](https://www.aicss.dev/components/task-list) & OMP `todo` tool:
   - Header with phase label, completed/total counter (`3/5 completed`), and visual progress bar (`60%`).
   - Distinct row states: completed (green check, strikethrough), in-progress (pulsing indicator, elevated card), pending (empty ring), and blocked (amber warning with expandable reason).

4. **Callout-Style Outputs for Built-in OMP Tools**  
   Tailored presentations for each tool kind:
   - `hub`: Agent coordination callout covering:
     - **Peer messaging**: Routing pill (`Main → SecurityReviewer`), delivery receipt (`✓ delivered in 14ms`), and synchronous reply thread.
     - **Process supervisor**: Managed daemon process status, TCP port readiness (`● :6767 ready`), regex log matcher, and process controls (Stop / Restart).
     - **Background jobs**: Snapshot matrix of active background tasks with elapsed timers and cancel triggers.
   - `thinking`: Reasoning callout with model badge, token metrics, and multi-step breakdown.
   - `shell`: Interactive PTY terminal window with working directory badge, exit code, elapsed time, and stdout/stderr streams.
   - `mcp`: Model Context Protocol callout with server namespace badge (`devnav`, `linkml`), transport badge, formatted JSON input arguments, and structured result payload.
   - `bash`: Terminal window box with colored dots, command syntax, exit code pill (`code 0`), duration, and collapsible output stream.
   - `read`: Code viewer callout with language tag, file path link (`src/server/agent/hub.ts:45-92`), line numbers, and syntax highlighting.
   - `edit`: Unified diff callout with line additions (`+`) in emerald green and removals (`-`) in rose red.
   - `eval`: Persistent REPL sandbox cell with runtime badge (`Bun / TS` or `Python`) and execution result card.
   - `ask`: Multiple-choice decision cards with "Recommended" pill and click-to-select interaction.
   - `task`: Subagent delegation pill with agent avatar (`scout`), model badge, and live progress state.

5. **Branded File Type Badges (`FileTypeLogo`)**  
   Crisp branded file type badges integrated across code snippets, file peek cards, and diff viewers:
   - **TypeScript** (`TS`, official `#3178C6` blue)
   - **Python** (`PY`, `#3776AB` blue with `#FFD438` gold)
   - **JavaScript** (`JS`, `#F7DF1E` yellow)
   - **Rust** (`RS`, `#CE412B` rust red)
   - **Shell / Bash** (`>_`, `#24292E` slate with `#00E676` prompt)
   - **JSON** (`{}`, `#5E5E5E` slate with `#FFD54F` gold)
   - **Markdown** (`M↓`, `#083FA1` markdown blue)
   - **HTML / CSS / SQL / Diff**

6. **Paseo Theme and Inline Stream**
   - Inherits `theme.colors` directly, so every component follows the active Paseo theme.
   - Adds no assistant-turn container. Reasoning, tools, and tasks remain inline with the native stream.
   - Uses crisp vector Lucide icons instead of emoji characters.

---

## Project Structure

omp-chat-enhancer/
paseo-plugin.json # Manifest (requires Paseo >=0.8.0-beta.1)
index.client.tsx # Registers the chat renderers and Settings page
index.server.ts # Server entry point
package.json # Dependencies and typecheck script
tsconfig.json # TypeScript configuration
shared/
contracts.ts # Shared types for reasoning, tasks, and tools
client/
live-renderers.tsx # Maps live OMP timeline events to presentation data
settings-page.tsx # Plugin settings, including glass and syntax choices
components/
theme-tokens.ts # Theme tokens derived from the host theme
reasoning-trace.tsx # Collapsible reasoning trace
approval-card.tsx # Permission request presentation
task-list.tsx # Todo presentation
tool-callouts.tsx # Dedicated OMP tool callouts
hub-callout.tsx # Agent coordination and process callouts

---

## Component API & Props

### 1. `ReasoningTrace`

```tsx
import { ReasoningTrace } from "./components/reasoning-trace.client";

<ReasoningTrace
  data={{
    id: "rt-1",
    agentModel: "google/gemini-3.8-flash",
    durationMs: 4800,
    totalTokens: 1480,
    status: "completed",
    steps: [
      {
        id: "step-1",
        number: 1,
        title: "Orient codebase & inspect session schema",
        durationMs: 1200,
        status: "completed",
        content: "Queried codedb symbol index for TokenStore...",
        codeSnippet: { language: "typescript", code: "..." },
      },
    ],
  }}
  tokens={tokens}
  defaultExpanded={true}
/>;
```

### 2. `ApprovalCard`

```tsx
import { ApprovalCard } from "./components/approval-card.client";

<ApprovalCard
  request={{
    id: "appr-1",
    toolName: "bash",
    title: "Execute Database Migration",
    riskLevel: "high",
    rationale: "Apply database schema changes before starting daemon.",
    command: "pnpm run db:migrate",
    cwd: "C:/Users/.../happy-bell",
    timeoutSeconds: 60,
    status: "pending",
    timestamp: "15:10:22",
  }}
  tokens={tokens}
  onApprove={(id, scope) => console.log("Approved:", id, scope)}
  onDeny={(id) => console.log("Denied:", id)}
/>;
```

### 3. `TaskList`

```tsx
import { TaskList } from "./components/task-list.client";

<TaskList
  data={{
    id: "tl-1",
    phaseName: "Token Rotation & Verification",
    tasks: [
      {
        id: "t-1",
        title: "Audit token-rotation schema",
        phase: "Auth",
        status: "completed",
        duration: "1.2s",
      },
      { id: "t-2", title: "Execute automated test suite", phase: "Auth", status: "in_progress" },
      {
        id: "t-3",
        title: "Verify backward compatibility",
        phase: "Auth",
        status: "blocked",
        blockerReason: "Waiting for user decision",
      },
    ],
  }}
  tokens={tokens}
  onToggleTask={(taskId, status) => console.log("Task toggled:", taskId, status)}
/>;
```

### 4. `ToolCallout`

```tsx
import { ToolCallout } from "./components/tool-callouts.client";

<ToolCallout
  data={{
    id: "tc-bash",
    tool: "bash",
    title: "Running test suite",
    status: "completed",
    durationMs: 340,
    exitCode: 0,
    command: "pnpm test",
    output: "PASS 3 tests completed in 2.1s",
  }}
  tokens={tokens}
  defaultExpanded={true}
/>;
```

---

## Runtime behavior

The plugin intercepts only OMP timeline items. It replaces their default rendering with enhanced presentations:

1. **Reasoning (`thought`)** renders the collapsible trace.
2. **Permissions** render the approval card and retain the host approval actions.
3. **Todo lists** render the interactive checklist.
4. **Tool calls** render tool-aware output, including terminal, source, diff, question, and coordination layouts.
5. **Prompts** render the enhanced bubble with token usage.

A file name in a source, diff, or read block is a link. Pressing it asks the daemon side to show
that file in the machine's own file manager: Explorer selects it on Windows, Finder selects it on
macOS, and every other platform opens the containing directory. Paseo exposes no file navigation to
plugins, so the link cannot open Paseo's own editor.

Open **Settings → Plugins → OMP Chat Enhancer** to select the accent, interface and code fonts, and
frosted-glass effect. The same page turns the enhanced prompt bubble off. Paseo removes pasted
images while it maps a message for plugins, so only the host's own bubble can show them.
