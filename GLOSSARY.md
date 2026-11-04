# Glossary

Terms this plugin uses about Paseo's timeline and omp's output. Behaviour lives in the code and the
README; this file only fixes what the words mean.

**Timeline item** — One row in the chat stream, as Paseo models it: a user message, an assistant
message, reasoning, a tool call, a checklist, a notification, an error, or a compaction.

**Tool call** — A timeline item for one tool invocation: `name`, `status`, `detail`, and optional
`metadata`. Cards render from this record, not from any provider's wire format.

**`plain_text` detail** — A tool call whose payload is prose: a `label` and a `text`. Several
providers use it for tools that have no structured result.

**Synthetic tool call** — A tool call Paseo creates itself for output that was never a tool
invocation: an advisor message, a retry or fallback event, or a `custom` message it could not
claim. Identified by `metadata.synthetic` and by the `metadata.source` naming the event.

**Advisor** — omp's reviewing voice, delivered as a `custom` message. Its payload is a list of
**advisor notes**.

**Advisor note** — One piece of advice: a body, an optional **severity**, and an optional advisor
name. Paseo passes only the flattened text, so the note is identified by its `[severity]` prefix.

**Severity** — The weight of an advisor note: `nit` (style), `concern` (may matter), or `blocker`
(must be read before proceeding).

**Telemetry row** — A one-line synthetic row for an event that reports state rather than a result:
`retry_fallback_applied`, `retry_fallback_succeeded`, `auto_retry_start`, `auto_retry_end`, or
`goal_updated`.

**Custom message** — A provider message that is neither a user's nor the model's: a relayed agent
message, a supervised-process report, a reminder. Paseo turns an unclaimed one into a synthetic tool
call named after its `customType`.

**Envelope** — The tagged text a custom message carries (`<system-notice>`, `<irc>`,
`<system-reminder>`, or a bare `Supervised process …` line). The plugin reads it into a **system
card**; text that is not an envelope is drawn as prose.

**System card** — The standalone card for an envelope. It carries no tool chrome because the row
reports something that happened elsewhere.
